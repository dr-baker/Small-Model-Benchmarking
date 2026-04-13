export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue }
  | JsonValue[];

/**
 * Extract and parse JSON from text that may contain non-JSON preamble.
 * Handles models that add prose before the JSON object despite response_format.
 * Returns parsed value or throws.
 */
export function extractJsonObject<T = unknown>(text: string): T {
  // Try direct parse first
  try { return JSON.parse(text) as T; } catch { /* not pure JSON */ }
  // Find first '{' and parse from there
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in text");
  return JSON.parse(text.slice(start)) as T;
}

export function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === "bigint") {
        return nestedValue.toString();
      }
      if (nestedValue instanceof Error) {
        return {
          name: nestedValue.name,
          message: nestedValue.message,
          stack: nestedValue.stack,
        };
      }
      return nestedValue;
    }),
  ) as JsonValue;
}
