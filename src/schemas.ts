import { z } from "zod";

export const RouterDecisionSchema = z.object({
  primaryAgent: z.enum(["general", "coding", "research", "finance", "document"]),
  secondaryAgents: z.array(
    z.enum(["general", "coding", "research", "finance", "document", "critic"])
  ).max(3),
  complexity: z.enum(["simple", "moderate", "complex"]),
  requiresMultiAgent: z.boolean(),
  debateMode: z.boolean().optional().default(false),
  reason: z.string(),
});

export type RouterDecision = z.infer<typeof RouterDecisionSchema>;
