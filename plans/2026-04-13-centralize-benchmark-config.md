# Centralize Benchmark Config

## Goal
Move all scattered configuration values into a single `benchmark.yaml` and refactor code to read from it. Eliminate hardcoded paths, magic strings, and duplicated config across `test-run.ts`, `prompt-template.ts`, `judge/run.ts`, and `tool-sets.ts`.

## TODO

### Phase 1: Create config file + loader
- [x] Create `benchmark.yaml` at repo root with all extracted config (see schema below)
- [x] Add `yaml` as dependency
- [x] Create `src/shared/config.ts` — typed loader that reads `benchmark.yaml`, resolves relative paths to repo root, exports typed `BenchmarkConfig` interface
- [x] `config.ts` validates required fields present, throws clear errors on missing/invalid

### Phase 2: Refactor prompt-template.ts
- [x] Remove `PROMPT_TEMPLATE_PATHS` hardcoded map
- [x] `loadPromptTemplate()` takes explicit `path: string` parameter
- [x] `renderPrompt()` takes `templatePath: string` instead of `templateId`

### Phase 3: Refactor judge/run.ts
- [x] Remove `JUDGE_PROMPT_TEMPLATE_PATHS` hardcoded map
- [x] Remove hardcoded system prompt string
- [x] Add `promptTemplatePath`, `systemPrompt`, `toolSetCatalogPath` to `JudgeRunOptions`
- [x] `renderJudgePrompt()` accepts explicit `promptTemplatePath` param
- [x] `createSkippedArtifact` accepts `systemPrompt` param instead of hardcoded
- [x] `loadToolSetDefinition` now takes `catalogPath` param

### Phase 4: Refactor collect/run.ts
- [x] Remove hardcoded system prompt string (`"You are a benchmark runner…"`)
- [x] Add `promptTemplatePath` and `systemPrompt` to `CollectRunInput`
- [x] `renderPrompt()` called with `input.promptTemplatePath`

### Phase 5: Refactor tool-sets.ts
- [x] Remove `TOOL_SET_CATALOG_PATH` hardcoded path
- [x] `loadToolSetCatalog(catalogPath: string)` takes path param
- [x] `loadToolSetDefinition(catalogPath: string, name: ToolSetName)` takes both params

### Phase 6: Refactor test-run.ts → proper CLI entry point
- [x] Remove all hardcoded paths, benchmark name, corpus ref, judge profile id, default model
- [x] Load `benchmark.yaml` via `loadBenchmarkConfig()`
- [x] Replace hardcoded `questions[0]` with config-driven `questions` selector (`"all"` or list of IDs)
- [x] Replace hardcoded mode↔toolSet mapping with config `modes` block
- [x] CLI args: `--model=`, `--judge-model=`, `--question=`, `--mode=` override config values

### Phase 7: Cleanup + verification
- [x] Run `npm run typecheck` — passes clean
- [x] Run `npm run check:architecture` — passes
- [x] Grep for remaining `resolve("tool-sets`, `resolve("rubric`, etc. — zero hits
- [x] Grep for `JUDGE_PROMPT_TEMPLATE|PROMPT_TEMPLATE_PATHS|TOOL_SET_CATALOG_PATH` — zero hits

## Config Schema (`benchmark.yaml`)

```yaml
# Core identity
benchmarkName: swiftui-docs-chatbot-benchmark
runId: auto                      # "auto" = timestamp-based, or explicit string

# Models (CLI --model / --judge-model override these)
defaultModel: openrouter/openai/gpt-oss-120b:nitro
judgeModel: null                 # null = use judge profile's model

# Paths — all relative to repo root
paths:
  dataset: dataset/swiftui-docs-chatbot-benchmark.v1.json
  toolSets: tool-sets/tool-sets.v1.json
  judgeProfiles: judges/judge-profiles.v1.json
  rubric: rubric/rubric.v1.json
  promptTemplates:
    benchmark-answer-v1: prompts/benchmark-answer-v1.md
    judge-answer-v1: prompts/judge-answer-v1.md

# Corpus
corpus:
  snapshotId: swift-docs-2026-04-10
  rootDir: corpus/swift-docs-2026-04-10/swiftui-macos-corpus
  manifestPath: corpus/swift-docs-2026-04-10/manifest.json
  manifestSha256: d71285e0

# Judge
judgeProfileId: semantic-judge-v1

# Pi session behavior
session:
  compaction: false
  retry: false
  maxRetries: 0

# System prompts
systemPrompts:
  collect: "You are a benchmark runner. Follow the response schema exactly."
  judge: "You are a benchmark judge. Follow the response schema exactly."

# Run matrix: which modes to run + default toolSet per mode
modes:
  open_book: read_grep
  closed_book: none

# Question selection: "all" or list of question IDs
questions: all
```

## What stays in code (NOT in config)
- `PIPELINE_CONTRACT_VERSION`, `ANSWER_RESPONSE_SCHEMA_VERSION`, `JUDGE_VERDICT_SCHEMA_VERSION` — code-level invariants
- Schema validation logic (`validateParsedAnswer`, `validateJudgeResponse`, etc.)
- Architecture enforcement rules (`check-architecture.mjs`)
- Grading/scoring algorithms
- Event subscription wire-up
- Tool factory mapping (`createReadTool`, `createGrepTool`, etc.)

## Refactor principles
- Config loader is the **only** place that reads `benchmark.yaml`. Everything else imports the typed result.
- Relative paths in YAML → resolved to absolute at load time. Consumers never call `resolve()` themselves.
- No mixing: if a value is in config, code must not have a fallback hardcoded default for it.
- `test-run.ts` (→ `run-benchmark.ts`) becomes a thin CLI shell: parse args → load config → call pipeline functions.

## Progress Notes
- 2026-04-13: All 7 phases complete. Code had evolved since initial analysis (uses `runLlmClient` + structured outputs instead of pi SDK sessions). Adjusted refactors accordingly — `session` config block stays in yaml for future use but not yet wired (no pi SDK session creation in current code). `CollectRunInput` gained `promptTemplatePath` + `systemPrompt` fields. `JudgeRunOptions` gained `promptTemplatePath`, `systemPrompt`, `toolSetCatalogPath`.

## Final notes and learnings
- Config extraction works cleanly when each module just accepts params instead of resolving paths internally. The config loader resolves paths once; consumers stay dumb.
- Code had drifted from initial read — always re-read before editing.
- `session` block in yaml reserved for future (current code uses `runLlmClient`, not pi SDK sessions). Easy to wire when sessions return.
- `questions: all` selector scales to multi-question benchmark runs vs old hardcoded `questions[0]`.
- Typecheck passed on first try after all edits — typed config interface caught mismatch risks early.