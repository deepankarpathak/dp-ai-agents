#!/usr/bin/env bash
# Clone and install https://github.com/aptro/superset-mcp (Python MCP for Apache Superset).
# Requires Python 3.10+ (Homebrew: brew install python@3.12).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/third_party/superset-mcp"
REPO="https://github.com/aptro/superset-mcp.git"

pick_python() {
  for c in "${PYTHON:-}" \
    /opt/homebrew/bin/python3.12 \
    /usr/local/bin/python3.12 \
    "$(command -v python3.12 2>/dev/null)" \
    "$(command -v python3 2>/dev/null)"; do
    [[ -z "${c:-}" ]] && continue
    [[ -x "$c" ]] || continue
    if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      echo "$c"
      return 0
    fi
  done
  echo "No Python 3.10+ found. Install with: brew install python@3.12" >&2
  exit 1
}

PY="$(pick_python)"
echo "Using: $PY ($("$PY" -c 'import sys; print(sys.version)'))"

if [[ ! -d "$TARGET/.git" ]]; then
  mkdir -p "$(dirname "$TARGET")"
  git clone --depth 1 "$REPO" "$TARGET"
else
  echo "Already cloned: $TARGET (skip clone)"
fi

cd "$TARGET"
if [[ ! -f .env ]] && [[ -f .env.example ]]; then
  cp .env.example .env
  echo "Created $TARGET/.env from .env.example — edit SUPERSET_* for your instance."
fi
if [[ ! -d .venv ]]; then
  "$PY" -m venv .venv
fi
# shellcheck source=/dev/null
source .venv/bin/activate
python -m pip install -U pip setuptools wheel -q
pip install .
echo "Done. Next: add SUPERSET_* to ~/.cursor/mcp-secrets.env and merge docs/cursor-mcp.example.json into ~/.cursor/mcp.json"
echo "Test: $TARGET/.venv/bin/python -c 'import main'"
