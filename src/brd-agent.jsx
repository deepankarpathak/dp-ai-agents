import { useState, useRef, useEffect } from "react";
import { API_BASE, sendCompletionNotify } from "./config.js";
import ShareAndScore from "./ShareAndScore.jsx";
import { syncPublishDefaultJiraKey, loadPublishDefaults, syncPublishJiraSiteFromIssue, getLlmProviderForRequest, getLlmDisabledForRequest, getBedrockModelTierForRequest } from "./ConnectorsStatus.jsx";
import { exportAgentOutput } from "./agentExport.js";
import { buildShareSubjectLine } from "./shareSubject.js";
import { buildAgentPrefaceContext } from "./agentContextPipeline.js";

// ── Domains (Feedback 2) ─────────────────────────────────────────────────────
const DOMAINS = [
  { id: "switch", label: "Switch", icon: "🔀", color: "#e8b84b" },
  { id: "pms", label: "PMS", icon: "👤", color: "#60a5fa" },
  { id: "compliance", label: "Compliance", icon: "🛡️", color: "#fbbf24" },
  { id: "refund", label: "Refund", icon: "↩️", color: "#f87171" },
  { id: "reconciliation", label: "Reconciliation", icon: "⚖️", color: "#a78bfa" },
  { id: "payout", label: "Payout", icon: "💸", color: "#34d399" },
  { id: "combination", label: "Combination", icon: "🔗", color: "#fb923c" },
  { id: "app", label: "App", icon: "📱", color: "#38bdf8" },
  { id: "mis", label: "MIS", icon: "📊", color: "#c084fc" },
  { id: "all", label: "All", icon: "🌐", color: "#94a3b8" },
];

const BRD_SYSTEM = `You are a senior BRD specialist for UPI/payment switch systems at a major Indian fintech. Generate a comprehensive, production-grade BRD in the following exact 24-section format. Use markdown with ## for section headers. Use markdown tables (| col | col |) for structured data. Be exhaustive — engineering teams must be able to implement from this BRD without further clarification.

SECTIONS TO INCLUDE:
## 1. Document Metadata
Table: Feature Name, Domain, Date, Version, Author, Status, JIRA ID

## 2. Executive Summary
3-4 sentences: what it does, why needed, what changes in system.

## 3. Regulatory / Compliance Reference
Table: Reference | Description | Circular ID | Deadline

## 4. Problem Statement
Bullet list of current problems.

## 5. Objective
Bullet list of goals.

## 6. Scope
In Scope bullets. Out of Scope bullets.

## 7. Terminology
Table: Term | Meaning

## 8. System Architecture Overview
Components involved, their roles.

## 9. Transaction Lifecycle
Numbered step-by-step flow.

## 10. Current Flow (AS-IS)
Describe current behavior with flow arrows.

## 11. Proposed Flow (TO-BE)
New behavior with step-by-step validation logic.

## 12. Business Rules
Table: Rule ID | Rule Description

## 13. API Behaviour
Table: API Name | Current Behaviour | New Behaviour | Parameters Affected

## 14. Error Code Mapping
Table: Scenario | Error Code | Source | Message

## 15. Edge Case Handling
Table: Scenario | Current Behaviour | Expected Behaviour

## 16. Reconciliation Impact
Whether debit/credit/settlement/recon entries occur for blocked transactions.

## 17. Risk Assessment
Table: Risk | Likelihood | Impact | Mitigation

## 18. Monitoring & Metrics
Metrics to track. Alerts to configure.

## 19. Configuration Management
Table: Config Key | Purpose | Default Value | Type

## 20. UAT Test Scenarios
Table: Test ID | Scenario | Input | Expected Output

## 21. Rollout Strategy
Phased rollout plan.

## 22. Rollback Plan
How to revert if issues arise.

## 23. Success Metrics
Measurable success criteria.

## 24. Failure Scenario Matrix
Table: Failure Point | System Behaviour | Customer Impact | Recovery Action

Be thorough. Tables should have 4-8 rows minimum where applicable. This BRD will be reviewed by NPCI compliance teams.`;

const CLARIFY_SYSTEM = `You are a BRD expert for fintech and UPI payment systems. Based on the requirement, generate exactly 6 targeted clarification questions that would significantly improve the BRD quality. Focus on regulatory, technical, reconciliation, and edge case gaps. Return ONLY a JSON array of 6 strings. No other text.`;

const HISTORY_KEY = "brdforge-history-v2";
function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
function saveHistoryLS(h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50))); } catch {} }

