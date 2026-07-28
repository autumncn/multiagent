import { models } from "../models.js";
import { prompts } from "../prompts.js";

export async function criticAgent(
  task: string,
  agentResults: Record<string, string>
): Promise<{ critique: string; needsRevision: boolean }> {
  const inputs = Object.entries(agentResults)
    .map(([agent, result]) => `## ${agent.toUpperCase()} AGENT:\n${result}`)
    .join("\n\n");

  const response = await models.critic.invoke([
    { role: "system", content: prompts.critic },
    {
      role: "user",
      content: `Review these agent outputs for the task: "${task}"\n\n${inputs}\n\nProvide critique and indicate if revision is needed (yes/no).`,
    },
  ]);

  const content = response.content as string;
  const needsRevision = content.toLowerCase().includes("revision needed: yes") || 
                        content.toLowerCase().includes("needs revision: yes") ||
                        content.toLowerCase().includes("significant issues found");

  return { critique: content, needsRevision };
}
