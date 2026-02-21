# Plan — codex-search extension

## Test scenarios
1. Prompt builder includes:
   - user question
   - `as_of` period/year phrase
   - required constraints (web search only, no command execution, include sources).
2. JSON parser handles:
   - valid JSON
   - fenced JSON blocks
   - invalid input (returns null).
3. Event parser extracts:
   - `web_search` actions (search/open_page)
   - URL and query traces
   - usage object from `turn.completed`.
4. Source normalization:
   - dedupe
   - URL validation
   - max source cap.

## Implementation checklist
- [x] Create package manifest (`package.json`) with Pi extension registration.
- [x] Implement utility module (`lib/codex-runner.mjs`).
- [x] Implement extension (`extensions/codex-search/index.ts`) with tool + command.
- [x] Add README with install/usage docs and output contract.
- [x] Add and run unit tests (`node --test`).
- [x] Run smoke test for codex CLI integration command shape.
