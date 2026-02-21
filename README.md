# pi-codex-search

Pi extension package that exposes Codex web research as a native Pi tool.

## What it adds

- **Tool:** `codex_search`
- **Command:** `/codex-search <question> [|| <question2> ...]`
- **Live progress updates:** elapsed time + search/page counters while Codex runs
- **Parallel batches:** pass multiple questions and the tool runs them concurrently

## Demo

![codex_search live progress demo](./demos/codex-search-progress.gif)

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

## Install with `pi install`

### Global install from GitHub (recommended)

```bash
pi install git:github.com/mikeyobrien/pi-codex-search
```

You can also use the HTTPS URL:

```bash
pi install https://github.com/mikeyobrien/pi-codex-search
```

This writes the package into your global Pi config at:

- `~/.pi/agent/settings.json` → `packages[]`

### Project-local install from GitHub

```bash
pi install -l git:github.com/mikeyobrien/pi-codex-search
```

This writes to `.pi/settings.json` in the current project.

### Local path install (development)

```bash
pi install /path/to/pi-codex-search
```

### Verify install

```bash
pi list
```

You should see one of:

- `git:github.com/mikeyobrien/pi-codex-search`
- `https://github.com/mikeyobrien/pi-codex-search`
- `/path/to/pi-codex-search` (if installed from a local checkout)

### Quick test after install

```bash
pi -p --no-session "Use codex_search with questions ['What is the latest stable npm version?'] as_of_period 'early' and as_of_year 2026. Return only a short answer."
```

### Run-only extension (without install)

```bash
pi -e /path/to/pi-codex-search/extensions/codex-search/index.ts
```

## Tool API

### `codex_search`

> Breaking change: this tool now accepts `questions` (array) instead of `question`.

Parameters:

- `questions` (required): list of research questions
  - one question → single search behavior
  - multiple questions → run in parallel
- `parallelism` (optional): worker count for batch runs (default: auto, max: `5`)
- `as_of_period` (optional): `early|mid|late` (default: `early`)
- `as_of_year` (optional): reference year (default: current UTC year)
- `model` (optional): Codex model override
- `timeout_sec` (optional): default `1800`, max `7200` (very permissive)
- `max_sources` (optional): default `8`, max `20`
- `fail_on_command_event` (optional): default `true`

Returns:

- single-question call: same human-readable answer format with `as_of`, confidence, and source URLs
- multi-question call: batch summary plus per-question result sections
- structured details including telemetry (`searchTrace`, `usage`, `commandEvents`) for each question
- progress summary (`elapsedSeconds`, `searches`, `pagesOpened`) per question, plus batch summary

If Codex emits search activity but no final structured output, the tool returns `reason: "no_final_output"` and a hint to retry with a larger `timeout_sec`.

## Development

### Test

```bash
npm test
```

### Regenerate demo GIF

```bash
nix-shell -p python312Packages.pillow --run "python3 scripts/make-demo-gif.py"
```

## Requirements

- `codex` CLI installed and authenticated
- network access for web search

## Sources

- Pi extension docs: `/home/mobrienv/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- Pi package docs: `/home/mobrienv/.npm-global/lib/node_modules/@mariozechner/pi-coding-agent/docs/packages.md`
- Codex non-interactive docs: https://developers.openai.com/codex/noninteractive/
- Codex CLI reference: https://developers.openai.com/codex/cli/reference/
