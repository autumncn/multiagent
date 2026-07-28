import { ChatOpenAI } from "@langchain/openai";
import { BaseMessageLike } from "@langchain/core/messages";

const baseUrl = process.env.LITELLM_BASE_URL || "http://localhost:4000/v1";
const apiKey = process.env.LITELLM_API_KEY || "sk-dummy";

export function createModel(alias: string): ChatOpenAI {
  return new ChatOpenAI({
    model: alias,
    configuration: {
      baseURL: baseUrl,
      apiKey: apiKey,
    },
    temperature: 0.7,
    maxTokens: 4096,
  });
}

// Streaming model call: returns full content, calls onToken for each chunk
export async function streamModel(
  alias: string,
  messages: BaseMessageLike[],
  onToken: (token: string) => void
): Promise<string> {
  const model = createModel(alias);
  const stream = await model.stream(messages);
  let full = "";
  for await (const chunk of stream) {
    const content = chunk.content;
    if (typeof content === "string" && content.length > 0) {
      full += content;
      onToken(content);
    }
  }
  return full;
}

// Non-streaming model call (for router JSON parsing)
export async function invokeModel(
  alias: string,
  messages: BaseMessageLike[]
): Promise<string> {
  const model = createModel(alias);
  const response = await model.invoke(messages);
  return response.content as string;
}
