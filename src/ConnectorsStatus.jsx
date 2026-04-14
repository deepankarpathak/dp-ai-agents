import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "./config.js";
import {
  AGENT_LOCAL_STORAGE_KEYS,
  applyAgentLocalStorageImport,
  downloadAgentBackupJson,
} from "./agentStorageBackup.js";

const PUBLISH_DEFAULTS_KEY = "publish-defaults-v1";
const PUBLISH_DEFAULTS_EMPTY = {
  jiraKey: "",
  telegramChatId: "",
  emailTo: "",
  /** Short JIRA project key for JIRA Agent default (e.g. TSP). */
  jiraDefaultProjectKey: "",
  /** Email, display name, or Atlassian accountId — sent as Dev Assignee on create. */
  jiraDevAssignee: "",
  /** auto | primary | secondary — default Atlassian site for fetch / create / Share when the issue key has no URL. */
  jiraWriteSite: "auto",
  /** openai | foundry — which backend Share & Score uses for Get score */
  scoreProvider: "openai",
  /** aws | foundry — which LLM backend PRD / UAT / BRD / JIRA agents use (default AWS Bedrock). */
  llmProvider: "aws",
  /** sonnet | opus | haiku — Bedrock model family when LLM provider is AWS (maps to inference profile IDs on the server). */
  bedrockModelTier: "sonnet",
};
function loadPublishDefaults() {
  try {
    const raw = localStorage.getItem(PUBLISH_DEFAULTS_KEY);
    return raw ? { ...PUBLISH_DEFAULTS_EMPTY, ...JSON.parse(raw) } : { ...PUBLISH_DEFAULTS_EMPTY };
  } catch {
    return { ...PUBLISH_DEFAULTS_EMPTY };
  }
}
function savePublishDefaults(d) {
  try {
    localStorage.setItem(PUBLISH_DEFAULTS_KEY, JSON.stringify(d));
    window.dispatchEvent(new CustomEvent("publish-defaults-changed", { detail: d }));
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

/** After JIRA fetch — remember which site the issue lives on for Share / creates. */
export function syncPublishJiraSiteFromIssue(d) {
  if (!d?.jiraSite) return;
  if (d.jiraSite !== "secondary" && d.jiraSite !== "primary") return;
  const cur = loadPublishDefaults();
  savePublishDefaults({ ...cur, jiraWriteSite: d.jiraSite });
}

/** Current LLM routing for /api/generate (browser default from Connectors). */
export function getLlmProviderForRequest() {
  const d = loadPublishDefaults();
  return d.llmProvider === "foundry" ? "foundry" : "aws";
}

/** Bedrock model tier for /api/generate when LLM provider is AWS. */
export function getBedrockModelTierForRequest() {
  const d = loadPublishDefaults();
  const t = String(d.bedrockModelTier || "sonnet").toLowerCase();
  if (t === "opus" || t === "haiku") return t;
  return "sonnet";
}

export { loadPublishDefaults, savePublishDefaults, PUBLISH_DEFAULTS_KEY, PUBLISH_DEFAULTS_EMPTY };

const CONNECTOR_LIST = [
  { id: "jira", label: "JIRA", icon: "J", color: "#0052CC", envHint: "JIRA_URL, JIRA_EMAIL, JIRA_TOKEN" },
  { id: "slack", label: "Slack", icon: "S", color: "#4A154B", envHint: "SLACK_BOT_TOKEN or SLACK_WEBHOOK_URL" },
  { id: "whatsapp", label: "WhatsApp", icon: "W", color: "#25D366", envHint: "WHATSAPP_TOKEN, WHATSAPP_PHONE_ID" },
  { id: "email", label: "Email", icon: "E", color: "#EA4335", envHint: "EMAIL_SMTP_HOST or EMAIL_API_KEY" },
  { id: "telegram", label: "Telegram", icon: "T", color: "#0088CC", envHint: "TELEGRAM_BOT_TOKEN" },
];

export default function ConnectorsStatus() {
  const [status, setStatus] = useState({
    jira: false,
    slack: false,
    whatsapp: false,
    email: false,
    telegram: false,
    llmBedrockConfigured: false,
    llmFoundryConfigured: false,
    llmProviders: [],
  });
  const [open, setOpen] = useState(false);
  const [jiraTestResult, setJiraTestResult] = useState("");
  const [jiraTestLoading, setJiraTestLoading] = useState(false);
  const [publishDefaults, setPublishDefaults] = useState(() => loadPublishDefaults());
  useEffect(() => { if (open) setPublishDefaults(loadPublishDefaults()); }, [open]);
  const [publishSaved, setPublishSaved] = useState(false);
  const [llmProbeLoading, setLlmProbeLoading] = useState(false);
  const [backendUnreachable, setBackendUnreachable] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const importFileRef = useRef(null);

  const fetchStatus = useCallback(() => {
    fetch(`${API_BASE}/api/connectors/status`)
      .then((r) => {
        setBackendUnreachable(!r.ok);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setStatus(data))
      .catch(() => {
        setBackendUnreachable(true);
      });
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const refreshLlmProbes = async () => {
    setLlmProbeLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/connectors/llm-probes`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (d.success && Array.isArray(d.llmProviders)) {
        setStatus((prev) => ({ ...prev, llmProviders: d.llmProviders }));
      } else {
        fetchStatus();
      }
    } catch {
      fetchStatus();
    }
    setLlmProbeLoading(false);
  };

  const testJira = async () => {
    setJiraTestLoading(true); setJiraTestResult("");
    try {
      const r = await fetch(`${API_BASE}/api/jira-test`);
      const d = await r.json();
      if (d.ok && Array.isArray(d.sites) && d.sites.length) {
        const lines = d.sites.map((s) => `${s.label || s.id}: ${s.ok ? `✓ ${s.user || "OK"}` : `✗ ${s.error || "fail"}`}`);
        setJiraTestResult(lines.join("\n"));
      } else if (d.ok) setJiraTestResult(`Connected as ${d.user}`);
      else setJiraTestResult(d.error || "Connection failed");
    } catch (e) { setJiraTestResult("Server error: " + e.message); }
    setJiraTestLoading(false);
  };

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
              <button type="button" onClick={() => setOpen(false)} style={{ background: "#1e293b", border: "none", borderRadius: 8, width: 30, height: 30, color: "#94a3b8", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>x</button>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20, lineHeight: 1.6 }}>
              Connectors are configured via environment variables in your <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4, color: "#93c5fd" }}>.env</code> file. Restart the server after making changes.
            </div>

            {backendUnreachable ? (
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #7f1d1d",
                  background: "rgba(69, 10, 10, 0.5)",
                  color: "#fecaca",
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: "#fff" }}>Cannot reach API</strong> at{" "}
                <code style={{ color: "#fde68a" }}>{API_BASE || "(see REACT_APP_API_URL)"}</code>. Start the backend:{" "}
                <code style={{ color: "#a7f3d0" }}>npm run start:backend</code> or <code style={{ color: "#a7f3d0" }}>npm run dev</code>.
              </div>
            ) : null}

            <div style={{ marginBottom: 16, padding: 14, background: "#1e293b", borderRadius: 12, border: "1px solid #334155" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>
                PRD / UAT / BRD / JIRA — browser history
              </div>
              <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 10px", lineHeight: 1.5 }}>
                History is stored in <strong style={{ color: "#94a3b8" }}>localStorage</strong> for this site only.{" "}
                <code style={{ color: "#93c5fd" }}>localhost</code> and <code style={{ color: "#93c5fd" }}>127.0.0.1</code> are{" "}
                <strong>different</strong> — opening the app on a new URL looks like an empty history. Export from the old URL and import here to restore.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    setBackupMsg("");
                    try {
                      downloadAgentBackupJson();
                      setBackupMsg("Download started (JSON file).");
                    } catch (e) {
                      setBackupMsg(String(e?.message || e));
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#93c5fd",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Export history (download JSON)
                </button>
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#a7f3d0",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Import history…
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: "none" }}
                  onChange={async (ev) => {
                    const f = ev.target.files?.[0];
                    ev.target.value = "";
                    if (!f) return;
                    setBackupMsg("Reading…");
                    try {
                      const text = await f.text();
                      const data = JSON.parse(text);
                      const n = applyAgentLocalStorageImport(data);
                      setBackupMsg(`Imported ${n} key(s). Reloading…`);
                      try {
                        window.dispatchEvent(
                          new CustomEvent("agent-localstorage-imported", { detail: { keys: AGENT_LOCAL_STORAGE_KEYS } }),
                        );
                        window.dispatchEvent(new CustomEvent("publish-defaults-changed", { detail: loadPublishDefaults() }));
                      } catch {
                        /* ignore */
                      }
                      setTimeout(() => window.location.reload(), 400);
                    } catch (e) {
                      setBackupMsg(`Import failed: ${e?.message || e}`);
                    }
                  }}
                />
              </div>
              <p style={{ fontSize: 10, color: "#64748b", margin: "8px 0 0" }}>
                Keys: {AGENT_LOCAL_STORAGE_KEYS.join(", ")}
              </p>
              {backupMsg ? (
                <p style={{ fontSize: 11, color: "#a7f3d0", margin: "8px 0 0" }}>{backupMsg}</p>
              ) : null}
            </div>

            <div style={{ marginBottom: 16, padding: 14, background: "#1e293b", borderRadius: 12, border: "1px solid #334155" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>LLM backends (health)</div>
                <button
                  type="button"
                  onClick={() => refreshLlmProbes()}
                  disabled={llmProbeLoading}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: llmProbeLoading ? "#64748b" : "#93c5fd",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: llmProbeLoading ? "default" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {llmProbeLoading ? "Checking…" : "Refresh probes"}
                </button>
              </div>
              <p style={{ fontSize: 10, color: "#64748b", margin: "0 0 10px", lineHeight: 1.5 }}>
                Startup and on-demand checks: <strong style={{ color: "#94a3b8" }}>Bedrock</strong>,{" "}
                <strong style={{ color: "#94a3b8" }}>Foundry</strong>, <strong style={{ color: "#94a3b8" }}>OpenAI</strong> (Share &amp; Score),{" "}
                <strong style={{ color: "#94a3b8" }}>Gemini</strong> (optional key — not used by agents unless you add routing).
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(Array.isArray(status.llmProviders) ? status.llmProviders : []).map((p) => {
                  const configured = !!p.configured;
                  const pending = configured && p.ok === null;
                  const ok = p.ok === true;
                  const label = p.label || p.id;
                  const err = (p.error || "").trim();
                  let line = "";
                  if (!configured) line = "Not configured";
                  else if (pending) line = "Checking…";
                  else if (ok) line = "Working";
                  else line = err || "Not working";
                  return (
                    <div
                      key={p.id || label}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: "#0f172a",
                        border: "1px solid #334155",
                        fontSize: 11,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#e2e8f0", minWidth: 100 }}>{label}</span>
                      <span
                        style={{
                          flex: 1,
                          textAlign: "right",
                          color: !configured ? "#94a3b8" : pending ? "#94a3b8" : ok ? "#22c55e" : "#f87171",
                          wordBreak: "break-word",
                        }}
                      >
                        {line}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 16, padding: 14, background: "#1e293b", borderRadius: 12, border: "1px solid #334155" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", marginBottom: 8 }}>LLM provider (all agents)</div>
              <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 10px", lineHeight: 1.5 }}>
                Choose whether PRD, UAT, BRD, and JIRA agents call <strong style={{ color: "#93c5fd" }}>AWS Bedrock</strong> or your <strong style={{ color: "#93c5fd" }}>Foundry</strong> gateway. Saved in this browser.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...loadPublishDefaults(), llmProvider: "aws" };
                    savePublishDefaults(next);
                    setPublishDefaults(next);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: (publishDefaults.llmProvider !== "foundry" ? "#f59e0b" : "#334155") + " 1px solid",
                    background: publishDefaults.llmProvider !== "foundry" ? "#f59e0b22" : "#0f172a",
                    color: publishDefaults.llmProvider !== "foundry" ? "#fbbf24" : "#94a3b8",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  AWS Bedrock
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...loadPublishDefaults(), llmProvider: "foundry" };
                    savePublishDefaults(next);
                    setPublishDefaults(next);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: publishDefaults.llmProvider === "foundry" ? "#38bdf8 1px solid" : "#334155 1px solid",
                    background: publishDefaults.llmProvider === "foundry" ? "#38bdf822" : "#0f172a",
                    color: publishDefaults.llmProvider === "foundry" ? "#7dd3fc" : "#94a3b8",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Foundry
                </button>
                <span style={{ fontSize: 10, color: "#64748b", flex: "1 1 200px" }}>
                  Bedrock: {status.llmBedrockConfigured ? <span style={{ color: "#22c55e" }}>env OK</span> : <span style={{ color: "#f87171" }}>not linked</span>}
                  {" · "}
                  Foundry: {status.llmFoundryConfigured ? <span style={{ color: "#22c55e" }}>env OK</span> : <span style={{ color: "#f87171" }}>not linked</span>}
                </span>
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #334155" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0", marginBottom: 6 }}>Bedrock model (when AWS is selected)</div>
                <p style={{ fontSize: 10, color: "#64748b", margin: "0 0 8px", lineHeight: 1.45 }}>
                  Chooses the on‑prem/gateway or native Bedrock model id for Sonnet, Opus, or Haiku. Saved in this browser.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {[
                    { id: "sonnet", label: "Sonnet" },
                    { id: "opus", label: "Opus" },
                    { id: "haiku", label: "Haiku" },
                  ].map(({ id, label }) => {
                    const active = (publishDefaults.bedrockModelTier || "sonnet") === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          const next = { ...loadPublishDefaults(), bedrockModelTier: id };
                          savePublishDefaults(next);
                          setPublishDefaults(next);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: active ? "#f59e0b 1px solid" : "#334155 1px solid",
                          background: active ? "#f59e0b22" : "#0f172a",
                          color: active ? "#fbbf24" : "#94a3b8",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
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
                    <button type="button" onClick={testJira} disabled={jiraTestLoading || !status.jira} style={{ background: status.jira ? "#0052CC22" : "#1e293b", border: `1px solid ${status.jira ? "#0052CC66" : "#334155"}`, borderRadius: 8, padding: "6px 14px", color: status.jira ? "#0052CC" : "#64748b", fontSize: 11, fontWeight: 600, cursor: status.jira && !jiraTestLoading ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
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
# Second site (TPAP / mypaytm) — same email & token
# JIRA_URL_2=https://mypaytm.atlassian.net
# Projects that live on JIRA_URL_2 (comma-separated):
# JIRA_SECONDARY_PROJECT_KEYS=TPAP,PCO,TPG
JIRA_EMAIL=you@company.com
JIRA_TOKEN=ATATT3x...
# Optional — Dev Assignee custom field on create (see .env.example)
# JIRA_DEV_ASSIGNEE_FIELD_ID=customfield_10236
# JIRA_DEV_ASSIGNEE=you@company.com
# JIRA_DEV_ASSIGNEE_SINGLE_USER_OBJECT=true   # only if your field is single-user, not multi-user

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
                  <label style={{ fontSize: 10, color: "#94a3b8", display: "block", marginBottom: 4 }}>Default JIRA site (fetch / Share / agents)</label>
                  <select
                    value={["auto", "primary", "secondary"].includes(publishDefaults.jiraWriteSite) ? publishDefaults.jiraWriteSite : "auto"}
                    onChange={(e) => setPublishDefaults((p) => ({ ...p, jiraWriteSite: e.target.value }))}
                    style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 12 }}
                  >
                    <option value="auto">Auto — use project key (TPAP, PCO, TPG → JIRA_URL_2) or try primary first on fetch</option>
                    <option value="primary">Always primary (JIRA_URL)</option>
                    <option value="secondary">Always secondary (JIRA_URL_2)</option>
                  </select>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Paste a full browse URL anytime — the correct site is detected from the link.</div>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#94a3b8", display: "block", marginBottom: 4 }}>JIRA Agent — default project key</label>
                  <input
                    type="text"
                    placeholder="e.g. TSP (not the full project name)"
                    value={publishDefaults.jiraDefaultProjectKey || ""}
                    onChange={(e) => setPublishDefaults((p) => ({ ...p, jiraDefaultProjectKey: e.target.value }))}
                    style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "6px 10px", color: "#e2e8f0", fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#94a3b8", display: "block", marginBottom: 4 }}>JIRA Agent — Dev assignee on create</label>
                  <input
                    type="text"
                    placeholder="Email, name, or Atlassian accountId (UUID)"
                    value={publishDefaults.jiraDevAssignee || ""}
                    onChange={(e) => setPublishDefaults((p) => ({ ...p, jiraDevAssignee: e.target.value }))}
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
