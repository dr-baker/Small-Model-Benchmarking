import type { ModelRef, ModelTransportConfig, PromptMessageSnapshot, ToolInvocationTrace, TraceEventRecord } from "./contracts.js";
import type { JsonValue } from "./json.js";
import type { OpenRouterResponseFormat } from "./response-schemas.js";
import { toJsonValue } from "./json.js";
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createExtensionRuntime,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { applyEnvApiKeyOverrides } from "./env-api-keys.js";

interface ToolLike {
  name: string;
  description: string;
  parameters: unknown;
  prepareArguments?: (args: unknown) => unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: (partialResult: unknown) => void) => Promise<{ content: Array<{ type: string; text?: string }> }>;
}

export interface LlmClientMessage extends PromptMessageSnapshot {}

export interface LlmClientConfig {
  model: ModelRef;
  transport: ModelTransportConfig;
  systemPrompt?: string;
  userPrompt?: string;
  messages?: LlmClientMessage[];
  tools: readonly unknown[];
  responseFormat?: OpenRouterResponseFormat;
  maxRounds?: number;
  apiKey?: string | undefined;
}

export interface LlmClientResult {
  finalText: string | undefined;
  finalAssistantMessage: JsonValue | undefined;
  usage: JsonValue | undefined;
  costUsd: number | undefined;
  toolInvocations: ToolInvocationTrace[];
  events: TraceEventRecord[];
  error: JsonValue | undefined;
  elapsedMs: number;
}

export interface LlmClientDeps {
  fetchImpl?: typeof fetch;
  createAgentSessionImpl?: typeof createAgentSession;
  createAuthStorage?: () => AuthStorage;
  createModelRegistry?: (authStorage: AuthStorage) => ModelRegistry;
  createSessionManager?: () => SessionManager;
  createSettingsManager?: (transport: ModelTransportConfig) => SettingsManager;
  resolvePiModel?: (model: ModelRef, modelRegistry: ModelRegistry) => unknown;
}

function resolveMessages(config: LlmClientConfig): ChatMessage[] {
  if (config.messages && config.messages.length > 0) {
    return config.messages.map((message) => ({ role: message.role, content: message.content }));
  }

  if (typeof config.systemPrompt === "string" && typeof config.userPrompt === "string") {
    return [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: config.userPrompt },
    ];
  }

  throw new Error("LlmClientConfig requires either messages or both systemPrompt and userPrompt.");
}

const PROVIDER_BASE_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
};

function agentToolsToOpenAITools(tools: readonly unknown[]) {
  return tools.map((raw) => {
    const t = raw as ToolLike;
    return {
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: JSON.parse(JSON.stringify(t.parameters)) as Record<string, unknown>,
      },
    };
  });
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  total_cost?: number;
  cost_details?: {
    upstream_inference_cost?: number;
  };
  [key: string]: unknown;
}

interface ChatCompletionResponse {
  choices: Array<{ message: ChatMessage; finish_reason: string }>;
  usage?: ChatCompletionUsage;
}

function extractCostUsd(usage: ChatCompletionUsage | undefined): number | undefined {
  if (!usage) return undefined;
  const directCost = typeof usage.cost === "number" ? usage.cost : undefined;
  if (directCost !== undefined) return directCost;
  const totalCost = typeof usage.total_cost === "number" ? usage.total_cost : undefined;
  if (totalCost !== undefined) return totalCost;
  const upstreamCost = typeof usage.cost_details?.upstream_inference_cost === "number"
    ? usage.cost_details.upstream_inference_cost
    : undefined;
  return upstreamCost;
}

function buildUsageSummary(promptTokens: number, completionTokens: number, totalCostUsd: number | undefined): JsonValue | undefined {
  const hasTokens = promptTokens > 0 || completionTokens > 0;
  const hasCost = typeof totalCostUsd === "number";
  if (!hasTokens && !hasCost) return undefined;
  return toJsonValue({
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    ...(hasCost ? { cost: totalCostUsd } : {}),
  });
}

