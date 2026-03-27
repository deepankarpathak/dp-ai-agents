import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "./config.js";

const PUBLISH_DEFAULTS_KEY = "publish-defaults-v1";
function loadPublishDefaults() {
  try {
    const raw = localStorage.getItem(PUBLISH_DEFAULTS_KEY);
    return raw ? JSON.parse(raw) : { jiraKey: "", telegramChatId: "", emailTo: "" };
  } catch {
    return { jiraKey: "", telegramChatId: "", emailTo: "" };
  }
}
function savePublishDefaults(d) {
  try {
    localStorage.setItem(PUBLISH_DEFAULTS_KEY, JSON.stringify(d));
  } catch {}
}

/** Sync default JIRA issue key (Connectors → Publish) from agent connector field or fetched key. */
export function syncPublishDefaultJiraKey(keyOrText) {
  const raw = (keyOrText || "").trim();
  if (!raw) return;
  const m = raw.match(/\b([A-Z][A-Z0-9]*-\d+)\b/i);
  const key = m ? m[1].toUpperCase() : "";
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(key)) return;
  const cur = loadPublishDefaults();
  savePublishDefaults({ ...cur, jiraKey: key });
}

export { loadPublishDefaults, savePublishDefaults, PUBLISH_DEFAULTS_KEY };

const CONNECTOR_LIST = [
  { id: "jira", label: "JIRA", icon: "J", color: "#0052CC", envHint: "JIRA_URL, JIRA_EMAIL, JIRA_TOKEN" },
  { id: "slack", label: "Slack", icon: "S", color: "#4A154B", envHint: "SLACK_BOT_TOKEN or SLACK_WEBHOOK_URL" },
  { id: "whatsapp", label: "WhatsApp", icon: "W", color: "#25D366", envHint: "WHATSAPP_TOKEN, WHATSAPP_PHONE_ID" },
  { id: "email", label: "Email", icon: "E", color: "#EA4335", envHint: "EMAIL_SMTP_HOST or EMAIL_API_KEY" },
  { id: "telegram", label: "Telegram", icon: "T", color: "#0088CC", envHint: "TELEGRAM_BOT_TOKEN" },
];

