---
description: Start PRD / UAT / BRD / JIRA agents (React UI + API backend)
argument-hint: optional note
---

When the user runs `/startagent`, call the **prd-agent-launcher** MCP tool **`startagent`** (approve if prompted).

Then summarize:

- Main UI: `http://localhost:3000` (tabs include PRD, UAT, BRD, JIRA).
- API: default `http://localhost:5000`.
- Logs: `prd-agent/.claude/main-dev.log`.

If something fails, call **`agents_status`** from the same MCP server and read the log file path returned by **`startagent`**.
