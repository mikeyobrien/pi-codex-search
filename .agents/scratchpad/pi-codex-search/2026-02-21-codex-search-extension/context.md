# Context — codex-search extension

## Task
Build a new Pi extension in `pi-codex-search` that exposes Codex web search behavior as a native Pi tool.

## Source requirements (from user)
- Make Codex search behavior a native Pi tool.
- Use Codex output types to improve reliability.
- Follow code-assist workflow.

## Existing documentation discovered
- `README.md` (project scaffold only)
- No `CODEASSIST.md` present.

## Relevant external docs and findings
- Pi extension API and tool registration:
  - `/home/mobrienv/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- Pi packages manifest and resource discovery:
  - `/home/mobrienv/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/packages.md`
- Existing extension patterns in `~/projects/rho/extensions/*`.
- Codex output controls:
  - `codex exec --json` JSONL event stream
  - `codex exec --output-schema <file>` structured output schema enforcement
  - `codex exec -o <file>` final output artifact

## Design decisions
1. Implement as a Pi package with `pi.extensions` manifest.
2. Register native tool `codex_search` in extension.
3. Use all three Codex output modes in one execution:
   - `--output-schema` for strict final JSON shape
   - `-o` for deterministic final payload capture
   - `--json` for telemetry/event parsing (web actions, usage)
4. Add a helper module for prompt building and event parsing, with unit tests.
5. Provide a slash command `/codex-search` for interactive convenience.

## Implementation paths
- `package.json` — package + Pi manifest + scripts
- `extensions/codex-search/index.ts` — extension tool/command
- `lib/codex-runner.mjs` — reusable prompt/event parsing utilities
- `test/codex-runner.test.mjs` — unit tests
- `README.md` — usage and architecture docs

## Dependencies and constraints
- Requires `codex` CLI available on PATH and authenticated.
- Tool must run in `read-only` sandbox and use `--ephemeral`.
- Tool should report source URLs and search trace in structured details.
