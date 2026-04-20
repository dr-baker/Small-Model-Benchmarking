# Root Cleanup and Share Readiness

## Goal
Make the repo root easier to understand and safer to share by moving non-essential files into better locations, tightening ignore rules, removing local path assumptions, and rewriting the README/docs to match the current project.

## TODO
- [x] Audit root-level files, script references, and docs drift to identify what can move versus what must stay.
- [x] Reorganize root-level assets into clearer folders, update references, and tighten `.gitignore` for archived and generated material.
- [x] Replace local-machine config paths with shareable defaults and document local override/setup flow.
- [x] Rewrite `README.md` into a concise share-ready overview and update any supporting docs that drifted.
- [x] Verify the repo after changes with targeted checks and summarize remaining follow-up.

## Progress Notes
- 2026-04-20 00:00 Created plan file and started audit.
- 2026-04-20 00:11 Audited root clutter, script references, and share-readiness drift. Decided to move the QA bank into `dataset/source/`, archive the unused legacy gold-evidence export, add docs for layout/local setup, and replace machine-specific config with a local override flow.
- 2026-04-20 00:26 Moved `final-qa-bank.md` to `dataset/source/final-qa-bank.md`, archived the unused legacy gold-evidence export, added `archive/README.md` plus default-ignore rules for future archive drops, and tightened root ignore rules for local config and temp logs.
- 2026-04-20 00:35 Added automatic `benchmark.local.yaml` overlay support, removed machine-specific Swift Docs paths from tracked config, scrubbed the corpus provenance path, and rewrote the root README into a short share-ready pitch with supporting docs under `docs/`.
- 2026-04-20 00:43 Verified the repo with `npm run dataset:build`, `npm run dataset:validate`, `npm run typecheck`, `npm run check:architecture`, plus explicit config-loader checks with and without a temporary `benchmark.local.yaml` override.

## Final notes and learnings
- Root-level clarity improved most by moving the source QA bank under `dataset/source/`, documenting archive intent, and keeping the top-level README intentionally short.
- Shareable config needed both content cleanup and code support: removing machine-specific paths from `benchmark.yaml` was not enough without a clean local override mechanism.
- Verification covered dataset regeneration, typing, architecture boundaries, and the new config overlay path.
