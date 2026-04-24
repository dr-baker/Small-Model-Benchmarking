# Full Benchmark Sweep

## Goal
Run full benchmark for Mercury across open-book, closed-book, and database-assisted toolsets, verify traces for sandboxing and tool correctness, summarize toolset results, then run matching full benchmarks for unlocked Nemotron and prior GPT OSS model.

## TODO
- [x] Verify local Swift Docs hybrid config and run Mercury 10-question smoke batch for open-book, closed-book, and database-assisted modes.
- [x] Run full 75-question Mercury benchmark across `read_grep`, `none`, and `swift_docs_hybrid`, using resumable explicit run ids and parallel lanes where safe.
- [x] Re-aggregate Mercury execution folders and inspect traces/logs for sandboxing, allowed tool use, and signs of cheating or path escape.
- [x] Summarize Mercury toolset results, including which toolset wins each rating metric/framework.
- [x] Run full 75-question benchmark for unlocked Nemotron with same supported toolsets.
- [x] Run full 75-question benchmark for prior GPT OSS model with same supported toolsets.
- [x] Re-aggregate Nemotron and GPT OSS execution folders and capture headline results/errors.

## Progress Notes
- 2026-04-20 21:00 Verified local Swift Docs config from prior smoke artifacts and wrote gitignored `benchmark.local.yaml` pointing at `/Users/daniel/Developer/Swift Docs` paths.
- 2026-04-20 21:00 Ran Mercury batch-1 validation at `batch-size=10` for `open_book`, `closed_book`, and `open_book + swift_docs_hybrid`. All three reached aggregate; closed-book recorded one judge-side transient server error.
- 2026-04-20 21:05-21:30 Ran remaining Mercury batches in three parallel lanes, then re-aggregated explicit execution folders. Final Mercury full-bench dirs: `benchmark-results/swiftui-docs-chatbot-benchmark--mercury-open-b1-2026-04-20/`, `...--mercury-closed-b1-2026-04-20/`, and `...--mercury-db-b1-2026-04-20/`.
- 2026-04-20 21:30 Audited Mercury traces for sandboxing and cheating signals. Closed-book had zero tools and zero citations across 75 runs. Open-book had no path escapes. Unsupported tool-call hallucinations happened (`search`, `find`, and misspelled hybrid tool names), but all were blocked with `Unknown tool: ...`; no unsupported tool executed successfully.
- 2026-04-20 21:31-22:00 Ran full unlocked Nemotron benchmark in three parallel lanes and re-aggregated: `...--nemotron-open-2026-04-20/`, `...--nemotron-closed-2026-04-20/`, `...--nemotron-db-2026-04-20/`.
- 2026-04-20 22:00-22:30 Ran full GPT OSS benchmark in three parallel lanes and re-aggregated: `...--gptoss-open-2026-04-20/`, `...--gptoss-closed-2026-04-20/`, `...--gptoss-db-2026-04-20/`.

## Final notes and learnings
- Mercury finished cleanly enough for comparison: `read_grep` won most judge-quality metrics, while `swift_docs_hybrid` won overall score and grounding. One Mercury hybrid collect run hit an OpenRouter client `TypeError`, and one Mercury closed-book run hit a judge-side Codex server error.
- Nemotron without provider lock was operationally better than locked-provider smoke history, but full open-book runs still degraded badly with many collect failures. Closed-book ended up strongest on mean score and stability for this model.
- GPT OSS was strongest overall on judge-quality dimensions. `swift_docs_hybrid` won headline score, but `read_grep` won most detailed quality metrics; both beat closed-book on answer richness.
- Sandbox held. Across all completed runs in this sweep, unauthorized tool-call attempts were blocked and no path-escape attempts succeeded.
