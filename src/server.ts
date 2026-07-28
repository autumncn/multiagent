import express from "express";
import { streamModel, invokeModel, getModelAlias } from "./models.js";
import { prompts } from "./prompts.js";
import { RouterDecisionSchema } from "./schemas.js";
import { BaseMessageLike } from "@langchain/core/messages";

const app = express();
app.use(express.json({ limit: "1mb" }));

const apiKey = process.env.AGENT_API_KEY || "test-key";

// ============================================================
// SSE Helper
// ============================================================
interface SSEWriter {
  write: (event: string, data: any) => void;
  end: () => void;
  closed: boolean;
}

function createSSEWriter(res: express.Response): SSEWriter {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  return {
    write(event: string, data: any) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!closed) res.end();
    },
    get closed() {
      return closed;
    },
  };
}

// ============================================================
// Auth Middleware
// ============================================================
function authenticate(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const requestKey = req.headers["x-api-key"];
  if (requestKey !== apiKey) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

// ============================================================
// Health Check
// ============================================================
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================
// Router: classify task (non-streaming, JSON parse)
// ============================================================
async function routeTask(message: string) {
  const routerAlias = getModelAlias("router");
  const routerPrompt = `${prompts.router}

IMPORTANT: Respond ONLY with a valid JSON object, no markdown, no explanation.
Schema:
{
  "primaryAgent": "general" | "coding" | "research" | "finance" | "document",
  "secondaryAgents": [...],
  "complexity": "simple" | "moderate" | "complex",
  "requiresMultiAgent": true | false,
  "debateMode": true | false,
  "reason": "brief explanation"
}`;

  const content = await invokeModel(routerAlias, [
    { role: "system", content: routerPrompt },
    { role: "user", content: message },
  ]);

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("No JSON found");
    }
  } catch {
    parsed = {
      primaryAgent: "general",
      secondaryAgents: [],
      complexity: "simple",
      requiresMultiAgent: false,
      debateMode: false,
      reason: "Router parse failed, fallback to general",
    };
  }

  const validated = RouterDecisionSchema.safeParse(parsed);
  const decision = validated.success ? validated.data : parsed;

  return {
    primaryAgent: decision.primaryAgent,
    selectedAgents: [
      decision.primaryAgent,
      ...(decision.secondaryAgents || []).filter(
        (a: string) => a !== "critic" && a !== decision.primaryAgent
      ),
    ],
    complexity: decision.complexity,
    requiresMultiAgent: decision.requiresMultiAgent,
    debateMode: decision.debateMode || false,
    reason: decision.reason,
  };
}

// ============================================================
// Agent: run a specialist agent (streaming)
// ============================================================
interface DebateOutput {
  agent: string;
  round: number;
  content: string;
}

function buildAgentMessages(
  agentType: string,
  userMessage: string,
  debateHistory: DebateOutput[],
  round: number
): BaseMessageLike[] {
  const systemPrompt = (prompts as any)[agentType] || prompts.general;

  if (round === 1) {
    // Round 1: independent analysis
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];
  }

  // Round 2+: debate mode, include previous outputs
  let context = `Original question: ${userMessage}\n\n`;
  context += "=== Previous Discussion ===\n\n";

  for (const output of debateHistory) {
    context += `--- ${output.agent} (Round ${output.round}) ---\n`;
    context += output.content + "\n\n";
  }

  context += `=== Your Task ===\n`;
  context += `This is debate Round ${round}. You have seen the previous analysis from other specialists.\n`;
  context += `Provide your updated analysis, addressing their points. Challenge weak arguments, reinforce strong ones.\n`;
  context += `Be specific about which points you agree or disagree with and why.`;

  return [
    {
      role: "system",
      content:
        systemPrompt +
        "\n\nYou are in a multi-agent debate. Respond to the other agents' analyses critically and constructively.",
    },
    { role: "user", content: context },
  ];
}

async function runAgent(
  agentType: string,
  userMessage: string,
  debateHistory: DebateOutput[],
  round: number,
  sse: SSEWriter,
  threadId: string
): Promise<DebateOutput> {
  const alias = getModelAlias(agentType);
  const messages = buildAgentMessages(agentType, userMessage, debateHistory, round);

  sse.write("agent_start", { threadId, agent: agentType, round });

  const content = await streamModel(alias, messages, (token) => {
    if (!sse.closed) {
      sse.write("token", {
        threadId,
        agent: agentType,
        round,
        token,
      });
    }
  });

  sse.write("agent_done", {
    threadId,
    agent: agentType,
    round,
    length: content.length,
  });

  return { agent: agentType, round, content };
}

