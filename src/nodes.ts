import { GraphStateType } from "./state.js";
import { models } from "./models.js";
import { prompts } from "./prompts.js";
import { debateAgentCall } from "./agents/factory.js";

const agentConfigs: Record<string, { model: string; prompt: string }> = {
  coding: { model: "coding", prompt: prompts.coding },
  research: { model: "research", prompt: prompts.research },
  finance: { model: "finance", prompt: prompts.finance },
  document: { model: "document", prompt: prompts.document },
  general: { model: "general", prompt: "You are a helpful general assistant. Answer questions clearly and concisely." },
};

/** Round 1: Each agent independently analyzes the task */
export async function runAgentsNode(state: GraphStateType) {
  const agentResults: Record<string, string> = {};
  const debateHistory: Record<string, Record<number, string>> = {};
  const errors: string[] = [];

  const specialistAgents = state.selectedAgents.filter(
    (a) => a !== "critic" && a !== "judge"
  );

  if (specialistAgents.length === 0) {
    return {
      agentResults: {},
      debateHistory: {},
      errors: [...state.errors, "No specialist agents selected"],
    };
  }

  // Run all agents in parallel for Round 1
  const promises = specialistAgents.map(async (agentName) => {
    const config = agentConfigs[agentName];
    if (!config) {
      errors.push(`Agent config not found: ${agentName}`);
      return;
    }

    try {
      const model = (models as Record<string, any>)[config.model];
      if (!model) {
        errors.push(`Model not found for agent: ${agentName}`);
        return;
      }

      const result = await debateAgentCall(
        model,
        config.prompt,
        agentName,
        state.userRequest,
        {}, // Round 1: no other opinions yet
        1
      );

      agentResults[agentName] = result;
      debateHistory[agentName] = { 1: result };
    } catch (error: any) {
      errors.push(`${agentName} failed: ${error.message}`);
    }
  });

  await Promise.all(promises);

  return {
    agentResults,
    debateHistory,
    currentRound: 1,
    errors: [...state.errors, ...errors],
  };
}

/** Round 2+: Agents see each other's outputs and debate */
export async function debateRoundNode(state: GraphStateType) {
  const nextRound = state.currentRound + 1;
  const newResults = { ...state.agentResults };
  const newHistory = { ...state.debateHistory };
  const errors: string[] = [];

  const specialistAgents = state.selectedAgents.filter(
    (a) => a !== "critic" && a !== "judge"
  );

  // Sequential so each agent sees the previous agent's updated output
  for (const agentName of specialistAgents) {
    const config = agentConfigs[agentName];
    if (!config) continue;

    try {
      const model = (models as Record<string, any>)[config.model];
      if (!model) continue;

      const result = await debateAgentCall(
        model,
        config.prompt,
        agentName,
        state.userRequest,
        newResults, // All other agents' latest outputs
        nextRound
      );

      newResults[agentName] = result;
      if (!newHistory[agentName]) newHistory[agentName] = {};
      newHistory[agentName][nextRound] = result;
    } catch (error: any) {
      errors.push(`${agentName} debate round ${nextRound} failed: ${error.message}`);
    }
  }

  return {
    agentResults: newResults,
    debateHistory: newHistory,
    currentRound: nextRound,
    errors: [...state.errors, ...errors],
  };
}

/** Critic reviews all debate rounds */
export async function criticNode(state: GraphStateType) {
  try {
    // Build a comprehensive view of all debate rounds
    const debateSummary = Object.entries(state.debateHistory)
      .map(([agent, rounds]) => {
        const roundTexts = Object.entries(rounds)
          .sort(([a], [b]) => parseInt(a) - parseInt(b))
          .map(([round, text]) => `Round ${round}: ${text}`)
          .join("\n");
        return `## ${agent.toUpperCase()}:\n${roundTexts}`;
      })
      .join("\n\n");

    const response = await models.critic.invoke([
      { role: "system", content: prompts.critic },
      {
        role: "user",
        content: `Review the full debate for task: "${state.userRequest}"\n\n${debateSummary}\n\nProvide critique covering:\n1. Logical flaws across all rounds\n2. Claims that went unchallenged but should have been\n3. Missing perspectives\n4. Whether the debate converged or is still divergent\n\nIndicate if revision is needed (yes/no).`,
      },
    ]);

    const content = response.content as string;
    const needsRevision =
      content.toLowerCase().includes("revision needed: yes") ||
      content.toLowerCase().includes("needs revision: yes") ||
      content.toLowerCase().includes("significant issues found");

    return {
      critique: content,
      needsRevision,
      revisionCount: needsRevision ? state.revisionCount + 1 : state.revisionCount,
    };
  } catch (error: any) {
    return {
      critique: null,
      needsRevision: false,
      errors: [...state.errors, `Critic failed: ${error.message}`],
    };
  }
}

/** Judge synthesizes the final answer from all debate rounds */
export async function judgeNode(state: GraphStateType) {
  try {
    const debateSummary = Object.entries(state.debateHistory)
      .map(([agent, rounds]) => {
        const roundTexts = Object.entries(rounds)
          .sort(([a], [b]) => parseInt(a) - parseInt(b))
          .map(([round, text]) => `Round ${round}: ${text}`)
          .join("\n");
        return `## ${agent.toUpperCase()}:\n${roundTexts}`;
      })
      .join("\n\n");

    const critiqueSection = state.critique
      ? `\n\n## CRITIC REVIEW:\n${state.critique}`
      : "";

    const response = await models.judge.invoke([
      { role: "system", content: prompts.judge },
      {
        role: "user",
        content: `Synthesize a final answer for: "${state.userRequest}"\n\nFull debate (${state.currentRound} rounds):\n\n${debateSummary}${critiqueSection}\n\nProduce a coherent, actionable final answer. If there were disagreements, state which side was more convincing and why.`,
      },
    ]);

    return { finalAnswer: response.content as string };
  } catch (error: any) {
    return {
      finalAnswer: null,
      errors: [...state.errors, `Judge failed: ${error.message}`],
    };
  }
}
