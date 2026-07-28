import express from "express";
import { compiledGraph } from "./graph.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const apiKey = process.env.AGENT_API_KEY || "test-key";

// Auth middleware
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

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Invoke endpoint
app.post("/invoke", authenticate, async (req, res) => {
  try {
    const { message, threadId, maxDebateRounds } = req.body;

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const thread = threadId || `thread-${Date.now()}`;
    const maxRounds = maxDebateRounds || 2;

    console.log(
      `[Invoke] Thread: ${thread}, Message: ${message.slice(0, 100)}...`
    );

    const result = await compiledGraph.invoke({
      userRequest: message,
      threadId: thread,
      primaryAgent: "",
      selectedAgents: [],
      complexity: "simple",
      requiresMultiAgent: false,
      debateMode: false,
      routingReason: "",
      currentRound: 0,
      maxRounds: maxRounds,
      agentResults: {},
      debateHistory: {},
      critique: null,
      needsRevision: false,
      finalAnswer: null,
      errors: [],
      revisionCount: 0,
    });

    console.log(
      `[Complete] Thread: ${thread}, Agents: ${result.selectedAgents.join(", ")}, Rounds: ${result.currentRound}, Debate: ${result.debateMode}`
    );
    console.log("[Response] Final answer length:", result.finalAnswer?.length || 0);
    console.log("[Response] Errors:", result.errors.length);

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
      revisionCount: result.revisionCount,
    });
  } catch (error: any) {
    console.error("[Error]", error);
    res.status(500).json({ error: error.message });
  }
});

const port = parseInt(process.env.PORT || "18088");
app.listen(port, "0.0.0.0", () => {
  console.log(`Multi-Agent Gateway running on port ${port}`);
});
