// LangGraph workflow: Dynamic Multi-Agent Orchestrator
// Router generates dynamic experts → run experts → optional debate → critic → judge

import { StateGraph, END } from "@langchain/langgraph";
import { GraphState } from "./state.js";
import {
  routerNode,
  collectDataNode,
  runExpertsNode,
  debateRoundNode,
  criticNode,
  judgeNode,
} from "./nodes.js";

// After runExperts: decide next step
function afterRunExperts(state: typeof GraphState.State): string {
  // Debate mode with multiple experts → start debate rounds
  if (state.debateMode && state.experts.length >= 2) {
    return "debateRound";
  }
  // Complex but no debate → critic review
  if (state.complexity === "complex") {
    return "critic";
  }
  // Simple/moderate → straight to judge
  return "judge";
}

// After debate round: continue or move to critic
function afterDebate(state: typeof GraphState.State): string {
  const maxRounds = state.maxRounds || 2;
  if (state.currentRound < maxRounds) {
    return "debateRound"; // Continue debating
  }
  return "critic"; // Debate complete → critic review
}

// After critic: revision or judge
function afterCritic(state: typeof GraphState.State): string {
  if (state.needsRevision && state.revisionCount < 2) {
    return "runExperts"; // Re-run with feedback
  }
  return "judge"; // Proceed to final judgment
}

// Build the graph
const graph = new StateGraph(GraphState)
  .addNode("router", routerNode)
  .addNode("collectData", collectDataNode)
  .addNode("runExperts", runExpertsNode)
  .addNode("debateRound", debateRoundNode)
  .addNode("critic", criticNode)
  .addNode("judge", judgeNode)
  .addEdge("__start__", "router")
  .addEdge("router", "collectData")
  .addEdge("collectData", "runExperts")
  .addConditionalEdges("runExperts", afterRunExperts)
  .addConditionalEdges("debateRound", afterDebate)
  .addConditionalEdges("critic", afterCritic)
  .addEdge("judge", END);

export const compiledGraph = graph.compile();
