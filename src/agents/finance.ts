import { models } from "../models.js";
import { prompts } from "../prompts.js";
import { createSpecialistAgent } from "./factory.js";

export const financeAgent = createSpecialistAgent(
  models.finance,
  prompts.finance,
  "finance"
);
