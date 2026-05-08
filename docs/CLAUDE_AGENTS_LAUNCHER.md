# Claude ↔ PRD Agent launcher (MCP + slash commands)

This repo exposes MCP tools so Claude can start local dev stacks without leaving chat:


| Intent                                                                   | MCP tool        | Slash (Claude Code) |
| ------------------------------------------------------------------------ | --------------- | ------------------- |
| **Everything:** main UI + API + Analyst + browser + log Terminal (macOS) | `letsbegin`     | `/letsbegin`        |
| Main agents only (PRD, UAT, BRD, JIRA + backend)                         | `startagent`    | `/startagent`       |
| Analyst / Query_Agent (Next.js) only                                     | `startanalyst`  | `/startanalyst`     |
| TCP check on 3000 / 5000 / 3040                                          | `agents_status` | —                   |


**Note:** Claude **web** chat does not run local MCP. Use **Claude Desktop**, **Claude Code**, or `**claude` CLI** with MCP enabled.

---

## One-time setup

1. From the repo root:
  ```bash
   npm run install:mcp-launcher
  ```
2. Ensure `npm` and `node` are on `PATH` when your Claude app starts. If MCP fails with “npm not found”, launch Claude from a terminal **or** wrap the MCP command in bash and source `nvm` / extend `PATH` (same idea as `docs/cursor-mcp.example.json`).

Optional env vars (host process / MCP `env` block):


| Variable                  | Effect                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PRD_AGENT_ROOT`          | Override repo root if auto-detection fails                                                                         |
| `PRD_AGENT_FORCE_START`   | Set to `1` to run `npm run dev` / `dev:analyst` even when ports already listen                                     |
| `PRD_AGENT_SKIP_TERMINAL` | Set to `1` to skip opening Terminal (macOS) from `letsbegin`                                                       |
| `PRD_AGENT_HTTP_LOG`      | Set to `0` on the **Express** backend to disable `[api]` lines (`[analyst-api]` only logs in Next **development**) |


---

## A. Claude Desktop (chat)

1. Edit `**~/Library/Application Support/Claude/claude_desktop_config.json`** (create the file if needed).
2. Under top-level `"mcpServers"`, add (replace the path with your clone):
  ```json
   "prd-agent-launcher": {
     "command": "node",
     "args": ["/ABSOLUTE/PATH/TO/prd-agent/mcp/agents-launcher/index.js"]
   }
  ```
   If `node` is only on PATH inside nvm, use bash instead:
3. **Quit and reopen** Claude Desktop.
4. Open **Settings → Developer / MCP** (wording varies by version) and confirm `**prd-agent-launcher`** is connected.
5. In a **new chat**, say either:
  - **Natural language:** “Run the **letsbegin** MCP tool” or “Start everything with letsbegin.”
  - Desktop **does not** load repo `.claude/commands/`; there is no `/letsbegin` slash there unless you create a [custom shortcut](https://support.anthropic.com/) yourself. Treat **letsbegin** as the MCP tool name.

**What `letsbegin` does:** starts main stack (`npm run dev`) and Analyst (`npm run dev:analyst`) when ports are free; opens **[http://localhost:3000](http://localhost:3000)** and **[http://localhost:3040](http://localhost:3040)**; on **macOS** runs `**open scripts/live-agent-logs.command`** so Terminal tails both log files (Express `[api]` + Next `[analyst-api]`).

---

## B. Claude Code / `claude` CLI

1. `**cd` into the repo** so project-scoped MCP resolves `./mcp/agents-launcher/index.js`.
2. Ensure `**npm run install:mcp-launcher`** has been run once.
3. The repo includes `**.mcp.json**`. First time, approve `**prd-agent-launcher**` when prompted (`claude mcp reset-project-choices` resets approvals).
  Or add explicitly:
4. Start Claude Code / CLI from this project and type `**/letsbegin**` — the command tells the model to call MCP tool `**letsbegin**`.

You can also type `**/startagent**` or `**/startanalyst**` for partial flows.

---

## Cursor

Add `**prd-agent-launcher**` to `**~/.cursor/mcp.json**` — see `**docs/cursor-mcp.example.json**` (adjust paths).

---

## Logs and API lines

- `**/.claude/main-dev.log**` — `concurrently` output for backend + React; includes `**[api] METHOD /path status +Nms**` from Express when `PRD_AGENT_HTTP_LOG` is not `0`.
- `**/.claude/analyst-dev.log**` — Next dev server; includes `**[analyst-api] METHOD /path**` for `/api/*` in development.

On macOS, `**scripts/live-agent-logs.command**` tails both (double-click or used automatically by `**letsbegin**`). Else:

```bash
bash /path/to/prd-agent/scripts/live-agent-logs.command
```

---

## Analyst prerequisite

`**startanalyst**` / `**letsbegin**` expect `**Query_Agent/**` next to the repo `package.json`. If that folder is missing locally, restore it and configure env per `**.env.example**` before starting.