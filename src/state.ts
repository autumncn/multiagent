import { Annotation } from "@langchain/langgraph";
import { Expert } from "./schemas.js";

export const GraphState = Annotation.Root({
  userRequest: Annotation<string>,
  threadId: Annotation<string>,

  // Router output: dynamic experts
  experts: Annotation<Expert[]>,
  complexity: Annotation<"simple" | "moderate" | "complex">,
  debateMode: Annotation<boolean>,
  routingReason: Annotation<string>,

  // Debate control
  currentRound: Annotation<number>,
  maxRounds: Annotation<number>,

  // Expert results (role -> content)
  expertResults: Annotation<Record<string, string>>,
  debateHistory: Annotation<Record<string, Record<number, string>>>,

  // Matched models (role -> LiteLLM alias)
  modelMapping: Annotation<Record<string, string>>,

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