function failTool(
  invocation: ToolInvocationTrace,
  messages: ChatMessage[],
  events: TraceEventRecord[],
  toolCallId: string,
  toolName: string,
  content: string,
  isError: boolean,
) {
  invocation.finishedAt = new Date().toISOString();
  invocation.isError = isError;
  invocation.result = toJsonValue(content);
  messages.push({ role: "tool", tool_call_id: toolCallId, content });
  events.push({
    observedAt: new Date().toISOString(),
    eventType: "tool_execution_end",
    payload: toJsonValue({ toolCallId, toolName, isError, result: content }),
  });
}

function buildUserPrompt(messages: ChatMessage[]): { systemPrompt: string; userPrompt: string } {
  const systemParts = messages.filter((message) => message.role === "system").map((message) => message.content ?? "");
  const nonSystemParts = messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role.toUpperCase()}\n${message.content ?? ""}`.trim())
    .filter((part) => part.length > 0);

  return {
    systemPrompt: systemParts.join("\n\n").trim(),
    userPrompt: nonSystemParts.join("\n\n").trim(),
  };
}

function extractAssistantText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((part): part is { type: string; text?: string } => Boolean(part) && typeof part === "object" && "type" in part)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
  return text.length > 0 ? text : undefined;
}

function buildPiUsageSummary(message: unknown): JsonValue | undefined {
  if (!message || typeof message !== "object") return undefined;
  const usage = (message as { usage?: unknown }).usage as {
    input?: number;
    output?: number;
    totalTokens?: number;
    cost?: { total?: number };
  } | undefined;
  if (!usage) return undefined;
  const promptTokens = usage.input ?? 0;
  const completionTokens = usage.output ?? 0;
  const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
  const totalCost = usage.cost?.total;
  if (promptTokens === 0 && completionTokens === 0 && totalCost === undefined) return undefined;
  return toJsonValue({
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    ...(typeof totalCost === "number" ? { cost: totalCost } : {}),
  });
}

function buildPiSettingsManager(transport: ModelTransportConfig): SettingsManager {
  const session = transport.session ?? { compaction: false, retry: false, maxRetries: 0, thinkingLevel: "off" };
  return SettingsManager.inMemory({
    compaction: { enabled: session.compaction },
    retry: { enabled: session.retry, maxRetries: session.maxRetries },
  });
}

function defaultResolvePiModel(model: ModelRef, modelRegistry: ModelRegistry): unknown {
  const fromRegistry = modelRegistry.find(model.provider, model.modelId);
  if (fromRegistry) return fromRegistry;
  try {
    const builtin = (getModel as unknown as (provider: string, modelId: string) => unknown)(model.provider, model.modelId);
    if (builtin) return builtin;
  } catch {
    // ignore and throw a clearer error below
  }
  throw new Error(`Pi transport could not resolve model ${model.provider}/${model.modelId}. Add it to pi's models registry or use transport.kind=openrouter.`);
}

