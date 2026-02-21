# pi-codex-search

Pi extension package that exposes Codex web research as a native Pi tool.

## What it adds

- **Tool:** `codex_search`
- **Command:** `/codex-search <question>`

The tool runs Codex in a locked search profile:

- `codex --search exec`
- `--ephemeral`
- `--skip-git-repo-check`
- `--sandbox read-only`
- `--json` (JSONL event telemetry)
- `--output-schema` (structured output contract)
- `-o` / `--output-last-message` (deterministic final artifact)

## Why this is better than plain text search prompts

It combines three Codex output modes for reliability:

1. **Schema-constrained result** (`--output-schema`) for stable machine parsing
2. **Final message artifact** (`-o`) for deterministic extraction
3. **JSONL event stream** (`--json`) for telemetry:
   - web search actions/queries/opened pages
   - usage metadata
   - policy checks (command-like event detection)

## Install in Pi

From this repo:

```bash
pi install /home/mobrienv/projects/pi-codex-search
```

Or as run-only extension while testing:

```bash
pi -e /home/mobrienv/projects/pi-codex-search/extensions/codex-search/index.ts
```

## Tool API

### `codex_search`

Parameters:

- `question` (required): research question
- `as_of_period` (optional): `early|mid|late` (default: `early`)
- `as_of_year` (optional): reference year (default: current UTC year)
- `model` (optional): Codex model override
- `timeout_sec` (optional): default `120`, max `600`
- `max_sources` (optional): default `8`, max `20`
- `fail_on_command_event` (optional): default `true`

Returns:

- human-readable answer with `as_of`, confidence, and source URLs
- structured details including telemetry (`searchTrace`, `usage`, `commandEvents`)

## Development

### Test

```bash
npm test
```

## Requirements

- `codex` CLI installed and authenticated
- network access for web search

## Sources

- Pi extension docs: `/home/mobrienv/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- Pi package docs: `/home/mobrienv/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/packages.md`
- Codex non-interactive docs: https://developers.openai.com/codex/noninteractive/
- Codex CLI reference: https://developers.openai.com/codex/cli/reference/
