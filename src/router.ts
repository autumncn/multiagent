import { models } from "./models.js";
import { prompts } from "./prompts.js";
import { RouterDecisionSchema } from "./schemas.js";
import { GraphStateType } from "./state.js";

export async function routerNode(state: GraphStateType) {
  const model = models.router;

  const response = await model.withStructuredOutput(RouterDecisionSchema).invoke([
    { role: "system", content: prompts.router },
    { role: "user", content: state.userRequest },
  ]);

  return {
    primaryAgent: response.primaryAgent,
    selectedAgents: [response.primaryAgent, ...response.secondaryAgents.filter(a => a !== "critic")],
    complexity: response.complexity,
    requiresMultiAgent: response.requiresMultiAgent,
    debateMode: response.debateMode || false,
    routingReason: response.reason,
  };
}
