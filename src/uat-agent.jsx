import { useState, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const MODELS = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4.6", provider: "Anthropic", color: "#d97706" },
  { id: "claude-opus-4-20250514",   label: "Claude Opus 4.6",   provider: "Anthropic", color: "#b45309" },
  { id: "gpt-4o",                   label: "GPT-4o",            provider: "OpenAI",    color: "#10a37f" },
  { id: "gpt-4-turbo",              label: "GPT-4 Turbo",       provider: "OpenAI",    color: "#10a37f" },
  { id: "gemini-1.5-pro",           label: "Gemini 1.5 Pro",    provider: "Google",    color: "#4285f4" },
  { id: "deepseek-chat",            label: "DeepSeek Chat",     provider: "DeepSeek",  color: "#7c3aed" },
];

const DOMAINS = [
  { id: "pms",            label: "PMS",            full: "Profile Management System",  icon: "👤", color: "#3b82f6" },
  { id: "switch",         label: "Switch",          full: "Transactional Switch",        icon: "🔀", color: "#d97706" },
  { id: "refund",         label: "Refund",          full: "Refund Service",              icon: "↩️", color: "#ef4444" },
  { id: "reconciliation", label: "Reconciliation",  full: "Reconciliation Service",      icon: "⚖️", color: "#8b5cf6" },
  { id: "payout",         label: "Payout",          full: "Payout Service",              icon: "💸", color: "#22c55e" },
  { id: "compliance",     label: "Compliance",      full: "Compliance Service",          icon: "🛡️", color: "#f59e0b" },
  { id: "mandates",       label: "Mandates",        full: "Mandates Service",            icon: "📋", color: "#06b6d4" },
  { id: "all",            label: "All Services",    full: "All Services",                icon: "🌐", color: "#94a3b8" },
];

const DEFAULT_MODEL = MODELS[0];

const buildSystemPrompt = (domains) => {
  const scopeList = domains.length > 0
    ? domains.map(d => `${d.full} (${d.label})`).join(", ")
    : "All Services";
  return `You are an expert UAT (User Acceptance Testing) Signoff Agent specializing in fintech, UPI, and payment systems.

SCOPE CONSTRAINT: This UAT is scoped to the following domain(s): ${scopeList}. Focus all analysis, test coverage assessment, risk identification, and signoff sections specifically on these domains. Do NOT expand scope beyond what is specified.

Your job is to analyze all provided UAT inputs (JIRA details, test cases, NPCI documents, logs, Excel/Word content, etc.) and produce a comprehensive, professional UAT Signoff document.

The UAT Signoff MUST include ALL these sections:
1️⃣ Document Header (Feature Name, JIRA ID, Environment, Release Version, Test Window, Tested By, Reviewed By, Signoff Authority, UAT Scope/Domain)
2️⃣ Objective of Testing
3️⃣ Scope of Testing (In Scope / Out of Scope table — constrained to: ${scopeList})
4️⃣ Test Execution Summary (Total, Passed, Failed, Blocked, Not Executed counts)
5️⃣ Acceptance Criteria Mapping (UAT Scenario, QA Test Case ID, Result, Remarks)
6️⃣ Defect / Gap Summary (Severity counts + gap table with Gap ID, Description, Severity, Impact, Recommendation)
7️⃣ Risk Assessment (Risk Area, Impact, Status)
8️⃣ Production Readiness Checklist (Validation Item, Status with check/warn/fail emoji)
9️⃣ UAT Final Decision (PASS / PASS WITH CONDITIONS / FAIL with justification)

Rules:
- Extract ALL data from provided documents/content — do not hallucinate numbers
- If data is missing for a section, note "Insufficient data provided — please supply [X]"
- Use markdown tables for all tabular sections
- Be precise, professional, and concise
- Flag gaps, risks, and defects clearly
- The final decision must be justified by the evidence
- Always include the selected domain scope in the Document Header under "UAT Scope"

Respond ONLY with the UAT Signoff document in clean markdown. Start with "# UAT SIGNOFF DOCUMENT" as the heading.`;
};

const CLARIFY_SYSTEM = `You are a UAT expert. The user has provided UAT input but wants clarification questions before generating the full signoff.

Analyze their input carefully and return ONLY a numbered list of 3-7 targeted clarifying questions that would significantly improve the UAT signoff quality. Focus on:
- Missing test case results or logs
- Unclear pass/fail criteria
- Missing environment or version info
- Ambiguous JIRA scope
- Gap in negative test scenarios

Format as a simple numbered list. Be concise and specific.`;

