// Multi-Agent Gateway Server with LangGraph + SSE Streaming
// Uses LangGraph for dynamic orchestration, SSE for real-time token output

import express from "express";
import { compiledGraph } from "./graph.js";
import {
  registerWriter,
  unregisterWriter,
  createSSEWriter,
  emitNodeStart,
} from "./streaming.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const apiKey = process.env.AGENT_API_KEY || "test-key";

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
// POST /invoke — LangGraph + SSE Streaming
// ============================================================
app.post("/invoke", authenticate, async (req, res) => {
  const { message, threadId, maxDebateRounds } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  const thread = threadId || `thread-${Date.now()}`;
  const maxRounds = maxDebateRounds || 2;
  const startTime = Date.now();

  // Check if client wants SSE
  const acceptSSE =
    !req.headers.accept ||
    req.headers.accept.includes("text/event-stream") ||
    req.headers.accept === "*/*";

  if (!acceptSSE) {
    return handleJSONInvoke(res, message, thread, maxRounds);
  }

  // === SSE Mode ===
  const sse = createSSEWriter(res);
  registerWriter(thread, sse);

  console.log(`[Invoke] Thread: ${thread}, Message: ${message.slice(0, 80)}...`);

  try {
    // Initial state
    const initialState = {
      userRequest: message,
      threadId: thread,
      primaryAgent: "",
      selectedAgents: [] as string[],
      complexity: "simple" as const,
      requiresMultiAgent: false,
      debateMode: false,
      routingReason: "",
      currentRound: 0,
      maxRounds: maxRounds,
      agentResults: {},
      debateHistory: {},
      critique: null as string | null,
      needsRevision: false,
      finalAnswer: null as string | null,
      errors: [] as string[],
      revisionCount: 0,
    };

    // Run LangGraph with streaming
    const stream = await compiledGraph.stream(initialState, {
      streamMode: "updates",
    });

    // Track accumulated state from each node update
    let finalState = { ...initialState };

    for await (const chunk of stream) {
      if (sse.closed) break;

      // chunk is like: { nodeName: { stateUpdates } }
      for (const [nodeName, updates] of Object.entries(chunk)) {
        // Merge updates into finalState
        finalState = { ...finalState, ...(updates as any) };

        // Emit node-level SSE event (token events already sent by node functions)
        if (!sse.closed) {
          sse.write("node_complete", {
            threadId: thread,
            node: nodeName,
            summary: summarizeNodeUpdate(nodeName, updates as any),
          });
        }
      }
    }

    // === Done ===
    const elapsed = Date.now() - startTime;
    const result = {
      threadId: thread,
      routing: {
        primaryAgent: finalState.primaryAgent,
        selectedAgents: finalState.selectedAgents,
        complexity: finalState.complexity,
        requiresMultiAgent: finalState.requiresMultiAgent,
        debateMode: finalState.debateMode,
        reason: finalState.routingReason,
      },
      debate: {
        rounds: finalState.currentRound,
        history: finalState.debateHistory,
      },
      agentResults: finalState.agentResults,
      critique: finalState.critique,
      finalAnswer: finalState.finalAnswer,
      errors: finalState.errors,
      elapsedMs: elapsed,
    };

    if (!sse.closed) {
      sse.write("done", result);
    }
    sse.end();

    console.log(
      `[Complete] Thread: ${thread}, ` +
        `Agent: ${finalState.primaryAgent}, ` +
        `Agents: ${finalState.selectedAgents.join(", ")}, ` +
        `Rounds: ${finalState.currentRound}, ` +
        `Debate: ${finalState.debateMode}, ` +
        `Time: ${elapsed}ms`
    );
  } catch (error: any) {
    console.error(`[Error] Thread: ${thread}`, error.message);
    if (!sse.closed) {
      sse.write("error", { threadId: thread, message: error.message });
      sse.end();
    }
  } finally {
    unregisterWriter(thread);
  }
});

// ============================================================
// Helper: summarize node update for SSE (without full content)
// ============================================================
function summarizeNodeUpdate(nodeName: string, updates: any): any {
  const summary: any = {};
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === "string" && value.length > 200) {
      summary[key] = `[${value.length} chars]`;
    } else if (typeof value === "object" && value !== null) {
      summary[key] = `[object]`;
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

// ============================================================
// JSON Fallback (non-SSE, uses LangGraph invoke)
// ============================================================
async function handleJSONInvoke(
  res: express.Response,
  message: string,
  thread: string,
  maxRounds: number
) {
  try {
    const initialState = {
      userRequest: message,
      threadId: thread,
      primaryAgent: "",
      selectedAgents: [] as string[],
      complexity: "simple" as const,
      requiresMultiAgent: false,
      debateMode: false,
      routingReason: "",
      currentRound: 0,
      maxRounds: maxRounds,
      agentResults: {},
      debateHistory: {},
      critique: null as string | null,
      needsRevision: false,
      finalAnswer: null as string | null,
      errors: [] as string[],
      revisionCount: 0,
    };

    const result = await compiledGraph.invoke(initialState);

    res.json({
      threadId: thread,
      routing: {
        primaryAgent: result.primaryAgent,
        selectedAgents: result.selectedAgents,
        complexity: result.complexity,
        requiresMultiAgent: result.requiresMultiAgent,
        debateMode: result.debateMode,
        reason: result.routingReason,
      },
      debate: {
        rounds: result.currentRound,
        history: result.debateHistory,
      },
      agentResults: result.agentResults,
      critique: result.critique,
      finalAnswer: result.finalAnswer,
      errors: result.errors,
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
  console.log(`Multi-Agent Gateway (LangGraph + SSE) running on port ${port}`);
});
