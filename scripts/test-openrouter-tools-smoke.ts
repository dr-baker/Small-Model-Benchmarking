import process from "node:process";
import type { JsonValue } from "../src/shared/json.js";
import { runLlmClient } from "../src/shared/llm-client.js";
import { resolveModelApiKey } from "../src/shared/api-key.js";
import { parseModelRefFromString } from "../src/shared/config.js";
import type { ModelTransportConfig, OpenRouterProviderRoutingConfig } from "../src/shared/contracts.js";

interface CliArgs {
  model: string;
  providerOnly?: string[];
  providerOrder?: string[];
  maxRounds: number;
  verbose: boolean;
}

function parseCsv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function parsePositiveInteger(raw: string | undefined, flagName: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return value;
}

function printHelp(): void {
  console.log(`OpenRouter tool-calling smoke test

Usage:
  npm run test:tools:smoke -- [options]

Options:
  --model=<provider/model>        Model ref. Default: openrouter/openai/gpt-oss-safeguard-20b
  --provider-only=<a,b>           Pin OpenRouter providers via routing.only
  --provider-order=<a,b>          Prefer OpenRouter providers via routing.order
  --max-rounds=<n>                Maximum tool-call rounds. Default: 4
  --verbose                       Print the full event log
  --help                          Show this help

Example:
  npm run test:tools:smoke -- --model=openrouter/openai/gpt-oss-safeguard-20b --provider-only=groq --verbose
`);
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    maxRounds: 4,
    verbose: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--verbose") {
      args.verbose = true;
      continue;
    }
    if (arg.startsWith("--model=")) {
      args.model = arg.slice("--model=".length);
      continue;
    }
    if (arg.startsWith("--provider-only=")) {
      args.providerOnly = parseCsv(arg.slice("--provider-only=".length));
      continue;
    }
    if (arg.startsWith("--provider-order=")) {
      args.providerOrder = parseCsv(arg.slice("--provider-order=".length));
      continue;
    }
    if (arg.startsWith("--max-rounds=")) {
      args.maxRounds = parsePositiveInteger(arg.slice("--max-rounds=".length), "--max-rounds");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function buildRouting(args: CliArgs): OpenRouterProviderRoutingConfig | undefined {
  if (!args.providerOnly && !args.providerOrder) return undefined;
  return {
    ...(args.providerOnly ? { only: args.providerOnly } : {}),
    ...(args.providerOrder ? { order: args.providerOrder } : {}),
  };
}

function extractErrorMessage(error: JsonValue | undefined): string | undefined {
  if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : JSON.stringify(error);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv);
  const model = parseModelRefFromString(args.model);
  const apiKey = await resolveModelApiKey(model);
  if (!apiKey) {
    throw new Error(`No API key resolved for provider '${model.provider}'. Check .env or your pi auth config.`);
  }

  const transport: ModelTransportConfig = {
    kind: "openrouter",
    openRouterUseStructuredOutputs: false,
    ...(buildRouting(args) ? { openRouterRouting: buildRouting(args) } : {}),
  };

  const result = await runLlmClient({
    model,
    transport,
    messages: [
      {
        role: "system",
        content: "You are a tool-calling smoke test assistant. Follow the user's instructions exactly.",
      },
      {
        role: "user",
        content: [
          "Call the `smoke_lookup` tool exactly once.",
          "After the tool returns, reply with exactly one plain-text line:",
          "TOOL_OK: <tool result text>",
          "Do not use JSON.",
        ].join("\n"),
      },
    ],
    tools: [{
      name: "smoke_lookup",
      description: "Returns a fixed smoke-test value for tool-calling diagnostics.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Any short topic string." },
        },
        required: ["topic"],
        additionalProperties: false,
      },
      execute: async (_toolCallId: string, params: unknown) => {
        const topic = params && typeof params === "object" && !Array.isArray(params) && typeof (params as { topic?: unknown }).topic === "string"
          ? (params as { topic: string }).topic
          : "unknown";
        return {
          content: [{ type: "text", text: `smoke-result-for:${topic}` }],
        };
      },
    }],
    apiKey,
    maxRounds: args.maxRounds,
  });

  const summary = {
    model: `${model.provider}/${model.modelId}`,
    routing: transport.openRouterRouting ?? null,
    maxRounds: args.maxRounds,
    finalText: result.finalText ?? null,
    errorMessage: extractErrorMessage(result.error) ?? null,
    usage: result.usage ?? null,
    toolInvocations: result.toolInvocations,
    eventTypes: result.events.map((event) => event.eventType),
    events: args.verbose ? result.events : result.events.slice(-10),
  };

  console.log(JSON.stringify(summary, null, 2));

  const failed = Boolean(result.error) || result.toolInvocations.length === 0 || !result.finalText;
  if (failed) {
    process.exitCode = 1;
  }
}

await main();