// ─── In-memory history ────────────────────────────────────────────────────────
let _history = [];
let _historyId = 1;
function saveHistory(entry) {
  _history.unshift({ id: _historyId++, ...entry, ts: new Date().toISOString() });
  return _history[0];
}

// ─── Utility: read files ─────────────────────────────────────────────────────
async function readFiles(fileList) {
  const arr = Array.from(fileList || []);
  const contents = [];
  for (const f of arr) {
    const text = await f.text().catch(() => `[Binary/unreadable file: ${f.name}]`);
    contents.push({ name: f.name, content: text.slice(0, 10000) });
  }
  return { files: arr, contents };
}

// ─── Shared sub-components ───────────────────────────────────────────────────
function Badge({ children, color = "#d97706" }) {
  return (
    <span style={{
      background: color + "22", color, border: `1px solid ${color}44`,
      borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap"
    }}>{children}</span>
  );
}

function ModelPicker({ selected, onChange }) {
  const [open, setOpen] = useState(false);
  const m = MODELS.find(x => x.id === selected) || DEFAULT_MODEL;
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: "#1a1a2e", border: "1px solid #2d2d4e", borderRadius: 8,
        color: "#e2e8f0", padding: "6px 14px", cursor: "pointer", display: "flex",
        alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, fontFamily: "inherit"
      }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: m.color, display: "inline-block", flexShrink: 0 }} />
        {m.label}
        <span style={{ marginLeft: 2, opacity: 0.5, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "110%", right: 0, background: "#12122a",
          border: "1px solid #2d2d4e", borderRadius: 10, zIndex: 200, minWidth: 230,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)", overflow: "hidden"
        }}>
          {MODELS.map(model => (
            <div key={model.id} onClick={() => { onChange(model.id); setOpen(false); }}
              style={{
                padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center",
                gap: 10, borderBottom: "1px solid #1e1e3a", fontSize: 13,
                background: selected === model.id ? "#1e1e3a" : "transparent", color: "#e2e8f0"
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#1e1e3a"}
              onMouseLeave={e => e.currentTarget.style.background = selected === model.id ? "#1e1e3a" : "transparent"}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: model.color, flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600 }}>{model.label}</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>{model.provider}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileChip({ file, onRemove }) {
  const ext = file.name.split(".").pop().toUpperCase();
  const colors = { PDF: "#ef4444", DOCX: "#3b82f6", XLSX: "#22c55e", XLS: "#22c55e", TXT: "#94a3b8", MD: "#a78bfa", CSV: "#f59e0b" };
  const c = colors[ext] || "#94a3b8";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: c + "15", border: `1px solid ${c}44`, borderRadius: 6, padding: "4px 10px", fontSize: 12
    }}>
      <span style={{ fontSize: 10, background: c + "33", padding: "1px 5px", borderRadius: 3, color: c, fontWeight: 700 }}>{ext}</span>
      <span style={{ color: "#cbd5e1", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
      <button onClick={onRemove} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 0, lineHeight: 1, fontSize: 15 }}>x</button>
    </div>
  );
}

function ModeTab({ modes, active, onChange }) {
  return (
    <div style={{ display: "inline-flex", background: "#1a1a2e", borderRadius: 8, border: "1px solid #2d2d4e", overflow: "hidden", marginBottom: 14 }}>
      {modes.map(m => (
        <button key={m.id} onClick={() => onChange(m.id)} style={{
          background: active === m.id ? "#d97706" : "transparent",
          color: active === m.id ? "#0a0a18" : "#64748b",
          border: "none", padding: "7px 18px", cursor: "pointer",
          fontSize: 12, fontWeight: 700, fontFamily: "inherit",
          letterSpacing: "0.04em", transition: "all 0.15s",
          display: "flex", alignItems: "center", gap: 6
        }}>
          {m.icon} {m.label}
        </button>
      ))}
    </div>
  );
}

