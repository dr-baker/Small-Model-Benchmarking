import type { ModelRef, PromptMessageSnapshot, ToolInvocationTrace, TraceEventRecord } from "./contracts.js";
import type { JsonValue } from "./json.js";
import type { OpenRouterResponseFormat } from "./response-schemas.js";
import { toJsonValue } from "./json.js";

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
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
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

export async function runLlmClient(config: LlmClientConfig): Promise<LlmClientResult> {
  const startedAt = Date.now();
  const maxRounds = config.maxRounds ?? 30;
  const events: TraceEventRecord[] = [];
  const toolInvocations: ToolInvocationTrace[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let totalCostUsd = 0;
  let hasTrackedCost = false;

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

  const baseUrl = PROVIDER_BASE_URLS[config.model.provider] ?? "https://openrouter.ai/api/v1";
  const url = `${baseUrl}/chat/completions`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/mariozechner/llm-benchmarking",
    "X-Title": "LLM Benchmarking",
  };

  const messages: ChatMessage[] = resolveMessages(config);

  const openaiTools = config.tools.length > 0 ? agentToolsToOpenAITools(config.tools) : undefined;
  const toolMap = new Map<string, unknown>(config.tools.map((r) => [(r as ToolLike).name, r]));

  try {
    for (let round = 0; round <= maxRounds; round++) {
      const body: Record<string, unknown> = { model: config.model.modelId, messages };
      if (openaiTools) body.tools = openaiTools;
      if (config.responseFormat) body.response_format = config.responseFormat;

      events.push({
        observedAt: new Date().toISOString(),
        eventType: "llm_request",
        payload: toJsonValue({ round, model: config.model.modelId }),
      });

      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
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
