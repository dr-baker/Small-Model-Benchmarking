import assert from "node:assert/strict";
import { runLlmClient } from "../src/shared/llm-client.js";

async function testOpenRouterTransport(): Promise<void> {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let callCount = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    callCount += 1;
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, body });

    const responseBody = callCount === 1
      ? {
          choices: [{
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "tool-1",
                type: "function",
                function: { name: "lookup", arguments: JSON.stringify({ topic: "swiftui" }) },
              }],
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.01 },
        }
      : {
          choices: [{
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({ ok: true, transport: "openrouter" }),
            },
          }],
          usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.005 },
        };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await runLlmClient({
    model: { provider: "openrouter", modelId: "openai/gpt-oss-120b:nitro" },
    transport: { kind: "openrouter" },
    messages: [
      { role: "system", content: "Return JSON." },
      { role: "user", content: "Use the tool then respond." },
    ],
    tools: [{
      name: "lookup",
      description: "Lookup a topic",
      parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
      execute: async () => ({ content: [{ type: "text", text: "SwiftUI result" }] }),
    }],
    responseFormat: { type: "json_schema", json_schema: { name: "test", strict: true, schema: { type: "object" } } },
    apiKey: "test-key",
  }, { fetchImpl });

  assert.equal(result.finalText, JSON.stringify({ ok: true, transport: "openrouter" }));
  assert.equal(result.toolInvocations.length, 1);
  assert.equal(result.toolInvocations[0]?.toolName, "lookup");
  assert.equal(result.costUsd, 0.015);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.ok("response_format" in (requests[0]?.body ?? {}));
}

async function testPiTransport(): Promise<void> {
  const listeners: Array<(event: any) => void> = [];
  const fakeSession = {
    state: {
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: JSON.stringify({ ok: true, transport: "pi" }) }],
          usage: { input: 7, output: 5, totalTokens: 12, cost: { total: 0.02 } },
          stopReason: "stop",
        },
      ],
    },
    subscribe(listener: (event: any) => void) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    async prompt(_text: string) {
      for (const listener of listeners) {
        listener({ type: "tool_execution_start", toolCallId: "tool-2", toolName: "search", args: { query: "swiftui" } });
        listener({ type: "tool_execution_update", toolCallId: "tool-2", toolName: "search", args: { query: "swiftui" }, partialResult: { chunk: 1 } });
        listener({ type: "tool_execution_end", toolCallId: "tool-2", toolName: "search", result: "done", isError: false });
      }
    },
  };

  const result = await runLlmClient({
    model: { provider: "openrouter", modelId: "openai/gpt-oss-120b:nitro" },
    transport: { kind: "pi", session: { compaction: false, retry: false, maxRetries: 0 } },
    messages: [
      { role: "system", content: "Return JSON." },
      { role: "user", content: "Use the tool then respond." },
    ],
    tools: [],
  }, {
    createAuthStorage: () => ({}) as any,
    createModelRegistry: () => ({}) as any,
    createSessionManager: () => ({}) as any,
    createSettingsManager: () => ({}) as any,
    resolvePiModel: () => ({ provider: "openrouter", id: "openai/gpt-oss-120b:nitro" }),
    createAgentSessionImpl: async () => ({ session: fakeSession } as any),
  });

  assert.equal(result.finalText, JSON.stringify({ ok: true, transport: "pi" }));
  assert.equal(result.toolInvocations.length, 1);
  assert.equal(result.toolInvocations[0]?.toolName, "search");
  assert.equal(result.costUsd, 0.02);
  assert.ok(result.events.some((event) => event.eventType === "tool_execution_start"));
}

await testOpenRouterTransport();
await testPiTransport();
console.log("transport lite tests passed");
