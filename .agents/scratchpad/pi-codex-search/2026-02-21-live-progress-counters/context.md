# Context — live progress updates + counters

## Task
Implement live tool updates for `codex_search` and add progress counters (search/page counts, elapsed time).

## Current behavior
- Tool sends one static update: "Running Codex web search..."
- Uses `pi.exec`, which returns only after command completes.
- No incremental visibility into Codex `--json` event stream.

## Constraints
- Keep Codex execution policy unchanged (`--search exec --ephemeral --skip-git-repo-check --sandbox read-only`).
- Preserve structured output flow (`--output-schema` + `-o`).
- Maintain policy checks for command-like events.

## Design approach
1. Replace blocking `pi.exec` call with `child_process.spawn` in extension.
2. Parse JSONL lines from stdout as they arrive.
3. Emit throttled `onUpdate` messages with counters:
   - elapsed seconds
   - searches executed
   - pages opened
   - last action summary
4. Keep final telemetry parsing with existing `parseCodexJsonlEvents` for consistency.
5. Add helper functions + tests for progress counter logic.
