/**
 * Launcher only — do not duplicate Express here (avoids broken root node_modules / iconv-lite).
 * The real API (PRD, Share, Score, JIRA, …) lives in backend/server.js.
 *
 * Prefer: npm run start:backend   (from repo root)
 * Or:    node server.js           (this file — spawns backend with cwd=backend/)
 */
const { spawn } = require("child_process");
const path = require("path");

const backendDir = path.join(__dirname, "backend");
const child = spawn(process.execPath, ["server.js"], {
  cwd: backendDir,
  stdio: "inherit",
  env: { ...process.env },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
