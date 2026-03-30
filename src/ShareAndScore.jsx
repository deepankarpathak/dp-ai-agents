import { useState, useEffect, useRef, useMemo } from "react";
import { API_BASE } from "./config.js";
import { loadPublishDefaults } from "./ConnectorsStatus.jsx";
import { buildShareSubjectLine } from "./shareSubject.js";

const panelStyle = {
  background: "#0D1626",
  border: "1px solid #1E3A5F",
  borderRadius: 12,
  padding: 16,
  marginTop: 12,
};

const btnStyle = (primary = false) => ({
  background: primary ? "#F59E0B" : "#111827",
  border: primary ? "none" : "1px solid #1E3A5F",
  borderRadius: 8,
  color: primary ? "#0B1120" : "#93C5FD",
  fontSize: 12,
  fontWeight: 600,
  padding: "6px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  marginRight: 8,
  marginBottom: 8,
});

/**
 * Share (JIRA, Telegram, Email, Slack) + Score (GPT 5.4) for PRD / UAT / BRD success screens.
 * @param {'prd'|'uat'|'brd'|'jira'} props.docType
 * @param {string} props.title - Document / J.display title
 * @param {string} props.content - Full markdown
 * @param {string} [props.jiraKey] - e.g. TSP-1889 for email subject pattern
 * @param {string[]} [props.autoPublish]
 * @param {'auto'|'primary'|'secondary'} [props.jiraShareSite] — overrides Connectors default for JIRA comment POST
 */
