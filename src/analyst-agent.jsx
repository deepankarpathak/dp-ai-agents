/**
 * Analyst Agent — embeds the Next.js app in Query_Agent/ (natural language → Trino SQL).
 * Run from repo root: npm run dev:analyst (loads secrets from ./.env via env-cmd).
 */
const DEFAULT_ANALYST_URL =
  (typeof process !== "undefined" &&
    process.env.REACT_APP_ANALYST_AGENT_URL &&
    String(process.env.REACT_APP_ANALYST_AGENT_URL).trim()) ||
  "http://localhost:3040";

export default function AnalystAgentTab() {
  const src = DEFAULT_ANALYST_URL.replace(/\/+$/, "");

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: "calc(100vh - 40px)",
        background: "#0f172a",
      }}
    >
      <div
        style={{
          padding: "6px 16px",
          fontSize: 11,
          color: "#94a3b8",
          borderBottom: "1px solid #1e293b",
          fontFamily: "'Segoe UI', sans-serif",
        }}
      >
        <strong style={{ color: "#cbd5e1" }}>Analyst Agent</strong> — Next.js app at{" "}
        <code style={{ color: "#e2e8f0" }}>{src}</code>
        . If this is blank, start it with{" "}
        <code style={{ color: "#e2e8f0" }}>npm run dev:analyst</code> (env from repo root{" "}
        <code style={{ color: "#e2e8f0" }}>.env</code>
        ). Override URL: <code style={{ color: "#e2e8f0" }}>REACT_APP_ANALYST_AGENT_URL</code>
      </div>
      <iframe
        title="Analyst Agent"
        src={src}
        style={{
          flex: 1,
          border: "none",
          width: "100%",
          minHeight: 0,
          background: "#fff",
        }}
      />
    </div>
  );
}
