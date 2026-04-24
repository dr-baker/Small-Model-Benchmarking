# Analyze Grok vs Safeguard Judge Results

## Goal
Assess whether the judge correctness scores for the SwiftUI docs open-book read_grep runs look accurate, and explain why the Grok 4.1 Fast run outperformed the GPT OSS Safeguard 20B run.

## TODO
- [x] Locate the relevant benchmark result directories, summaries, and per-question artifacts for both runs.
- [x] Compare run-level and question-level patterns, including answer availability, retrieval behavior, and judge verdict distributions.
- [x] Manually audit representative judged examples to assess whether the judge correctness scores look accurate.
- [x] Synthesize what materially drove Grok's better performance and write up clear conclusions.
- [x] Verification step: cross-check the final narrative against the run artifacts and summary files.

## Progress Notes
- [2026-04-22 00:00] Created plan file and started artifact review.
- [2026-04-22 00:20] Confirmed the two primary runs: `benchmark-results/swiftui-docs-chatbot-benchmark--grok-4-1-fast-open-2026-04-22/` and `benchmark-results/swiftui-docs-chatbot-benchmark--gpt-oss-safeguard-20b-open-lazy-full-2026-04-23/`.
- [2026-04-22 00:35] Found that Grok completed and judged all 83 questions, while Safeguard had 63 collect errors and only 20 judged runs.
- [2026-04-22 00:50] Audited representative judge outcomes, including judge-vs-deterministic disagreements and overlap cases where both models answered.
- [2026-04-22 01:05] Verified the main performance delta is a mix of infrastructure compatibility, actual tool use, and Grok choosing benchmark-preferred modern APIs more often.

## Final notes and learnings
- Grok’s apparent advantage is real in part, but the top-line gap is dominated by Safeguard run instability during tool calling.
- The judge looks directionally trustworthy overall, with most questionable cases being strict boundary decisions about whether an older-but-workable primary recommendation should count as partial or incorrect.
- The deterministic grader is useful as a backstop, but several audited cases show the semantic judge is more accurate when answers are conceptually right but phrased differently from the rubric.
