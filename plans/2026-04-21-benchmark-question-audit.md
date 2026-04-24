# Benchmark Question Audit

## Goal
Review the current Swift benchmark questions for unrealistic pitfall leakage, identify weak spots, and draft stronger open-ended questions grounded in the corpus.

## TODO
- [x] Inspect the current benchmark question bank and dataset structure to understand how questions are phrased today.
- [x] Explore the Swift corpus for broad themes, pitfalls, and docs-rich topics that could support more realistic user questions.
- [x] Distill findings into a concise audit of current question quality plus a proposed set of improved and new questions.
- [x] Verify that proposed questions match the benchmark’s real-user Swift agent goal and note any follow-up edits needed in the dataset.

## Progress Notes
- [2026-04-21 00:00] Started audit and created working plan.
- [2026-04-21 00:10] Reviewed the 75-question bank and dataset JSON. The main weakness is answer-shaped wording: many prompts say “modern”, “recommended”, or directly name the old/new API pair.
- [2026-04-21 00:18] Quantified the issue in the current bank: 23/75 questions use words like “modern”, “recommended”, “best”, or “cleanest”; 24/75 include inline code syntax in the question; 17/75 name a specific implementation trick or API family in the ask itself.
- [2026-04-21 00:27] Explored corpus themes with subagents plus direct doc reads. Strong docs-rich areas for new open-ended questions include Liquid Glass, navigation architecture, search, layout/container choice, accessibility/focus, app structure, and document-based apps.

## Final notes and learnings
- The benchmark is strongest when prompts describe a product goal and force the agent to discover the relevant APIs. It is weakest when the question itself names the pitfall, old API, or exact modifier the answer will discuss.
- The corpus supports broader synthesis questions well, especially around Liquid Glass and app architecture topics where answers need multiple docs, sample articles, and symbol pages.
- Next useful step: rewrite the most answer-shaped prompts first, then add 6–10 open-ended synthesis questions with explicit gold-evidence bundles instead of single-page evidence.
