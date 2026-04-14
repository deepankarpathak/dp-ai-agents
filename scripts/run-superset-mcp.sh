#!/usr/bin/env bash
# Cursor MCP launcher: sources ~/.cursor/mcp-secrets.env then runs aptro/superset-mcp.
# Install first: ./scripts/install-superset-mcp.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="$ROOT/third_party/superset-mcp/.venv/bin/python"
MAIN="$ROOT/third_party/superset-mcp/main.py"

if [[ -f "$HOME/.cursor/mcp-secrets.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$HOME/.cursor/mcp-secrets.env"
  set +a
fi

if [[ ! -x "$PY" ]] || [[ ! -f "$MAIN" ]]; then
  echo "superset-mcp not installed. Run: $ROOT/scripts/install-superset-mcp.sh" >&2
  exit 1
fi

cd "$ROOT/third_party/superset-mcp"
exec "$PY" "$MAIN"
