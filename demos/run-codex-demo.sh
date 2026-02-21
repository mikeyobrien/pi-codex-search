#!/usr/bin/env bash
set -euo pipefail
cd /home/mobrienv/projects/pi-codex-search
pi --no-session "Use codex_search with questions ['What is the latest stable npm version?','What is the latest stable pnpm version?'] parallelism 2 as_of_period 'early' as_of_year 2026 timeout_sec 180 max_sources 3. Return concise answers for both questions."