function InputSection({ title, icon, badge, badgeColor, children }) {
  return (
    <div style={{ background: "#0d0d22", border: "1px solid #1e1e3a", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "11px 18px", borderBottom: "1px solid #1e1e3a", display: "flex", alignItems: "center", gap: 10, background: "#0a0a18" }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: "#f8fafc" }}>{title}</span>
        {badge && <Badge color={badgeColor}>{badge}</Badge>}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

function DomainSelector({ selected, onChange }) {
  const toggle = (id) => {
    if (id === "all") { onChange(selected.includes("all") ? [] : ["all"]); return; }
    const next = selected.filter(s => s !== "all");
    onChange(next.includes(id) ? next.filter(s => s !== id) : [...next, id]);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
      {DOMAINS.map(d => {
        const on = selected.includes(d.id);
        return (
          <button key={d.id} onClick={() => toggle(d.id)} style={{
            background: on ? d.color + "20" : "#1a1a2e",
            border: `2px solid ${on ? d.color : "#2d2d4e"}`,
            borderRadius: 9, padding: "9px 14px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 8, transition: "all 0.15s", fontFamily: "inherit",
            outline: "none"
          }}>
            <span style={{ fontSize: 16 }}>{d.icon}</span>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: on ? d.color : "#94a3b8", lineHeight: 1.3 }}>{d.label}</div>
              <div style={{ fontSize: 10, color: on ? d.color + "aa" : "#475569", lineHeight: 1.2 }}>{d.full}</div>
            </div>
            {on && <span style={{ marginLeft: 2, color: d.color, fontSize: 13 }}>✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function Dropzone({ fileRef, onDrop, onBrowse, files, onRemove, hint }) {
  const [dragging, setDragging] = useState(false);
  return (
    <>
      <div
        onClick={onBrowse}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); onDrop(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${dragging ? "#d97706" : "#2d2d4e"}`, borderRadius: 10,
          padding: "22px 16px", textAlign: "center", cursor: "pointer",
          background: dragging ? "#d9770608" : "transparent", transition: "all 0.2s"
        }}
      >
        <div style={{ fontSize: 26, marginBottom: 6 }}>📎</div>
        <div style={{ color: "#64748b", fontSize: 12 }}>
          Drop files here or <span style={{ color: "#d97706" }}>click to browse</span>
        </div>
        <div style={{ color: "#334155", fontSize: 11, marginTop: 3 }}>{hint || "PDF · DOCX · XLSX · TXT · CSV"}</div>
      </div>
      {files.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 7 }}>
          {files.map((f, i) => <FileChip key={i} file={f} onRemove={() => onRemove(i)} />)}
        </div>
      )}
    </>
  );
}

function formatInline(text) {
  return (text || "")
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#f8fafc">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em style="color:#94a3b8">$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:#1e1e3a;padding:1px 5px;border-radius:3px;font-family:monospace;color:#a78bfa;font-size:0.85em">$1</code>');
}

function MarkdownRenderer({ content }) {
  const lines = content.split("\n");
  let result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("|") && i + 1 < lines.length && lines[i + 1].match(/^\|[\s\-:|]+\|/)) {
      const headers = line.split("|").slice(1, -1).map(c => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i].split("|").slice(1, -1).map(c => c.trim()));
        i++;
      }
      result.push(`<div style="overflow-x:auto;margin:12px 0"><table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead><tr>${headers.map(h => `<th style="background:#1a1a2e;color:#fbbf24;padding:8px 12px;text-align:left;border:1px solid #2d2d4e;font-weight:700;white-space:nowrap">${formatInline(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r, ri) => `<tr style="background:${ri % 2 ? "#0a0a18" : "#0d0d22"}">${r.map(c => `<td style="padding:7px 12px;border:1px solid #1e1e3a;color:#cbd5e1;vertical-align:top">${formatInline(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>`);
      continue;
    }
    if (line.match(/^# /)) result.push(`<h1 style="font-size:1.35em;color:#f8fafc;border-bottom:2px solid #d97706;padding-bottom:8px;margin:24px 0 10px">${formatInline(line.slice(2))}</h1>`);
    else if (line.match(/^## /)) result.push(`<h2 style="font-size:1.05em;color:#fbbf24;margin:18px 0 7px;padding:6px 10px;background:#1a1a2e;border-left:3px solid #d97706;border-radius:0 4px 4px 0">${formatInline(line.slice(3))}</h2>`);
    else if (line.match(/^### /)) result.push(`<h3 style="font-size:0.95em;color:#e2e8f0;margin:12px 0 5px">${formatInline(line.slice(4))}</h3>`);
    else if (line.match(/^---+$/)) result.push(`<hr style="border:none;border-top:1px solid #1e1e3a;margin:16px 0">`);
    else if (line.trim() === "") result.push(`<div style="height:5px"></div>`);
    else result.push(`<p style="margin:3px 0;color:#cbd5e1;line-height:1.7;font-size:13px">${formatInline(line)}</p>`);
    i++;
  }
  return <div dangerouslySetInnerHTML={{ __html: result.join("") }} />;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function UATAgent() {
  const [view, setView] = useState("home");
  const [model, setModel] = useState(DEFAULT_MODEL.id);
  const [selectedDomains, setSelectedDomains] = useState([]);
  const [askQuestions, setAskQuestions] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState(null);
  const [clarifyQs, setClarifyQs] = useState(null);
  const [clarifyAnswers, setClarifyAnswers] = useState("");
  const [copiedResult, setCopiedResult] = useState(false);

  // JIRA
  const [jiraSubject, setJiraSubject] = useState("");
  const [jiraDesc, setJiraDesc] = useState("");
  const [jiraMode, setJiraMode] = useState("type");
  const [jiraFiles, setJiraFiles] = useState([]);
  const [jiraFileContents, setJiraFileContents] = useState([]);
  const jiraRef = useRef();

  // Test Cases
  const [testCases, setTestCases] = useState("");
  const [testMode, setTestMode] = useState("type");
  const [testFiles, setTestFiles] = useState([]);
  const [testFileContents, setTestFileContents] = useState([]);
  const testRef = useRef();

  // Supporting Docs
  const [extraContext, setExtraContext] = useState("");
  const [docsMode, setDocsMode] = useState("type");
  const [docsFiles, setDocsFiles] = useState([]);
  const [docsFileContents, setDocsFileContents] = useState([]);
  const docsRef = useRef();

  const addFiles = async (fileList, setFiles, setContents) => {
    const { files, contents } = await readFiles(fileList);
    setFiles(p => [...p, ...files]);
    setContents(p => [...p, ...contents]);
  };

  const removeFile = (idx, setFiles, setContents) => {
    setFiles(p => p.filter((_, i) => i !== idx));
    setContents(p => p.filter((_, i) => i !== idx));
  };

  const buildContext = () => {
    const domains = DOMAINS.filter(d => selectedDomains.includes(d.id));
    const scopeList = domains.length > 0 ? domains.map(d => d.full).join(", ") : "All Services";
    let ctx = `## UAT Scope / Domains\n${scopeList}\n\n`;
    if (jiraMode === "type") {
      if (jiraSubject) ctx += `## JIRA Subject / Feature Name\n${jiraSubject}\n\n`;
      if (jiraDesc) ctx += `## JIRA Description\n${jiraDesc}\n\n`;
    } else {
      jiraFileContents.forEach(f => { ctx += `## JIRA Upload: ${f.name}\n\`\`\`\n${f.content}\n\`\`\`\n\n`; });
    }
    if (testMode === "type") {
      if (testCases) ctx += `## QA Test Cases / Execution Logs\n${testCases}\n\n`;
    } else {
      testFileContents.forEach(f => { ctx += `## Test Cases Upload: ${f.name}\n\`\`\`\n${f.content}\n\`\`\`\n\n`; });
    }
    if (docsMode === "type") {
      if (extraContext) ctx += `## Supporting Context / NPCI Docs\n${extraContext}\n\n`;
    } else {
      docsFileContents.forEach(f => { ctx += `## Supporting Doc: ${f.name}\n\`\`\`\n${f.content}\n\`\`\`\n\n`; });
    }
    return ctx;
  };

  const hasInput = () => {
    if (jiraMode === "type" && (jiraSubject || jiraDesc)) return true;
    if (jiraMode === "upload" && jiraFiles.length > 0) return true;
    if (testMode === "type" && testCases) return true;
    if (testMode === "upload" && testFiles.length > 0) return true;
    if (docsMode === "type" && extraContext) return true;
    if (docsMode === "upload" && docsFiles.length > 0) return true;
    return false;
  };

  const callClaude = async (systemPrompt, userMessage) => {
    const tools = webSearch ? [{ type: "web_search_20250305", name: "web_search" }] : undefined;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        ...(tools ? { tools } : {})
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.content.map(b => b.type === "text" ? b.text : "").filter(Boolean).join("\n");
  };

  const runGenerate = async (withClarifications = false) => {
    if (!hasInput()) { setStatus("Please provide at least one input before generating."); return; }
    if (selectedDomains.length === 0) { setStatus("Please select at least one UAT domain scope."); return; }
    setLoading(true); setStatus("Analyzing UAT inputs...");
    try {
      const ctx = buildContext();
      let userMsg = withClarifications && clarifyAnswers.trim() ? ctx + `\n## Clarification Answers\n${clarifyAnswers}\n` : ctx;
      if (askQuestions && !withClarifications) {
        setStatus("Generating clarifying questions...");
        const qs = await callClaude(CLARIFY_SYSTEM, ctx);
        setClarifyQs(qs); setLoading(false); setStatus(""); return;
      }
      setStatus("Generating UAT Signoff document...");
      const domains = DOMAINS.filter(d => selectedDomains.includes(d.id));
      const signoff = await callClaude(buildSystemPrompt(domains), userMsg);
      const entry = saveHistory({
        jira: jiraSubject || jiraFiles[0]?.name || "Unnamed Session",
        model: MODELS.find(m => m.id === model)?.label || model,
        domains: domains.map(d => d.label),
        signoff
      });
      setResult({ signoff, id: entry.id });
      setView("result");
    } catch (err) {
      setStatus("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setJiraSubject(""); setJiraDesc(""); setJiraFiles([]); setJiraFileContents([]); setJiraMode("type");
    setTestCases(""); setTestFiles([]); setTestFileContents([]); setTestMode("type");
    setExtraContext(""); setDocsFiles([]); setDocsFileContents([]); setDocsMode("type");
    setSelectedDomains([]); setClarifyQs(null); setClarifyAnswers("");
    setResult(null); setStatus("");
  };

  const S = {
    root: { background: "#0a0a18", minHeight: "100vh", fontFamily: "'IBM Plex Mono', 'Fira Code', 'Courier New', monospace", color: "#e2e8f0" },
    nav: { background: "#0d0d22", borderBottom: "1px solid #1e1e3a", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
    main: { maxWidth: 980, margin: "0 auto", padding: "28px 20px" },
    card: { background: "#0d0d22", border: "1px solid #1e1e3a", borderRadius: 12, padding: 22, marginBottom: 18 },
    label: { display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 },
    input: { width: "100%", background: "#1a1a2e", border: "1px solid #2d2d4e", borderRadius: 8, color: "#e2e8f0", padding: "10px 14px", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" },
    btn: (v = "primary", dis = false) => ({
      background: v === "primary" ? (dis ? "#92400e" : "linear-gradient(135deg, #d97706, #f59e0b)") : "#1e1e3a",
      color: v === "primary" ? "#0a0a18" : "#e2e8f0",
      border: v === "primary" ? "none" : "1px solid #2d2d4e",
      borderRadius: 8, padding: "10px 20px", cursor: dis ? "not-allowed" : "pointer",
      fontSize: 13, fontWeight: 700, fontFamily: "inherit", opacity: dis ? 0.6 : 1, transition: "opacity 0.15s"
    }),
    navBtn: (active) => ({
      background: active ? "#d97706" : "transparent", color: active ? "#0a0a18" : "#94a3b8",
      border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer",
      fontSize: 13, fontWeight: active ? 700 : 500, fontFamily: "inherit"
    }),
    toggle: (on) => ({
      width: 40, height: 22, borderRadius: 11, background: on ? "#d97706" : "#1e1e3a",
      border: `1px solid ${on ? "#f59e0b" : "#2d2d4e"}`, cursor: "pointer",
      position: "relative", transition: "background 0.2s", flexShrink: 0
    }),
    toggleDot: (on) => ({
      position: "absolute", top: 3, left: on ? 19 : 3, width: 14, height: 14,
      borderRadius: 7, background: on ? "#0a0a18" : "#64748b", transition: "left 0.2s"
    }),
  };

  const INPUT_MODES = [
    { id: "type", icon: "⌨️", label: "Type / Paste" },
    { id: "upload", icon: "📎", label: "Upload File" }
  ];

  // ── Views ──────────────────────────────────────────────────────────────────
  const HomeView = () => (
    <div>
      <div style={{ textAlign: "center", padding: "44px 0 32px" }}>
        <div style={{ fontSize: 46, marginBottom: 14 }}>🤖</div>
        <h1 style={{ fontSize: "1.9em", fontWeight: 800, margin: "0 0 8px", background: "linear-gradient(135deg, #d97706, #f8fafc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          UAT Signoff Agent
        </h1>
        <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
          Domain-scoped · AI-powered · RAG · Multi-model · Web Search
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 28 }}>
        {[
          { icon: "📋", title: "New UAT Session", desc: "Start from JIRA, test cases & supporting docs", action: () => { resetForm(); setView("new"); } },
          { icon: "📚", title: "History", desc: `${_history.length} signoff${_history.length !== 1 ? "s" : ""} on record`, action: () => setView("history") },
          { icon: "⚙️", title: "AI Model", desc: "Switch AI model anytime", extra: true }
        ].map((item, i) => (
          <div key={i} onClick={item.action} style={{ ...S.card, cursor: item.action ? "pointer" : "default", textAlign: "center", transition: "border-color 0.2s", marginBottom: 0 }}
            onMouseEnter={e => item.action && (e.currentTarget.style.borderColor = "#d97706")}
            onMouseLeave={e => item.action && (e.currentTarget.style.borderColor = "#1e1e3a")}
          >
            <div style={{ fontSize: 26, marginBottom: 8 }}>{item.icon}</div>
            <div style={{ fontWeight: 700, color: "#f8fafc", marginBottom: 5, fontSize: 13 }}>{item.title}</div>
            <div style={{ color: "#64748b", fontSize: 11 }}>{item.desc}</div>
            {item.extra && <div style={{ marginTop: 12 }}><ModelPicker selected={model} onChange={setModel} /></div>}
          </div>
        ))}
      </div>
      <div style={S.card}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>📡 Integration Channels</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
          {[
            { icon: "💬", name: "Slack", cmd: "/uat-signoff start", detail: "Post to #uat-agent channel" },
            { icon: "📱", name: "WhatsApp", cmd: "Message: START UAT", detail: "Send to UAT bot number" },
            { icon: "🌐", name: "Browser", cmd: "Current session ✓", detail: "Use this web interface" },
          ].map((ch, i) => (
            <div key={i} style={{ background: "#1a1a2e", borderRadius: 8, padding: 14, border: "1px solid #2d2d4e" }}>
              <span style={{ fontSize: 18 }}>{ch.icon}</span>
              <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 12, marginTop: 6 }}>{ch.name}</div>
              <div style={{ color: "#475569", fontSize: 11, marginTop: 3 }}>{ch.detail}</div>
              <div style={{ color: "#d97706", fontSize: 10, marginTop: 5, fontFamily: "monospace" }}>{ch.cmd}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const NewView = () => (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, color: "#f8fafc", fontSize: "1.15em" }}>🚀 New UAT Session</h2>
          <p style={{ margin: "3px 0 0", color: "#64748b", fontSize: 11 }}>
            Type or upload for each section — mix and match freely
          </p>
        </div>
        <ModelPicker selected={model} onChange={setModel} />
      </div>

      {/* ── 1. DOMAIN SCOPE ── */}
      <InputSection title="UAT Domain Scope" icon="🎯" badge="Required" badgeColor="#ef4444">
        <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px", lineHeight: 1.6 }}>
          Select one or more domains to constrain this UAT. The signoff will be focused strictly on your selection.
        </p>
        <DomainSelector selected={selectedDomains} onChange={setSelectedDomains} />
        {selectedDomains.length > 0 && (
          <div style={{ marginTop: 12, padding: "9px 14px", background: "#1a1a2e", borderRadius: 7, border: "1px solid #2d2d4e", fontSize: 12 }}>
            <span style={{ color: "#64748b" }}>Active scope: </span>
            {DOMAINS.filter(d => selectedDomains.includes(d.id)).map(d => (
              <span key={d.id} style={{ color: d.color, fontWeight: 700, marginRight: 12 }}>{d.icon} {d.full}</span>
            ))}
          </div>
        )}
      </InputSection>

      {/* ── 2. JIRA ── */}
      <InputSection title="JIRA Details" icon="🔵" badge="JIRA" badgeColor="#3b82f6">
        <ModeTab modes={INPUT_MODES} active={jiraMode} onChange={setJiraMode} />
        {jiraMode === "type" ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>JIRA Subject / Feature Name</label>
              <input style={S.input} placeholder="e.g. TSP-3516 — Silent Mobile Verification (SMV)" value={jiraSubject} onChange={e => setJiraSubject(e.target.value)} />
            </div>
            <label style={S.label}>JIRA Description & Acceptance Criteria</label>
            <textarea style={{ ...S.input, minHeight: 110 }}
              placeholder="Paste full JIRA description, acceptance criteria, environment details, release version, signoff authority..."
              value={jiraDesc} onChange={e => setJiraDesc(e.target.value)} />
          </>
        ) : (
          <>
            <input ref={jiraRef} type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv" style={{ display: "none" }}
              onChange={e => addFiles(e.target.files, setJiraFiles, setJiraFileContents)} />
            <Dropzone
              fileRef={jiraRef}
              onDrop={fl => addFiles(fl, setJiraFiles, setJiraFileContents)}
              onBrowse={() => jiraRef.current.click()}
              files={jiraFiles}
              onRemove={i => removeFile(i, setJiraFiles, setJiraFileContents)}
              hint="Upload JIRA export, screenshot text, or Word doc with ticket details"
            />
          </>
        )}
      </InputSection>

      {/* ── 3. TEST CASES ── */}
      <InputSection title="QA Test Cases & Execution Logs" icon="🧪" badge="Test Cases" badgeColor="#22c55e">
        <ModeTab modes={INPUT_MODES} active={testMode} onChange={setTestMode} />
        {testMode === "type" ? (
          <>
            <label style={S.label}>Test Cases / Results / Logs</label>
            <textarea style={{ ...S.input, minHeight: 150 }}
              placeholder={"Paste test cases and execution results. Example:\n\nTC_001 | SMV Device Binding    | PASS | User registered successfully\nTC_002 | Invalid OTP Handling  | FAIL | Error code mismatch — Bug #123\nTC_003 | Timeout scenario      | PASS | Retry handled\n\nOr paste raw logs, test run exports, QA sign-off notes..."}
              value={testCases} onChange={e => setTestCases(e.target.value)} />
          </>
        ) : (
          <>
            <input ref={testRef} type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv" style={{ display: "none" }}
              onChange={e => addFiles(e.target.files, setTestFiles, setTestFileContents)} />
            <Dropzone
              fileRef={testRef}
              onDrop={fl => addFiles(fl, setTestFiles, setTestFileContents)}
              onBrowse={() => testRef.current.click()}
              files={testFiles}
              onRemove={i => removeFile(i, setTestFiles, setTestFileContents)}
              hint="Upload Excel test plan, CSV results, PDF test report, or log file"
            />
          </>
        )}
      </InputSection>

      {/* ── 4. SUPPORTING DOCS ── */}
      <InputSection title="Supporting Documents & Context" icon="📄" badge="Docs" badgeColor="#a78bfa">
        <ModeTab modes={INPUT_MODES} active={docsMode} onChange={setDocsMode} />
        {docsMode === "type" ? (
          <>
            <label style={S.label}>NPCI Comms, Release Notes, Known Issues, Signoff Authority</label>
            <textarea style={{ ...S.input, minHeight: 100 }}
              placeholder="Paste NPCI circular references, release notes, known issues, signoff authority names, environment URLs, deployment notes..."
              value={extraContext} onChange={e => setExtraContext(e.target.value)} />
          </>
        ) : (
          <>
            <input ref={docsRef} type="file" multiple accept=".pdf,.docx,.xlsx,.xls,.txt,.md,.csv" style={{ display: "none" }}
              onChange={e => addFiles(e.target.files, setDocsFiles, setDocsFileContents)} />
            <Dropzone
              fileRef={docsRef}
              onDrop={fl => addFiles(fl, setDocsFiles, setDocsFileContents)}
              onBrowse={() => docsRef.current.click()}
              files={docsFiles}
              onRemove={i => removeFile(i, setDocsFiles, setDocsFileContents)}
              hint="Upload NPCI documents, compliance specs, SRS, Word/PDF material"
            />
          </>
        )}
      </InputSection>

      {/* ── OPTIONS ── */}
      <div style={{ ...S.card, display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Options</div>
        {[
          { label: "Ask Clarifying Questions First", val: askQuestions, set: setAskQuestions, icon: "💬" },
          { label: "Enable Web Search (NPCI / RBI docs)", val: webSearch, set: setWebSearch, icon: "🌐" },
        ].map((opt, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => opt.set(v => !v)}>
            <div style={S.toggle(opt.val)}><div style={S.toggleDot(opt.val)} /></div>
            <span style={{ fontSize: 12, color: opt.val ? "#f8fafc" : "#64748b" }}>{opt.icon} {opt.label}</span>
          </div>
        ))}
      </div>

      {/* ── CLARIFY SECTION ── */}
      {clarifyQs && (
        <div style={{ ...S.card, border: "1px solid #d97706" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706", marginBottom: 12, letterSpacing: "0.08em" }}>💬 CLARIFYING QUESTIONS</div>
          <div style={{ background: "#1a1a2e", borderRadius: 8, padding: 16, marginBottom: 16, fontSize: 13, color: "#cbd5e1", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{clarifyQs}</div>
          <label style={S.label}>Your Answers (leave blank to skip)</label>
          <textarea style={{ ...S.input, minHeight: 100 }} placeholder="Answer any questions to improve signoff quality..." value={clarifyAnswers} onChange={e => setClarifyAnswers(e.target.value)} />
          <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
            <button style={S.btn("primary", loading)} onClick={() => runGenerate(true)} disabled={loading}>
              {loading ? "Generating..." : "Generate Signoff with Answers"}
            </button>
            <button style={S.btn("secondary", loading)} onClick={() => { setClarifyQs(null); runGenerate(false); }} disabled={loading}>
              Skip and Generate Now
            </button>
          </div>
        </div>
      )}

      {status && (
        <div style={{ background: "#1a1a2e", border: "1px solid #f59e0b", borderRadius: 8, padding: "11px 16px", marginBottom: 14, fontSize: 13, color: "#fbbf24" }}>
          {status}
        </div>
      )}

      {!clarifyQs && (
        <div style={{ display: "flex", gap: 12 }}>
          <button style={{ ...S.btn("primary", loading), flex: 1, padding: "13px 20px", fontSize: 14 }} onClick={() => runGenerate(false)} disabled={loading}>
            {loading ? `${status || "Processing..."}` : "Generate UAT Signoff"}
          </button>
          <button style={S.btn("secondary")} onClick={() => { resetForm(); setView("home"); }}>Cancel</button>
        </div>
      )}
    </div>
  );

  const ResultView = () => (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, color: "#f8fafc" }}>UAT Signoff Generated</h2>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 11 }}>Ref #{result?.id} · {new Date().toLocaleString()}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={S.btn("secondary")} onClick={() => {
            navigator.clipboard.writeText(result?.signoff || "");
            setCopiedResult(true); setTimeout(() => setCopiedResult(false), 2000);
          }}>
            {copiedResult ? "Copied!" : "Copy Signoff"}
          </button>
          <button style={S.btn("primary")} onClick={() => { resetForm(); setView("new"); }}>+ New Session</button>
        </div>
      </div>
      <div style={{ ...S.card, padding: 28 }}>
        {result?.signoff && <MarkdownRenderer content={result.signoff} />}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <button style={S.btn("secondary")} onClick={() => setView("history")}>View History</button>
        <button style={S.btn("secondary")} onClick={() => setView("home")}>Home</button>
      </div>
    </div>
  );

  const HistoryView = () => (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
        <h2 style={{ margin: 0, color: "#f8fafc" }}>UAT History</h2>
        <button style={S.btn("primary")} onClick={() => { resetForm(); setView("new"); }}>+ New Session</button>
      </div>
      {_history.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>📭</div>
          <div style={{ color: "#64748b", fontSize: 13 }}>No UAT sessions yet.</div>
        </div>
      ) : _history.map(h => (
        <div key={h.id} style={{ ...S.card, cursor: "pointer", transition: "border-color 0.2s" }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "#d97706"}
          onMouseLeave={e => e.currentTarget.style.borderColor = "#1e1e3a"}
          onClick={() => { setResult({ signoff: h.signoff, id: h.id }); setView("result"); }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: "#f8fafc", marginBottom: 7, fontSize: 13 }}>
                #{h.id} — {h.jira}
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                <Badge color="#64748b">{h.model}</Badge>
                {h.domains?.map(d => {
                  const dom = DOMAINS.find(x => x.label === d);
                  return <Badge key={d} color={dom?.color || "#94a3b8"}>{dom?.icon} {d}</Badge>;
                })}
              </div>
            </div>
            <div style={{ color: "#475569", fontSize: 11, flexShrink: 0 }}>{new Date(h.ts).toLocaleString()}</div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={S.root}>
      <nav style={S.nav}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setView("home")}>
          <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #d97706, #f59e0b)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🤖</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#f8fafc", letterSpacing: "-0.02em" }}>UAT Agent</div>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.06em" }}>SIGNOFF GENERATOR</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "home", label: "Home" },
            { id: "new", label: "New Session" },
            { id: "history", label: `History${_history.length ? ` (${_history.length})` : ""}` },
          ].map(tab => (
            <button key={tab.id} style={S.navBtn(view === tab.id)} onClick={() => { if (tab.id === "new") resetForm(); setView(tab.id); }}>
              {tab.label}
            </button>
          ))}
        </div>
        <ModelPicker selected={model} onChange={setModel} />
      </nav>

      <main style={S.main}>
        {view === "home" && <HomeView />}
        {view === "new" && <NewView />}
        {view === "result" && result && <ResultView />}
        {view === "history" && <HistoryView />}
      </main>

      <div style={{ borderTop: "1px solid #1e1e3a", padding: "14px 24px", textAlign: "center", fontSize: 11, color: "#334155" }}>
        UAT Agent · Domain-Scoped · RAG-enabled · Multi-model ready · <span style={{ color: "#d97706" }}>Powered by Anthropic</span>
      </div>
    </div>
  );
}
