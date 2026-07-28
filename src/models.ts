import { ChatOpenAI } from "@langchain/openai";

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

export const models = {
  router: createModel(process.env.MODEL_ROUTER || "router-fast"),
  general: createModel(process.env.MODEL_GENERAL || "general-fast"),
  coding: createModel(process.env.MODEL_CODING || "coding-primary"),
  research: createModel(process.env.MODEL_RESEARCH || "research-primary"),
  finance: createModel(process.env.MODEL_FINANCE || "finance-primary"),
  document: createModel(process.env.MODEL_DOCUMENT || "document-primary"),
  critic: createModel(process.env.MODEL_CRITIC || "critic-primary"),
  judge: createModel(process.env.MODEL_JUDGE || "judge-primary"),
};
