import { models } from "../models.js";
import { prompts } from "../prompts.js";
import { createSpecialistAgent } from "./factory.js";

export const generalAgent = createSpecialistAgent(
  models.general,
  "You are a helpful general assistant. Answer questions clearly and concisely.",
  "general"
);
