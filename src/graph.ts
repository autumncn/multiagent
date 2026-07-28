// LangGraph workflow definition
// Dynamic graph with conditional edges for debate mode

import { StateGraph, END } from "@langchain/langgraph";
import { GraphState } from "./state.js";
import {
  routerNode,
  runAgentsNode,
  debateRoundNode,
  criticNode,
  judgeNode,
} from "./nodes.js";

// After router: always go to runAgents
// (routing decisions are encoded in state.selectedAgents)

// After runAgents: decide next step based on task complexity
function afterRunAgents(state: typeof GraphState.State): string {
  // Debate mode with multiple agents → start debate rounds
  if (state.debateMode && state.selectedAgents.length >= 2) {
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
    return "runAgents"; // Re-run with feedback
  }
  return "judge"; // Proceed to final judgment
}

// Build the graph
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
