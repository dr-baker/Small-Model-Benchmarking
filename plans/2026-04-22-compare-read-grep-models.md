# Compare read_grep model runs

## Goal
Analyze the aggregate scores and per-question outcomes for the most relevant read_grep runs, then recommend prompt or tooling tweaks that could improve speed, cost, and correctness for each model.

## TODO
- [x] Identify the exact benchmark result directories for GPT OSS 120B on Baseten, Mercury 2 read_grep, and Grok 4.1 Fast read_grep.
- [x] Compare aggregate metrics across the three runs, including score, groundedness, retrieval, speed, and cost where available.
- [x] Inspect representative correct and incorrect questions for each model from traces, grades, and judge outputs.
- [x] Synthesize failure patterns into concrete prompt and tooling recommendations per model.
- [x] Summarize tradeoffs and recommend the best default and model-specific tweaks.
- [x] Review the Grok hybrid-retrieval runs and isolate retrieval-script failure modes versus answer-synthesis failure modes.
- [x] Recommend concrete retrieval-script changes based on the hybrid-run evidence.

## Progress Notes
- [2026-04-22 00:00] Created plan file and started gathering the exact run directories and aggregate outputs.
- [2026-04-22 00:20] Compared aggregate summaries and per-run CSVs for `swiftui-docs-chatbot-benchmark--gpt-oss-120b-open-baseten-fp4-structured-2026-04-23`, `swiftui-docs-chatbot-benchmark--mercury-open-2026-04-21-v2`, and `swiftui-docs-chatbot-benchmark--grok-4-1-fast-open-2026-04-22`.
- [2026-04-22 00:35] Audited representative successes and failures: Grok strong on modern formatting but weak when raw availability docs suggested the wrong diagnosis; Mercury strong on accessibility and Combine questions but often recommended older patterns like `EnvironmentKey`; GPT OSS 120B was competitive on judged answers but lost 33 runs to `Assistant produced no final text.`
- [2026-04-22 00:45] Derived prompt and tooling recommendations focused on symbol-first retrieval, hiding raw corpus artifacts by default, explicit modern-preferred instructions, and a stricter finalization step for GPT OSS 120B.
- [2026-04-22 01:00] Scope expanded to review Grok hybrid-retrieval runs directly and determine whether retrieval-script changes are likely the next highest-value improvement.
- [2026-04-22 01:25] Reviewed `grok-4-1-fast-db-structured-2026-04-22` against the open `read_grep` run. Hybrid was faster and more grounded, but correctness regressed: 16 questions got worse and only 10 improved. The strongest evidence points to retriever/interface issues: 43/83 runs emitted invalid `semantic_max_distance: 0`, exact symbol ranking often lost to irrelevant explicit matches, module filters could hide the right framework entirely, and the candidate only had the hybrid tool with snippets instead of a follow-up read step.

## Final notes and learnings
- GPT OSS 120B on Baseten has the highest upside if final-answer reliability is fixed: on the 50 judged runs it was roughly tied with Grok and Mercury on mean answer score while staying cheaper than Mercury, but 33 runs were skipped because the model stopped with reasoning and no final JSON content.
- Grok 4.1 Fast currently gives the best end-to-end correctness, but it is slower and more likely to answer from partially relevant evidence or raw corpus artifacts.
- Mercury 2 is the fastest option and retrieves relevant docs very well, but it too often promotes older-but-still-valid patterns as the primary recommendation.
- The clearest shared improvement is to move candidate open-book runs away from raw `grep` over the whole corpus toward symbol-first or hybrid retrieval over canonical markdown pages, with explicit instructions to prefer the modern Apple-documented pattern when multiple approaches exist.
- The Grok hybrid run shows that hybrid retrieval is promising but the current interface/ranking is not robust enough yet. The next retrieval-script changes should be: hide advanced knobs from the model, sanitize invalid params, add exact-symbol resolution plus module fallback, and let the model read the top 1–2 canonical pages after retrieval so it can verify deprecations and preferred patterns instead of answering from snippets alone.