// ============================================================
// Critic: review debate quality (streaming)
// ============================================================
async function runCritic(
  userMessage: string,
  debateHistory: DebateOutput[],
  sse: SSEWriter,
  threadId: string
): Promise<string> {
  const alias = getModelAlias("critic");

  let context = `Original question: ${userMessage}\n\n`;
  context += "=== Agent Discussion ===\n\n";
  for (const output of debateHistory) {
    context += `--- ${output.agent} (Round ${output.round}) ---\n`;
    context += output.content + "\n\n";
  }

  const messages: BaseMessageLike[] = [
    { role: "system", content: prompts.critic },
    {
      role: "user",
      content: `Review the following multi-agent discussion. Find flaws, gaps, contradictions, and unchallenged assumptions.\n\n${context}`,
    },
  ];

  sse.write("stage", { threadId, stage: "critic_start" });

  const content = await streamModel(alias, messages, (token) => {
    if (!sse.closed) {
      sse.write("token", { threadId, stage: "critic", token });
    }
  });

  sse.write("stage", { threadId, stage: "critic_done", length: content.length });
  return content;
}

// ============================================================
// Judge: synthesize final answer (streaming)
// ============================================================
async function runJudge(
  userMessage: string,
  debateHistory: DebateOutput[],
  critique: string | null,
  sse: SSEWriter,
  threadId: string
): Promise<string> {
  const alias = getModelAlias("judge");

  let context = `Original question: ${userMessage}\n\n`;
  context += "=== Full Agent Discussion ===\n\n";
  for (const output of debateHistory) {
    context += `--- ${output.agent} (Round ${output.round}) ---\n`;
    context += output.content + "\n\n";
  }
  if (critique) {
    context += `=== Critic Review ===\n${critique}\n\n`;
  }

  const messages: BaseMessageLike[] = [
    { role: "system", content: prompts.judge },
    {
      role: "user",
      content: `Synthesize the following multi-agent analysis into a clear, actionable final answer.\n\n${context}`,
    },
  ];

  sse.write("stage", { threadId, stage: "judge_start" });

  const content = await streamModel(alias, messages, (token) => {
    if (!sse.closed) {
      sse.write("token", { threadId, stage: "judge", token });
    }
  });

  sse.write("stage", { threadId, stage: "judge_done", length: content.length });
  return content;
}

// ============================================================
// POST /invoke — SSE Streaming Multi-Agent Orchestration
// ============================================================
app.post("/invoke", authenticate, async (req, res) => {
  const { message, threadId, maxDebateRounds } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  const thread = threadId || `thread-${Date.now()}`;
  const maxRounds = maxDebateRounds || 2;

  // Check if client wants SSE or JSON
  const acceptSSE =
    req.headers.accept?.includes("text/event-stream") ||
    req.headers.accept === "*/*" ||
    !req.headers.accept;

  if (!acceptSSE) {
    // JSON fallback mode (run full pipeline, return JSON)
    return handleJSONInvoke(req, res, message, thread, maxRounds);
  }

  // SSE mode
  const sse = createSSEWriter(res);
  const startTime = Date.now();

  console.log(`[Invoke] Thread: ${thread}, Message: ${message.slice(0, 100)}...`);

  try {
    // === Phase 1: Router ===
    sse.write("stage", { threadId: thread, stage: "routing", message: "Classifying task..." });

    const routing = await routeTask(message);
    sse.write("stage", {
      threadId: thread,
      stage: "routed",
      routing,
    });

    console.log(`[Routed] Thread: ${thread}, Agent: ${routing.primaryAgent}, Agents: ${routing.selectedAgents.join(", ")}, Debate: ${routing.debateMode}`);

    // === Phase 2: Agent Round 1 (parallel) ===
    sse.write("stage", {
      threadId: thread,
      stage: "agents_start",
      agents: routing.selectedAgents,
      round: 1,
    });

    const debateHistory: DebateOutput[] = [];
    const round1Promises = routing.selectedAgents.map((agent) =>
      runAgent(agent, message, debateHistory, 1, sse, thread)
    );
    const round1Results = await Promise.all(round1Promises);
    debateHistory.push(...round1Results);

    // === Phase 3: Debate Rounds (sequential) ===
    if (routing.debateMode && routing.selectedAgents.length > 1) {
      for (let round = 2; round <= maxRounds; round++) {
        if (sse.closed) break;

        sse.write("stage", {
          threadId: thread,
          stage: "debate_round",
          round,
        });

        // Sequential: each agent sees all previous outputs
        for (const agentName of routing.selectedAgents) {
          if (sse.closed) break;
          const result = await runAgent(
            agentName,
            message,
            debateHistory,
            round,
            sse,
            thread
          );
          debateHistory.push(result);
        }
      }
    }

    // === Phase 4: Critic ===
    let critique: string | null = null;
    if (routing.complexity !== "simple" && !sse.closed) {
      critique = await runCritic(message, debateHistory, sse, thread);
    }

    // === Phase 5: Judge ===
    let finalAnswer = "";
    if (!sse.closed) {
      finalAnswer = await runJudge(message, debateHistory, critique, sse, thread);
    }

    // === Done ===
    const elapsed = Date.now() - startTime;
    const result = {
      threadId: thread,
      routing,
      debate: {
        rounds: routing.debateMode ? maxRounds : 1,
        history: debateHistory.reduce(
          (acc, d) => {
            if (!acc[d.agent]) acc[d.agent] = {};
            acc[d.agent][d.round] = d.content;
            return acc;
          },
          {} as Record<string, Record<number, string>>
        ),
      },
      agentResults: debateHistory
        .filter((d) => d.round === 1)
        .reduce(
          (acc, d) => {
            acc[d.agent] = d.content;
            return acc;
          },
          {} as Record<string, string>
        ),
      critique,
      finalAnswer,
      errors: [],
      elapsedMs: elapsed,
    };

    sse.write("done", result);
    sse.end();

    console.log(
      `[Complete] Thread: ${thread}, Agents: ${routing.selectedAgents.join(", ")}, ` +
        `Rounds: ${routing.debateMode ? maxRounds : 1}, ` +
        `Debate: ${routing.debateMode}, ` +
        `Time: ${elapsed}ms`
    );
  } catch (error: any) {
    console.error(`[Error] Thread: ${thread}`, error.message);
    sse.write("error", { threadId: thread, message: error.message });
    sse.end();
  }
});

