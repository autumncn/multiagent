import { ChatOpenAI } from "@langchain/openai";

export function createSpecialistAgent(
  model: ChatOpenAI,
  systemPrompt: string,
  agentName: string
) {
  return async (task: string): Promise<string> => {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: task },
    ]);
    return response.content as string;
  };
}

/** Debate-aware agent: sees other agents' outputs and responds */
export async function debateAgentCall(
  model: ChatOpenAI,
  systemPrompt: string,
  agentName: string,
  originalTask: string,
  otherOpinions: Record<string, string>,
  round: number
): Promise<string> {
  const othersText = Object.entries(otherOpinions)
    .filter(([name]) => name !== agentName)
    .map(([name, opinion]) => `### ${name.toUpperCase()}:\n${opinion}`)
    .join("\n\n");

  const debatePrompt = round === 1
    ? `Task: ${originalTask}\n\nPlease provide your initial analysis.`
    : `Original task: ${originalTask}\n\nOther experts have said:\n\n${othersText}\n\nYou are ${agentName.toUpperCase()}. This is debate round ${round}. Review the other experts' opinions. You may:\n- Agree and add supporting evidence\n- Disagree and explain why\n- Add new perspectives they missed\n- Concede points where they are right\n\nBe specific and reference their arguments.`;

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: debatePrompt },
  ]);

  return response.content as string;
}
