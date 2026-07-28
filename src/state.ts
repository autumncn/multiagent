import { Annotation } from "@langchain/langgraph";

export const GraphState = Annotation.Root({
  userRequest: Annotation<string>,
  threadId: Annotation<string>,

  // Router output
  primaryAgent: Annotation<string>,
  selectedAgents: Annotation<string[]>,
  complexity: Annotation<"simple" | "moderate" | "complex">,
  requiresMultiAgent: Annotation<boolean>,
  debateMode: Annotation<boolean>,
  routingReason: Annotation<string>,

  // Debate control
  currentRound: Annotation<number>,
  maxRounds: Annotation<number>,

  // Agent results (accumulated across rounds)
  agentResults: Annotation<Record<string, string>>,
  debateHistory: Annotation<Record<string, Record<number, string>>>,

  // Critic output
  critique: Annotation<string | null>,
  needsRevision: Annotation<boolean>,

  // Judge output
  finalAnswer: Annotation<string | null>,

  // Metadata
  errors: Annotation<string[]>,
  revisionCount: Annotation<number>,
});

export type GraphStateType = typeof GraphState.State;
