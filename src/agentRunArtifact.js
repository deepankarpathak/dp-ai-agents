/**
 * Local run log + Markdown artifact shape for successful agent completions.
 * Stored under agent-run-artifacts-v1 for Connectors → Export browser backup.
 */

const ARTIFACTS_KEY = "agent-run-artifacts-v1";
const MAX_ENTRIES = 150;

export function formatArtifactMarkdown({ agent, jiraId, subject, steps, input, output }) {
  const stepBlock =
    (Array.isArray(steps) ? steps : [])
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n") || "_(none listed)_";
  const ink = String(input ?? "").trim() || "_(empty)_";
  const outk = String(output ?? "").trim() || "_(empty)_";
  return [
    `# ${String(agent || "Agent").toUpperCase()} — ${subject || "output"}`,
    "",
    `- **JIRA:** ${jiraId || "—"}`,
    `- **Recorded (UTC):** ${new Date().toISOString()}`,
    "",
    "## Steps followed",
    stepBlock,
    "",
    "## Input",
    "```text",
    ink,
    "```",
    "",
    "## Output",
    outk,
  ].join("\n");
}

/**
 * Append a compact artifact record to localStorage (same-origin as the main app).
 * Full fidelity is written to disk via exportAgentOutput → /api/save-agent-output.
 */
export function recordAgentRunArtifact({ agent, jiraId, subject, steps, input, output }) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    at: new Date().toISOString(),
    agent: String(agent || "UNK").toUpperCase(),
    jiraId: String(jiraId || ""),
    subject: String(subject || ""),
    steps: Array.isArray(steps) ? steps.map(String) : [],
    input: String(input ?? "").slice(0, 24000),
    output: String(output ?? "").slice(0, 96000),
  };
  try {
    const prev = JSON.parse(localStorage.getItem(ARTIFACTS_KEY) || "[]");
    const list = Array.isArray(prev) ? prev : [];
    const next = [entry, ...list].slice(0, MAX_ENTRIES);
    localStorage.setItem(ARTIFACTS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}
