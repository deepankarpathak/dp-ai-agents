/**
 * API base URL for backend.
 * - Empty = same origin (React dev server proxies /api/* to backend; or production build served by backend).
 * - Set REACT_APP_API_URL in .env to your backend URL if you get 404 (e.g. REACT_APP_API_URL=http://localhost:5000).
 *   Use the same port as the backend (see PORT in backend/.env or run "Backend running on port XXXX" in terminal).
 */
export const API_BASE = (process.env.REACT_APP_API_URL && String(process.env.REACT_APP_API_URL).trim()) || "";

export async function sendCompletionNotify(agentName, identifier) {
  try {
    await fetch(`${API_BASE}/api/notify/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName, identifier }),
    });
  } catch (_) {}
}
