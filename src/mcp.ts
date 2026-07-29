// Multi-MCP Client: connects to Yahoo Finance MCP + China Stock MCP
// Routes queries based on symbol type

import http from "http";

// MCP server configs from env
interface MCPServerConfig {
  name: string;
  url: string;
  host: string;
}

const MCP_SERVERS: MCPServerConfig[] = (process.env.MCP_SERVERS || "yahoo|http://192.168.31.51:3000|localhost:3000").split(";").map((s) => {
  const [name, url, host] = s.split("|");
  return { name, url, host };
});

// Fallback: legacy single-server config
if (MCP_SERVERS.length === 1 && MCP_SERVERS[0].name === "yahoo" && process.env.MCP_BASE_URL) {
  MCP_SERVERS[0].url = process.env.MCP_BASE_URL;
}

// Add China stock MCP if configured
const CHINA_MCP_URL = process.env.MCP_CHINA_URL;
if (CHINA_MCP_URL && !MCP_SERVERS.find((s) => s.name === "china")) {
  const host = new URL(CHINA_MCP_URL).host;
  MCP_SERVERS.push({ name: "china", url: CHINA_MCP_URL, host });
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
}

interface MCPSession {
  server: MCPServerConfig;
  sessionId: string;
  tools: MCPTool[];
}

// Session cache per server
const sessions = new Map<string, MCPSession>();

// ============================================================
// HTTP helpers
// ============================================================

