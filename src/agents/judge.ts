import { models } from "../models.js";
import { prompts } from "../prompts.js";

export async function judgeAgent(
  task: string,
  agentResults: Record<string, string>,
  critique: string | null
): Promise<string> {
  const inputs = Object.entries(agentResults)
    .map(([agent, result]) => `## ${agent.toUpperCase()} AGENT:\n${result}`)
    .join("\n\n");

  const critiqueSection = critique ? `\n\n## CRITIC REVIEW:\n${critique}` : "";

  const response = await models.judge.invoke([
    { role: "system", content: prompts.judge },
    {
      role: "user",
      content: `Synthesize a final answer for: "${task}"\n\n${inputs}${critiqueSection}\n\nProduce a coherent, actionable final answer.`,
    },
  ]);

  return response.content as string;
}
