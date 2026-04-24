# Tool Test Scripts for Safeguard

## Goal
Add a couple of focused test scripts that exercise tool calling with candidate models so we can diagnose whether GPT OSS Safeguard can complete tool-using conversations outside the full benchmark pipeline.

## TODO
- [x] Inspect the existing transport and tool helper code to design lightweight diagnostic scripts.
- [x] Add a minimal tool-calling smoke test script for OpenRouter models using a tiny custom tool.
- [x] Add a benchmark-like read/grep diagnostic script using the corpus tools.
- [x] Wire the new scripts into `package.json` and document the key CLI options in the script output/comments.
- [x] Verification step: run the new scripts with a local model target and confirm they compile and produce useful diagnostics.

## Progress Notes
- [2026-04-22 01:15] Created plan file and started inspecting the transport and existing script helpers.
- [2026-04-22 01:25] Added `scripts/test-openrouter-tools-smoke.ts` to isolate the tool-call handshake with a single custom tool and plain-text response.
- [2026-04-22 01:30] Added `scripts/test-openrouter-read-grep.ts` to exercise the same OpenRouter path with the benchmark's real `read_grep` corpus tools.
- [2026-04-22 01:35] Added `npm` script entries for both diagnostics and verified both scripts load successfully with `--help`.
- [2026-04-22 01:36] Ran `npm run typecheck` to confirm repository TypeScript remains clean after the script additions.
- [2026-04-22 01:45] Ran live Safeguard tool tests. The minimal smoke test and the benchmark-like `read_grep` test both reproduced the same Groq-side 400 after the first successful tool call. OpenRouter reports `available_providers: ["groq"]` for this model, so there is no alternate provider route to try for this exact model on the current account.

## Final notes and learnings
- The two scripts intentionally separate provider/tool-call compatibility from benchmark retrieval complexity, which should make the Safeguard failure mode easier to isolate.
- Both scripts support OpenRouter routing overrides like `--provider-only=groq`, which should let you directly reproduce or bypass the failing provider path.
