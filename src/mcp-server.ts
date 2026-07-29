/**
 * MCP Server - Expose Gateway as MCP tools
 * 
 * Tools:
 * 1. analyze_stock - Full multi-agent debate analysis
 * 2. get_stock_data - Get realtime data without debate
 * 3. get_fibonacci - Get Fibonacci levels for A-shares
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Request, Response } from "express";
import { compiledGraph } from "./graph.js";
import { extractSymbols, fetchStockData, formatStockContext } from "./mcp.js";

/**
 * Create MCP server with tools registered
 * Called per-connection to avoid transport conflicts
 */
function createMCPServer() {
  const server = new McpServer({
    name: "finance-debate-server",
    version: "1.0.0",
  });

  // Tool 1: analyze_stock - Full multi-agent debate
  server.tool(
    "analyze_stock",
    "Analyze a stock using multi-agent debate with realtime data. Best for deep investment analysis.",
    {
      query: z.string().describe("Stock symbol, name, or analysis question (e.g., 'AAPL', '贵州茅台', 'Is COIN a good buy?')"),
      debate_rounds: z.number().optional().default(2).describe("Number of debate rounds (1-3, default 2)"),
    },
    async ({ query, debate_rounds }) => {
      try {
        const threadId = `mcp-${Date.now()}`;
        
        // Extract symbols from query
        const { us: usSymbols, cn: cnSymbols } = extractSymbols(query);
        const allSymbols = [...usSymbols, ...cnSymbols];
        
        // Fetch realtime data
        let stockContext = "";
        if (allSymbols.length > 0) {
          console.log(`[MCP-Tool] analyze_stock: fetching ${allSymbols.length} symbols`);
          const dataMap = await fetchStockData({ us: usSymbols, cn: cnSymbols });
          stockContext = formatStockContext(dataMap);
        }

        // Run LangGraph
        const result = await compiledGraph.invoke({
          userRequest: query,
          threadId,
          stockContext,
          maxRounds: debate_rounds,
        });

        const finalAnswer = result.finalAnswer || "No response";
        
        return {
          content: [{ type: "text", text: finalAnswer as string }],
        };
      } catch (error: any) {
        console.error("[MCP-Tool] analyze_stock error:", error);
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 2: get_stock_data - Just data, no debate
  server.tool(
    "get_stock_data",
    "Get realtime stock data (price, news, earnings) without LLM analysis. Fast response.",
    {
      symbols: z.array(z.string()).describe("Stock symbols (e.g., ['AAPL', '600519', 'SATS'])"),
    },
    async ({ symbols }) => {
      try {
        // Extract symbols
        const { us: usSymbols, cn: cnSymbols } = extractSymbols(symbols.join(" "));
        
        if (usSymbols.length === 0 && cnSymbols.length === 0) {
          return {
            content: [{ type: "text", text: "No valid stock symbols found." }],
          };
        }

        console.log(`[MCP-Tool] get_stock_data: US=${usSymbols.join(",")}, CN=${cnSymbols.join(",")}`);
        
        // Fetch data
        const dataMap = await fetchStockData({ us: usSymbols, cn: cnSymbols });
        const context = formatStockContext(dataMap);

        return {
          content: [{ type: "text", text: context || "No data available." }],
        };
      } catch (error: any) {
        console.error("[MCP-Tool] get_stock_data error:", error);
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 3: get_fibonacci - Fibonacci levels for A-shares
  server.tool(
    "get_fibonacci",
    "Calculate Fibonacci retracement levels (0.382, 0.5, 0.618, 0.786) for A-share stocks. Shows current position.",
    {
      symbol: z.string().describe("A-share stock code (e.g., '600519', 'sh600519', 'sz300024')"),
      days: z.number().optional().default(20).describe("Lookback days for high/low calculation (default 20)"),
    },
    async ({ symbol, days }) => {
      try {
        const { us, cn } = extractSymbols(symbol);
        
        if (cn.length === 0) {
          return {
            content: [{ type: "text", text: "Symbol must be A-share (e.g., 600519, sh600519)" }],
            isError: true,
          };
        }

        console.log(`[MCP-Tool] get_fibonacci: ${cn[0]}, ${days} days`);
        
        // Fetch Fib data
        const dataMap = await fetchStockData({ us: [], cn: [cn[0]] });
        const stock = dataMap.get(cn[0]);
        
        if (!stock || !stock.fibonacci) {
          return {
            content: [{ type: "text", text: `No Fibonacci data for ${symbol}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: stock.fibonacci }],
        };
      } catch (error: any) {
        console.error("[MCP-Tool] get_fibonacci error:", error);
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

/**
 * Handle MCP HTTP requests
 * Creates a new server + transport per connection
 */
export async function mcpHandler(req: Request, res: Response) {
  try {
    // Create fresh server + transport per connection
    const server = createMCPServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Connect transport to MCP server
    await server.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error: any) {
    console.error("[MCP-Handler] Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
}
