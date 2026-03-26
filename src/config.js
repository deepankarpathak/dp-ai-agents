/**
 * API base URL for backend.
 * - Production: empty = same origin (when the Express app serves the built frontend).
 * - Development: defaults to http://127.0.0.1:5000 so requests hit backend/server.js directly
 *   (avoids proxy quirks + ensures Share/Score routes are found). Backend enables CORS.
 * - Override anytime: REACT_APP_API_URL=http://localhost:YOUR_PORT
 * - Alternate dev default: REACT_APP_DEV_BACKEND_URL=http://127.0.0.1:5001
 */
function resolveApiBase() {
  const explicit = process.env.REACT_APP_API_URL && String(process.env.REACT_APP_API_URL).trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.NODE_ENV === "development") {
    const dev = process.env.REACT_APP_DEV_BACKEND_URL && String(process.env.REACT_APP_DEV_BACKEND_URL).trim();
    return (dev || "http://127.0.0.1:5000").replace(/\/$/, "");
  }
  return "";
}

export const API_BASE = resolveApiBase();

/**
 * @param {{ agentName: string, identifier: string, notifySubject?: string }} payload
 */
export async function sendCompletionNotify(payload) {
  try {
    await fetch(`${API_BASE}/api/notify/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (_) {}
}