export default function ConnectorsStatus() {
  const [status, setStatus] = useState({ jira: false, slack: false, whatsapp: false, email: false, telegram: false });
  const [open, setOpen] = useState(false);
  const [jiraTestResult, setJiraTestResult] = useState("");
  const [jiraTestLoading, setJiraTestLoading] = useState(false);
  const [publishDefaults, setPublishDefaults] = useState(() => loadPublishDefaults());
  useEffect(() => { if (open) setPublishDefaults(loadPublishDefaults()); }, [open]);
  const [publishSaved, setPublishSaved] = useState(false);

  const fetchStatus = useCallback(() => {
    fetch(`${API_BASE}/api/connectors/status`)
      .then((r) => r.json())
      .then((data) => setStatus(data))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const testJira = async () => {
    setJiraTestLoading(true); setJiraTestResult("");
    try {
      const r = await fetch(`${API_BASE}/api/jira-test`);
      const d = await r.json();
      if (d.ok) setJiraTestResult(`Connected as ${d.user}`);
      else setJiraTestResult(d.error || "Connection failed");
    } catch (e) { setJiraTestResult("Server error: " + e.message); }
    setJiraTestLoading(false);
  };

  const connectedCount = CONNECTOR_LIST.filter((c) => status[c.id]).length;
  const totalCount = CONNECTOR_LIST.length;
  const connectorNames = CONNECTOR_LIST.map((c) => c.label).join(" · ");

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
        style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "4px 10px", borderRadius: 10, background: "#0f172a", border: "1px solid #1e293b", cursor: "pointer" }}
        title="Open Connector Settings"
      >
        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Connectors</span>

          {/* This line is commented */}
  {/*
       <span style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>
          {connectorNames}
        </span>
   
        <span style={{ fontSize: 10, color: "#22c55e", fontWeight: 600 }}>{connectedCount} connected</span>
        <span style={{ fontSize: 10, color: "#64748b" }}>
          · {connectedCount}/{totalCount} · Click to enable others
        </span>

        */}
        
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "#93c5fd" }}>Know more →</span>
      </div>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9998 }} />
          <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 520, maxHeight: "80vh", overflow: "auto", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, zIndex: 9999, padding: 28, fontFamily: "'Segoe UI', sans-serif", color: "#e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Connector Settings</div>
              <button onClick={() => setOpen(false)} style={{ background: "#1e293b", border: "none", borderRadius: 8, width: 30, height: 30, color: "#94a3b8", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>x</button>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20, lineHeight: 1.6 }}>
              Connectors are configured via environment variables in your <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4, color: "#93c5fd" }}>.env</code> file. Restart the server after making changes.
            </div>

            {CONNECTOR_LIST.map(({ id, label, icon, color, envHint }) => (
              <div key={id} style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 12, border: `1px solid ${status[id] ? `${color}44` : "#334155"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: `${color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color }}>
                    {icon}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: status[id] ? "#22c55e" : "#f87171", background: status[id] ? "#22c55e18" : "#f8717118", padding: "3px 10px", borderRadius: 12 }}>
                    {status[id] ? "Linked" : "Not Linked"}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
                  Required env vars: <code style={{ background: "#0f172a", padding: "2px 6px", borderRadius: 4, color: "#93c5fd" }}>{envHint}</code>
                </div>
                {id === "jira" && (
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={testJira} disabled={jiraTestLoading || !status.jira} style={{ background: status.jira ? "#0052CC22" : "#1e293b", border: `1px solid ${status.jira ? "#0052CC66" : "#334155"}`, borderRadius: 8, padding: "6px 14px", color: status.jira ? "#0052CC" : "#64748b", fontSize: 11, fontWeight: 600, cursor: status.jira && !jiraTestLoading ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
                      {jiraTestLoading ? "Testing..." : "Test Connection"}
                    </button>
                    {jiraTestResult && (
                      <span style={{ fontSize: 11, color: jiraTestResult.startsWith("Connected") ? "#22c55e" : "#f87171" }}>
                        {jiraTestResult}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div style={{ marginTop: 16, padding: 14, background: "#1e293b", borderRadius: 10, border: "1px solid #334155" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", marginBottom: 6 }}>Example .env configuration</div>
              <pre style={{ fontSize: 11, color: "#94a3b8", margin: 0, lineHeight: 1.8, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{`# JIRA
JIRA_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_TOKEN=ATATT3x...

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# WhatsApp (Meta Business API)
WHATSAPP_TOKEN=EAAx...
WHATSAPP_PHONE_ID=123456789

# Email (SMTP)
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_API_KEY=your-api-key

# Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...`}</pre>
            </div>

            <div style={{ marginTop: 16, padding: 14, background: "#1e293b", borderRadius: 10, border: "1px solid #334155" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#22c55e", marginBottom: 8 }}>Default publish destinations</div>
              <p style={{ fontSize: 11, color: "#64748b", marginBottom: 10, lineHeight: 1.5 }}>Set these to use &quot;Publish&quot; on the final screen without typing each time (saved in browser).</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10, color: "#94a3b8", display: "block", marginBottom: 4 }}>Default JIRA issue key</label>
                  <input
                    type="text"
                    placeholder="e.g. TSP-1889"
                    value={publishDefaults.jiraKey}
                    onChange={(e) => setPublishDefaults((p) => ({ ...p, jiraKey: e.target.value }))}
                    style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#94a3b8", display: "block", marginBottom: 4 }}>Default Telegram chat ID</label>
                  <input
                    type="text"
                    placeholder="e.g. -1001234567890"
                    value={publishDefaults.telegramChatId}
                    onChange={(e) => setPublishDefaults((p) => ({ ...p, telegramChatId: e.target.value }))}
                    style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#94a3b8", display: "block", marginBottom: 4 }}>Default email (to)</label>
                  <input
                    type="text"
                    placeholder="e.g. team@company.com"
                    value={publishDefaults.emailTo}
                    onChange={(e) => setPublishDefaults((p) => ({ ...p, emailTo: e.target.value }))}
                    style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 12 }}
                  />
                </div>
                <button type="button" onClick={() => { savePublishDefaults(publishDefaults); setPublishSaved(true); setTimeout(() => setPublishSaved(false), 1500); }} style={{ alignSelf: "flex-start", background: "#22c55e", color: "#0f172a", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {publishSaved ? "Saved" : "Save defaults"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
