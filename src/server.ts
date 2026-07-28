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
// OpenAI-compatible /v1/chat/completions (for LiteLLM integration)
// ============================================================
function openaiAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  // Support both "Bearer sk-xxx" and direct x-api-key
  const auth = req.headers.authorization;
  const xKey = req.headers["x-api-key"];
  if (auth) {
    const token = auth.replace(/^Bearer\s+/i, "");
    if (token !== apiKey) {
      return res.status(401).json({ error: { message: "Invalid API key", type: "invalid_request_error" } });
    }
  } else if (xKey !== apiKey) {
    return res.status(401).json({ error: { message: "Invalid API key", type: "invalid_request_error" } });
  }
  next();
}

app.get("/v1/models", openaiAuth, (_req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: "multi-agent",
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "hermes",
      },
      {
        id: "multi-agent-debate",
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "hermes",
      },
    ],
  });
});

app.post("/v1/chat/completions", openaiAuth, async (req, res) => {
  const { messages, model, stream: isStream, max_tokens } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: "messages array is required", type: "invalid_request_error" },
    });
  }

  // Extract the last user message as the task
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
  const userMessage = lastUserMsg?.content || "";

  if (!userMessage) {
    return res.status(400).json({
      error: { message: "No user message found", type: "invalid_request_error" },
    });
  }

  const thread = `thread-${Date.now()}`;
  const isDebate = model?.includes("debate");
  const maxRounds = isDebate ? 2 : 1;
  const startTime = Date.now();
  const completionId = `chatcmpl-${Date.now()}`;

  // Build conversation context from all messages
  let fullContext = "";
  for (const msg of messages) {
    fullContext += `[${msg.role}]: ${msg.content}\n\n`;
  }

  console.log(`[OpenAI] Thread: ${thread}, Model: ${model}, Stream: ${!!isStream}, Message: ${userMessage.slice(0, 80)}...`);

  try {
    const initialState = {
      userRequest: fullContext.trim(),
      threadId: thread,
      primaryAgent: "",
      selectedAgents: [] as string[],
      complexity: "simple" as const,
      requiresMultiAgent: false,
      debateMode: isDebate,
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

    if (isStream) {
      // === Streaming: SSE in OpenAI format ===
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();

      let closed = false;
      res.on("close", () => { closed = true; });

      const sendChunk = (content: string, finish?: string) => {
        if (closed) return;
        const chunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: model || "multi-agent",
          choices: [
            {
              index: 0,
              delta: finish ? {} : { role: "assistant", content },
              finish_reason: finish || null,
            },
          ],
        };
        try {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        } catch {
          closed = true;
        }
      };

      // Register streaming writer for token forwarding
      const sseWriter = {
        write: (event: string, data: any) => {
          if (closed) return;
          // Forward token events as OpenAI chunks
          if (event === "token" && data.token) {
            sendChunk(data.token);
          }
        },
        end: () => {},
        closed: false,
      };
      registerWriter(thread, sseWriter);

      // Run graph
      const graphStream = await compiledGraph.stream(initialState, {
        streamMode: "updates",
      });

      for await (const chunk of graphStream) {
        if (closed) break;
      }

      unregisterWriter(thread);

      // Send final answer if tokens weren't fully streamed
      // (graph.stream already triggered token events via nodes)
      sendChunk("", "stop");
      if (!closed) {
        res.write("data: [DONE]\n\n");
        res.end();
      }

      const elapsed = Date.now() - startTime;
      console.log(`[OpenAI] Complete: ${thread}, Stream, Time: ${elapsed}ms`);
    } else {
      // === Non-streaming: full JSON response ===
      const result = await compiledGraph.invoke(initialState);
      const elapsed = Date.now() - startTime;
      const finalText = result.finalAnswer || "No answer generated";

      res.json({
        id: completionId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model || "multi-agent",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: finalText,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      });

      console.log(`[OpenAI] Complete: ${thread}, Non-stream, Time: ${elapsed}ms`);
    }
  } catch (error: any) {
    console.error(`[OpenAI Error] Thread: ${thread}`, error.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: { message: error.message, type: "server_error" },
      });
    } else {
      const errChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model || "multi-agent",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
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
