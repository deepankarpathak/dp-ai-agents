import { API_BASE } from "./config.js";
import { formatArtifactMarkdown, recordAgentRunArtifact } from "./agentRunArtifact.js";

/**
 * Best-effort server-side export under backend/agent-exports/ (see /api/save-agent-output).
 * Persists a Markdown artifact: steps + input + final output (the deliverable body).
 */
export async function exportAgentOutput({ agent, jiraId, subject, content, steps, input }) {
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) return;
  const md = formatArtifactMarkdown({
    agent,
    jiraId,
    subject,
    steps,
    input,
    output: text,
  });
  recordAgentRunArtifact({
    agent,
    jiraId,
    subject,
    steps,
    input,
    output: text,
  });
  try {
    await fetch(`${API_BASE}/api/save-agent-output`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: String(agent || "OUT").toUpperCase(),
        jiraId: jiraId || "",
        subject: subject || "",
        content: md,
      }),
    });
  } catch (_) {}
}
