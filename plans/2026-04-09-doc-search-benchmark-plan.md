# Docs Search Benchmark Plan

## Goal
Design a reproducible benchmark harness that measures both closed-book answer quality and open-book doc-search efficiency, using the pi SDK to orchestrate isolated per-question runs with fresh context and reviewable traces. The primary design constraint is that **new analysis ideas should not require re-running the models** — only adding new questions, new models, or new tool sets should.

## Principles
1. **Three-stage pipeline with file boundaries.** The harness is split into three stages that only communicate through files on disk:
   - **Collect** — runs models, writes raw traces. Expensive. Only rerun when a run input (model, mode, tool set, corpus snapshot, prompt template, or question) changes.
   - **Grade** — a pure function over persisted traces. Cheap. Rerun freely to try new rubrics, metrics, or failure taxonomies.
   - **Aggregate/report** — a pure function over grade outputs. Cheap. Rerun freely.
   The grading and aggregation stages must never call the model or the corpus directly. This is the rule that protects the "no rerun" goal.
2. **Capture raw, not pre-processed.** Traces store the full prompt as sent, full tool return payloads, raw streamed events, token usage, cost, and errors. Anything the model saw or produced is on disk verbatim.
3. **Immutable run directories as time capsules.** Each benchmark execution writes to `/benchmark-results/YYYY-MM-DD-<name>/` and never mutates prior runs. A top-level `manifest.json` records every piece of config needed to interpret the run years later.
4. **Name every dimension; don't hide experimental axes inside code.** Model, mode, tool set, prompt template, rubric, and sampling params are all versioned, named values — not implicit defaults.

## TODO
- [x] Write a benchmark plan that covers closed-book and open-book evaluation modes, session isolation, and pi SDK orchestration.
- [ ] Define the three-stage pipeline contract (collect → grade → aggregate) in code, with grading and aggregation forbidden from calling the model or touching the corpus directly.
- [ ] Convert `final-qa-bank.md` into a structured benchmark dataset with stable question IDs, taxonomy tags, and **gold evidence references** (file paths + passage anchors in the frozen corpus). Keep the dataset focused on ground truth; rubric logic lives elsewhere.
- [ ] Create a separately versioned grading rubric module (must-mention / must-not-mention / partial-credit rules, groundedness checks, failure taxonomy) so new rubric dimensions are a grader-stage change, not a dataset edit that invalidates history.
- [x] Freeze the docs corpus under versioned snapshots instead of pointing at a live `~/Developer` tree, and generate a manifest with file hashes and metadata. *(2026-04-10: copied `Swift Docs/swiftui-macos-corpus` to `corpus/swift-docs-2026-04-10/swiftui-macos-corpus`, 29,127 files / 321 MB, with `manifest.txt` (per-file sha256) and `manifest.json` (summary + aggregate hash `d71285e0…`) and `source.json` recording upstream commit `76240323`. Blob is git-ignored; manifests are tracked.)*
- [ ] Define two benchmark modes per question: closed-book (no search tools, answer from model knowledge only) and open-book (search/read tools enabled against the frozen corpus).
- [ ] Treat **tool set** as a first-class, named benchmark dimension rather than a closed/open boolean. Catalog each tool set (e.g. `none`, `read_only`, `read_grep`, `read_grep_glob`) with a version string, and record the tool-set name on every run so adding a new search tool later does not invalidate existing results.
- [ ] Specify the response schema for both modes, including final answer text, confidence, and citations/evidence for open-book runs.
- [ ] Build the pi SDK runner so each `(model, mode, tool_set, question, seed)` gets a brand-new in-memory session with no prior conversation history and no session reuse. The runner emits traces only — it must not compute any grading metrics.
- [ ] Configure the pi SDK runner to use `SessionManager.inMemory()` and fresh `createAgentSession()` calls per question, rather than continuing or branching sessions, to prevent cross-question learning.
- [ ] Use custom tool configuration in the pi SDK for mode/tool-set isolation: no doc tools in closed-book mode; the exact named tool set in open-book mode, created with the correct corpus `cwd` via tool factory functions.
- [ ] Subscribe to pi SDK events and log a full trace for each run, capturing everything needed for post-hoc analysis:
  - Full prompt as sent (system message, tool descriptions, user message verbatim)
  - Raw streamed events in order, including any thinking/reasoning tokens the SDK exposes
  - Every tool call with full arguments and **full return payloads** (the actual text the model saw), not just filenames and byte counts
  - Timestamps per event, wall-clock latency, and token usage (input / output / reasoning)
  - Cost in USD at the model's current rate
  - Final answer, citations, and structured response fields
  - Error/timeout records as first-class artifacts (failed runs are data, not silent drops)
