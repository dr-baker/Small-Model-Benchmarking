export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue }
  | JsonValue[];

/**
 * Extract and parse JSON from text that may contain prose, markdown fences,
 * or trailing text around the first JSON object.
 */
function tryParseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function* extractFencedBlocks(text: string): Generator<string> {
  const pattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) yield match[1].trim();
  }
}

function extractBalancedJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === undefined) continue;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

export function extractJsonObject<T = unknown>(text: string): T {
  const trimmed = text.trim();
  const direct = tryParseJson<T>(trimmed);
  if (direct !== undefined) return direct;

  for (const block of extractFencedBlocks(trimmed)) {
    const parsedBlock = tryParseJson<T>(block);
    if (parsedBlock !== undefined) return parsedBlock;

    const balancedBlock = extractBalancedJsonObject(block);
    if (balancedBlock) {
      const parsedBalancedBlock = tryParseJson<T>(balancedBlock);
      if (parsedBalancedBlock !== undefined) return parsedBalancedBlock;
    }
  }

  const balanced = extractBalancedJsonObject(trimmed);
  if (balanced) {
    const parsedBalanced = tryParseJson<T>(balanced);
    if (parsedBalanced !== undefined) return parsedBalanced;
  }

  throw new Error("No JSON object found in text");
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
