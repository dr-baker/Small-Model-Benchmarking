# Debug High Error Runs

## Goal
Find why Gemma and similar visualizer runs have high collect error rates, identify whether the benchmark runner can be fixed, and rerun affected runs if appropriate.

## TODO
- [x] Inspect failed run traces/manifests for the high-error Gemma runs.
- [x] Identify the common failure mode and the stage responsible.
- [x] Patch runner or configuration if the failures are fixable locally.
- [x] Run a targeted smoke rerun for an affected model/toolset.
- [ ] Wait for the affected OpenRouter matrix rerun to finish.
- [ ] Regenerate visualizer data after successful reruns.

## Progress Notes
- 2026-04-25: Started investigation after Gemma appeared in sidebar but was filtered from charts due to high error rate.
- 2026-04-25: Gemma, Devstral, GLM, and many Qwen failures all share the same collect-stage OpenRouter 403: monthly key limit exceeded. These are not model/tool/schema errors.
- 2026-04-25: Added an OpenRouter key preflight to `scripts/test-run.ts` so future runs fail before creating 82/83 errored run artifacts when the key is exhausted.
- 2026-04-25: Targeted Gemma smoke rerun now aborts cleanly at preflight with usage $30.09 / limit $30.00, so rerun is blocked until the key limit is raised or a different key is supplied.
- 2026-04-25: After the OpenRouter limit was raised to $50, confirmed ~$19.91 remaining.
- 2026-04-25: Updated the matrix runner phase summary to surface concrete error samples from trace files, so provider/API bugs show up in matrix output instead of only in per-run artifacts.
- 2026-04-25: Started a background matrix rerun for Devstral, Gemma, GLM, and Qwen toolset runs affected by OpenRouter limit exhaustion. PID 85358, top-level log `.tmp/rerun-openrouter-limit-affected-2026-04-25.log`.

## Final notes and learnings
