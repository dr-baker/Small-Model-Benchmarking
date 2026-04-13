import type { ModelRef, ToolInvocationTrace, TraceEventRecord } from "./contracts.js";
import type { JsonValue } from "./json.js";
import type { OpenRouterResponseFormat } from "./response-schemas.js";
import { toJsonValue } from "./json.js";

// ── Structural tool interface (avoids typebox generic complexity) ────────

interface ToolLike {
  name: string;
  description: string;
  parameters: unknown;
  prepareArguments?: (args: unknown) => unknown;
  execute: (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: (partialResult: unknown) => void) => Promise<{ content: Array<{ type: string; text?: string }> }>;
}

// ── Config & Result ──────────────────────────────────────────────────────

export interface LlmClientConfig {
  model: ModelRef;
  systemPrompt: string;
  userPrompt: string;
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

// ── Provider URL map ─────────────────────────────────────────────────────

const PROVIDER_BASE_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
};

// ── Tool schema conversion ──────────────────────────────────────────────

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

// ── OpenAI chat completion types (subset) ────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface ChatCompletionResponse {
  choices: Array<{ message: ChatMessage; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ── Tool error helper ────────────────────────────────────────────────────

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

// ── Main client ──────────────────────────────────────────────────────────

export async function runLlmClient(config: LlmClientConfig): Promise<LlmClientResult> {
  const startedAt = Date.now();
  const maxRounds = config.maxRounds ?? 30;
  const events: TraceEventRecord[] = [];
  const toolInvocations: ToolInvocationTrace[] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  if (!config.apiKey) {
    return {
      finalText: undefined, finalAssistantMessage: undefined, usage: undefined, costUsd: undefined,
      toolInvocations: [], events: [],
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

  const messages: ChatMessage[] = [
    { role: "system", content: config.systemPrompt },
    { role: "user", content: config.userPrompt },
  ];

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
        // Final response — no tool calls
        const usage = promptTokens > 0 ? toJsonValue({ prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }) : undefined;
        return {
          finalText: assistantMessage.content ?? undefined,
          finalAssistantMessage: toJsonValue(assistantMessage),
          usage,
          costUsd: undefined,
          toolInvocations,
          events,
          error: undefined,
          elapsedMs: Date.now() - startedAt,
        };
      }

      // Process tool calls
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
          toolCallId, toolName,
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

        const typedTool = tool;
        let resolvedArgs: unknown = args;
        if (typedTool.prepareArguments) {
          try { resolvedArgs = typedTool.prepareArguments(args); } catch { /* use raw args */ }
        }

        try {
          const result = await typedTool.execute(toolCallId, resolvedArgs, undefined, (partial) => {
            invocation.updates.push(toJsonValue(partial));
          });
          const resultText = result.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("\n");
          failTool(invocation, messages, events, toolCallId, toolName, resultText, false);
        } catch (execError) {
          const msg = execError instanceof Error ? execError.message : String(execError);
          failTool(invocation, messages, events, toolCallId, toolName, `Error: ${msg}`, true);
        }
      }
      // Continue loop — next API call sees tool results
    }

    throw new Error(`Exceeded max tool-call rounds (${maxRounds})`);
  } catch (error) {
    const usage = promptTokens > 0 ? toJsonValue({ prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }) : undefined;
    return {
      finalText: undefined, finalAssistantMessage: undefined,
      usage, costUsd: undefined,
      toolInvocations, events,
      error: toJsonValue(error),
      elapsedMs: Date.now() - startedAt,
    };
  }
}