export default function ShareAndScore({ docType, title, content, jiraKey = "", autoPublish = [], jiraShareSite }) {
  const [shareStatus, setShareStatus] = useState({ type: "", ok: false, msg: "" });
  const [score, setScore] = useState(null);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreError, setScoreError] = useState("");
  const [publishSelected, setPublishSelected] = useState({ jira: true, telegram: true, email: true, slack: true });
  const [publishRunning, setPublishRunning] = useState(false);
  const [publishDone, setPublishDone] = useState(false);

  const shareSubject = useMemo(
    () => buildShareSubjectLine(docType, jiraKey, title),
    [docType, jiraKey, title]
  );

  const ranAutoPublish = useRef(false);
  const contentHeadRef = useRef("");

  useEffect(() => {
    const head = (content || "").slice(0, 160);
    if (head !== contentHeadRef.current) {
      contentHeadRef.current = head;
      ranAutoPublish.current = false;
    }
  }, [content]);

  useEffect(() => {
    if (!content || autoPublish.length === 0 || ranAutoPublish.current) return;
    const defs = loadPublishDefaults();
    const toRun = [];
    if (autoPublish.includes("jira") && defs.jiraKey) toRun.push("jira");
    if (autoPublish.includes("telegram") && defs.telegramChatId) toRun.push("telegram");
    if (autoPublish.includes("email") && defs.emailTo) toRun.push("email");
    if (autoPublish.includes("slack")) toRun.push("slack");
    if (toRun.length === 0) return;
    ranAutoPublish.current = true;
    setPublishRunning(true);
    (async () => {
      for (const t of toRun) {
        try {
          if (t === "jira") {
            const site = jiraShareSite ?? defs.jiraWriteSite;
            const body = { issueKey: defs.jiraKey, text: content, title };
            if (site && site !== "auto") body.jiraSite = site;
            await apiJson("/api/share/jira", body);
          }
          else if (t === "telegram") await apiJson("/api/share/telegram", { chatId: defs.telegramChatId, text: content, title });
          else if (t === "email") await apiJson("/api/share/email", { to: defs.emailTo, subject: shareSubject, text: content, title });
          else if (t === "slack") await apiJson("/api/share/slack", { text: content, title });
        } catch (_) {}
      }
      setPublishRunning(false);
      setPublishDone(true);
    })();
  }, [content, autoPublish, docType, title, shareSubject, jiraShareSite]);

  async function apiJson(path, body) {
    const primary = `${API_BASE}${path}`;
    const urls = [primary];
    if (primary.startsWith("http://127.0.0.1:")) {
      const alt = primary.replace("http://127.0.0.1:", "http://localhost:");
      if (alt !== primary) urls.push(alt);
    }
    let r;
    let lastNetErr;
    for (const url of urls) {
      try {
        r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        lastNetErr = undefined;
        break;
      } catch (e) {
        lastNetErr = e;
      }
    }
    if (!r) {
      throw new Error(
        `Cannot reach API (${primary}). Start the backend: open a terminal and run \`npm run start:backend\` from the repo root, or run \`npm run dev\` to start frontend + backend together. (${lastNetErr?.message || "Failed to fetch"})`
      );
    }
    const text = await r.text();
    let d;
    try {
      d = text ? JSON.parse(text) : {};
    } catch {
      if (r.status === 404) {
        throw new Error(
          "Backend returned 404 — Share/Score routes are served by backend/server.js (not the root server.js). Run: npm run start:backend (port 5000). If the backend uses another port, set REACT_APP_API_URL in .env and restart npm start."
        );
      }
      throw new Error(
        r.ok
          ? "Invalid JSON from server"
          : `Backend error: ${r.status}. ${text.slice(0, 120).replace(/\s+/g, " ")}`
      );
    }
    return { ok: r.ok, data: d };
  }

  const handleShareJira = async () => {
    const defs = loadPublishDefaults();
    if (!defs.jiraKey?.trim()) { setShareStatus({ type: "jira", ok: false, msg: "Set default JIRA issue key in Connectors (top bar)" }); return; }
    setShareStatus({ type: "", msg: "" });
    try {
      const site = jiraShareSite ?? defs.jiraWriteSite;
      const body = { issueKey: defs.jiraKey.trim(), text: content, title };
      if (site && site !== "auto") body.jiraSite = site;
      const { data: d } = await apiJson("/api/share/jira", body);
      if (d.success) setShareStatus({ type: "jira", ok: true, msg: "Posted to JIRA" });
      else setShareStatus({ type: "jira", ok: false, msg: d.error || "Failed" });
    } catch (e) { setShareStatus({ type: "jira", ok: false, msg: e.message }); }
  };

  const handleShareTelegram = async () => {
    const defs = loadPublishDefaults();
    if (!defs.telegramChatId?.trim()) { setShareStatus({ type: "tg", ok: false, msg: "Set default Telegram chat ID in Connectors (top bar)" }); return; }
    setShareStatus({ type: "", msg: "" });
    try {
      const { data: d } = await apiJson("/api/share/telegram", { chatId: defs.telegramChatId.trim(), text: content, title });
      if (d.success) setShareStatus({ type: "tg", ok: true, msg: "Sent to Telegram" });
      else setShareStatus({ type: "tg", ok: false, msg: d.error || "Failed" });
    } catch (e) { setShareStatus({ type: "tg", ok: false, msg: e.message }); }
  };

  const handleShareEmail = async () => {
    const defs = loadPublishDefaults();
    if (!defs.emailTo?.trim()) { setShareStatus({ type: "email", ok: false, msg: "Set default email in Connectors (top bar)" }); return; }
    setShareStatus({ type: "", msg: "" });
    try {
      const { data: d } = await apiJson("/api/share/email", { to: defs.emailTo.trim(), subject: shareSubject, text: content, title });
      if (d.success) setShareStatus({ type: "email", ok: true, msg: "Email sent" });
      else setShareStatus({ type: "email", ok: false, msg: d.error || "Failed" });
    } catch (e) { setShareStatus({ type: "email", ok: false, msg: e.message }); }
  };

  const handleScore = async () => {
    setScore(null); setScoreError(""); setScoreLoading(true);
    try {
      const { data: d } = await apiJson("/api/score", { type: docType, content, title });
      if (d.success) setScore({ score: d.score, maxScore: d.maxScore ?? 10, rationale: d.rationale });
      else setScoreError(d.error || "Score failed");
    } catch (e) { setScoreError(e.message); }
    setScoreLoading(false);
  };

  const handlePublish = async () => {
    const defs = loadPublishDefaults();
    setShareStatus({ type: "", msg: "" });
    const results = [];
    if (publishSelected.jira && defs.jiraKey) {
      try {
        const site = jiraShareSite ?? defs.jiraWriteSite;
        const jb = { issueKey: defs.jiraKey.trim(), text: content, title };
        if (site && site !== "auto") jb.jiraSite = site;
        const { data: d } = await apiJson("/api/share/jira", jb);
        results.push(d.success ? "JIRA ✓" : "JIRA: " + (d.error || "Failed"));
      } catch (e) { results.push("JIRA: " + e.message); }
    } else if (publishSelected.jira) results.push("JIRA: Set default in Connectors");
    if (publishSelected.telegram && defs.telegramChatId) {
      try {
        const { data: d } = await apiJson("/api/share/telegram", { chatId: defs.telegramChatId.trim(), text: content, title });
        results.push(d.success ? "Telegram ✓" : "Telegram: " + (d.error || "Failed"));
      } catch (e) { results.push("Telegram: " + e.message); }
    } else if (publishSelected.telegram) results.push("Telegram: Set default in Connectors");
    if (publishSelected.email && defs.emailTo) {
      try {
        const { data: d } = await apiJson("/api/share/email", { to: defs.emailTo.trim(), subject: shareSubject, text: content, title });
        results.push(d.success ? "Email ✓" : "Email: " + (d.error || "Failed"));
      } catch (e) { results.push("Email: " + e.message); }
    } else if (publishSelected.email) results.push("Email: Set default in Connectors");
    if (publishSelected.slack) {
      try {
        const { data: d } = await apiJson("/api/share/slack", { text: content, title });
        results.push(d.success ? "Slack ✓" : "Slack: " + (d.error || "Failed"));
      } catch (e) { results.push("Slack: " + e.message); }
    }
    const allOk = results.every((x) => x.endsWith("✓"));
    setShareStatus({ type: "publish", ok: allOk, msg: results.join(" · ") });
    if (allOk) setPublishDone(true);
  };

  if (!content) return null;

  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 10 }}>Share &amp; score</div>
      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 10, fontFamily: "monospace", wordBreak: "break-all" }}>Subject: {shareSubject}</div>

      {/* Publish (pre-configured defaults) */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>Publish to (configure defaults in Connectors):</div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          {["jira", "telegram", "email", "slack"].map((id) => (
            <label key={id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#CBD5E1" }}>
              <input type="checkbox" checked={publishSelected[id]} onChange={(e) => setPublishSelected((p) => ({ ...p, [id]: e.target.checked }))} />
              {id === "jira" && "JIRA"}
              {id === "telegram" && "Telegram"}
              {id === "email" && "Email"}
              {id === "slack" && "Slack"}
            </label>
          ))}
          <button type="button" onClick={handlePublish} disabled={publishRunning} style={btnStyle(true)}>
            {publishRunning ? "Publishing…" : publishDone ? "Published" : "Publish"}
          </button>
        </div>
        {autoPublish.length > 0 && publishRunning && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Auto-publishing to {autoPublish.join(", ")}…</div>}
      </div>

      {/* Share */}
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Send to one destination (uses defaults from Connectors):</div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={handleShareJira} style={btnStyle()}>Post to JIRA</button>
        <button type="button" onClick={handleShareTelegram} style={btnStyle()}>Send to Telegram</button>
        <button type="button" onClick={handleShareEmail} style={btnStyle()}>Send via Email</button>
      </div>
      {shareStatus.msg && (
        <div style={{ fontSize: 11, color: shareStatus.ok ? "#22c55e" : "#f87171", marginBottom: 8 }}>{shareStatus.msg}</div>
      )}

      {/* Score */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={handleScore} disabled={scoreLoading} style={btnStyle(true)}>
          {scoreLoading ? "Scoring…" : "Get score (GPT)"}
        </button>
        {score && (
          <span style={{ fontSize: 13, color: "#F59E0B", fontWeight: 700 }}>
            Score: {score.score}/{score.maxScore}
          </span>
        )}
        {scoreError && <span style={{ fontSize: 11, color: "#f87171" }}>{scoreError}</span>}
      </div>
      {score?.rationale && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#94A3B8", lineHeight: 1.5 }}>{score.rationale}</div>
      )}
    </div>
  );
}