const FEEDBACK_MEM_KEY = "brdforge-feedback-memory";
function loadFeedbackMemory() { try { return JSON.parse(localStorage.getItem(FEEDBACK_MEM_KEY) || "[]"); } catch { return []; } }
function saveFeedbackMemory(m) { try { localStorage.setItem(FEEDBACK_MEM_KEY, JSON.stringify(m.slice(0, 20))); } catch {} }

// ── LLM call (same API as PRD/UAT) ──────────────────────────────────────────
async function callLLM(systemPrompt, userMessage, maxTokens = 8000, prefaceContext = "") {
  const pc = typeof prefaceContext === "string" ? prefaceContext.trim() : "";
  const res = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: maxTokens,
      llmProvider: getLlmProviderForRequest(),
      llmDisabled: getLlmDisabledForRequest(),
      bedrockModelTier: getBedrockModelTierForRequest(),
      ...(pc ? { prefaceContext: pc } : {}),
    }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok || data.error) throw new Error(data.message || data.error?.message || `Request failed: ${res.status}`);
  const payload = data.data ?? data;
  const blocks = payload?.content;
  if (!Array.isArray(blocks)) throw new Error("Unexpected LLM response shape");
  return blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
}

// ── JIRA: extract issue key from URL or plain key ────────────────────────────
function parseJiraIssueKey(input) {
  const s = (input || "").trim();
  if (!s) return "";
  // Match JIRA issue key (PROJECT-NUMBER) anywhere in the string
  const keyMatch = s.match(/\b([A-Z][A-Z0-9]*-\d+)\b/i);
  if (keyMatch) return keyMatch[1].toUpperCase();
  // From URL path: .../browse/TSP-1889 or .../TSP-1889
  try {
    const url = new URL(s.startsWith("http") ? s : "https://host/" + s);
    const segments = (url.pathname || "").split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && /^[A-Z0-9]+-\d+$/i.test(last)) return last.toUpperCase();
  } catch (_) {}
  return "";
}

// ── JIRA fetch via server proxy ──────────────────────────────────────────────
async function fetchJiraIssue(issueKeyOrUrl) {
  const raw = String(issueKeyOrUrl || "").trim();
  const defs = loadPublishDefaults();
  const site = defs.jiraWriteSite;
  const siteQs = site && site !== "auto" ? `?site=${encodeURIComponent(site)}` : "";
  const key = encodeURIComponent(raw);
  const r = await fetch(`${API_BASE}/api/jira-issue/${key}${siteQs}`, {
    headers: { Accept: "application/json" },
  });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch (_) {
    if (text.trimStart().startsWith("<")) throw new Error("Server returned a page (check issue key and server). Use e.g. TSP-1889 or paste JIRA browse URL.");
    throw new Error(text || `JIRA error ${r.status}`);
  }
  if (!r.ok) throw new Error(d.error || `JIRA error ${r.status}`);
  return d;
}

// ── Markdown renderer ────────────────────────────────────────────────────────
function renderBRDMarkdown(md) {
  if (!md) return null;
  const lines = md.split("\n");
  const elements = [];
  let tableRows = [];
  let key = 0;

  function flushTable() {
    if (tableRows.length < 2) { tableRows = []; return; }
    const headers = tableRows[0].split("|").map((h) => h.trim()).filter(Boolean);
    const body = tableRows.slice(2);
    elements.push(
      <table key={key++} style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 12 }}>
        <thead>
          <tr>{headers.map((h, i) => <th key={i} style={{ background: "#111827", color: "#a89fff", padding: "7px 11px", textAlign: "left", fontWeight: 600, border: "1px solid #1E293B", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, ri) => {
            const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
            return cells.length ? <tr key={ri}>{cells.map((c, ci) => <td key={ci} style={{ padding: "7px 11px", border: "1px solid #1E293B", color: "#94A3B8", verticalAlign: "top" }}>{c}</td>)}</tr> : null;
          })}
        </tbody>
      </table>
    );
    tableRows = [];
  }

  lines.forEach((line) => {
    if (line.startsWith("## ") || line.startsWith("# ")) {
      flushTable();
      const title = line.replace(/^#+\s/, "");
      const numMatch = title.match(/^(\d+)\.\s*(.*)/);
      elements.push(
        <div key={key++} style={{ fontSize: 14, fontWeight: 700, color: "#a89fff", padding: "6px 0", margin: "20px 0 10px", borderBottom: "1px solid #1E293B", display: "flex", alignItems: "center", gap: 8 }}>
          {numMatch && <span style={{ fontSize: 10, background: "#1E293B", border: "1px solid #1E3A5F", color: "#a89fff", padding: "2px 6px", borderRadius: 6 }}>{numMatch[1]}</span>}
          {numMatch ? numMatch[2] : title}
        </div>
      );
    } else if (line.startsWith("|")) {
      tableRows.push(line);
    } else {
      flushTable();
      if (line.startsWith("- ") || line.startsWith("* ")) {
        elements.push(<p key={key++} style={{ fontSize: 13, color: "#9e9ab0", marginBottom: 4, paddingLeft: 12 }}>▸ {line.replace(/^[-*]\s/, "")}</p>);
      } else if (line.trim()) {
        elements.push(<p key={key++} style={{ fontSize: 13, color: "#9e9ab0", marginBottom: 8, lineHeight: 1.7 }}>{line}</p>);
      }
    }
  });
  flushTable();
  return elements;
}

