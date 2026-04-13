/**
 * JSON Schema definitions for OpenRouter structured outputs.
 * Eliminates `schema_parse_failure` by enforcing schema at the API level.
 */

export interface OpenRouterResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict: boolean;
    schema: Record<string, unknown>;
  };
}

/**
 * Answer-response.v1 schema. Flat structure with all fields required
 * (strict mode requirement). Mode-dependent fields use nullable types.
 */
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { type: "string", const: "answer-response.v1" },
    mode: { type: "string", enum: ["closed_book", "open_book"] },
    finalAnswer: { type: "string", description: "The benchmark answer text" },
    confidence: { type: "number", description: "Confidence 0.0–1.0" },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          anchor: { type: ["string", "null"] },
          quote: { type: ["string", "null"] },
          justification: { type: ["string", "null"] },
        },
        required: ["filePath", "anchor", "quote", "justification"],
        additionalProperties: false,
      },
    },
    evidenceSummary: { type: ["string", "null"], description: "Required for open_book; null for closed_book." },
  },
  required: ["schemaVersion", "mode", "finalAnswer", "confidence", "citations", "evidenceSummary"],
  additionalProperties: false,
};

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    recommendsCorrectPattern: { type: "boolean" },
    recommendsDeprecatedPattern: { type: "boolean" },
    completeness: { type: "integer", enum: [0, 1, 2] },
    codeExample: { type: "integer", enum: [0, 1, 2] },
    explanation: { type: "integer", enum: [0, 1, 2] },
    reasoning: { type: "string", description: "One-sentence judgment summary" },
  },
  required: ["recommendsCorrectPattern", "recommendsDeprecatedPattern", "completeness", "codeExample", "explanation", "reasoning"],
  additionalProperties: false,
};

function buildFormat(name: string, schema: Record<string, unknown>): OpenRouterResponseFormat {
  return { type: "json_schema", json_schema: { name, strict: true, schema } };
}

export const buildAnswerResponseFormat = () => buildFormat("benchmark_answer", ANSWER_SCHEMA);
export const buildJudgeVerdictResponseFormat = () => buildFormat("judge_verdict", JUDGE_SCHEMA);
