#!/usr/bin/env bash
set -euo pipefail
cd /home/mobrienv/projects/pi-codex-search
pi --no-session --no-extensions --no-skills --no-prompt-templates --no-themes \
  -e /home/mobrienv/projects/pi-codex-search/extensions/codex-search/index.ts \
  "Use codex_search with question 'What is the latest stable npm version?' as_of_period 'early' as_of_year 2026 timeout_sec 180 max_sources 3. Return one sentence."
