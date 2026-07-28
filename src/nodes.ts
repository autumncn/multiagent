// LangGraph node functions with streaming support
// Dynamic Multi-Agent Orchestrator: Router generates experts, models matched by capability

import { GraphStateType } from "./state.js";
import { streamModel, invokeModel } from "./models.js";
import { prompts, buildExpertPrompt } from "./prompts.js";
import { RouterDecisionSchema, Expert } from "./schemas.js";
import { matchModel } from "./registry.js";
import {
  emitNodeStart,
  emitToken,
  emitNodeDone,
} from "./streaming.js";
import { BaseMessageLike } from "@langchain/core/messages";

// ============================================================
// Router Node: generate dynamic experts (non-streaming, JSON parse)
// ============================================================
export async function routerNode(state: GraphStateType) {
  emitNodeStart(state.threadId, "router");

  const routerAlias = "router-fast";
  const content = await invokeModel(routerAlias, [
    { role: "system", content: prompts.router },
    { role: "user", content: state.userRequest },
  ]);

  let parsed;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("No JSON found in router output");
    }
  } catch {
    // Fallback: single general expert
    parsed = {
      experts: [
        {
          role: "General Assistant",
          needs: ["general", "qa"],
          task: state.userRequest,
        },
      ],
      complexity: "simple",
      debate: false,
      reason: "Router parse failed, fallback to general expert",
    };
  }

  const validated = RouterDecisionSchema.safeParse(parsed);
  const decision = validated.success ? validated.data : parsed;

  // Match models for each expert
  const modelMapping: Record<string, string> = {};
  for (const expert of decision.experts) {
    modelMapping[expert.role] = matchModel(expert.needs);
  }

  emitNodeDone(state.threadId, "router", {
    experts: decision.experts.map((e: Expert) => ({
      role: e.role,
      model: modelMapping[e.role],
    })),
    debate: decision.debate,
    complexity: decision.complexity,
  });

  return {
    experts: decision.experts as Expert[],
    complexity: decision.complexity,
    debateMode: decision.debate || false,
    routingReason: decision.reason,
    modelMapping,
  };
}

// ============================================================
// Build debate context from history
// ============================================================
function buildDebateContext(
  userRequest: string,
  debateHistory: Record<string, Record<number, string>>
): string {
  let context = `Original question: ${userRequest}\n\n`;
  context += "=== Previous Discussion ===\n\n";

  for (const [role, rounds] of Object.entries(debateHistory)) {
    for (const [round, content] of Object.entries(rounds)) {
      context += `--- ${role} (Round ${round}) ---\n`;
      context += content + "\n\n";
    }
  }

  return context;
}

// ============================================================
// Run Experts Node: Round 1 (parallel, streaming)
// ============================================================
export async function runExpertsNode(state: GraphStateType) {
  emitNodeStart(state.threadId, "runExperts", {
    experts: state.experts.map((e) => e.role),
    round: 1,
  });

  const debateHistory: Record<string, Record<number, string>> = {};
  const expertResults: Record<string, string> = {};

  // Round 1: parallel execution with streaming
  const expertPromises = state.experts.map(async (expert) => {
    const alias = state.modelMapping[expert.role] || "reasoning-light";
    const systemPrompt = buildExpertPrompt(expert.role, expert.task);

    const messages: BaseMessageLike[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: state.userRequest },
    ];

    emitNodeStart(state.threadId, expert.role, { round: 1, model: alias });

    const content = await streamModel(alias, messages, (token) => {
      emitToken(state.threadId, expert.role, token, { round: 1 });
    });

    emitNodeDone(state.threadId, expert.role, { round: 1, length: content.length });

    return { role: expert.role, content };
  });

  const results = await Promise.all(expertPromises);

  for (const r of results) {
    expertResults[r.role] = r.content;
    debateHistory[r.role] = { 1: r.content };
  }

  emitNodeDone(state.threadId, "runExperts", { round: 1 });

  return {
    expertResults,
    debateHistory,
    currentRound: 1,
  };
}

// ============================================================
// Debate Round Node: Round 2+ (sequential, streaming)
// ============================================================
export async function debateRoundNode(state: GraphStateType) {
  const round = state.currentRound + 1;
  emitNodeStart(state.threadId, "debateRound", { round });

  const updatedHistory = { ...state.debateHistory };
  const debateContext = buildDebateContext(state.userRequest, state.debateHistory);

  // Sequential: each expert sees all previous outputs
  for (const expert of state.experts) {
    const alias = state.modelMapping[expert.role] || "reasoning-light";
    const systemPrompt = buildExpertPrompt(expert.role, expert.task);

    const debateTask = `${debateContext}
=== Your Task ===
This is debate Round ${round}. You have seen the previous analysis from other experts.
Provide your updated analysis, addressing their points.
Challenge weak arguments, reinforce strong ones. Be specific about what you agree or disagree with and why.`;

    const messages: BaseMessageLike[] = [
      {
        role: "system",
        content: systemPrompt + "\n\nYou are in a multi-expert debate. Respond critically and constructively.",
      },
      { role: "user", content: debateTask },
    ];

    emitNodeStart(state.threadId, expert.role, { round, model: alias });

    const content = await streamModel(alias, messages, (token) => {
      emitToken(state.threadId, expert.role, token, { round });
    });

    emitNodeDone(state.threadId, expert.role, { round, length: content.length });

    if (!updatedHistory[expert.role]) updatedHistory[expert.role] = {};
    updatedHistory[expert.role][round] = content;
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

  const debateContext = buildDebateContext(state.userRequest, state.debateHistory);

  const criticAlias = "critical-heavy";
  const messages: BaseMessageLike[] = [
    { role: "system", content: prompts.critic },
    {
      role: "user",
      content: `Review the following multi-expert discussion. Find flaws, gaps, contradictions, and unchallenged assumptions.\n\n${debateContext}`,
    },
  ];

  const critique = await streamModel(criticAlias, messages, (token) => {
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
  context += "=== Full Expert Discussion ===\n\n";

  for (const [role, rounds] of Object.entries(state.debateHistory)) {
    for (const [round, content] of Object.entries(rounds as Record<string, string>)) {
      context += `--- ${role} (Round ${round}) ---\n`;
      context += content + "\n\n";
    }
  }

  if (state.critique) {
    context += `=== Critic Review ===\n${state.critique}\n\n`;
  }

  const judgeAlias = "reasoning-heavy";
  const messages: BaseMessageLike[] = [
    { role: "system", content: prompts.judge },
    {
      role: "user",
      content: `Synthesize the following multi-expert analysis into a clear, actionable final answer.\n\n${context}`,
    },
  ];

  const finalAnswer = await streamModel(judgeAlias, messages, (token) => {
    emitToken(state.threadId, "judge", token);
  });

  emitNodeDone(state.threadId, "judge", { length: finalAnswer.length });

  return {
    finalAnswer,
  };
}
