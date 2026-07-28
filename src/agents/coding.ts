import { models } from "../models.js";
import { prompts } from "../prompts.js";
import { createSpecialistAgent } from "./factory.js";

export const codingAgent = createSpecialistAgent(
  models.coding,
  prompts.coding,
  "coding"
);
