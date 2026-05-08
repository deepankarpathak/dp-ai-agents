#!/bin/bash
# Double-click or `open scripts/live-agent-logs.command` — tails main + analyst dev logs (macOS Terminal).
cd "$(dirname "$0")/.." || exit 1
mkdir -p .claude
touch .claude/main-dev.log .claude/analyst-dev.log
clear
echo "Live logs — PRD stack (.claude/main-dev.log) + Analyst (.claude/analyst-dev.log)"
echo "[api] lines from Express (main) and [analyst-api] from Next middleware appear below."
echo "Ctrl+C stops tail only; dev servers keep running."
echo "---"
tail -n 120 -f .claude/main-dev.log .claude/analyst-dev.log
