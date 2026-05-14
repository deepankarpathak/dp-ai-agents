#!/bin/bash
# Double-click or `open scripts/live-agent-logs.command` — tails all agent + MCP dev logs (macOS Terminal).
cd "$(dirname "$0")/.." || exit 1
mkdir -p .claude
touch .claude/main-dev.log .claude/analyst-dev.log .claude/alpha-dev.log \
      .claude/mcp-kb.log .claude/mcp-redash.log .claude/mcp-prometheus.log .claude/mcp-superset.log
clear
echo "═══════════════════════════════════════════════════════════════"
echo "  Live Logs — All Agents + MCP Servers"
echo "═══════════════════════════════════════════════════════════════"
echo "  [api]         → Express backend   (.claude/main-dev.log)"
echo "  [analyst-api] → Next.js analyst   (.claude/analyst-dev.log)"
echo "  [alpha]       → Alpha Agent       (.claude/alpha-dev.log)"
echo "  [mcp-kb]      → KB MCP Server     (.claude/mcp-kb.log)"
echo "  [mcp-redash]  → Redash MCP        (.claude/mcp-redash.log)"
echo "  [mcp-prom]    → Prometheus MCP    (.claude/mcp-prometheus.log)"
echo "  [mcp-super]   → Superset MCP      (.claude/mcp-superset.log)"
echo "═══════════════════════════════════════════════════════════════"
echo "  Ctrl+C stops tail only; servers keep running."
echo ""
tail -n 80 -f \
  .claude/main-dev.log \
  .claude/analyst-dev.log \
  .claude/alpha-dev.log \
  .claude/mcp-kb.log \
  .claude/mcp-redash.log \
  .claude/mcp-prometheus.log \
  .claude/mcp-superset.log
