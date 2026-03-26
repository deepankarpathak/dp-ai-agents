import { API_BASE } from "./config.js";

/** Best-effort server-side export under backend/agent-exports/ (see /api/save-agent-output). */
export async function exportAgentOutput({ agent, jiraId, subject, content }) {
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) return;
  try {
    await fetch(`${API_BASE}/api/save-agent-output`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: String(agent || "OUT").toUpperCase(),
        jiraId: jiraId || "",
        subject: subject || "",
        content: text,
      }),
    });
  } catch (_) {}
}