// ============================================================
// JSON fallback (for programmatic use without SSE)
// ============================================================
async function handleJSONInvoke(
  req: express.Request,
  res: express.Response,
  message: string,
  threadId: string,
  maxRounds: number
) {
  try {
    const routing = await routeTask(message);
    const debateHistory: DebateOutput[] = [];

    // Round 1: parallel
    const round1Results = await Promise.all(
      routing.selectedAgents.map((agent) => {
        const alias = getModelAlias(agent);
        const messages = buildAgentMessages(agent, message, [], 1);
        return invokeModel(alias, messages).then((content) => ({
          agent,
          round: 1,
          content,
        }));
      })
    );
    debateHistory.push(...round1Results);

    // Debate rounds
    if (routing.debateMode && routing.selectedAgents.length > 1) {
      for (let round = 2; round <= maxRounds; round++) {
        for (const agentName of routing.selectedAgents) {
          const alias = getModelAlias(agentName);
          const messages = buildAgentMessages(
            agentName,
            message,
            debateHistory,
            round
          );
          const content = await invokeModel(alias, messages);
          debateHistory.push({ agent: agentName, round, content });
        }
      }
    }

    // Critic
    let critique: string | null = null;
    if (routing.complexity !== "simple") {
      const criticAlias = getModelAlias("critic");
      let context = `Original question: ${message}\n\n=== Discussion ===\n\n`;
      for (const d of debateHistory) {
        context += `--- ${d.agent} (Round ${d.round}) ---\n${d.content}\n\n`;
      }
      critique = await invokeModel(criticAlias, [
        { role: "system", content: prompts.critic },
        { role: "user", content: context },
      ]);
    }

    // Judge
    const judgeAlias = getModelAlias("judge");
    let judgeContext = `Original question: ${message}\n\n=== Full Discussion ===\n\n`;
    for (const d of debateHistory) {
      judgeContext += `--- ${d.agent} (Round ${d.round}) ---\n${d.content}\n\n`;
    }
    if (critique) {
      judgeContext += `=== Critic Review ===\n${critique}\n\n`;
    }
    const finalAnswer = await invokeModel(judgeAlias, [
      { role: "system", content: prompts.judge },
      { role: "user", content: judgeContext },
    ]);

    res.json({
      threadId,
      routing,
      debate: {
        rounds: routing.debateMode ? maxRounds : 1,
        history: debateHistory.reduce(
          (acc, d) => {
            if (!acc[d.agent]) acc[d.agent] = {};
            acc[d.agent][d.round] = d.content;
            return acc;
          },
          {} as Record<string, Record<number, string>>
        ),
      },
      agentResults: debateHistory
        .filter((d) => d.round === 1)
        .reduce(
          (acc, d) => {
            acc[d.agent] = d.content;
            return acc;
          },
          {} as Record<string, string>
        ),
      critique,
      finalAnswer,
      errors: [],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

// ============================================================
// Start Server
// ============================================================
const port = parseInt(process.env.PORT || "18088");
app.listen(port, "0.0.0.0", () => {
  console.log(`Multi-Agent Gateway (SSE) running on port ${port}`);
});
