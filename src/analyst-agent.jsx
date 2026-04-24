/**
 * Analyst Agent — embeds the Next.js app in Query_Agent/ (natural language → Trino SQL).
 * Run from repo root: npm run dev:analyst (loads secrets from ./.env via env-cmd).
 * Optional: REACT_APP_ANALYST_AGENT_URL to point at a non-default host/port.
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
        background: "#0b1120",
      }}
    >
      <iframe
        title="Analyst Agent"
        src={src}
        style={{
          flex: 1,
          border: "none",
          width: "100%",
          minHeight: 0,
          background: "#0b1120",
        }}
      />
    </div>
  );
}
