// LangGraph node functions with streaming support
// Each node emits token events via the streaming callback registry

import { GraphStateType } from "./state.js";
import { models, getModelAlias } from "./models.js";
import { prompts } from "./prompts.js";
import { RouterDecisionSchema } from "./schemas.js";
import {
  getWriter,
  emitNodeStart,
  emitToken,
  emitNodeDone,
  streamWithCallback,
  invokeModel,
} from "./streaming.js";

// ============================================================
// Router Node (non-streaming, JSON parse)
// ============================================================
export async function routerNode(state: GraphStateType) {
  emitNodeStart(state.threadId, "router");

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

  const routerAlias = getModelAlias("router");
  const content = await invokeModel(routerAlias, [
    { role: "system", content: routerPrompt },
    { role: "user", content: state.userRequest },
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

  emitNodeDone(state.threadId, "router", { decision });

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
    routingReason: decision.reason,
  };
}

// ============================================================
// Run Agents Node (Round 1: parallel, streaming)
// ============================================================
function buildAgentPrompt(
  agentType: string,
  userMessage: string,
  debateHistory: Array<{ agent: string; round: number; content: string }>,
  round: number
): Array<{ role: string; content: string }> {
  const systemPrompt = (prompts as any)[agentType] || prompts.general;

  if (round === 1) {
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];
  }

  let context = `Original question: ${userMessage}\n\n`;
  context += "=== Previous Discussion ===\n\n";
  for (const d of debateHistory) {
    context += `--- ${d.agent} (Round ${d.round}) ---\n`;
    context += d.content + "\n\n";
  }
  context += `=== Your Task ===\n`;
  context += `This is debate Round ${round}. You have seen the previous analysis.\n`;
  context += `Provide your updated analysis, addressing their points.\n`;
  context += `Challenge weak arguments, reinforce strong ones. Be specific.`;

  return [
    {
      role: "system",
      content: systemPrompt +
        "\n\nYou are in a multi-agent debate. Respond critically and constructively.",
    },
    { role: "user", content: context },
  ];
}

export async function runAgentsNode(state: GraphStateType) {
  emitNodeStart(state.threadId, "runAgents", {
    agents: state.selectedAgents,
    round: 1,
  });

  const debateHistory: Array<{ agent: string; round: number; content: string }> = [];

  // Round 1: parallel agent execution with streaming
  const agentPromises = state.selectedAgents.map(async (agentName) => {
    const alias = getModelAlias(agentName);
    const messages = buildAgentPrompt(agentName, state.userRequest, debateHistory, 1);

    emitNodeStart(state.threadId, agentName, { round: 1 });

    const content = await streamWithCallback(alias, messages, (token) => {
      emitToken(state.threadId, agentName, token, { round: 1 });
    });

    emitNodeDone(state.threadId, agentName, { round: 1, length: content.length });

    return { agent: agentName, round: 1, content };
  });

  const results = await Promise.all(agentPromises);

  const agentResults: Record<string, string> = {};
  const history: Record<string, Record<number, string>> = {};

  for (const r of results) {
    debateHistory.push(r);
    agentResults[r.agent] = r.content;
    if (!history[r.agent]) history[r.agent] = {};
    history[r.agent][1] = r.content;
  }

  emitNodeDone(state.threadId, "runAgents", { agents: state.selectedAgents, round: 1 });

  return {
    agentResults,
    debateHistory: history,
    currentRound: 1,
  };
}

// ============================================================
// Debate Round Node (Round 2+: sequential, streaming)
// ============================================================
export async function debateRoundNode(state: GraphStateType) {
  const round = state.currentRound + 1;
  emitNodeStart(state.threadId, "debateRound", { round });

  // Rebuild debate history from state
  const prevHistory: Array<{ agent: string; round: number; content: string }> = [];
  for (const [agent, rounds] of Object.entries(state.debateHistory)) {
    for (const [r, content] of Object.entries(rounds as Record<string, string>)) {
      prevHistory.push({ agent, round: parseInt(r), content });
    }
  }
  prevHistory.sort((a, b) => a.round - b.round || a.agent.localeCompare(b.agent));

  const updatedHistory = { ...state.debateHistory };

  // Sequential debate: each agent sees all previous outputs
  for (const agentName of state.selectedAgents) {
    const alias = getModelAlias(agentName);
    const messages = buildAgentPrompt(agentName, state.userRequest, prevHistory, round);

    emitNodeStart(state.threadId, agentName, { round });

    const content = await streamWithCallback(alias, messages, (token) => {
      emitToken(state.threadId, agentName, token, { round });
    });

    emitNodeDone(state.threadId, agentName, { round, length: content.length });

    if (!updatedHistory[agentName]) updatedHistory[agentName] = {};
    updatedHistory[agentName][round] = content;
    prevHistory.push({ agent: agentName, round, content });
  }

  emitNodeDone(state.threadId, "debateRound", { round });

  return {
    debateHistory: updatedHistory,
    currentRound: round,
  };
}

// ============================================================
// Critic Node (streaming)
// ============================================================
export async function criticNode(state: GraphStateType) {
  emitNodeStart(state.threadId, "critic");

  // Build discussion context
  let context = `Original question: ${state.userRequest}\n\n`;
  context += "=== Agent Discussion ===\n\n";

  for (const [agent, rounds] of Object.entries(state.debateHistory)) {
    for (const [round, content] of Object.entries(rounds as Record<string, string>)) {
      context += `--- ${agent} (Round ${round}) ---\n`;
      context += content + "\n\n";
    }
  }

  const criticAlias = getModelAlias("critic");
  const messages = [
    { role: "system", content: prompts.critic },
    {
      role: "user",
      content: `Review the following multi-agent discussion. Find flaws, gaps, contradictions, and unchallenged assumptions.\n\n${context}`,
    },
  ];

  const critique = await streamWithCallback(criticAlias, messages, (token) => {
    emitToken(state.threadId, "critic", token);
  });

  emitNodeDone(state.threadId, "critic", { length: critique.length });

  return {
    critique,
    needsRevision: false,
  };
}

// ============================================================
// Judge Node (streaming)
// ============================================================
export async function judgeNode(state: GraphStateType) {
  emitNodeStart(state.threadId, "judge");

  let context = `Original question: ${state.userRequest}\n\n`;
  context += "=== Full Agent Discussion ===\n\n";

  for (const [agent, rounds] of Object.entries(state.debateHistory)) {
    for (const [round, content] of Object.entries(rounds as Record<string, string>)) {
      context += `--- ${agent} (Round ${round}) ---\n`;
      context += content + "\n\n";
    }
  }

  if (state.critique) {
    context += `=== Critic Review ===\n${state.critique}\n\n`;
  }

  const judgeAlias = getModelAlias("judge");
  const messages = [
    { role: "system", content: prompts.judge },
    {
      role: "user",
      content: `Synthesize the following multi-agent analysis into a clear, actionable final answer.\n\n${context}`,
    },
  ];

  const finalAnswer = await streamWithCallback(judgeAlias, messages, (token) => {
    emitToken(state.threadId, "judge", token);
  });

  emitNodeDone(state.threadId, "judge", { length: finalAnswer.length });

  return {
    finalAnswer,
  };
}
