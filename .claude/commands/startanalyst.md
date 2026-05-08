---
description: Start Analyst Agent (Query_Agent Next.js stack)
argument-hint: optional note
---

When the user runs `/startanalyst`, call the **prd-agent-launcher** MCP tool **`startanalyst`** (approve if prompted).

Then summarize:

- Embedded app default URL: `http://localhost:3040` (override with `REACT_APP_ANALYST_AGENT_URL` in `.env` if needed).
- Logs: `prd-agent/.claude/analyst-dev.log`.

If the tool reports `Query_Agent` missing, explain that folder is usually local-only (gitignored): restore or clone it next to `package.json`, configure `.env` from `.env.example`, then retry.

Use **`agents_status`** to verify port **3040** is listening after a short wait.
