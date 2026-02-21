# Progress — live progress updates + counters

## Setup
- [x] Created task workspace and logs directory
- [x] Captured context and plan

## Execution checklist
- [x] Add progress helper utilities
- [x] Update tests
- [x] Refactor extension runner to streaming spawn
- [x] Emit live updates with counters
- [x] Run tests + smoke

## Notes
- Incorporated bug findings from tmux window 5:
  - Some runs produced search telemetry but no final structured output, likely due timeout pressure.
  - Increased timeout default to be very permissive (`timeout_sec` default 1800, max 7200).
  - Added explicit `no_final_output` error path with hint to increase `timeout_sec` when applicable.
- Verified live updates now stream incremental counters (`searches`, `pages`, elapsed seconds) via repeated `tool_execution_update` events.