function mcpPost(
  server: MCPServerConfig,
  body: string,
  sessionId?: string
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(server.url);
    const basePath = url.pathname === "/" ? "" : url.pathname;
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: `${basePath}/mcp`,
      method: "POST",
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Host: server.host,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") headers[k] = v;
          else if (Array.isArray(v)) headers[k] = v.join(", ");
        }
        resolve({ status: res.statusCode || 0, headers, body });
      });
    });

    req.on("timeout", () => { req.destroy(); reject(new Error("MCP timeout")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseSSEData(text: string): any {
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  if (!line) return null;
  try { return JSON.parse(line.slice(6)); } catch { return null; }
}

function parseMCPResponse(text: string): string {
  const result = parseSSEData(text);
  if (!result) return "[MCP Error: No data]";
  if (result.error) return `[MCP Error: ${result.error.message}]`;
  const content = result.result?.content || result.result?.result || [];
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text || "").filter(Boolean).join("\n");
  }
  return JSON.stringify(result.result, null, 2);
}

// ============================================================
// Session management per server
// ============================================================

async function initSession(server: MCPServerConfig): Promise<MCPSession> {
  const cached = sessions.get(server.name);
  if (cached) return cached;

  console.log(`[MCP:${server.name}] Connecting to ${server.url}`);

  const initBody = JSON.stringify({
    jsonrpc: "2.0", method: "initialize",
    params: {
      protocolVersion: "2025-03-26", capabilities: {},
      clientInfo: { name: "hermes-gateway", version: "0.6.0" },
    },
    id: 1,
  });

  const initResp = await mcpPost(server, initBody);
  const sessionId = initResp.headers["mcp-session-id"];
  if (!sessionId) throw new Error(`MCP:${server.name} no session ID`);

  const initResult = parseSSEData(initResp.body);
  console.log(`[MCP:${server.name}] Session ${sessionId.substring(0, 8)} - ${initResult?.result?.serverInfo?.name || "unknown"}`);

  // List tools
  const toolsBody = JSON.stringify({
    jsonrpc: "2.0", method: "tools/list", params: {}, id: 2,
  });
  const toolsResp = await mcpPost(server, toolsBody, sessionId);
  const toolsResult = parseSSEData(toolsResp.body);
  const tools: MCPTool[] = toolsResult?.result?.tools || [];

  console.log(`[MCP:${server.name}] ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

  const session: MCPSession = { server, sessionId, tools };
  sessions.set(server.name, session);
  return session;
}

async function callToolOnServer(
  server: MCPServerConfig,
  toolName: string,
  args: Record<string, any>
): Promise<string> {
  const session = await initSession(server);
  const body = JSON.stringify({
    jsonrpc: "2.0", method: "tools/call",
    params: { name: toolName, arguments: args },
    id: Date.now(),
  });

  let resp = await mcpPost(server, body, session.sessionId);

  if (resp.status !== 200) {
    sessions.delete(server.name);
    const newSession = await initSession(server);
    resp = await mcpPost(server, body, newSession.sessionId);
    if (resp.status !== 200) return `[MCP Error: ${resp.status}]`;
  }

  return parseMCPResponse(resp.body);
}

// ============================================================
// Server routing: which MCP server for which symbol
// ============================================================

function getServer(name: string): MCPServerConfig {
  return MCP_SERVERS.find((s) => s.name === name) || MCP_SERVERS[0];
}

/**
 * Determine if a symbol is a China A-share stock
 * Rules: sh/sz prefix, or 6-digit number starting with 0/3/6
 */
export function isChinaStock(symbol: string): boolean {
  const s = symbol.toLowerCase();
  if (s.startsWith("sh") || s.startsWith("sz")) return true;
  // Pure 6-digit number
  if (/^\d{6}$/.test(s)) {
    const first = s[0];
    return first === "0" || first === "3" || first === "6" || first === "1"; // 1=convertible bonds
  }
  // Has .SS or .SZ suffix (Yahoo format for China)
  if (/\.(ss|sz)$/i.test(symbol)) return true;
  return false;
}

// ============================================================
// Symbol extraction
// ============================================================

export function extractSymbols(message: string): { us: string[]; cn: string[] } {
  const usSymbols: string[] = [];
  const cnSymbols: string[] = [];
  const upper = message.toUpperCase();

  // A-share patterns
  // Pattern 1: sh/sz prefix (e.g., sh600519)
  const prefixPattern = /\b(sh|sz)(\d{6})\b/gi;
  let m;
  while ((m = prefixPattern.exec(message)) !== null) {
    const code = `${m[1].toLowerCase()}${m[2]}`;
    if (!cnSymbols.includes(code)) cnSymbols.push(code);
  }

  // Pattern 2: bare 6-digit codes (e.g., 600519, 300024)
  const barePattern = /\b(\d{6})\b/g;
  while ((m = barePattern.exec(message)) !== null) {
    const code = m[1];
    if (/^[036]/.test(code) && !cnSymbols.includes(code)) {
      cnSymbols.push(code);
    }
  }

  // US/HK/SG patterns
  const usPatterns = [
    /\$([A-Z]{1,5})\b/g,
    /\b([A-Z]{1,5})\.(SI|HK|SS|SZ|L|TO|AX|DE|PA)\b/g,
    /\b(NYSE|NASDAQ|SGX):([A-Z]{1,5})\b/gi,
  ];

  for (const pattern of usPatterns) {
    let match;
    while ((match = pattern.exec(upper)) !== null) {
      const symbol = match[2] && match[2].length <= 3
        ? `${match[1]}.${match[2]}` : match[2] || match[1];
      if (symbol && !usSymbols.includes(symbol) && !isChinaStock(symbol)) {
        usSymbols.push(symbol);
      }
    }
  }

  // Well-known ticker names
  const knownUS: Record<string, string> = {
    AAPL: "AAPL", MSFT: "MSFT", GOOGL: "GOOGL", AMZN: "AMZN",
    TSLA: "TSLA", NVDA: "NVDA", META: "META", COIN: "COIN",
    BABA: "BABA", SPCX: "SPCX", VOO: "VOO", SGOV: "SGOV",
    SATS: "S58.SI", OCBC: "O39.SI", UOB: "U11.SI", DBS: "D05.SI",
    SSB: "S68.SI", SINGTEL: "Z74.SI", FCT: "BUOU.SI",
    SPY: "SPY", QQQ: "QQQ", BTC: "BTC-USD", ETH: "ETH-USD",
    GLD: "GLD", TLT: "TLT",
  };

  for (const [name, ticker] of Object.entries(knownUS)) {
    if (upper.includes(name) && !usSymbols.includes(ticker) && !usSymbols.includes(name)) {
      usSymbols.push(ticker);
    }
  }

  // Well-known A-share names (Chinese)
  const knownCN: Record<string, string> = {
    "茅台": "600519", "五粮液": "000858", "比亚迪": "002594",
    "宁德时代": "300750", "隆基": "601012", "中国平安": "601318",
    "招商银行": "600036", "中信证券": "600030", "恒瑞医药": "600276",
    "美的": "000333", "格力": "000651", "海尔": "600690",
    "科大讯飞": "002230", "海康威视": "002415", "中兴通讯": "000063",
    "机器人": "300024", "中科曙光": "603019", "洋河": "002304",
    "长江电力": "600900", "工商银行": "601398",
  };

  for (const [name, code] of Object.entries(knownCN)) {
    if (message.includes(name) && !cnSymbols.includes(code)) {
      cnSymbols.push(code);
    }
  }

  return { us: usSymbols, cn: cnSymbols };
}

// ============================================================
// Data fetching: route to correct MCP server
// ============================================================

export interface StockData {
  symbol: string;
  market: "us" | "cn";
  info: string;
  news: string;
  earnings: string;
  priceHistory: string;
  fibonacci: string;  // China stocks only
}

async function fetchUSStock(symbol: string): Promise<StockData> {
  const server = getServer("yahoo");
  const data: StockData = { symbol, market: "us", info: "", news: "", earnings: "", priceHistory: "", fibonacci: "" };

  const [info, news, earnings, priceHistory] = await Promise.allSettled([
    callToolOnServer(server, "get-ticker-info", { symbol }),
    callToolOnServer(server, "get-ticker-news", { symbol, count: 5 }),
    callToolOnServer(server, "ticker-earning", { symbol, period: "quarterly" }),
    callToolOnServer(server, "get-price-history", { symbol, period: "6mo", interval: "1d" }),
  ]);

  if (info.status === "fulfilled") data.info = info.value;
  if (news.status === "fulfilled") data.news = news.value;
  if (earnings.status === "fulfilled") data.earnings = earnings.value;
  if (priceHistory.status === "fulfilled") data.priceHistory = priceHistory.value;

  return data;
}

async function fetchCNStock(symbol: string): Promise<StockData> {
  const server = getServer("china");
  const data: StockData = { symbol, market: "cn", info: "", news: "", earnings: "", priceHistory: "", fibonacci: "" };

  // Sequential calls to avoid session deadlock on shared MCP session
  try { data.info = await callToolOnServer(server, "get_realtime_quote", { symbols: [symbol] }); } catch (e: any) { console.error(`[MCP] CN quote error ${symbol}:`, e.message); }
  try { data.priceHistory = await callToolOnServer(server, "get_kline_history", { symbol, period: "day", count: 30 }); } catch (e: any) { console.error(`[MCP] CN kline error ${symbol}:`, e.message); }
  try { data.fibonacci = await callToolOnServer(server, "get_fibonacci_levels", { symbol, days: 20 }); } catch (e: any) { console.error(`[MCP] CN fib error ${symbol}:`, e.message); }

  return data;
}

// Also fetch A-share market context (indices, sectors, northbound)
async function fetchCNMarketContext(): Promise<string> {
  const server = getServer("china");
  const parts: string[] = [];

  const [indices, sectors, northbound] = await Promise.allSettled([
    callToolOnServer(server, "get_market_indices", {}),
    callToolOnServer(server, "get_sector_ranking", { count: 10 }),
    callToolOnServer(server, "get_northbound_flow", { days: 5 }),
  ]);

  if (indices.status === "fulfilled" && indices.value && !indices.value.includes("Error")) {
    parts.push(`**大盘指数:**\n${indices.value.substring(0, 1000)}`);
  }
  if (sectors.status === "fulfilled" && sectors.value && !sectors.value.includes("Error")) {
    parts.push(`**涨幅前10板块:**\n${sectors.value.substring(0, 1000)}`);
  }
  if (northbound.status === "fulfilled" && northbound.value && !northbound.value.includes("Error")) {
    parts.push(`**北向资金(近5日):**\n${northbound.value.substring(0, 800)}`);
  }

  return parts.join("\n\n");
}

export async function fetchStockData(
  symbols: { us: string[]; cn: string[] }
): Promise<Map<string, StockData>> {
  const dataMap = new Map<string, StockData>();

  const promises: Promise<void>[] = [];

  // US stocks via Yahoo MCP
  for (const symbol of symbols.us) {
    promises.push(
      fetchUSStock(symbol).then((data) => { dataMap.set(symbol, data); })
        .catch((err) => console.error(`[MCP] US fetch error ${symbol}:`, err.message))
    );
  }

  // China stocks via China MCP
  for (const symbol of symbols.cn) {
    promises.push(
      fetchCNStock(symbol).then((data) => { dataMap.set(symbol, data); })
        .catch((err) => console.error(`[MCP] CN fetch error ${symbol}:`, err.message))
    );
  }

  await Promise.all(promises);
  return dataMap;
}

// ============================================================
// Format context for expert prompts
// ============================================================

export function formatStockContext(dataMap: Map<string, StockData>): string {
  if (dataMap.size === 0) return "";

  const usEntries = [...dataMap.values()].filter((d) => d.market === "us");
  const cnEntries = [...dataMap.values()].filter((d) => d.market === "cn");
  const sections: string[] = [];

  if (usEntries.length > 0) {
    sections.push("## US/Global Market Data (Yahoo Finance)\n");
    for (const data of usEntries) {
      sections.push(`### ${data.symbol}\n`);
      if (data.info) sections.push(`**Company & Financials:**\n${data.info.substring(0, 3000)}\n`);
      if (data.priceHistory) {
        const lines = data.priceHistory.split("\n");
        sections.push(`**Price History (30d):**\n${lines.slice(-35).join("\n")}\n`);
      }
      if (data.earnings) sections.push(`**Earnings:**\n${data.earnings.substring(0, 1500)}\n`);
      if (data.news) sections.push(`**Recent News:**\n${data.news.substring(0, 2000)}\n`);
    }
  }

  if (cnEntries.length > 0) {
    sections.push("## A股实时数据 (腾讯财经)\n");
    for (const data of cnEntries) {
      sections.push(`### ${data.symbol}\n`);
      if (data.info) sections.push(`**实时行情:**\n${data.info.substring(0, 2000)}\n`);
      if (data.fibonacci) sections.push(`**斐波那契分析:**\n${data.fibonacci}\n`);
      if (data.priceHistory) {
        const lines = data.priceHistory.split("\n");
        sections.push(`**近30日K线:**\n${lines.slice(-20).join("\n")}\n`);
      }
    }
  }

  return sections.join("\n");
}

// Also export market context fetcher for nodes
export { fetchCNMarketContext };

// ============================================================
// Health check for all MCP servers
// ============================================================

export async function mcpHealth(): Promise<{
  servers: Record<string, { status: string; tools: number; session: string }>;
  total: number;
}> {
  const result: Record<string, { status: string; tools: number; session: string }> = {};

  for (const server of MCP_SERVERS) {
    try {
      const session = await initSession(server);
      result[server.name] = {
        status: "ok",
        tools: session.tools.length,
        session: session.sessionId.substring(0, 8),
      };
    } catch (err: any) {
      result[server.name] = { status: "error", tools: 0, session: err.message };
    }
  }

  const total = Object.values(result).reduce((sum, r) => sum + r.tools, 0);
  return { servers: result, total };
}
