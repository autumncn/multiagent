import { models } from "../models.js";
import { prompts } from "../prompts.js";
import { createSpecialistAgent } from "./factory.js";

export const researchAgent = createSpecialistAgent(
  models.research,
  prompts.research,
  "research"
);
