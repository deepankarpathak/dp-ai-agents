import { useEffect, useState } from "react";
import { API_BASE } from "./config.js";

/**
 * Shown when Express (backend/server.js) is not reachable. PRD/UAT/BRD/JIRA and JIRA API routes all use this server.
 */
export default function BackendWarningBanner() {
  const [state, setState] = useState("checking"); // checking | ok | fail

  useEffect(() => {
    const url = `${API_BASE}/api/connectors/status`;
    fetch(url, { method: "GET", cache: "no-store" })
      .then((r) => setState(r.ok ? "ok" : "fail"))
      .catch(() => setState("fail"));
  }, []);

  if (state !== "fail") return null;

  const base = API_BASE || "(same origin — production build served with API)";
  return (
    <div
      role="alert"
      style={{
        padding: "10px 16px",
        background: "linear-gradient(90deg, #450a0a 0%, #1c1917 100%)",
        borderBottom: "1px solid #7f1d1d",
        color: "#fecaca",
        fontSize: 12,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        lineHeight: 1.5,
      }}
    >
      <strong style={{ color: "#fff" }}>API server unreachable</strong> at{" "}
      <code style={{ color: "#fde68a", fontSize: 11 }}>{base}</code> — PRD, UAT, BRD, and JIRA agents need the backend; JIRA fetch and Connectors use{" "}
      <code style={{ color: "#fde68a", fontSize: 11 }}>/api/jira-issue/…</code> on the same host.
      <div style={{ marginTop: 6 }}>
        In the project root run:{" "}
        <code style={{ background: "rgba(0,0,0,0.35)", padding: "2px 8px", borderRadius: 6, color: "#fff" }}>
          npm run start:backend
        </code>{" "}
        (port 5000) or{" "}
        <code style={{ background: "rgba(0,0,0,0.35)", padding: "2px 8px", borderRadius: 6, color: "#fff" }}>
          npm run dev
        </code>{" "}
        to start backend + frontend together. Ensure{" "}
        <code style={{ color: "#a7f3d0" }}>REACT_APP_API_URL</code> in <code style={{ color: "#a7f3d0" }}>.env</code> matches that port if you set it.
      </div>
    </div>
  );
}
