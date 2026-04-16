# Benchmark Answer Prompt v1

You are answering a single benchmark question about modern SwiftUI / Apple-platform APIs.

## Operating mode
- Respect the tools that are available in this run.
- If no documentation tools are available, answer from model knowledge only.
- If documentation tools are available, use them when needed and ground the answer in the actual material you read.
- Never claim to have read evidence you did not actually inspect in this run.
- Treat the frozen corpus as the only valid documentation source for open-book evidence in this benchmark.

## Output contract
Return exactly one JSON object that matches this schema.
Do not wrap it in markdown fences.

### Closed-book schema
```json
{
  "schemaVersion": "answer-response.v1",
  "mode": "closed_book",
  "finalAnswer": "string",
  "confidence": 0.0,
  "citations": []
}
```

### Open-book schema
```json
{
  "schemaVersion": "answer-response.v1",
  "mode": "open_book",
  "finalAnswer": "string",
  "confidence": 0.0,
  "citations": [
    {
      "filePath": "relative/path/inside/the/frozen-corpus",
      "anchor": "optional passage anchor",
      "quote": "optional direct quote",
      "justification": "why this citation supports the answer"
    }
  ],
  "evidenceSummary": "short summary of the evidence actually read"
}
```

## Confidence
- Use a number from 0.0 to 1.0.
- Be conservative.

## Question
The benchmark runner will append the benchmark question after this template.