// ── Spinner ──────────────────────────────────────────────────────────────────
function Spinner() {
  return <div style={{ width: 16, height: 16, border: "2px solid #1E293B", borderTop: "2px solid #7c6fff", borderRadius: "50%", animation: "spin .7s linear infinite", flexShrink: 0 }} />;
}

// ── Main BRD Agent ───────────────────────────────────────────────────────────
export default function BRDAgent() {
  const [phase, setPhase] = useState("input"); // input | clarify | generating | output | feedback
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  // Input
  const [jiraId, setJiraId] = useState("");
  const [jiraData, setJiraData] = useState(null);
  const [subject, setSubject] = useState("");
  const [domain, setDomain] = useState("switch");
  const [description, setDescription] = useState("");
  const [ac, setAc] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [askQ, setAskQ] = useState(true);

  // Clarify
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});

  // Output
  const [brdRaw, setBrdRaw] = useState("");
  const [copyDone, setCopyDone] = useState(false);

  // History
  const [history, setHistory] = useState(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);

  // Feedback (Feedback 4)
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackUploading, setFeedbackUploading] = useState(false);
  const [feedbackMemory, setFeedbackMemory] = useState(() => loadFeedbackMemory());

  // Auto-publish after generation (session option)
  const [autoPublishChannels, setAutoPublishChannels] = useState({ jira: false, telegram: false, email: false, slack: false });
  const [allowAutoPublish, setAllowAutoPublish] = useState(false);
  const [contextStage, setContextStage] = useState(null);

  const fileRef = useRef();
  const feedbackFileRef = useRef();
  const hasSentNotifyRef = useRef(false);

  useEffect(() => { saveHistoryLS(history); }, [history]);
  useEffect(() => { saveFeedbackMemory(feedbackMemory); }, [feedbackMemory]);
  useEffect(() => {
    const onImport = () => {
      setHistory(loadHistory());
      setFeedbackMemory(loadFeedbackMemory());
    };
    window.addEventListener("agent-localstorage-imported", onImport);
    return () => window.removeEventListener("agent-localstorage-imported", onImport);
  }, []);

  // ── JIRA fetch ──
  const handleFetchJira = async () => {
    const raw = jiraId.trim();
    if (!raw) { setError("Enter a JIRA issue key or paste a JIRA browse URL."); return; }
    const issueKey = parseJiraIssueKey(raw);
    if (!issueKey && !/atlassian\.net/i.test(raw)) {
      setError("Could not find a JIRA issue key (e.g. TSP-1889). Paste the key or a full browse URL.");
      return;
    }
    setLoading(true); setError(""); setStatusMsg("Fetching JIRA issue…");
    try {
      const data = await fetchJiraIssue(raw);
      setJiraData(data);
      if (data.summary) setSubject(data.summary);
      if (data.description) setDescription(data.description);
      if (data.acceptanceCriteria) setAc(data.acceptanceCriteria);
      syncPublishDefaultJiraKey(data.id || issueKey);
      syncPublishJiraSiteFromIssue(data);
      setStatusMsg("");
    } catch (e) { setError("JIRA: " + e.message); }
    setLoading(false);
  };

  // ── File attach ──
  const handleFiles = (e) => {
    Array.from(e.target.files).forEach((f) => {
      const reader = new FileReader();
      reader.onload = (ev) => setAttachments((prev) => [...prev, { name: f.name, content: ev.target.result.slice(0, 4000) }]);
      reader.readAsText(f);
    });
    e.target.value = "";
  };

  const loadPreface = async (queryText) => {
    const histLines = history.slice(0, 4).map((h) => `BRD: ${h.subject || "Untitled"} — ${h.jiraId || ""}`);
    try {
      return await buildAgentPrefaceContext({
        apiBase: API_BASE,
        query: queryText,
        historyLines: histLines,
        onStep: (s) => setContextStage(s),
      });
    } finally {
      setContextStage(null);
    }
  };

  // ── Build context ──
  const buildContext = () => {
    let ctx = `Feature: ${subject}\nDomain: ${DOMAINS.find((d) => d.id === domain)?.label || domain}\nJIRA ID: ${jiraId || "N/A"}\n\nDescription:\n${description || "(Not provided)"}\n\nAcceptance Criteria:\n${ac || "(Not provided)"}`;
    if (jiraData) ctx += `\n\nJIRA Data:\n- Status: ${jiraData.status}\n- Reporter: ${jiraData.reporter}\n- Components: ${jiraData.components}\n- Labels: ${jiraData.labels}\n- Comments: ${jiraData.comments}`;
    if (attachments.length) ctx += "\n\n" + attachments.map((a) => `--- Attachment: ${a.name} ---\n${a.content}`).join("\n");
    if (feedbackMemory.length) ctx += "\n\nPREVIOUS FEEDBACK TO REMEMBER:\n" + feedbackMemory.map((f) => `- ${f}`).join("\n");
    return ctx;
  };

  // ── Step 1 → Clarify or Generate ──
  const handleProceed = async () => {
    if (!subject.trim() && !description.trim()) { setError("Enter a Feature Name or Description."); return; }
    setError(""); setLoading(true);
    if (askQ) {
      setStatusMsg("Analyzing inputs & generating questions…");
      try {
        const ctx = buildContext();
        const pf = await loadPreface(ctx.slice(0, 3000));
        const raw = await callLLM(CLARIFY_SYSTEM, ctx, 1000, pf);
        let qs = [];
        try { qs = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch { qs = []; }
        if (!Array.isArray(qs) || qs.length === 0) qs = ["What NPCI circular mandates this change?", "Which error codes should be returned?", "How should in-flight transactions be handled?", "What monitoring alerts should trigger rollback?", "Which domains/services are affected?", "How does this interact with UPI Lite or AutoPay?"];
        setQuestions(qs);
        setAnswers({});
        setPhase("clarify");
        setStatusMsg("");
      } catch (e) { setError("Error: " + e.message); }
    } else {
      await generateBRD();
    }
    setLoading(false);
  };

  // ── Generate BRD ──
  const generateBRD = async (extraCtx = "") => {
    setPhase("generating"); setLoading(true); setStatusMsg("Generating comprehensive BRD…");
    try {
      let ctx = buildContext();
      const qaCtx = questions.length > 0 ? "\n\nClarification Q&A:\n" + questions.map((q, i) => answers[i] ? `Q: ${q}\nA: ${answers[i]}` : "").filter(Boolean).join("\n\n") : "";
      ctx += qaCtx + extraCtx;
      const pf = await loadPreface(ctx.slice(0, 3000));
      const raw = await callLLM(BRD_SYSTEM, ctx, 8000, pf);
      setBrdRaw(raw);
      const entry = { subject: subject || "Untitled", domain: DOMAINS.find((d) => d.id === domain)?.label || domain, jiraId, date: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }), brd: raw };
      setHistory((prev) => [entry, ...prev].slice(0, 50));
      setPhase("output");
      setStatusMsg("");
      void exportAgentOutput({
        agent: "BRD",
        jiraId: parseJiraIssueKey(jiraId) || jiraId || "NOJIRA",
        subject: subject || "BRD",
        content: raw,
      });
      setAllowAutoPublish(true);
      if (!hasSentNotifyRef.current) {
        hasSentNotifyRef.current = true;
        await sendCompletionNotify({
          agentName: "BRD Agent",
          identifier: jiraId || subject || "BRD",
          notifySubject: buildShareSubjectLine("brd", parseJiraIssueKey(jiraId), subject || "BRD"),
        });
      }
    } catch (e) { setError("Error: " + e.message); setPhase("input"); }
    setLoading(false);
  };

  // ── Feedback (Feedback 4) ──
  const handleFeedbackDocx = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    setFeedbackUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/api/extract-docx`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Extract failed");
      setFeedbackText((prev) => (prev ? prev + "\n\n" : "") + `[From ${file.name}]\n${data.text || ""}`);
    } catch (err) { setError("DOCX extract: " + err.message); }
    setFeedbackUploading(false);
    e.target.value = "";
  };

  const handleApplyFeedback = async () => {
    if (!feedbackText.trim()) { setError("Enter feedback or upload a document."); return; }
    setLoading(true); setStatusMsg("Improving BRD with feedback…");
    try {
      const improvePrompt = `You have an existing BRD. Apply the following feedback to improve it.\n\nFEEDBACK:\n${feedbackText}\n\nEXISTING BRD:\n${brdRaw.slice(0, 24000)}\n\nGenerate the FULL improved 24-section BRD. Apply all feedback. Return the complete BRD in markdown. Do NOT truncate or shorten any section.`;
      const pf = await loadPreface(improvePrompt.slice(0, 3000));
      const improved = await callLLM(BRD_SYSTEM, improvePrompt, 16000, pf);
      setBrdRaw(improved);
      const newMem = [...feedbackMemory, feedbackText.trim().slice(0, 200)].slice(-20);
      setFeedbackMemory(newMem);
      setHistory((prev) => {
        const updated = [...prev];
        if (updated.length > 0) updated[0] = { ...updated[0], brd: improved };
        return updated;
      });
      setFeedbackText("");
      setStatusMsg("");
      setAllowAutoPublish(true);
      if (!hasSentNotifyRef.current) {
        hasSentNotifyRef.current = true;
        await sendCompletionNotify({
          agentName: "BRD Agent",
          identifier: jiraId || subject || "BRD",
          notifySubject: buildShareSubjectLine("brd", parseJiraIssueKey(jiraId), (subject || "BRD") + "-revised"),
        });
      }
    } catch (e) { setError("Error: " + e.message); }
    setLoading(false);
  };

  // ── Copy / Download ──
  const handleCopy = () => {
    navigator.clipboard.writeText(brdRaw).then(() => { setCopyDone(true); setTimeout(() => setCopyDone(false), 2000); });
  };
  const handleDownload = () => {
    const fname = `BRD_${(subject || "document").replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "")}_${new Date().toISOString().split("T")[0]}.md`;
    const blob = new Blob([brdRaw], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
  };

  // ── Reset ──
  const reset = () => {
    setPhase("input"); setJiraId(""); setJiraData(null); setSubject(""); setDomain("switch"); setDescription(""); setAc(""); setAttachments([]); setQuestions([]); setAnswers({}); setBrdRaw(""); setError(""); setFeedbackText(""); setAutoPublishChannels({ jira: false, telegram: false, email: false, slack: false });
    setAllowAutoPublish(false);
  };

  const loadHistoryItem = (item) => {
    setAllowAutoPublish(false);
    setBrdRaw(item.brd);
    setSubject(item.subject || "");
    setJiraId(item.jiraId || "");
    setPhase("output");
    setShowHistory(false);
  };

  const C = { bg: "#0B1120", bg2: "#0D1626", bg3: "#111827", border: "#1E293B", border2: "#1E3A5F", purple: "#7c6fff", purpleLight: "#a89fff", green: "#4ADE80", amber: "#F59E0B", red: "#EF4444", text: "#F1F5F9", text2: "#94A3B8", text3: "#475569" };

  return (
    <div style={{ fontFamily: "'Inter','Segoe UI',sans-serif", background: C.bg, minHeight: "100vh", color: C.text }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}`}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 24px", background: C.bg2, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg,#7c6fff,#5a4fe0)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff" }}>BF</div>
          <div><span style={{ fontSize: 18, fontWeight: 700 }}>BRD</span><span style={{ fontSize: 18, fontWeight: 700, color: C.purpleLight }}>Forge</span></div>
        </div>
        <span style={{ fontSize: 11, background: "rgba(120,100,255,0.15)", border: `1px solid ${C.border2}`, color: C.purpleLight, borderRadius: 12, padding: "3px 9px" }}>v2.0</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setShowHistory((s) => !s)} style={{ padding: "7px 14px", borderRadius: 10, fontSize: 12, fontWeight: 500, cursor: "pointer", border: `1px solid ${C.border2}`, background: "transparent", color: C.text2, fontFamily: "inherit" }}>
            📋 History ({history.length})
          </button>
          <button type="button" onClick={reset} style={{ padding: "7px 14px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", background: C.purple, color: "#fff", fontFamily: "inherit" }}>+ New BRD</button>
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "24px 20px 100px" }}>

        {error && <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(255,95,95,0.1)", border: "1px solid rgba(255,95,95,0.3)", borderRadius: 10, color: C.red, fontSize: 12 }}>{error}</div>}
        {contextStage && (
          <div style={{ marginBottom: 16, padding: "10px 14px", background: "#0C1A2E", border: "1px solid #1E3A5F", borderRadius: 10, display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#93C5FD" }}>
            <Spinner />
            <div>
              <div style={{ fontWeight: 700, color: "#E0F2FE" }}>Context pipeline</div>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{contextStage.label}</div>
            </div>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 0.6 }}>{contextStage.step}</span>
          </div>
        )}

        {/* ── PHASE: INPUT ── */}
        {phase === "input" && (
          <div style={{ animation: "fadeUp .4s ease" }}>
            {/* JIRA */}
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: "linear-gradient(135deg,#0052cc,#2684ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff" }}>J</div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>JIRA Connector</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={jiraId} onChange={(e) => setJiraId(e.target.value)} onBlur={() => { const k = parseJiraIssueKey(jiraId); if (k) syncPublishDefaultJiraKey(k); }} onKeyDown={(e) => e.key === "Enter" && handleFetchJira()} placeholder="e.g. TSP-1889 or paste JIRA browse URL" style={{ flex: 1, background: C.bg3, border: `1px solid ${C.border2}`, color: C.text, fontSize: 13, padding: "8px 11px", borderRadius: 10, fontFamily: "inherit" }} />
                <button type="button" onClick={handleFetchJira} disabled={loading} style={{ padding: "8px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", background: "rgba(79,163,227,0.1)", color: "#4fa3e3", fontFamily: "inherit" }}>↓ Fetch</button>
              </div>
              {jiraData && (
                <div style={{ marginTop: 10, padding: 12, background: C.bg3, borderRadius: 10, fontSize: 12, color: C.text2 }}>
                  <div style={{ color: C.green, fontWeight: 600, marginBottom: 6 }}>✓ JIRA fetched & auto-populated</div>
                  <div>ID: {jiraData.id} · Status: {jiraData.status} · Reporter: {jiraData.reporter}</div>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 11, color: C.text3 }}>Use Fetch to pull summary, description & acceptance criteria from JIRA into this form (input). Other connectors (Slack, Telegram, etc.) show status in the top bar; configure in .env and use for future integrations.</div>
            </div>

            {/* Main input */}
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(120,100,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: C.purpleLight, fontSize: 13 }}>1</div>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Requirement Input</span>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Feature Name / Subject</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Block P2M collect on Android" style={{ width: "100%", marginTop: 5, background: C.bg3, border: `1px solid ${C.border2}`, color: C.text, fontSize: 13, padding: "9px 11px", borderRadius: 10, fontFamily: "inherit" }} />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Domain</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {DOMAINS.map((d) => (
                    <button key={d.id} onClick={() => setDomain(d.id)} style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer", border: `1px solid ${domain === d.id ? d.color : C.border2}`, background: domain === d.id ? `${d.color}22` : "transparent", color: domain === d.id ? d.color : C.text2, fontFamily: "inherit", fontWeight: domain === d.id ? 600 : 400 }}>
                      {d.icon} {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Paste JIRA description, requirement, or any context here." rows={5} style={{ width: "100%", marginTop: 5, background: C.bg3, border: `1px solid ${C.border2}`, color: C.text, fontSize: 13, padding: "9px 11px", borderRadius: 10, fontFamily: "inherit", resize: "vertical" }} />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Acceptance Criteria</label>
                <textarea value={ac} onChange={(e) => setAc(e.target.value)} placeholder="What are the conditions for acceptance?" rows={3} style={{ width: "100%", marginTop: 5, background: C.bg3, border: `1px solid ${C.border2}`, color: C.text, fontSize: 13, padding: "9px 11px", borderRadius: 10, fontFamily: "inherit", resize: "vertical" }} />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Attach Files</label>
                <div style={{ marginTop: 6 }}>
                  <button type="button" onClick={() => fileRef.current?.click()} style={{ background: C.bg3, border: `1.5px dashed ${C.border2}`, borderRadius: 10, padding: "10px 16px", color: C.text3, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>📎 Click to attach (.txt .md .csv .json)</button>
                  <input ref={fileRef} type="file" multiple accept=".txt,.md,.csv,.json,.xml" style={{ display: "none" }} onChange={handleFiles} />
                </div>
                {attachments.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                    {attachments.map((f, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(62,207,142,0.1)", color: C.green, borderRadius: 10, fontSize: 12, padding: "4px 10px" }}>
                        {f.name} <span onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} style={{ cursor: "pointer", color: C.text3 }}>×</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 14px", background: C.bg3, borderRadius: 10 }}>
                <span style={{ fontSize: 12, color: C.text3 }}>Ask clarifying questions</span>
                <div onClick={() => setAskQ(!askQ)} style={{ width: 36, height: 20, borderRadius: 10, background: askQ ? C.purple : C.bg3, position: "relative", cursor: "pointer", border: `1px solid ${C.border2}`, transition: "background .2s", flexShrink: 0 }}>
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: askQ ? 18 : 2, transition: "left .2s" }} />
                </div>
              </div>

              <div style={{ marginBottom: 14, padding: "10px 14px", background: C.bg3, borderRadius: 10, border: `1px solid ${C.border2}` }}>
                <div style={{ fontSize: 11, color: C.text3, fontWeight: 600, marginBottom: 8 }}>After generation, auto-publish to</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {["jira", "telegram", "email", "slack"].map((ch) => (
                    <label key={ch} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: C.text2 }}>
                      <input type="checkbox" checked={!!autoPublishChannels[ch]} onChange={(e) => setAutoPublishChannels((p) => ({ ...p, [ch]: e.target.checked }))} />
                      {ch === "jira" && "JIRA"}
                      {ch === "telegram" && "Telegram"}
                      {ch === "email" && "Email"}
                      {ch === "slack" && "Slack"}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>Set default destinations in Connectors (top bar).</div>
              </div>

              {feedbackMemory.length > 0 && (
                <div style={{ padding: "10px 14px", background: "rgba(62,207,142,0.08)", border: "1px solid rgba(62,207,142,0.2)", borderRadius: 10, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: C.green, fontWeight: 600, marginBottom: 4 }}>🧠 {feedbackMemory.length} feedback item{feedbackMemory.length > 1 ? "s" : ""} remembered from previous BRDs</div>
                  <div style={{ fontSize: 11, color: C.text3 }}>These will be applied to the next BRD automatically.</div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" onClick={handleProceed} disabled={loading} style={{ padding: "11px 28px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", border: "none", background: loading ? C.bg3 : C.purple, color: loading ? C.text3 : "#fff", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
                  {loading ? <><Spinner /> {statusMsg}</> : "Gather & Generate →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── PHASE: CLARIFY ── */}
        {phase === "clarify" && (
          <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 16, animation: "fadeUp .4s ease" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(245,166,35,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: C.amber, fontSize: 13 }}>?</div>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Clarification Questions</span>
              <span style={{ fontSize: 11, color: C.text3 }}>Optional — improves BRD quality</span>
            </div>
            {questions.map((q, i) => (
              <div key={i} style={{ background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 8 }}>Q{i + 1}: {q}</div>
                <textarea value={answers[i] || ""} onChange={(e) => setAnswers((prev) => ({ ...prev, [i]: e.target.value }))} placeholder="Your answer (leave blank to skip)…" rows={2} style={{ width: "100%", background: "#252535", border: `1px solid ${C.border2}`, color: C.text, fontSize: 13, padding: "8px 10px", borderRadius: 10, fontFamily: "inherit", resize: "vertical" }} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" onClick={() => generateBRD()} disabled={loading} style={{ padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: `1px solid ${C.border2}`, background: "transparent", color: C.text2, fontFamily: "inherit" }}>Skip All & Generate</button>
              <button type="button" onClick={() => generateBRD()} disabled={loading} style={{ padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none", background: C.purple, color: "#fff", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
                {loading ? <><Spinner /> {statusMsg}</> : "Generate BRD →"}
              </button>
            </div>
          </div>
        )}

        {/* ── PHASE: GENERATING ── */}
        {phase === "generating" && (
          <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, display: "flex", alignItems: "center", gap: 14 }}>
            <Spinner />
            <span style={{ fontSize: 14, color: C.text2 }}>{statusMsg || "Generating…"}</span>
          </div>
        )}

        {/* ── PHASE: OUTPUT ── */}
        {(phase === "output" || brdRaw) && phase !== "input" && phase !== "clarify" && phase !== "generating" && (
          <div>
            {/* Action bar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, background: "rgba(62,207,142,0.1)", color: C.green, borderRadius: 12, padding: "3px 9px", fontWeight: 500 }}>BRD Ready</span>
              <button type="button" onClick={handleCopy} style={{ marginLeft: "auto", padding: "9px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1px solid ${C.border2}`, background: "transparent", color: copyDone ? C.green : C.text2, fontFamily: "inherit" }}>{copyDone ? "✓ Copied!" : "⎘ Copy Markdown"}</button>
              <button type="button" onClick={handleDownload} style={{ padding: "9px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1px solid ${C.border2}`, background: "transparent", color: C.text2, fontFamily: "inherit" }}>↓ Download .md</button>
              <button type="button" onClick={reset} style={{ padding: "9px 16px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none", background: C.purple, color: "#fff", fontFamily: "inherit" }}>+ New BRD</button>
            </div>

            {/* BRD document */}
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: "28px 32px", marginBottom: 20 }}>
              {renderBRDMarkdown(brdRaw)}
            </div>

            {brdRaw && (
              <ShareAndScore
                docType="brd"
                title={subject || "BRD"}
                jiraKey={parseJiraIssueKey(jiraId) || ""}
                content={brdRaw}
                autoPublish={allowAutoPublish ? Object.keys(autoPublishChannels).filter((k) => autoPublishChannels[k]) : []}
              />
            )}

            {/* Feedback section (Feedback 4) */}
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span style={{ fontSize: 16 }}>💬</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Improve BRD with Feedback</div>
                  <div style={{ fontSize: 11, color: C.text3 }}>Paste feedback or upload a .docx. This feedback is remembered for future BRDs.</div>
                </div>
              </div>
              <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder="Paste your feedback here, or upload a .docx below…" rows={4} style={{ width: "100%", background: C.bg3, border: `1px solid ${C.border2}`, color: C.text, fontSize: 13, padding: "9px 11px", borderRadius: 10, fontFamily: "inherit", resize: "vertical", marginBottom: 10 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input ref={feedbackFileRef} type="file" accept=".docx" style={{ display: "none" }} onChange={handleFeedbackDocx} />
                <button type="button" onClick={() => feedbackFileRef.current?.click()} disabled={feedbackUploading} style={{ background: C.bg3, border: `1px solid ${C.border2}`, borderRadius: 10, padding: "7px 14px", color: "#4fa3e3", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  {feedbackUploading ? "… Extracting…" : "📎 Upload .docx"}
                </button>
                <div style={{ marginLeft: "auto" }}>
                  <button type="button" onClick={handleApplyFeedback} disabled={loading || !feedbackText.trim()} style={{ padding: "10px 22px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: !feedbackText.trim() || loading ? "not-allowed" : "pointer", border: "none", background: !feedbackText.trim() || loading ? C.bg3 : C.purple, color: !feedbackText.trim() || loading ? C.text3 : "#fff", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
                    {loading ? <><Spinner /> {statusMsg}</> : "✨ Apply Feedback & Improve"}
                  </button>
                </div>
              </div>
              {feedbackMemory.length > 0 && (
                <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(62,207,142,0.08)", border: "1px solid rgba(62,207,142,0.2)", borderRadius: 10 }}>
                  <div style={{ fontSize: 11, color: C.green, fontWeight: 600, marginBottom: 4 }}>🧠 Remembered Feedback ({feedbackMemory.length})</div>
                  {feedbackMemory.map((f, i) => <div key={i} style={{ fontSize: 11, color: C.text3, marginBottom: 2 }}>• {f.slice(0, 100)}{f.length > 100 ? "…" : ""}</div>)}
                  <button type="button" onClick={() => { setFeedbackMemory([]); }} style={{ marginTop: 6, background: "none", border: `1px solid rgba(255,95,95,0.3)`, borderRadius: 8, padding: "3px 10px", color: C.red, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Clear memory</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* History drawer */}
      {showHistory && (
        <>
          <div onClick={() => setShowHistory(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 99 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 400, background: C.bg2, borderLeft: `1px solid ${C.border}`, zIndex: 100, display: "flex", flexDirection: "column", animation: "fadeUp .25s ease" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>📋 BRD History</span>
              <button type="button" onClick={() => setShowHistory(false)} style={{ background: C.bg3, border: "none", borderRadius: 8, width: 28, height: 28, color: C.text2, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "12px 14px" }}>
              {history.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: C.text3 }}>No BRDs yet</div>
              ) : history.map((item, i) => (
                <div key={i} onClick={() => loadHistoryItem(item)} style={{ background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 }}>{item.subject || "Untitled"}</div>
                  <div style={{ fontSize: 11, color: C.text3 }}>{item.domain} · {item.date} {item.jiraId && `· ${item.jiraId}`}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