- [ ] Write a per-run `manifest.json` capturing: pi SDK version, model ID with snapshot/date, corpus snapshot hash, prompt-template version, tool-set name and version, rubric version, sampling params (seed, temperature, top-p), and a unique run ID that appears on every artifact for joinability.
- [ ] Decide and document the replication strategy: either force `temperature=0` with single-shot per question (accept no variance estimate) or run N≥3 replicates per question with recorded seeds. This must be settled before collect runs, since adding replicates later is a rerun.
- [ ] Implement retrieval grading against gold evidence as a pure function over traces, using metrics like Hit@1, Hit@k, MRR, time to first relevant doc, files read before first relevant doc, and bytes read.
- [ ] Implement answer grading as a pure function over traces, separately for closed-book and open-book runs, driven by the versioned rubric module.
- [ ] Add groundedness checks so open-book answers are scored separately for correctness and evidence support, using the captured tool return payloads as the source of truth for what the model actually saw.
- [ ] Define a per-run failure taxonomy such as: no relevant doc found, relevant doc found but wrong synthesis, correct answer without support, outdated doc preferred, or excessive search cost. Live in the rubric module, not the dataset.
- [ ] Create output artifacts and directory layout for later qualitative review, including per-run JSON traces, normalized answers, grader results, and aggregate summaries. Each run lives under an immutable `/benchmark-results/YYYY-MM-DD-<name>/` directory; grader and aggregate outputs are written as sibling files inside the same directory so the full lineage stays co-located.
- [ ] Build aggregate reports that compare models on raw knowledge vs search-assisted performance, plus delta metrics showing how much each model improves when tools are available. Reports consume grade outputs only, never raw traces directly.
- [ ] Add verification runs to ensure isolation actually holds, including randomized question order, repeated questions in separate runs, checks that no state leaks between sessions, and a check that tool `cwd` sandboxing prevents the model from reading files outside the frozen corpus snapshot via absolute paths.

## Progress Notes
- 2026-04-09: Reviewed `final-qa-bank.md`, existing evaluation notes, and pi SDK docs/examples relevant to session creation, in-memory sessions, tool configuration, and runtime/session replacement.
- 2026-04-09: Decided the benchmark should explicitly separate closed-book scoring from open-book scoring so you can measure baseline training knowledge versus search-assisted performance.
- 2026-04-09: Decided the harness should create a fresh pi SDK session for every single question instead of reusing a conversation, to keep context clean and eliminate carryover learning.
- 2026-04-09: Decided open-book runs should use a frozen docs snapshot with citations and full traces, so quantitative efficiency metrics and later qualitative inspection both stay reproducible.
- 2026-04-10: Added the three-stage pipeline principle (collect → grade → aggregate with file boundaries) as the load-bearing constraint for "run once, analyze forever." Grading and aggregation are pure functions over persisted traces and must not call the model or touch the corpus.
- 2026-04-10: Expanded the trace spec to capture full tool return payloads, full sent prompts, raw streamed events, token usage, cost, and error records — not just file names and byte counts. Without the actual bytes the model read, we cannot re-grade groundedness or retrieval with new rubrics.
- 2026-04-10: Promoted "tool set" to a named, versioned benchmark dimension. Open-book is not a single config; it's a family, and each family member gets its own name so future tool additions don't invalidate old runs.
- 2026-04-10: Decided grading rubric logic lives in a separately versioned module, while only the gold evidence lives in the dataset. Adding a new rubric dimension should be a grader-stage change, not a dataset edit.
- 2026-04-10: Added a per-run `manifest.json` requirement covering SDK version, model snapshot/date, corpus hash, prompt template version, tool-set name/version, rubric version, sampling params/seed, and a run ID that appears on every artifact for joinability.
- 2026-04-10: Flagged the replication-count decision (temp=0 single-shot vs N≥3 replicates) as something that must be settled before any collect run, because changing it later forces a rerun.
- 2026-04-10: Initialized the repo at `/Users/daniel/Developer/LLM Benchmarking/` with `git init` and scaffolded the directory layout: `corpus/`, `dataset/`, `rubric/`, `tool-sets/`, `prompts/`, `src/{collect,grade,aggregate}/`, `benchmark-results/`. Empty dirs are held with `.gitkeep` until implementation lands.
- 2026-04-10: Froze the first corpus snapshot at `corpus/swift-docs-2026-04-10/` by copying `swiftui-macos-corpus/` (29,127 files, 321 MB, 5,824 markdown pages) from `~/Developer/Swift Docs` at upstream commit `76240323`. Generated `manifest.txt` (per-file sha256, sorted), `manifest.json` (summary + aggregate hash `d71285e0…d616448a876e` over the manifest), and `source.json` (upstream provenance + copy method). Added `.gitignore` that excludes the 384M blob (`corpus/*/swiftui-macos-corpus/`) while tracking the manifests, so the repo stays small and the snapshot is verifiable via `find … | shasum | diff` against `manifest.txt`.

## Final notes and learnings
- This plan assumes pi SDK orchestration, not CLI session reuse, so the cleanest design is one fresh in-memory `createAgentSession()` call per `(model, mode, tool_set, question, seed)`.
- Closed-book and open-book should be treated as separate benchmark modes with separate scoring, then compared with a delta report to show how much search actually helps each model.
- Reproducibility and "no rerun for new ideas" depend on five things: a frozen corpus, strict response schemas with evidence, full event/tool traces (including tool return payloads) from the pi SDK, a per-run `manifest.json` capturing all versioned inputs, and a hard separation between the collect stage and the grade/aggregate stages.
- Treat each run directory as an immutable time capsule. Never overwrite a prior run — a new grading pass writes new grader output files alongside the original traces.
- The cost of over-capturing trace data at collect time is small; the cost of discovering a missing field six months later is a rerun.
- No implementation has been done yet beyond documenting the plan and the constraints for isolation, tooling, grading, and reproducibility.
