# Cursor MCP configuration (secrets & git safety)

## Verification: was `mcp.json` in this git repo?

**`~/.cursor/mcp.json` is not part of this repository** — it lives in your home directory. Secrets there were **not** committed via that path.

**What was wrong:** storing API tokens and emails **inside** `mcp.json` is unsafe (backups, screen sharing, accidental copy-paste into git). If tokens ever appeared in **chat**, a **tracked file**, or a **shared** config, treat them as **compromised** and **rotate** them in Atlassian and Redash.

**Repo hygiene:** `.cursor/` under the project is **gitignored**. One stray file (`.cursor/debug-*.log`) had been tracked earlier; it was removed from the index. If anything else under `.cursor/` is still tracked:

```bash
git rm -r --cached .cursor/
```

## Recommended setup (no secrets in `mcp.json`)

1. **Secrets file (local only, never commit)**  
   - Copy `docs/cursor-mcp-secrets.env.example` → `~/.cursor/mcp-secrets.env`  
   - Fill in real values; `chmod 600 ~/.cursor/mcp-secrets.env`

2. **`mcp.json` uses a tiny bash wrapper**  
   For servers that need API keys, use `command: /bin/bash` and `args` that **source** `mcp-secrets.env` then `exec` the real CLI (`uvx`, `npx`, …).  
   See **`docs/cursor-mcp.example.json`**.

   This works even when Cursor is launched from the **Dock** (no reliance on `${env:…}` expansion or your shell profile).

3. **Reload Cursor**  
   Command Palette → **Developer: Reload Window**.

## Alternative: `${env:VAR}` in `mcp.json`

Some Cursor/VS Code builds expand variables like `"JIRA_API_TOKEN": "${env:JIRA_TOKEN}"` in the `env` block. That only works if those variables exist in **Cursor’s** environment (often true if you start Cursor from a terminal where you already `export`’d them). The **bash + source** pattern above is more reliable on macOS.

## Overlap with project `.env`

The app reads `JIRA_URL`, `JIRA_EMAIL`, `JIRA_TOKEN` from `prd-agent/.env`. Cursor MCP does **not** read that file automatically. You can duplicate the same values into `~/.cursor/mcp-secrets.env`, or script a sync (keep both out of git).

## References

- [mcp-atlassian](https://github.com/sooperset/mcp-atlassian)
- [redash-mcp](https://github.com/suthio/redash-mcp)
- [whatsapp-mcp](https://github.com/lharries/whatsapp-mcp)
- [aptro/superset-mcp](https://github.com/aptro/superset-mcp) — Apache Superset (SQL Lab, dashboards, datasets). Installed in this repo via `scripts/install-superset-mcp.sh`; run with `scripts/run-superset-mcp.sh` and add `superset-mcp` to `~/.cursor/mcp.json` as in `docs/cursor-mcp.example.json`. Set `SUPERSET_BASE_URL`, `SUPERSET_USERNAME`, `SUPERSET_PASSWORD` in `~/.cursor/mcp-secrets.env`.
