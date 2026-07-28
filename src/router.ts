import { models } from "./models.js";
import { prompts } from "./prompts.js";
import { RouterDecisionSchema } from "./schemas.js";
import { GraphStateType } from "./state.js";

export async function routerNode(state: GraphStateType) {
  const model = models.router;

  const routerPrompt = `${prompts.router}

IMPORTANT: Respond ONLY with a valid JSON object, no markdown, no explanation.
Schema:
{
  "primaryAgent": "general" | "coding" | "research" | "finance" | "document",
  "secondaryAgents": [...],  // max 3, can be empty array
  "complexity": "simple" | "moderate" | "complex",
  "requiresMultiAgent": true | false,
  "debateMode": true | false,
  "reason": "brief explanation"
}`;

  const response = await model.invoke([
    { role: "system", content: routerPrompt },
    { role: "user", content: state.userRequest },
  ]);

  // Parse JSON from response
  const content = response.content as string;
  let parsed;
  try {
    // Try to extract JSON from possible markdown code blocks
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("No JSON found");
    }
  } catch {
    // Fallback: route to general agent
    console.error("[Router] Failed to parse JSON, fallback to general:", content);
    parsed = {
      primaryAgent: "general",
      secondaryAgents: [],
      complexity: "simple",
      requiresMultiAgent: false,
      debateMode: false,
      reason: "Router parse failed, fallback to general",
    };
  }

  // Validate with Zod (soft - use defaults on failure)
  const validated = RouterDecisionSchema.safeParse(parsed);
  const decision = validated.success ? validated.data : parsed;

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