async function runOpenRouterClient(config: LlmClientConfig, deps: LlmClientDeps = {}): Promise<LlmClientResult> {
  const startedAt = Date.now();
  const maxRounds = config.maxRounds ?? 30;
  const events: TraceEventRecord[] = [];
  const toolInvocations: ToolInvocationTrace[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let totalCostUsd = 0;
  let hasTrackedCost = false;

  if (config.model.provider !== "openrouter") {
    throw new Error(`transport.kind=openrouter requires openrouter/* model refs. Received ${config.model.provider}/${config.model.modelId}`);
  }

  if (!config.apiKey) {
    return {
      finalText: undefined,
      finalAssistantMessage: undefined,
      usage: undefined,
      costUsd: undefined,
      toolInvocations: [],
      events: [],
      error: toJsonValue(new Error(`No API key for provider: ${config.model.provider}`)),
      elapsedMs: Date.now() - startedAt,
    };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = PROVIDER_BASE_URLS.openrouter;
  const url = `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/mariozechner/llm-benchmarking",
    "X-Title": "LLM Benchmarking",
  };

  const messages: ChatMessage[] = resolveMessages(config);
  const openaiTools = config.tools.length > 0 ? agentToolsToOpenAITools(config.tools) : undefined;
  const toolMap = new Map<string, unknown>(config.tools.map((raw) => [(raw as ToolLike).name, raw]));

  try {
    for (let round = 0; round <= maxRounds; round += 1) {
      const body: Record<string, unknown> = { model: config.model.modelId, messages };
      if (openaiTools) body.tools = openaiTools;
      if (config.responseFormat) body.response_format = config.responseFormat;

      events.push({
        observedAt: new Date().toISOString(),
        eventType: "llm_request",
        payload: toJsonValue({ round, model: config.model.modelId, transport: config.transport.kind }),
      });

      const response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error");
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      if (data.usage) {
        promptTokens += data.usage.prompt_tokens ?? 0;
        completionTokens += data.usage.completion_tokens ?? 0;
        const roundCostUsd = extractCostUsd(data.usage);
        if (typeof roundCostUsd === "number") {
          totalCostUsd += roundCostUsd;
          hasTrackedCost = true;
        }
      }

      events.push({
        observedAt: new Date().toISOString(),
        eventType: "llm_response",
        payload: toJsonValue({ round, finishReason: data.choices[0]?.finish_reason, usage: data.usage }),
      });

      const assistantMessage = data.choices[0]?.message;
      if (!assistantMessage) throw new Error("No message in API response");

      const toolCalls = assistantMessage.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return {
          finalText: assistantMessage.content ?? undefined,
          finalAssistantMessage: toJsonValue(assistantMessage),
          usage: buildUsageSummary(promptTokens, completionTokens, hasTrackedCost ? totalCostUsd : undefined),
          costUsd: hasTrackedCost ? totalCostUsd : undefined,
          toolInvocations,
          events,
          error: undefined,
          elapsedMs: Date.now() - startedAt,
        };
      }

      messages.push(assistantMessage);

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        const toolCallId = toolCall.id;

        let args: unknown;
        try { args = JSON.parse(toolCall.function.arguments); } catch { args = {}; }

        events.push({
          observedAt: new Date().toISOString(),
          eventType: "tool_execution_start",
          payload: toJsonValue({ toolCallId, toolName, args }),
        });

        const invocation: ToolInvocationTrace = {
          toolCallId,
          toolName,
          args: toJsonValue(args),
          startedAt: new Date().toISOString(),
          updates: [],
        };
        toolInvocations.push(invocation);

        const tool = toolMap.get(toolName) as ToolLike | undefined;
        if (!tool) {
          failTool(invocation, messages, events, toolCallId, toolName, `Unknown tool: ${toolName}`, true);
          continue;
        }

        let resolvedArgs: unknown = args;
        if (tool.prepareArguments) {
          try { resolvedArgs = tool.prepareArguments(args); } catch { /* use raw args */ }
        }

        try {
          const result = await tool.execute(toolCallId, resolvedArgs, undefined, (partial) => {
            invocation.updates.push(toJsonValue(partial));
            events.push({
              observedAt: new Date().toISOString(),
              eventType: "tool_execution_update",
              payload: toJsonValue({ toolCallId, toolName, args, partialResult: partial }),
            });
          });
          const resultText = result.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("\n");
          failTool(invocation, messages, events, toolCallId, toolName, resultText, false);
        } catch (execError) {
          const msg = execError instanceof Error ? execError.message : String(execError);
          failTool(invocation, messages, events, toolCallId, toolName, `Error: ${msg}`, true);
        }
      }
    }

    throw new Error(`Exceeded max tool-call rounds (${maxRounds})`);
  } catch (error) {
    return {
      finalText: undefined,
      finalAssistantMessage: undefined,
      usage: buildUsageSummary(promptTokens, completionTokens, hasTrackedCost ? totalCostUsd : undefined),
      costUsd: hasTrackedCost ? totalCostUsd : undefined,
      toolInvocations,
      events,
      error: toJsonValue(error),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

async function runPiSessionClient(config: LlmClientConfig, deps: LlmClientDeps = {}): Promise<LlmClientResult> {
  const startedAt = Date.now();
  const toolInvocations: ToolInvocationTrace[] = [];
  const events: TraceEventRecord[] = [];
  const createSession = deps.createAgentSessionImpl ?? createAgentSession;

  try {
    const messages = resolveMessages(config);
    const { systemPrompt, userPrompt } = buildUserPrompt(messages);
    const authStorage = deps.createAuthStorage?.() ?? AuthStorage.create();
    applyEnvApiKeyOverrides(authStorage);
    const modelRegistry = deps.createModelRegistry?.(authStorage) ?? ModelRegistry.create(authStorage);
    const model = (deps.resolvePiModel ?? defaultResolvePiModel)(config.model, modelRegistry);
    const settingsManager = deps.createSettingsManager?.(config.transport) ?? buildPiSettingsManager(config.transport);
    const sessionManager = deps.createSessionManager?.() ?? SessionManager.inMemory(process.cwd());

    const resourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => systemPrompt,
      getAppendSystemPrompt: () => [],
      extendResources: () => {},
      reload: async () => {},
    };

    const { session } = await createSession({
      cwd: process.cwd(),
      model: model as never,
      thinkingLevel: config.transport.session?.thinkingLevel ?? "off",
      authStorage,
      modelRegistry,
      resourceLoader,
      tools: config.tools as never,
      sessionManager,
      settingsManager,
    });

    const toolInvocationMap = new Map<string, ToolInvocationTrace>();
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      events.push({
        observedAt: new Date().toISOString(),
        eventType: event.type,
        payload: toJsonValue(event as unknown as Record<string, unknown>),
      });

      if (event.type === "tool_execution_start") {
        const invocation: ToolInvocationTrace = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: toJsonValue(event.args),
          startedAt: new Date().toISOString(),
          updates: [],
        };
        toolInvocationMap.set(event.toolCallId, invocation);
        toolInvocations.push(invocation);
      } else if (event.type === "tool_execution_update") {
        const invocation = toolInvocationMap.get(event.toolCallId);
        invocation?.updates.push(toJsonValue(event.partialResult));
      } else if (event.type === "tool_execution_end") {
        const invocation = toolInvocationMap.get(event.toolCallId);
        if (invocation) {
          invocation.finishedAt = new Date().toISOString();
          invocation.isError = event.isError;
          invocation.result = toJsonValue(event.result);
        }
      }
    });

    await session.prompt(userPrompt.length > 0 ? userPrompt : config.userPrompt ?? "");
    unsubscribe();

    const assistantMessages = session.state.messages.filter((message) => {
      return Boolean(message) && typeof message === "object" && (message as { role?: string }).role === "assistant";
    });
    const finalAssistantMessage = assistantMessages.at(-1);
    const finalText = extractAssistantText(finalAssistantMessage);
    const usage = buildPiUsageSummary(finalAssistantMessage);
    const costUsd = (() => {
      if (!finalAssistantMessage || typeof finalAssistantMessage !== "object") return undefined;
      const usage = (finalAssistantMessage as { usage?: { cost?: { total?: number } } }).usage;
      return usage?.cost?.total;
    })();
    const stopReason = finalAssistantMessage && typeof finalAssistantMessage === "object"
      ? (finalAssistantMessage as { stopReason?: string }).stopReason
      : undefined;
    const errorMessage = finalAssistantMessage && typeof finalAssistantMessage === "object"
      ? (finalAssistantMessage as { errorMessage?: string }).errorMessage
      : undefined;

    return {
      finalText,
      finalAssistantMessage: finalAssistantMessage !== undefined ? toJsonValue(finalAssistantMessage) : undefined,
      usage,
      costUsd,
      toolInvocations,
      events,
      error: stopReason === "error" ? toJsonValue(new Error(errorMessage ?? "Pi session returned an error")) : undefined,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      finalText: undefined,
      finalAssistantMessage: undefined,
      usage: undefined,
      costUsd: undefined,
      toolInvocations,
      events,
      error: toJsonValue(error),
      elapsedMs: Date.now() - startedAt,
    };
  }
}

export async function runLlmClient(config: LlmClientConfig, deps: LlmClientDeps = {}): Promise<LlmClientResult> {
  if (config.transport.kind === "openrouter") {
    return runOpenRouterClient(config, deps);
  }
  return runPiSessionClient(config, deps);
}
