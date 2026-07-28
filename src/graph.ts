import { StateGraph, END } from "@langchain/langgraph";
import { GraphState } from "./state.js";
import { routerNode } from "./router.js";
import { runAgentsNode, debateRoundNode, criticNode, judgeNode } from "./nodes.js";

function afterRouter(state: typeof GraphState.State): string {
  // Simple tasks with single agent, no debate needed
  if (!state.requiresMultiAgent) {
    return "runAgents";
  }
  return "runAgents";
}

function afterRunAgents(state: typeof GraphState.State): string {
  // If debate mode is on, start debate rounds
  if (state.debateMode && state.selectedAgents.length >= 2) {
    return "debateRound";
  }
  // Complex but no debate → go to critic
  if (state.complexity === "complex") {
    return "critic";
  }
  // Moderate or simple → go straight to judge
  return "judge";
}

function afterDebate(state: typeof GraphState.State): string {
  const maxRounds = state.maxRounds || 2;
  if (state.currentRound < maxRounds) {
    return "debateRound"; // Continue debating
  }
  // Debate rounds complete → critic review
  return "critic";
}

function afterCritic(state: typeof GraphState.State): string {
  if (state.needsRevision && state.revisionCount < 2) {
    return "runAgents"; // Re-run agents with fresh start
  }
  return "judge";
}

const graph = new StateGraph(GraphState)
  .addNode("router", routerNode)
  .addNode("runAgents", runAgentsNode)
  .addNode("debateRound", debateRoundNode)
  .addNode("critic", criticNode)
  .addNode("judge", judgeNode)
  .addEdge("__start__", "router")
  .addEdge("router", "runAgents")
  .addConditionalEdges("runAgents", afterRunAgents)
  .addConditionalEdges("debateRound", afterDebate)
  .addConditionalEdges("critic", afterCritic)
  .addEdge("judge", END);

export const compiledGraph = graph.compile();
