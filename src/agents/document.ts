import { models } from "../models.js";
import { prompts } from "../prompts.js";
import { createSpecialistAgent } from "./factory.js";

export const documentAgent = createSpecialistAgent(
  models.document,
  prompts.document,
  "document"
);
