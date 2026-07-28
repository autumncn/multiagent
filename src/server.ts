// Multi-Agent Gateway Server: Dynamic Multi-Agent Orchestrator
// LangGraph + SSE Streaming + OpenAI-compatible API

import express from "express";
import { compiledGraph } from "./graph.js";
import {
  registerWriter,
  unregisterWriter,
  createSSEWriter,
} from "./streaming.js";
import { logRegistrySummary } from "./registry.js";

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

function openaiAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
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

// ============================================================
// Health Check
// ============================================================
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============================================================
// OpenAI-compatible /v1/models
// ============================================================
app.get("/v1/models", openaiAuth, (_req, res) => {
  res.json({
    object: "list",
    data: [
      { id: "multi-agent", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "hermes" },
      { id: "multi-agent-debate", object: "model", created: Math.floor(Date.now() / 1000), owned_by: "hermes" },
    ],
  });
});

// ============================================================
// Build initial state for LangGraph
// ============================================================
function buildInitialState(message: string, thread: string, maxRounds: number, forceDebate: boolean) {
  return {
    userRequest: message,
    threadId: thread,
    experts: [] as any[],
    complexity: "simple" as const,
    debateMode: forceDebate,
    routingReason: "",
    currentRound: 0,
    maxRounds: maxRounds,
    expertResults: {},
    debateHistory: {} as Record<string, Record<number, string>>,
    modelMapping: {} as Record<string, string>,
    critique: null as string | null,
    needsRevision: false,
    finalAnswer: null as string | null,
    errors: [] as string[],
    revisionCount: 0,
  };
}

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

  const acceptSSE =
    !req.headers.accept ||
    req.headers.accept.includes("text/event-stream") ||
    req.headers.accept === "*/*";

  if (!acceptSSE) {
    return handleJSONInvoke(res, message, thread, maxRounds);
  }

  // SSE Mode
  const sse = createSSEWriter(res);
  registerWriter(thread, sse);

  console.log(`[Invoke] Thread: ${thread}, Message: ${message.slice(0, 80)}...`);

  try {
    const initialState = buildInitialState(message, thread, maxRounds, false);

    const stream = await compiledGraph.stream(initialState, {
      streamMode: "updates",
    });

    let finalState = { ...initialState };

    for await (const chunk of stream) {
      if (sse.closed) break;
      for (const [nodeName, updates] of Object.entries(chunk)) {
        finalState = { ...finalState, ...(updates as any) };
        if (!sse.closed) {
          sse.write("node_complete", {
            threadId: thread,
            node: nodeName,
            summary: summarizeNodeUpdate(updates as any),
          });
        }
      }
    }

    const elapsed = Date.now() - startTime;
    const result = {
      threadId: thread,
      experts: finalState.experts,
      modelMapping: finalState.modelMapping,
      debate: {
        rounds: finalState.currentRound,
        history: finalState.debateHistory,
      },
      expertResults: finalState.expertResults,
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
        `Experts: ${finalState.experts.map((e: any) => e.role).join(", ")}, ` +
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
// POST /v1/chat/completions — OpenAI-compatible
// ============================================================
app.post("/v1/chat/completions", openaiAuth, async (req, res) => {
  const { messages, model, stream: isStream } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: "messages array is required", type: "invalid_request_error" },
    });
  }

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

  let fullContext = "";
  for (const msg of messages) {
    fullContext += `[${msg.role}]: ${msg.content}\n\n`;
  }

  console.log(`[OpenAI] Thread: ${thread}, Model: ${model}, Stream: ${!!isStream}, Message: ${userMessage.slice(0, 80)}...`);

  try {
    const initialState = buildInitialState(fullContext.trim(), thread, maxRounds, isDebate);

    if (isStream) {
      // Streaming: SSE in OpenAI format
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
          if (event === "token" && data.token) {
            sendChunk(data.token);
          }
        },
        end: () => {},
        closed: false,
      };
      registerWriter(thread, sseWriter);

      const graphStream = await compiledGraph.stream(initialState, {
        streamMode: "updates",
      });

      for await (const chunk of graphStream) {
        if (closed) break;
      }

      unregisterWriter(thread);
      sendChunk("", "stop");
      if (!closed) {
        res.write("data: [DONE]\n\n");
        res.end();
      }

      const elapsed = Date.now() - startTime;
      console.log(`[OpenAI] Complete: ${thread}, Stream, Time: ${elapsed}ms`);
    } else {
      // Non-streaming: full JSON response
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
            message: { role: "assistant", content: finalText },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
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
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

// ============================================================
// Helper
// ============================================================
function summarizeNodeUpdate(updates: any): any {
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

async function handleJSONInvoke(
  res: express.Response,
  message: string,
  thread: string,
  maxRounds: number
) {
  try {
    const initialState = buildInitialState(message, thread, maxRounds, false);
    const result = await compiledGraph.invoke(initialState);

    res.json({
      threadId: thread,
      experts: result.experts,
      modelMapping: result.modelMapping,
      debate: { rounds: result.currentRound, history: result.debateHistory },
      expertResults: result.expertResults,
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
  console.log(`Dynamic Multi-Agent Orchestrator running on port ${port}`);
  logRegistrySummary();
});
