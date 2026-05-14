#!/usr/bin/env bash
# Start all external MCP servers in background, log to .claude/mcp-*.log
# Usage: bash scripts/start-mcps.sh

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/.claude"
mkdir -p "$LOG_DIR"

MCP_HOME="/Users/deepankarpathak/dev/mcp"

_ts() { date "+%H:%M:%S"; }

start_mcp() {
  local name="$1"
  local logname="$2"
  local logfile="$LOG_DIR/$logname"
  shift 2
  printf "--- %s %s ---\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$name" >> "$logfile"
  "$@" >> "$logfile" 2>&1 &
  local pid=$!
  printf "[%s] ✓ started %-26s pid=%-6s → %s\n" "$(_ts)" "$name" "$pid" "$logfile"
}

start_mcp "kb-mcp-server"           "mcp-kb.log"          node    "$MCP_HOME/kb-mcp-server/src/index.js"
start_mcp "redash-mcp"              "mcp-redash.log"       node    "$MCP_HOME/redash-mcp/dist/cli.js"
start_mcp "mcp-server-prometheus"   "mcp-prometheus.log"   node    "$MCP_HOME/mcp-server-prometheus/build/index.js"
start_mcp "superset-mcp"            "mcp-superset.log"     "$MCP_HOME/superset-mcp/venv/bin/python" "$MCP_HOME/superset-mcp/main.py"

echo ""
printf "[%s] ✓ All MCPs launched. Logs: %s/mcp-*.log\n" "$(_ts)" "$LOG_DIR"
