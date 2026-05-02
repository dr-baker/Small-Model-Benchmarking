import { AuthStorage } from "@mariozechner/pi-coding-agent";
import { applyEnvApiKeyOverrides } from "./env-api-keys.js";
import type { ModelRef } from "../core/contracts.js";

/**
 * Resolve an API key using pi SDK AuthStorage (covers ~/.pi/agent/auth.json,
 * OAuth, env overrides from .env, and process.env fallback).
 */
export async function resolveModelApiKey(model: ModelRef): Promise<string | undefined> {
  const authStorage = AuthStorage.create();
  applyEnvApiKeyOverrides(authStorage);
  return authStorage.getApiKey(model.provider);
}
