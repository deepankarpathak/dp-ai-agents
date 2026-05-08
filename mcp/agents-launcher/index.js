/**
 * MCP server: start local PRD-agent stacks from Claude (Desktop / Claude Code / CLI).
 * Tools: letsbegin (all-in-one), startagent, startanalyst, agents_status.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_FALLBACK = path.resolve(__dirname, "../..");

function resolveRepoRoot() {
  const env = process.env.PRD_AGENT_ROOT?.trim();
  if (env && fs.existsSync(path.join(env, "package.json"))) {
    return path.resolve(env);
  }
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "package.json")) && fs.existsSync(path.join(cwd, "mcp/agents-launcher/index.js"))) {
    return cwd;
  }
  return REPO_ROOT_FALLBACK;
}

function forceStart() {
  return process.env.PRD_AGENT_FORCE_START === "1";
}

function ensureLogDir(root) {
  const dir = process.env.PRD_AGENT_LAUNCH_LOG_DIR?.trim() || path.join(root, ".claude");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

function appendSpawnBanner(logPath, title) {
  const line = `\n--- ${new Date().toISOString()} ${title} ---\n`;
  try {
    fs.appendFileSync(logPath, line);
  } catch {
    /* ignore */
  }
}

function npmDetached(root, npmArgs, logFile) {
  appendSpawnBanner(logFile, npmArgs.join(" "));
  const logFd = fs.openSync(logFile, "a");
  const child = spawn("npm", npmArgs, {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });
  try {
    fs.closeSync(logFd);
  } catch {
    /* ignore */
  }
  child.unref();
  return child.pid;
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    const done = (ok) => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    socket.setTimeout(1200);
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
  });
}

function openUrlInBrowser(url) {
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", shell: true }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

/** macOS: opens Terminal via .command bundle. Else returns manual hint. */
function openLiveLogTerminal(root) {
  if (process.env.PRD_AGENT_SKIP_TERMINAL === "1") {
    return { skipped: true, reason: "PRD_AGENT_SKIP_TERMINAL=1" };
  }
  const cmdFile = path.join(root, "scripts", "live-agent-logs.command");
  if (!fs.existsSync(cmdFile)) {
    return { skipped: true, reason: "live-agent-logs.command missing", cmdFile };
  }
  if (process.platform === "darwin") {
    spawn("open", [cmdFile], { detached: true, stdio: "ignore" }).unref();
    return { opened: true, cmdFile };
  }
  return {
    skipped: true,
    reason: "Auto Terminal is macOS-only; run: bash scripts/live-agent-logs.command",
    cmdFile,
  };
}

async function startMainStack(root) {
  const logDir = ensureLogDir(root);
  const logFile = path.join(logDir, "main-dev.log");
  if (!forceStart()) {
    const [p3000, p5000] = await Promise.all([portOpen(3000), portOpen(5000)]);
    if (p3000 && p5000) {
      return {
        ok: true,
        started: false,
        repoRoot: root,
        logFile,
        note: "Ports 3000 and 5000 already listening; skipped npm run dev. Set PRD_AGENT_FORCE_START=1 to spawn anyway.",
      };
    }
  }
  const pid = npmDetached(root, ["run", "dev"], logFile);
  return { ok: true, started: true, pid, repoRoot: root, logFile };
}

async function startAnalystStack(root) {
  const qaDir = path.join(root, "Query_Agent");
  if (!fs.existsSync(qaDir)) {
    return {
      ok: false,
      error: "Query_Agent directory not found. Clone or create it beside package.json, then retry.",
      repoRoot: root,
    };
  }
  const logDir = ensureLogDir(root);
  const logFile = path.join(logDir, "analyst-dev.log");
  if (!forceStart() && (await portOpen(3040))) {
    return {
      ok: true,
      started: false,
      repoRoot: root,
      logFile,
      note: "Port 3040 already listening; skipped npm run dev:analyst. Set PRD_AGENT_FORCE_START=1 to spawn anyway.",
    };
  }
  const pid = npmDetached(root, ["run", "dev:analyst"], logFile);
  return { ok: true, started: true, pid, repoRoot: root, logFile };
}

const server = new McpServer({
  name: "prd-agent-launcher",
  version: "1.0.0",
});

server.tool(
  "letsbegin",
  "One-shot: start main agents (React :3000 + API :5000) and Analyst (:3040) if not already running; open browser tabs; on macOS open Terminal tailing combined dev logs with [api]/[analyst-api] lines. Maps to user slash /letsbegin.",
  async () => {
    const root = resolveRepoRoot();
    const main = await startMainStack(root);
    const analyst = await startAnalystStack(root);
    const mainUrl = process.env.PRD_AGENT_MAIN_URL?.trim() || "http://localhost:3000";
    const analystUrl = process.env.REACT_APP_ANALYST_AGENT_URL?.trim() || "http://localhost:3040";

    openUrlInBrowser(mainUrl);
    setTimeout(() => openUrlInBrowser(analystUrl), 400);

    const terminal = openLiveLogTerminal(root);

    const payload = {
      ok: analyst.ok !== false && main.ok !== false,
      mainStack: main,
      analystStack: analyst,
      browserOpened: [mainUrl, analystUrl],
      terminal,
      tips: [
        "Wait a few seconds for dev servers to bind ports; refresh browser if needed.",
        "API traffic: lines prefixed [api] (Express) and [analyst-api] (Next) appear in the tail window / log files.",
        "Disable HTTP request logs: PRD_AGENT_HTTP_LOG=0 on backend env or Query_Agent.",
      ],
    };

    if (!analyst.ok) {
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  },
);

server.tool(
  "startagent",
  "Starts the main agent stack: Node backend (port 5000) + React app (port 3000). Serves PRD, UAT, BRD, and JIRA tabs in one UI. Skips if ports already up unless PRD_AGENT_FORCE_START=1. Logs: .claude/main-dev.log.",
  async () => {
    const root = resolveRepoRoot();
    const result = await startMainStack(root);
    const mainUrl = process.env.PRD_AGENT_MAIN_URL?.trim() || "http://localhost:3000";
    const body = {
      ...result,
      openUi: mainUrl,
      apiUrl: "http://localhost:5000",
      note: "If npm is missing from PATH when Claude launches MCP, fix PATH in MCP env (see docs/CLAUDE_AGENTS_LAUNCHER.md).",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    };
  },
);

server.tool(
  "startanalyst",
  "Starts Analyst / Query_Agent (npm run dev:analyst — Next.js :3040). Skips if port up unless PRD_AGENT_FORCE_START=1. Logs: .claude/analyst-dev.log.",
  async () => {
    const root = resolveRepoRoot();
    const result = await startAnalystStack(root);
    if (!result.ok) {
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: true,
      };
    }
    const analystUrl = process.env.REACT_APP_ANALYST_AGENT_URL?.trim() || "http://localhost:3040";
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ...result, iframeUrl: analystUrl }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "agents_status",
  "Checks whether default ports are accepting TCP connections: 3000 (main React), 5000 (API), 3040 (Analyst Next.js).",
  async () => {
    const [p3000, p5000, p3040] = await Promise.all([portOpen(3000), portOpen(5000), portOpen(3040)]);
    const body = {
      mainReact: { port: 3000, listening: p3000 },
      mainApi: { port: 5000, listening: p5000 },
      analystNext: { port: 3040, listening: p3040 },
      repoRoot: resolveRepoRoot(),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
