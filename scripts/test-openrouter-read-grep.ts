import process from "node:process";
import { resolve } from "node:path";
import type { JsonValue } from "../src/shared/json.js";
import { runLlmClient } from "../src/shared/llm-client.js";
import { resolveModelApiKey } from "../src/shared/api-key.js";
import { parseModelRefFromString, loadBenchmarkConfigWithMeta } from "../src/shared/config.js";
import type { ModelTransportConfig, OpenRouterProviderRoutingConfig, ToolSetName } from "../src/shared/contracts.js";
import { loadToolSetDefinition, createToolsForToolSet } from "../src/collect/tool-sets.js";

const REPO_ROOT = resolve(import.meta.dirname ?? ".", "..");

interface CliArgs {
  model: string;
  providerOnly?: string[];
  providerOrder?: string[];
  maxRounds: number;
  verbose: boolean;
  toolSet: ToolSetName;
  grepTerm: string;
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
  console.log(`OpenRouter read/grep tool diagnostic

Usage:
  npm run test:tools:read-grep -- [options]

Options:
  --model=<provider/model>        Model ref. Default: openrouter/openai/gpt-oss-safeguard-20b
  --provider-only=<a,b>           Pin OpenRouter providers via routing.only
  --provider-order=<a,b>          Prefer OpenRouter providers via routing.order
  --tool-set=<name>               Tool set name. Default: read_grep
  --grep-term=<term>              Term to force through grep. Default: TabView
  --max-rounds=<n>                Maximum tool-call rounds. Default: 6
  --verbose                       Print the full event log
  --help                          Show this help

Example:
  npm run test:tools:read-grep -- --model=openrouter/openai/gpt-oss-safeguard-20b --provider-only=groq --grep-term=TabView
`);
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    model: "openrouter/openai/gpt-oss-safeguard-20b",
    maxRounds: 6,
    verbose: false,
    toolSet: "read_grep",
    grepTerm: "TabView",
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
    if (arg.startsWith("--tool-set=")) {
      args.toolSet = arg.slice("--tool-set=".length) as ToolSetName;
      continue;
    }
    if (arg.startsWith("--grep-term=")) {
      args.grepTerm = arg.slice("--grep-term=".length);
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
  const { config } = await loadBenchmarkConfigWithMeta();
  const model = parseModelRefFromString(args.model);
  const apiKey = await resolveModelApiKey(model);
  if (!apiKey) {
    throw new Error(`No API key resolved for provider '${model.provider}'. Check .env or your pi auth config.`);
  }

  const toolSetDefinition = await loadToolSetDefinition(resolve(REPO_ROOT, config.paths.toolSets), args.toolSet);
  const corpusRoot = resolve(REPO_ROOT, config.corpus.rootDir);
  const tools = createToolsForToolSet(toolSetDefinition, corpusRoot, config.swiftDocs ? { swiftDocs: config.swiftDocs } : undefined);

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
        content: "You are testing read/grep tool use against a frozen docs corpus. Follow the user's instructions exactly.",
      },
      {
        role: "user",
        content: [
          `You must use grep to search for '${args.grepTerm}'.`,
          "Then you must use read on one relevant file from the grep results.",
          "After reading, answer in plain text using exactly these two lines:",
          "RESULT: <one-sentence answer>",
          "FILE: <relative file path that you actually read>",
          "Do not use JSON.",
        ].join("\n"),
      },
    ],
    tools,
    apiKey,
    maxRounds: args.maxRounds,
    cwd: corpusRoot,
  });

  const summary = {
    model: `${model.provider}/${model.modelId}`,
    routing: transport.openRouterRouting ?? null,
    toolSet: toolSetDefinition.name,
    corpusRoot,
    grepTerm: args.grepTerm,
    finalText: result.finalText ?? null,
    errorMessage: extractErrorMessage(result.error) ?? null,
    usage: result.usage ?? null,
    toolInvocations: result.toolInvocations,
    eventTypes: result.events.map((event) => event.eventType),
    events: args.verbose ? result.events : result.events.slice(-12),
  };

  console.log(JSON.stringify(summary, null, 2));

  const usedGrep = result.toolInvocations.some((invocation) => invocation.toolName === "grep");
  const usedRead = result.toolInvocations.some((invocation) => invocation.toolName === "read");
  const failed = Boolean(result.error) || !usedGrep || !usedRead || !result.finalText;
  if (failed) {
    process.exitCode = 1;
  }
}

await main();
