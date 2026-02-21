# Plan — live progress updates + counters

## Test scenarios
1. Counter extraction from JSONL events:
   - `web_search` search action increments `searches`.
   - `web_search` open_page action increments `pagesOpened`.
   - malformed events do not break parsing.
2. Progress formatter includes elapsed time + counters.
3. End-to-end tool smoke still succeeds with structured output.

## Implementation checklist
- [x] Add progress helper utilities in `lib/codex-runner.mjs`.
- [x] Update tests for progress helper behavior.
- [x] Refactor extension runner to use `spawn` with streaming JSONL parse.
- [x] Emit live updates via `onUpdate` with progress counters.
- [x] Incorporate window-5 bug finding: very permissive timeout defaults + no-final-output timeout hint.
- [x] Run tests and a smoke test.
