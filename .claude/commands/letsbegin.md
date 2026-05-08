---
description: Start all agents, open browsers, open live API log terminal (macOS)
argument-hint: optional note
---

When the user runs `/letsbegin`, call the **prd-agent-launcher** MCP tool **`letsbegin`** (approve if prompted).

Confirm in your reply:

1. **Main app** — http://localhost:3000 (PRD, UAT, BRD, JIRA tabs); API http://localhost:5000  
2. **Analyst** — http://localhost:3040 (also embedded in the Analyst tab)  
3. **Terminal** — On macOS, Terminal should open tailing `.claude/main-dev.log` and `.claude/analyst-dev.log` with `[api]` (Express) and `[analyst-api]` (Next) lines  
4. If **`letsbegin`** reports Analyst missing **`Query_Agent`**, stop and tell the user to restore that folder  

If ports were already up, the tool may say it **skipped** starting servers — that is normal.
