import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AuthStorage } from "@mariozechner/pi-coding-agent";

/**
 * Mapping from standard env var names to pi SDK provider IDs.
 * Add new providers here as needed.
 */
const ENV_TO_PROVIDER: Record<string, string> = {
  OPENROUTER_API_KEY: "openrouter",
  ANTHROPIC_API_KEY: "anthropic",
  OPENAI_API_KEY: "openai",
  GOOGLE_API_KEY: "google",
  GOOGLE_GEMINI_API_KEY: "google",
  MISTRAL_API_KEY: "mistral",
  DEEPSEEK_API_KEY: "deepseek",
  XAI_API_KEY: "xai",
};

/**
 * Parse a simple .env file (KEY=VALUE lines, no nesting, # comments).
 * Does not use dotenv — keeps it dependency-free.
 */
function parseDotEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};

  const content = readFileSync(filePath, "utf8");
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip matching surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Load provider API keys from a project-local `.env` file and apply them
 * as runtime overrides on the given AuthStorage (highest priority).
 *
 * This lets the benchmark use separate keys from the user's global
 * `~/.config/pi/auth.json` — e.g. a dedicated OpenRouter key for
 * cost tracking.
 */
export function applyEnvApiKeyOverrides(authStorage: AuthStorage, projectRoot?: string): void {
  const root = projectRoot ?? resolve(import.meta.dirname ?? ".", "../..");
  const envVars = parseDotEnv(resolve(root, ".env"));

  for (const [envVar, provider] of Object.entries(ENV_TO_PROVIDER)) {
    // .env values take precedence, fall back to process.env
    const key = envVars[envVar] ?? process.env[envVar];
    if (key) {
      authStorage.setRuntimeApiKey(provider, key);
    }
  }
}
