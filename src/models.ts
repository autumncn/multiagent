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

// Model alias map
const modelAliases: Record<string, string> = {
  router: process.env.MODEL_ROUTER || "router-fast",
  general: process.env.MODEL_GENERAL || "general-fast",
  coding: process.env.MODEL_CODING || "coding-primary",
  research: process.env.MODEL_RESEARCH || "research-primary",
  finance: process.env.MODEL_FINANCE || "finance-primary",
  document: process.env.MODEL_DOCUMENT || "document-primary",
  critic: process.env.MODEL_CRITIC || "critic-primary",
  judge: process.env.MODEL_JUDGE || "judge-primary",
};

export function getModelAlias(agentType: string): string {
  return modelAliases[agentType] || modelAliases.general;
}

// Backward compat: pre-built model instances (used by graph.ts/nodes.ts)
export const models = {
  router: createModel(modelAliases.router),
  general: createModel(modelAliases.general),
  coding: createModel(modelAliases.coding),
  research: createModel(modelAliases.research),
  finance: createModel(modelAliases.finance),
  document: createModel(modelAliases.document),
  critic: createModel(modelAliases.critic),
  judge: createModel(modelAliases.judge),
};
