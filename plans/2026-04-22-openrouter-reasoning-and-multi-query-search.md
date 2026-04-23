# Add OpenRouter reasoning controls and multi-query Swift Docs search

## Goal
Let benchmark candidate runs pass an OpenRouter reasoning-effort setting, upgrade the Swift Docs search tool so one call can run multiple queries in parallel with unified ranking, and rerun the key smoke slices to measure speed and quality.

## TODO
- [x] Add config and transport support for OpenRouter reasoning effort so candidate runs can request `low` or `minimal` effort.
- [x] Extend `swift_docs_search` to accept multiple queries in one call, execute them in parallel, and unify results with support-aware ranking.
- [x] Update prompt/tool descriptions and the direct tool test script to encourage multi-query search usage.
- [x] Run typecheck plus direct tool tests for the new multi-query search behavior.
- [x] Commit the search-tool changes as their own incremental commit.
- [x] Replace the ad hoc shell wrappers with a reusable benchmark-matrix runner and a checked-in matrix spec for this smoke slice.
- [x] Run benchmark smoke slices again for Grok, Mercury, and GPT OSS 120B Baseten on the updated search tool.
- [x] Run Grok smoke slices with default, `low`, and `minimal` OpenRouter reasoning effort and compare latency, tool use, and judged results.
- [ ] Commit the reusable matrix runner and OpenRouter reasoning support after the test pass.

## Progress Notes
- [2026-04-22 04:35] Created a follow-up plan for two systematic speed/quality levers: OpenRouter reasoning-effort control on the candidate path and multi-query Swift Docs search in a single tool call.
- [2026-04-22 04:48] Added multi-query support to `swift_docs_search`: it now accepts `query` or `queries`, runs the hybrid searches in parallel inside one tool call, merges page/chunk results with per-query support tracking, and boosts hits that are reinforced by multiple phrasings. Updated the benchmark prompt and `scripts/test-swift-docs-search.ts` so the model and local tests can use that path.
- [2026-04-22 04:56] Ran `npm run typecheck` plus direct multi-query tool checks for q51 and q64. The top-ranked recommendations stayed anchored on the right WebKit and `accessibilityDifferentiateWithoutColor` docs, while also surfacing support counts from multiple query variants.
- [2026-04-22 05:00] Committed the search-tool part separately as `3ab6391` (`let swift docs search handle multiple queries at once`).
- [2026-04-22 05:12] Added OpenRouter reasoning-effort support on the candidate transport (`openRouterReasoningEffort`) plus a matching `--openrouter-reasoning-effort=` flag in `scripts/test-run.ts`. Verified both `low` and `minimal` work against Grok on a one-question probe.
- [2026-04-22 05:20] Replaced the ad hoc long shell wrappers with `scripts/run-benchmark-matrix.ts` and a checked-in matrix file at `scripts/matrices/search-read-multiquery-smoke.json`. The matrix runner writes per-entry logs under `.tmp/benchmark-matrix-logs/`, can fan out entries with bounded parallelism, and supports per-entry transport overrides like Baseten routing or Grok reasoning effort.
- [2026-04-22 05:24] Used the reusable matrix runner to replay the current five-entry smoke matrix (Grok default/low/minimal, Mercury default, GPT OSS 120B Baseten default) with `resume=true`, confirming the new orchestration path works without the custom one-off bash wrappers.

## Final notes and learnings
- In progress. The reusable matrix runner removed the need for bespoke background-shell orchestration and made per-entry transport overrides explicit and repeatable.
- Multi-query search is now a first-class tool behavior instead of something the model approximates with repeated serial search calls.
