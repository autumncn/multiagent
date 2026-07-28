// Model Capability Registry
// Loads registry.yaml and provides dynamic model matching

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AliasEntry {
  capabilities: string[];
  description: string;
  cost_tier?: string;
  fixed_node?: string;
}

interface RegistryData {
  aliases: Record<string, AliasEntry>;
}

// Load registry from YAML
function loadRegistry(): RegistryData {
  // In Docker: registry.yaml is at /app/dist/registry.yaml
  // In dev: registry.yaml is at src/registry.yaml
  const paths = [
    path.join(__dirname, "registry.yaml"),          // dist/ (Docker)
    path.join(__dirname, "..", "src", "registry.yaml"), // dev mode
  ];

  let filePath = "";
  for (const p of paths) {
    if (fs.existsSync(p)) {
      filePath = p;
      break;
    }
  }

  if (!filePath) {
    console.error("registry.yaml not found in any expected path");
    // Return empty registry
    return { aliases: {} };
  }

  console.log(`Loaded model registry from: ${filePath}`);
  const content = fs.readFileSync(filePath, "utf8");
  return yaml.load(content) as RegistryData;
}

const registry = loadRegistry();

// Match capabilities to find the best model alias for dynamic experts
// Skips fixed_node aliases (reserved for router/judge/critic)
// Scoring: exact match +3, partial match +1 per capability
export function matchModel(needs: string[]): string {
  let bestAlias = "general-fast"; // fallback
  let bestScore = 0;

  for (const [alias, entry] of Object.entries(registry.aliases)) {
    // Skip fixed_node aliases (reserved for specific nodes)
    if (entry.fixed_node) continue;

    let score = 0;
    for (const need of needs) {
      const needLower = need.toLowerCase();

      // Exact capability match
      if (entry.capabilities.some((c) => c.toLowerCase() === needLower)) {
        score += 3;
      }
      // Partial match (capability contains need or vice versa)
      else if (
        entry.capabilities.some(
          (c) =>
            c.toLowerCase().includes(needLower) ||
            needLower.includes(c.toLowerCase())
        )
      ) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestAlias = alias;
    }
  }

  return bestAlias;
}

// Get the fixed model alias for a specific node (router, judge, critic)
export function getFixedNodeModel(nodeName: string): string {
  for (const [alias, entry] of Object.entries(registry.aliases)) {
    if (entry.fixed_node === nodeName) {
      return alias;
    }
  }
  // Fallback if no fixed_node found
  if (nodeName === "router") return "router-fast";
  if (nodeName === "judge") return "judge-primary";
  if (nodeName === "critic") return "critic-primary";
  return "general-fast";
}

// Get all registered aliases
export function getAllAliases(): string[] {
  return Object.keys(registry.aliases);
}

// Get capabilities for an alias
export function getCapabilities(alias: string): string[] {
  return registry.aliases[alias]?.capabilities || [];
}

// Get description for an alias
export function getDescription(alias: string): string {
  return registry.aliases[alias]?.description || "";
}

// Get cost tier for an alias
export function getCostTier(alias: string): string {
  return registry.aliases[alias]?.cost_tier || "unknown";
}

// Log registry summary on startup
export function logRegistrySummary(): void {
  const entries = Object.entries(registry.aliases);
  console.log(`Registry loaded: ${entries.length} aliases`);
  for (const [alias, entry] of entries) {
    console.log(`  ${alias}: ${entry.capabilities.length} capabilities (${entry.cost_tier || "unknown"})`);
  }
}
