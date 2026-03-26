import { useState, useRef, useEffect } from "react";
import { API_BASE, sendCompletionNotify } from "./config.js";
import ShareAndScore from "./ShareAndScore.jsx";
import { syncPublishDefaultJiraKey } from "./ConnectorsStatus.jsx";
import { exportAgentOutput } from "./agentExport.js";
import { buildShareSubjectLine } from "./shareSubject.js";

// ── Google Font ───────────────────────────────────────────────────────────────
const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
fontLink.href = "https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap";
document.head.appendChild(fontLink);

const css = `
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #0B1120; }
  ::-webkit-scrollbar-thumb { background: #1E293B; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #334155; }
  @keyframes fadeSlideIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
  @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .fade-in { animation: fadeSlideIn 0.35s ease forwards; }
  .sentinel-glow { box-shadow: 0 0 0 1px #e8b84b22, 0 4px 24px #e8b84b18; }
  .hover-lift:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(232,184,75,0.15); }
  textarea:focus, input:focus { border-color: #e8b84b88 !important; box-shadow: 0 0 0 3px #e8b84b12; }
`;
const styleEl = document.createElement("style");
styleEl.textContent = css;
document.head.appendChild(styleEl);

// ── Constants ─────────────────────────────────────────────────────────────────
const MODELS = [
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4.6", provider: "Anthropic", color: "#e8b84b" },
  { id: "claude-opus-4-20250514",   label: "Claude Opus 4.6",   provider: "Anthropic", color: "#d4823a" },
  { id: "gpt-4o",                   label: "GPT-4o",            provider: "OpenAI",    color: "#10a37f" },
  { id: "gemini-1.5-pro",           label: "Gemini 1.5 Pro",    provider: "Google",    color: "#4285f4" },
  { id: "deepseek-chat",            label: "DeepSeek Chat",     provider: "DeepSeek",  color: "#7c3aed" },
];

const DOMAINS = [
  { id: "pms",            label: "PMS",            full: "Profile Management System", icon: "👤", color: "#60a5fa" },
  { id: "switch",         label: "Switch",          full: "Transactional Switch",       icon: "🔀", color: "#e8b84b" },
  { id: "refund",         label: "Refund",          full: "Refund Service",             icon: "↩️", color: "#f87171" },
  { id: "reconciliation", label: "Reconciliation",  full: "Reconciliation Service",     icon: "⚖️", color: "#a78bfa" },
  { id: "payout",         label: "Payout",          full: "Payout Service",             icon: "💸", color: "#34d399" },
  { id: "compliance",     label: "Compliance",      full: "Compliance Service",         icon: "🛡️", color: "#fbbf24" },
  { id: "mandates",       label: "Mandates",        full: "Mandates Service",           icon: "📋", color: "#22d3ee" },
  { id: "all",            label: "All Services",    full: "All Services",               icon: "🌐", color: "#94a3b8" },
];

// ── System Prompts ────────────────────────────────────────────────────────────
const buildSystemPrompt = (domains, objective, feedbackNote) => {
  const scopeList = domains.length > 0 ? domains.map(d => `${d.full} (${d.label})`).join(", ") : "All Services";
  const objSection = objective ? `\nCONFIRMED OBJECTIVE OF TESTING:\n${objective}\n` : "";
  const fbSection = feedbackNote ? `\nUSER FEEDBACK TO INCORPORATE:\n${feedbackNote}\n` : "";
  return `You are TestSentinel — an expert UAT Signoff Agent for fintech, UPI, and payment systems.
${objSection}${fbSection}
DOMAIN SCOPE: ${scopeList}. Constrain ALL analysis strictly to these domains.

Generate a professional UAT Signoff with EXACTLY these sections in this order:

## 1️⃣ Introduction
A table with ONLY these fields (no others):
| Field | Value |
| Feature Name | [from input] |
| JIRA ID | [from input] |
| UAT Scope | ${scopeList} |

## 2️⃣ Objective
${objective ? `Use this confirmed objective: ${objective}` : "Derive from inputs. Describe what was validated in 2-3 sentences."}

## 5️⃣ UAT Acceptance Criteria
Table with columns: UAT Scenario | QA Test Case ID | Result | Remarks
Extract ALL test cases from input. Mark PASS/FAIL/BLOCKED clearly.

## 3️⃣ + 4️⃣ Scope Definition
**MERGED SECTION** (scope table + test execution summary + counts below)

First, a Scope table:
| In Scope | Out of Scope |
List all relevant in-scope items including:
- End-to-End Transaction Flow Validation
- Negative & Edge Case Coverage
- Fund Loss Risk Validation
- Reconciliation Integrity Validation
- NPCI Compliance Validation
- Feature Flag & Configuration Safety
- [domain-specific items from test cases]

Then, Test Execution Summary table:
| QA Test Case ID | Scenario | Result | Remarks |
List every test case with its ID.

Then counts summary:
| Category | Count |
| Total Test Cases | X |
| Passed | X |
| Failed | X |
| Blocked | X |
| Not Executed | X |

## 6️⃣ Defect / Gap Summary
Severity counts table, then gap details table: Gap ID | Description | Severity | Impact | Recommendation

## 7️⃣ Risk Assessment  
Table: Risk Area | Impact | Status

## 8️⃣ Production Readiness Checklist
Table: Validation Item | Status (use ✅ ⚠️ ❌)

## 9️⃣ UAT Final Decision
State ONLY: ✅ PASS, ⚠️ PASS WITH CONDITIONS, or ❌ FAIL
Then 2-3 sentence justification.
DO NOT include Sign-off Pending, Prepared By, Date, or Next Review fields.

Rules:
- Never hallucinate numbers — extract from provided data only
- Use "Insufficient data — please supply [X]" if info is missing
- All tables use markdown format
- Be precise and professional
- Start response with "# UAT Status"`;
};

const CLARIFY_SYSTEM = `You are TestSentinel, a UAT expert for fintech and UPI payment systems.

The user provided UAT inputs. Generate:
1. First: A draft "Objective" paragraph (2-3 sentences) based on their inputs
2. Then: 3-6 targeted clarifying questions to improve the signoff

Format your response as:

DRAFT_OBJECTIVE:
[your draft objective paragraph here]

QUESTIONS:
1. [question]
2. [question]
...

Be specific and concise.`;

// ── History (persisted to localStorage for online/offline) ───────────────────
const UAT_HISTORY_KEY = "uat-sentinel-history-v1";
function loadHistoryFromLS() {
  try {
    const raw = localStorage.getItem(UAT_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return (Array.isArray(arr) ? arr : []).filter((h) => new Date(h.ts).getTime() > cutoff);
  } catch {
    return [];
  }
}
let _history = loadHistoryFromLS();
let _hid = Math.max(1, ..._history.map((h) => h.id || 0)) + 1;
function saveToHistory(entry) {
  const record = { id: _hid++, ...entry, ts: new Date().toISOString() };
  _history.unshift(record);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  _history = _history.filter((h) => new Date(h.ts).getTime() > cutoff);
  try {
    localStorage.setItem(UAT_HISTORY_KEY, JSON.stringify(_history.slice(0, 50)));
  } catch {}
  return record;
}
function getHistory() { return _history; }

const UAT_FEEDBACK_MEM_KEY = "uat-feedback-memory-v1";
function loadUATFeedbackMemory() { try { return JSON.parse(localStorage.getItem(UAT_FEEDBACK_MEM_KEY) || "[]"); } catch { return []; } }
function saveUATFeedbackMemoryLS(m) { try { localStorage.setItem(UAT_FEEDBACK_MEM_KEY, JSON.stringify(m.slice(0, 20))); } catch {} }

// ── Utilities ─────────────────────────────────────────────────────────────────
async function readFiles(fileList) {
  const arr = Array.from(fileList || []);
  const contents = [];
  for (const f of arr) {
    const text = await f.text().catch(() => `[Binary file: ${f.name}]`);
    contents.push({ name: f.name, content: text.slice(0, 12000) });
  }
  return { files: arr, contents };
}

/** Bedrock caps total prompt ~200k tokens; cap user context to avoid failures (mixed text ~3–4 chars/token). */
const MAX_CLARIFY_USER_CHARS = 100_000;
const MAX_GENERATE_USER_CHARS = 420_000;
const MAX_FEEDBACK_USER_CHARS = 420_000;

function truncateForLLM(text, maxChars) {
  const s = String(text || "");
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n\n[TRUNCATED — input exceeded ${maxChars.toLocaleString()} characters (${s.length.toLocaleString()} total). Tail omitted to stay within model limits; shorten pastes or use fewer files for full context.]`;
}

function formatInline(t) {
  return (t || "")
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#f1f5f9;font-weight:700">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em style="color:#94a3b8">$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:#111827;padding:1px 6px;border-radius:3px;font-family:JetBrains Mono,monospace;color:#a78bfa;font-size:0.82em">$1</code>');
}

function MarkdownRenderer({ content }) {
  const lines = content.split("\n");
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("|") && i + 1 < lines.length && lines[i+1].match(/^\|[\s\-:|]+\|/)) {
      const headers = line.split("|").slice(1,-1).map(c=>c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i].split("|").slice(1,-1).map(c=>c.trim()));
        i++;
      }
      const isResultCol = (h) => ["result","status"].includes(h.toLowerCase());
      const colorResult = (v) => {
        if (!v) return v;
        const u = v.toUpperCase();
        if (u.includes("PASS") && !u.includes("FAIL")) return `<span style="color:#34d399;font-weight:700">${v}</span>`;
        if (u.includes("FAIL")) return `<span style="color:#f87171;font-weight:700">${v}</span>`;
        if (u.includes("BLOCK")) return `<span style="color:#fbbf24;font-weight:700">${v}</span>`;
        if (u.includes("✅")) return `<span style="color:#34d399">${v}</span>`;
        if (u.includes("⚠")) return `<span style="color:#fbbf24">${v}</span>`;
        if (u.includes("❌")) return `<span style="color:#f87171">${v}</span>`;
        return formatInline(v);
      };
      result.push(`<div style="overflow-x:auto;margin:14px 0;border-radius:8px;overflow:hidden;border:1px solid #1e1e38">
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;font-family:JetBrains Mono,monospace">
          <thead><tr>${headers.map(h=>`<th style="background:#111827;color:#e8b84b;padding:10px 14px;text-align:left;font-weight:600;white-space:nowrap;border-bottom:1px solid #1E293B;letter-spacing:0.04em;font-size:11px;text-transform:uppercase">${formatInline(h)}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((r,ri)=>`<tr style="background:${ri%2?"#0D1626":"#0B1120"};transition:background 0.15s" onmouseover="this.style.background='#111827'" onmouseout="this.style.background='${ri%2?"#0D1626":"#0B1120"}'">${r.map((c,ci)=>`<td style="padding:9px 14px;border-bottom:1px solid #111827;color:#cbd5e1;vertical-align:top">${isResultCol(headers[ci]) ? colorResult(c) : formatInline(c)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>`);
      continue;
    }
    if (line.match(/^# /)) result.push(`<h1 style="font-size:1.4em;color:#f8fafc;font-family:Syne,sans-serif;font-weight:800;border-bottom:2px solid #e8b84b;padding-bottom:10px;margin:0 0 20px;letter-spacing:-0.02em">${formatInline(line.slice(2))}</h1>`);
    else if (line.match(/^## /)) result.push(`<h2 style="font-size:1em;color:#e8b84b;font-family:Syne,sans-serif;font-weight:700;margin:22px 0 10px;padding:8px 14px;background:linear-gradient(90deg,#e8b84b12,transparent);border-left:3px solid #e8b84b;border-radius:0 6px 6px 0;letter-spacing:0.02em">${formatInline(line.slice(3))}</h2>`);
    else if (line.match(/^### /)) result.push(`<h3 style="font-size:0.9em;color:#cbd5e1;font-family:Syne,sans-serif;font-weight:700;margin:14px 0 6px;text-transform:uppercase;letter-spacing:0.06em">${formatInline(line.slice(4))}</h3>`);
    else if (line.match(/^---+$/)) result.push(`<hr style="border:none;border-top:1px solid #1E293B;margin:18px 0">`);
    else if (line.match(/^- /)) result.push(`<div style="display:flex;gap:8px;margin:3px 0;color:#94a3b8;font-size:13px"><span style="color:#e8b84b;margin-top:2px;flex-shrink:0">▸</span><span>${formatInline(line.slice(2))}</span></div>`);
    else if (line.trim() === "") result.push(`<div style="height:6px"></div>`);
    else result.push(`<p style="margin:4px 0;color:#94a3b8;line-height:1.75;font-size:13px;font-family:JetBrains Mono,monospace">${formatInline(line)}</p>`);
    i++;
  }
  return <div dangerouslySetInnerHTML={{ __html: result.join("") }} />;
}

// ── Shared UI atoms ───────────────────────────────────────────────────────────
const C = {
  bg: "#0B1120", surface: "#0D1626", elevated: "#111827", border: "#1E293B",
  gold: "#e8b84b", goldDim: "#e8b84b44", text: "#f1f5f9", muted: "#64748b", subtle: "#94a3b8",
  font: "Syne, sans-serif", mono: "JetBrains Mono, monospace",
};

function Tag({ children, color = C.gold }) {
  return <span style={{ background: color+"18", color, border:`1px solid ${color}33`, borderRadius:4, padding:"2px 9px", fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", whiteSpace:"nowrap", fontFamily:C.mono }}>{children}</span>;
}

function Btn({ children, variant="primary", onClick, disabled, style={}, size="md" }) {
  const pad = size==="sm" ? "7px 14px" : size==="lg" ? "14px 28px" : "10px 20px";
  const base = {
    border:"none", borderRadius:8, cursor: disabled?"not-allowed":"pointer",
    fontFamily:C.font, fontWeight:700, letterSpacing:"0.04em",
    transition:"all 0.2s", opacity: disabled?0.5:1,
    fontSize: size==="sm"?11:size==="lg"?15:13, padding:pad, ...style
  };
  const variants = {
    primary: { background:`linear-gradient(135deg, ${C.gold}, #f0cc6a)`, color:"#0a0a14", boxShadow:"0 2px 12px #e8b84b30" },
    ghost: { background:"transparent", color:C.subtle, border:`1px solid ${C.border}` },
    danger: { background:"#f8717118", color:"#f87171", border:"1px solid #f8717133" },
    outline: { background:"transparent", color:C.gold, border:`1px solid ${C.goldDim}` },
  };
  return <button type="button" onClick={disabled?undefined:onClick} style={{...base,...variants[variant]}}>{children}</button>;
}

function Card({ children, style = {}, className = "", ...rest }) {
  return <div className={className} style={{ background:C.elevated, border:`1px solid ${C.border}`, borderRadius:12, ...style }} {...rest}>{children}</div>;
}

function SectionHeader({ icon, title, tag, tagColor }) {
  return (
    <div style={{ padding:"13px 20px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:10, background:C.surface }}>
      <span style={{ fontSize:17 }}>{icon}</span>
      <span style={{ fontWeight:700, fontSize:13, color:C.text, fontFamily:C.font }}>{title}</span>
      {tag && <Tag color={tagColor}>{tag}</Tag>}
    </div>
  );
}

function Toggle({ on, onChange, label, icon }) {
  return (
    <div onClick={()=>onChange(!on)} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", userSelect:"none" }}>
      <div style={{ width:38, height:21, borderRadius:11, background: on?C.gold:"#1e1e38", border:`1px solid ${on?C.gold:C.border}`, position:"relative", transition:"all 0.2s", flexShrink:0 }}>
        <div style={{ position:"absolute", top:3, left: on?18:3, width:13, height:13, borderRadius:"50%", background: on?"#0a0a14":C.muted, transition:"left 0.2s" }} />
      </div>
      <span style={{ fontSize:12, color: on?C.text:C.muted, fontFamily:C.font }}>{icon} {label}</span>
    </div>
  );
}

function ModeTab({ modes, active, onChange }) {
  return (
    <div style={{ display:"inline-flex", background:C.surface, borderRadius:8, border:`1px solid ${C.border}`, overflow:"hidden", marginBottom:14 }}>
      {modes.map(m => (
        <button type="button" key={m.id} onClick={()=>onChange(m.id)} style={{
          background: active===m.id ? C.gold : "transparent",
          color: active===m.id ? "#0a0a14" : C.muted,
          border:"none", padding:"7px 18px", cursor:"pointer",
          fontSize:12, fontWeight:700, fontFamily:C.font,
          transition:"all 0.15s", display:"flex", alignItems:"center", gap:5
        }}>{m.icon} {m.label}</button>
      ))}
    </div>
  );
}

function FileChip({ file, onRemove }) {
  const ext = file.name.split(".").pop().toUpperCase();
  const colors = { PDF:"#f87171", DOCX:"#60a5fa", XLSX:"#34d399", XLS:"#34d399", TXT:C.muted, MD:"#a78bfa", CSV:C.gold };
  const c = colors[ext]||C.muted;
  return (
    <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:c+"15", border:`1px solid ${c}33`, borderRadius:6, padding:"4px 10px", fontSize:11 }}>
      <span style={{ background:c+"33", padding:"1px 5px", borderRadius:3, color:c, fontWeight:700, fontFamily:C.mono }}>{ext}</span>
      <span style={{ color:C.subtle, maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontFamily:C.mono }}>{file.name}</span>
      <button type="button" onClick={onRemove} style={{ background:"none", border:"none", cursor:"pointer", color:C.muted, padding:0, fontSize:15, lineHeight:1 }}>×</button>
    </div>
  );
}

function Dropzone({ fileRef, onDrop, onBrowse, files, onRemove, hint }) {
  const [drag, setDrag] = useState(false);
  return (
    <>
      <div onClick={onBrowse}
        onDragOver={e=>{e.preventDefault();setDrag(true);}}
        onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);onDrop(e.dataTransfer.files);}}
        style={{ border:`2px dashed ${drag?C.gold:C.border}`, borderRadius:10, padding:"22px 16px", textAlign:"center", cursor:"pointer", background:drag?`${C.gold}08`:"transparent", transition:"all 0.2s" }}
      >
        <div style={{ fontSize:24, marginBottom:6 }}>📎</div>
        <div style={{ color:C.muted, fontSize:12, fontFamily:C.font }}>Drop files or <span style={{color:C.gold}}>click to browse</span></div>
        <div style={{ color:"#334155", fontSize:11, marginTop:3, fontFamily:C.mono }}>{hint||"PDF · DOCX · XLSX · TXT · CSV"}</div>
      </div>
      {files.length > 0 && <div style={{ marginTop:10, display:"flex", flexWrap:"wrap", gap:7 }}>{files.map((f,i)=><FileChip key={i} file={f} onRemove={()=>onRemove(i)}/>)}</div>}
    </>
  );
}

function ModelPicker({ selected, onChange }) {
  const [open, setOpen] = useState(false);
  const m = MODELS.find(x=>x.id===selected)||MODELS[0];
  return (
    <div style={{ position:"relative" }}>
      <button type="button" onClick={()=>setOpen(o=>!o)} style={{ background:C.elevated, border:`1px solid ${C.border}`, borderRadius:8, color:C.text, padding:"7px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:8, fontSize:12, fontWeight:600, fontFamily:C.font }}>
        <span style={{ width:7, height:7, borderRadius:"50%", background:m.color, display:"inline-block", flexShrink:0 }}/>
        {m.label}
        <span style={{ opacity:0.4, fontSize:9 }}>▾</span>
      </button>
      {open && (
        <div style={{ position:"absolute", top:"110%", right:0, background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, zIndex:300, minWidth:220, boxShadow:"0 12px 40px rgba(0,0,0,0.7)", overflow:"hidden" }}>
          {MODELS.map(model=>(
            <div key={model.id} onClick={()=>{onChange(model.id);setOpen(false);}}
              style={{ padding:"10px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:10, borderBottom:`1px solid ${C.border}`, fontSize:12, background:selected===model.id?C.elevated:"transparent", color:C.text, transition:"background 0.1s" }}
              onMouseEnter={e=>e.currentTarget.style.background=C.elevated}
              onMouseLeave={e=>e.currentTarget.style.background=selected===model.id?C.elevated:"transparent"}
            >
              <span style={{ width:7, height:7, borderRadius:"50%", background:model.color, flexShrink:0 }}/>
              <div><div style={{ fontWeight:600, fontFamily:C.font }}>{model.label}</div><div style={{ fontSize:10, color:C.muted }}>{model.provider}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DomainSelector({ selected, onChange }) {
  const toggle = (id) => {
    if (id==="all") { onChange(selected.includes("all")?[]:["all"]); return; }
    const next = selected.filter(s=>s!=="all");
    onChange(next.includes(id)?next.filter(s=>s!==id):[...next,id]);
  };
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:9 }}>
      {DOMAINS.map(d=>{
        const on = selected.includes(d.id);
        return (
          <button type="button" key={d.id} onClick={()=>toggle(d.id)} style={{
            background: on?`${d.color}18`:C.surface, border:`2px solid ${on?d.color:C.border}`,
            borderRadius:10, padding:"9px 15px", cursor:"pointer",
            display:"flex", alignItems:"center", gap:8, fontFamily:C.font, outline:"none",
            transition:"all 0.15s"
          }}>
            <span style={{ fontSize:15 }}>{d.icon}</span>
            <div style={{ textAlign:"left" }}>
              <div style={{ fontSize:12, fontWeight:700, color:on?d.color:C.subtle, lineHeight:1.3 }}>{d.label}</div>
              <div style={{ fontSize:10, color:on?`${d.color}aa`:C.muted, lineHeight:1.2 }}>{d.full}</div>
            </div>
            {on && <span style={{ color:d.color, fontSize:12, marginLeft:2 }}>✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function Spinner() {
  return <div style={{ width:16, height:16, border:`2px solid ${C.border}`, borderTopColor:C.gold, borderRadius:"50%", animation:"spin 0.7s linear infinite", display:"inline-block" }}/>;
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ step }) {
  const steps = ["Inputs", "Clarify & Objective", "Review & Generate", "Signoff"];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:0, marginBottom:28 }}>
      {steps.map((s,i)=>(
        <div key={i} style={{ display:"flex", alignItems:"center", flex: i<steps.length-1?1:"none" }}>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
            <div style={{
              width:30, height:30, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center",
              background: step>i?C.gold:step===i?`${C.gold}22`:"#0D1626",
              border:`2px solid ${step>=i?C.gold:C.border}`,
              fontSize:12, fontWeight:700, color: step>i?"#0a0a14":step===i?C.gold:C.muted,
              transition:"all 0.3s", fontFamily:C.font
            }}>
              {step>i ? "✓" : i+1}
            </div>
            <span style={{ fontSize:10, color:step===i?C.gold:C.muted, whiteSpace:"nowrap", fontFamily:C.font, fontWeight:step===i?700:400 }}>{s}</span>
          </div>
          {i<steps.length-1 && <div style={{ flex:1, height:2, background:step>i?C.gold:C.border, margin:"0 6px 16px", transition:"background 0.3s" }}/>}
        </div>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function TestSentinel() {
  const [view, setView] = useState("home"); // home | new | result | history
  const [step, setStep] = useState(0); // 0=inputs, 1=clarify, 2=review, 3=done
  const [model, setModel] = useState(MODELS[0].id);
  const [webSearch, setWebSearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  // Inputs
  const [selectedDomains, setSelectedDomains] = useState([]);
  const [jiraSubject, setJiraSubject] = useState("");
  const [jiraDesc, setJiraDesc] = useState("");
  const [jiraMode, setJiraMode] = useState("type");
  const [jiraFiles, setJiraFiles] = useState([]); const [jiraFC, setJiraFC] = useState([]);
  const [testCases, setTestCases] = useState("");
  const [testMode, setTestMode] = useState("type");
  const [testFiles, setTestFiles] = useState([]); const [testFC, setTestFC] = useState([]);
  const [docsText, setDocsText] = useState("");
  const [docsMode, setDocsMode] = useState("type");
  const [docsFiles, setDocsFiles] = useState([]); const [docsFC, setDocsFC] = useState([]);

  // Clarify step
  const [clarifyRaw, setClarifyRaw] = useState(""); // full AI response
  const [draftObjective, setDraftObjective] = useState("");
  const [editedObjective, setEditedObjective] = useState("");
  const [clarifyAnswers, setClarifyAnswers] = useState("");

  // Result
  const [result, setResult] = useState(null); // { signoff, id, domains }
  const [copied, setCopied] = useState(false);

  // Feedback
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackMode, setFeedbackMode] = useState("type");
  const [feedbackFiles, setFeedbackFiles] = useState([]); const [feedbackFC, setFeedbackFC] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackMemory, setFeedbackMemory] = useState(() => loadUATFeedbackMemory());

  // Auto-publish only right after a new generation (not when reopening history)
  const [autoPublishChannels, setAutoPublishChannels] = useState({ jira: false, telegram: false, email: false, slack: false });
  const [allowAutoPublish, setAllowAutoPublish] = useState(false);
  // JIRA Connector: fetch issue key input and loading
  const [jiraIssueKey, setJiraIssueKey] = useState("");
  const [jiraFetchLoading, setJiraFetchLoading] = useState(false);
  const [jiraFetchError, setJiraFetchError] = useState("");

  useEffect(() => { saveUATFeedbackMemoryLS(feedbackMemory); }, [feedbackMemory]);

  const jiraRef = useRef(); const testRef = useRef(); const docsRef = useRef(); const fbRef = useRef();

  function parseJiraIssueKey(input) {
    const s = (input || "").trim();
    if (!s) return "";
    const keyMatch = s.match(/\b([A-Z][A-Z0-9]*-\d+)\b/i);
    if (keyMatch) return keyMatch[1].toUpperCase();
    try {
      const url = new URL(s.startsWith("http") ? s : "https://host/" + s);
      const segments = (url.pathname || "").split("/").filter(Boolean);
      const last = segments[segments.length - 1];
      if (last && /^[A-Z0-9]+-\d+$/i.test(last)) return last.toUpperCase();
    } catch (_) {}
    return "";
  }

  const handleFetchJiraUAT = async () => {
    const key = parseJiraIssueKey(jiraIssueKey);
    if (!key) { setJiraFetchError("Enter a JIRA issue key (e.g. TSP-1889) or paste a JIRA URL."); return; }
    setJiraFetchError("");
    setJiraFetchLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/jira-issue/${encodeURIComponent(key)}`, { headers: { Accept: "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `JIRA error ${r.status}`);
      setJiraSubject(d.summary ? `${d.id} — ${d.summary}` : d.id || jiraIssueKey);
      setJiraDesc([d.description, d.acceptanceCriteria ? `Acceptance criteria:\n${d.acceptanceCriteria}` : ""].filter(Boolean).join("\n\n") || "(No description)");
      setJiraMode("type");
      syncPublishDefaultJiraKey(d.id || key);
    } catch (e) {
      setJiraFetchError(e.message || "JIRA fetch failed");
    }
    setJiraFetchLoading(false);
  };

  const addFiles = async (fl, setF, setC) => {
    const { files, contents } = await readFiles(fl);
    setF(p=>[...p,...files]); setC(p=>[...p,...contents]);
  };
  const removeFile = (i, setF, setC) => { setF(p=>p.filter((_,j)=>j!==i)); setC(p=>p.filter((_,j)=>j!==i)); };

  const buildContext = () => {
    const doms = DOMAINS.filter(d=>selectedDomains.includes(d.id));
    const scope = doms.map(d=>d.full).join(", ")||"All Services";
    let ctx = `UAT Scope: ${scope}\n\n`;
    if (jiraMode==="type") { if(jiraSubject) ctx+=`JIRA Subject: ${jiraSubject}\n`; if(jiraDesc) ctx+=`JIRA Description:\n${jiraDesc}\n\n`; }
    else jiraFC.forEach(f=>{ ctx+=`JIRA File [${f.name}]:\n${f.content}\n\n`; });
    if (testMode==="type") { if(testCases) ctx+=`Test Cases / Logs:\n${testCases}\n\n`; }
    else testFC.forEach(f=>{ ctx+=`Test Cases File [${f.name}]:\n${f.content}\n\n`; });
    if (docsMode==="type") { if(docsText) ctx+=`Supporting Context:\n${docsText}\n\n`; }
    else docsFC.forEach(f=>{ ctx+=`Supporting Doc [${f.name}]:\n${f.content}\n\n`; });
    return ctx;
  };

  const hasInput = () => {
    if (jiraMode==="type" && (jiraSubject||jiraDesc)) return true;
    if (jiraMode==="upload" && jiraFiles.length>0) return true;
    if (testMode==="type" && testCases) return true;
    if (testMode==="upload" && testFiles.length>0) return true;
    if (docsMode==="type" && docsText) return true;
    if (docsMode==="upload" && docsFiles.length>0) return true;
    return false;
  };

  const callClaude = async (systemPrompt, userMessage, maxTokens = 8000) => {
    const res = await fetch(`${API_BASE}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        max_tokens: maxTokens,
      }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok || data.error) throw new Error(data.message || data.error?.message || `Request failed: ${res.status}`);
    const payload = data.data ?? data;
    const blocks = payload?.content;
    if (!Array.isArray(blocks)) throw new Error("Unexpected LLM response shape");
    return blocks.filter(b => b.type === "text").map(b => b.text || "").join("\n");
  };

  // Step 1 → Step 2: get clarify questions + draft objective
  const handleProceedToClarify = async () => {
    if (!hasInput()) { setStatusMsg("Please provide at least one input."); return; }
    if (!selectedDomains.length) { setStatusMsg("Please select at least one domain."); return; }
    setLoading(true); setStatusMsg("Analyzing inputs & drafting objective...");
    try {
      const ctx = truncateForLLM(buildContext(), MAX_CLARIFY_USER_CHARS);
      const raw = await callClaude(CLARIFY_SYSTEM, ctx);
      setClarifyRaw(raw);
      // parse draft objective
      const objMatch = raw.match(/DRAFT_OBJECTIVE:\s*([\s\S]*?)(?=QUESTIONS:|$)/i);
      const draft = objMatch ? objMatch[1].trim() : "";
      setDraftObjective(draft);
      setEditedObjective(draft);
      setStep(1);
      setStatusMsg("");
    } catch(e) { setStatusMsg("Error: "+e.message); }
    finally { setLoading(false); }
  };

  // Step 2 → Step 3: review
  const handleProceedToReview = () => { setStep(2); };

  // Step 3 → Generate
  const handleGenerate = async () => {
    setLoading(true); setStatusMsg("Generating UAT Signoff...");
    try {
      const ctx = buildContext();
      let userMsg = ctx;
      if (clarifyAnswers.trim()) userMsg += `\nClarification Answers:\n${clarifyAnswers}\n`;
      if (feedbackMemory.length > 0) userMsg += `\nREMEMBERED FEEDBACK FROM PREVIOUS UATs (apply these improvements):\n${feedbackMemory.map(f => `- ${f}`).join("\n")}\n`;
      userMsg = truncateForLLM(userMsg, MAX_GENERATE_USER_CHARS);
      const domains = DOMAINS.filter(d=>selectedDomains.includes(d.id));
      const signoff = await callClaude(buildSystemPrompt(domains, editedObjective, ""), userMsg);
      const jiraKey = parseJiraIssueKey(jiraIssueKey) || parseJiraIssueKey(jiraSubject);
      const entry = saveToHistory({
        jira: jiraSubject||jiraFiles[0]?.name||"Unnamed",
        jiraKey,
        model: MODELS.find(m=>m.id===model)?.label||model,
        domains: domains.map(d=>d.label),
        objective: editedObjective,
        signoff
      });
      setResult({ signoff, id:entry.id, domains:entry.domains });
      setStep(3);
      setView("result");
      setStatusMsg("");
      void exportAgentOutput({
        agent: "UAT",
        jiraId: jiraKey || "NOJIRA",
        subject: jiraSubject || "UAT-Signoff",
        content: signoff,
      });
      setAllowAutoPublish(true);
      await sendCompletionNotify({
        agentName: "UAT Agent",
        identifier: jiraSubject || jiraIssueKey || "UAT Signoff",
        notifySubject: buildShareSubjectLine("uat", jiraKey, jiraSubject || "UAT Signoff"),
      });
    } catch(e) { setStatusMsg("Error: "+e.message); }
    finally { setLoading(false); }
  };

  // Feedback → regenerate
  const handleFeedback = async () => {
    if (!feedbackText.trim() && feedbackFiles.length===0) return;
    setFeedbackLoading(true);
    try {
      let fbCtx = result.signoff+"\n\n---\nUSER FEEDBACK:\n";
      if (feedbackMode==="type") fbCtx += feedbackText;
      else feedbackFC.forEach(f=>{ fbCtx+=`[File: ${f.name}]\n${f.content}\n`; });
      fbCtx = truncateForLLM(fbCtx, MAX_FEEDBACK_USER_CHARS);
      const domains = DOMAINS.filter(d=>result.domains?.includes(d.label));
      const improved = await callClaude(buildSystemPrompt(domains, editedObjective, feedbackText||"(see attached feedback)"), fbCtx);
      const jiraKey = parseJiraIssueKey(jiraIssueKey) || parseJiraIssueKey(jiraSubject);
      const entry = saveToHistory({
        jira: (jiraSubject||"Feedback revision")+" (revised)",
        jiraKey,
        model: MODELS.find(m=>m.id===model)?.label||model,
        domains: result.domains||[],
        objective: editedObjective,
        signoff: improved
      });
      setResult({ signoff:improved, id:entry.id, domains:result.domains });
      void exportAgentOutput({
        agent: "UAT",
        jiraId: jiraKey || "NOJIRA",
        subject: (jiraSubject || "UAT-Signoff") + "-revised",
        content: improved,
      });
      const fbSummary = feedbackMode === "type" ? feedbackText.trim() : feedbackFC.map(f => `[${f.name}] ${f.content.slice(0, 100)}`).join("; ");
      if (fbSummary) setFeedbackMemory(prev => [...prev, fbSummary.slice(0, 200)].slice(-20));
      setFeedbackText(""); setFeedbackFiles([]); setFeedbackFC([]);
      setAllowAutoPublish(true);
      await sendCompletionNotify({
        agentName: "UAT Agent",
        identifier: (jiraSubject || jiraIssueKey || "UAT Signoff") + " (revised)",
        notifySubject: buildShareSubjectLine("uat", jiraKey, (jiraSubject || "UAT Signoff") + "-revised"),
      });
    } catch(e) { console.error(e); }
    finally { setFeedbackLoading(false); }
  };

  const resetAll = () => {
    setStep(0); setJiraSubject(""); setJiraDesc(""); setJiraFiles([]); setJiraFC([]);
    setTestCases(""); setTestFiles([]); setTestFC([]); setDocsText(""); setDocsFiles([]); setDocsFC([]);
    setSelectedDomains([]); setClarifyRaw(""); setDraftObjective(""); setEditedObjective("");
    setClarifyAnswers(""); setResult(null); setStatusMsg(""); setFeedbackText(""); setFeedbackFiles([]); setFeedbackFC([]);
    setJiraMode("type"); setTestMode("type"); setDocsMode("type"); setFeedbackMode("type");
    setJiraIssueKey(""); setJiraFetchError("");
    setAllowAutoPublish(false);
  };

  const INPUT_MODES = [{id:"type",icon:"⌨️",label:"Type / Paste"},{id:"upload",icon:"📎",label:"Upload File"}];

  // ── Shared textarea / input style ─────────────────────────────────────────
  const inp = { width:"100%", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, color:C.text, padding:"10px 14px", fontSize:12, outline:"none", boxSizing:"border-box", fontFamily:C.mono, resize:"vertical", transition:"border 0.2s, box-shadow 0.2s" };
  const lbl = { display:"block", fontSize:10, fontWeight:700, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:7, fontFamily:C.font };

  // ── VIEWS ─────────────────────────────────────────────────────────────────
  const HomeView = () => (
    <div className="fade-in">
      {/* Hero */}
      <div style={{ textAlign:"center", padding:"52px 0 40px", position:"relative" }}>
        <div style={{ fontSize:52, marginBottom:16, filter:"drop-shadow(0 0 24px #e8b84b44)" }}>🛡️</div>
        <h1 style={{ fontFamily:C.font, fontWeight:800, fontSize:"2.4em", margin:"0 0 8px", letterSpacing:"-0.03em", background:`linear-gradient(135deg, ${C.gold} 30%, #f8fafc)`, WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
          TestSentinel
        </h1>
        <p style={{ color:C.muted, fontSize:13, margin:"0 0 32px", fontFamily:C.mono }}>
          UAT Signoff Agent · Domain-Scoped · RAG-enabled · Multi-model
        </p>
        <Btn size="lg" onClick={()=>{resetAll();setView("new");}}>
          ⚡ Start New UAT Session
        </Btn>
        {feedbackMemory.length > 0 && (
          <div style={{ marginTop:16, display:"inline-flex", alignItems:"center", gap:8, background:"#052E16", border:"1px solid #16A34A22", borderRadius:9, padding:"8px 14px" }}>
            <span style={{ fontSize:11, color:"#4ADE80", fontWeight:600 }}>🧠 {feedbackMemory.length} feedback item{feedbackMemory.length>1?"s":""} remembered</span>
            <button type="button" onClick={()=>setFeedbackMemory([])} style={{ background:"none", border:"1px solid #EF444433", borderRadius:6, padding:"2px 8px", color:"#EF4444", fontSize:10, cursor:"pointer" }}>Clear</button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:24 }}>
        {[
          { icon:"📋", label:"Sessions", value: getHistory().length||"—", sub:"total performed" },
          { icon:"📅", label:"Last 30 Days", value: getHistory().filter(h=>new Date(h.ts)>new Date(Date.now()-30*86400000)).length||"—", sub:"UATs completed" },
          { icon:"✅", label:"Quick Action", value:"New UAT", sub:"click to start", action:()=>{resetAll();setView("new");} },
        ].map((s,i)=>(
          <Card key={i} className="hover-lift" style={{ padding:20, textAlign:"center", cursor:s.action?"pointer":"default", transition:"all 0.2s", marginBottom:0 }} onClick={s.action}>
            <div style={{ fontSize:24, marginBottom:8 }}>{s.icon}</div>
            <div style={{ fontFamily:C.font, fontWeight:800, fontSize:"1.6em", color:C.gold, marginBottom:2 }}>{s.value}</div>
            <div style={{ fontSize:11, color:C.text, fontWeight:600, fontFamily:C.font }}>{s.label}</div>
            <div style={{ fontSize:10, color:C.muted, marginTop:2, fontFamily:C.mono }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      {/* Domain quick ref */}
      <Card style={{ marginBottom:18 }}>
        <SectionHeader icon="🎯" title="Supported UAT Domains" />
        <div style={{ padding:18, display:"flex", flexWrap:"wrap", gap:8 }}>
          {DOMAINS.filter(d=>d.id!=="all").map(d=>(
            <div key={d.id} style={{ display:"flex", alignItems:"center", gap:6, background:`${d.color}12`, border:`1px solid ${d.color}22`, borderRadius:7, padding:"6px 12px" }}>
              <span>{d.icon}</span>
              <span style={{ fontSize:11, color:d.color, fontWeight:700, fontFamily:C.font }}>{d.label}</span>
              <span style={{ fontSize:10, color:C.muted, fontFamily:C.mono }}>{d.full}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Channels */}
      <Card>
        <SectionHeader icon="📡" title="Integration Channels" />
        <div style={{ padding:18, display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
          {[
            { icon:"💬", name:"Slack", cmd:"/testsentinel", status:"Connected", color:"#22c55e" },
            { icon:"📱", name:"WhatsApp", cmd:"Hey TestSentinel", status:"Setup pending", color:C.gold },
            { icon:"🌐", name:"Browser", cmd:"Active now ✓", status:"Live", color:"#60a5fa" },
          ].map((ch,i)=>(
            <div key={i} style={{ background:C.surface, borderRadius:9, padding:14, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:20 }}>{ch.icon}</div>
              <div style={{ fontWeight:700, color:C.text, fontSize:12, marginTop:6, fontFamily:C.font }}>{ch.name}</div>
              <div style={{ color:`${ch.color}`, fontSize:10, marginTop:4, fontFamily:C.mono }}>{ch.cmd}</div>
              <Tag color={ch.color}>{ch.status}</Tag>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  const renderNewSession = () => (
    <div className="fade-in">
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:12 }}>
        <div>
          <h2 style={{ margin:0, color:C.text, fontFamily:C.font, fontWeight:800, fontSize:"1.3em" }}>New UAT Session</h2>
          <p style={{ margin:"3px 0 0", color:C.muted, fontSize:11, fontFamily:C.mono }}>Fill inputs → clarify → confirm objective → generate signoff</p>
        </div>
        <ModelPicker selected={model} onChange={setModel}/>
      </div>

      <StepBar step={step}/>

      {/* ── Step 0: Inputs ── */}
      {step===0 && (
        <div className="fade-in" role="presentation" onKeyDown={(e)=>{ if (e.key==="Enter" && e.target.tagName!=="TEXTAREA") e.preventDefault(); }}>
          {/* JIRA Connector */}
          <Card style={{ marginBottom:16 }}>
            <SectionHeader icon="🔵" title="JIRA Connector" tag="Fetch issue" tagColor="#60a5fa"/>
            <div style={{ padding:18 }}>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                <input
                  type="text"
                  placeholder="e.g. TSP-1889 or paste JIRA browse URL"
                  value={jiraIssueKey}
                  onChange={(e)=>setJiraIssueKey(e.target.value)}
                  onBlur={()=>{ const k = parseJiraIssueKey(jiraIssueKey); if (k) syncPublishDefaultJiraKey(k); }}
                  onKeyDown={(e)=>{ if (e.key==="Enter") { e.preventDefault(); handleFetchJiraUAT(); } }}
                  style={{ flex:1, minWidth:200, ...inp }}
                />
                <button type="button" onClick={handleFetchJiraUAT} disabled={jiraFetchLoading} style={{ padding:"8px 16px", borderRadius:8, fontSize:12, fontWeight:600, cursor: jiraFetchLoading?"wait":"pointer", border:"none", background:"#0052CC", color:"#fff" }}>
                  {jiraFetchLoading ? "Fetching…" : "↓ Fetch"}
                </button>
              </div>
              {jiraFetchError && <div style={{ marginTop:8, fontSize:11, color:"#f87171" }}>{jiraFetchError}</div>}
              {(jiraSubject || jiraDesc) && (
                <div style={{ marginTop:10, padding:12, background:C.surface, borderRadius:8, fontSize:12, color:C.text }}>
                  <span style={{ color:"#22c55e", fontWeight:600 }}>✓ JIRA fetched — subject & description filled below</span>
                </div>
              )}
              <div style={{ marginTop:8, fontSize:11, color:C.muted }}>Fetch summary & description into JIRA Details. Configure JIRA in Connectors (top bar).</div>
            </div>
          </Card>

          {/* Domain Scope */}
          <Card style={{ marginBottom:16 }}>
            <SectionHeader icon="🎯" title="UAT Domain Scope" tag="Required" tagColor="#f87171"/>
            <div style={{ padding:18 }}>
              <p style={{ fontSize:12, color:C.muted, margin:"0 0 14px", fontFamily:C.font }}>Select domains to scope this UAT. The signoff will be strictly constrained to your selection.</p>
              <DomainSelector selected={selectedDomains} onChange={setSelectedDomains}/>
              {selectedDomains.length>0 && (
                <div style={{ marginTop:12, padding:"9px 14px", background:C.surface, borderRadius:7, border:`1px solid ${C.border}`, display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
                  <span style={{ fontSize:11, color:C.muted, fontFamily:C.mono }}>Active scope:</span>
                  {DOMAINS.filter(d=>selectedDomains.includes(d.id)).map(d=>(
                    <span key={d.id} style={{ color:d.color, fontSize:11, fontWeight:700, fontFamily:C.font }}>{d.icon} {d.full}</span>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* JIRA */}
          <Card style={{ marginBottom:16 }}>
            <SectionHeader icon="🔵" title="JIRA Details" tag="JIRA" tagColor="#60a5fa"/>
            <div style={{ padding:18 }}>
              <ModeTab modes={INPUT_MODES} active={jiraMode} onChange={setJiraMode}/>
              {jiraMode==="type" ? (
                <>
                  <div style={{ marginBottom:12 }}>
                    <label style={lbl}>JIRA Subject / Feature Name</label>
                    <input style={{...inp, resize:"none"}} placeholder="e.g. TSP-3516 — Silent Mobile Verification (SMV)" value={jiraSubject} onChange={e=>setJiraSubject(e.target.value)}/>
                  </div>
                  <label style={lbl}>JIRA Description & Acceptance Criteria</label>
                  <textarea style={{...inp, minHeight:100}} placeholder="Paste full description, acceptance criteria, environment details..." value={jiraDesc} onChange={e=>setJiraDesc(e.target.value)}/>
                </>
              ) : (
                <><input ref={jiraRef} type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.md,.csv" style={{display:"none"}} onChange={e=>addFiles(e.target.files,setJiraFiles,setJiraFC)}/>
                <Dropzone fileRef={jiraRef} onDrop={fl=>addFiles(fl,setJiraFiles,setJiraFC)} onBrowse={()=>jiraRef.current.click()} files={jiraFiles} onRemove={i=>removeFile(i,setJiraFiles,setJiraFC)} hint="JIRA export, Word doc, or ticket details file"/></>
              )}
            </div>
          </Card>

          {/* Test Cases */}
          <Card style={{ marginBottom:16 }}>
            <SectionHeader icon="🧪" title="QA Test Cases & Execution Logs" tag="Test Cases" tagColor="#34d399"/>
            <div style={{ padding:18 }}>
              <ModeTab modes={INPUT_MODES} active={testMode} onChange={setTestMode}/>
              {testMode==="type" ? (
                <>
                  <label style={lbl}>Test Cases / Results / Logs</label>
                  <textarea style={{...inp, minHeight:140}} placeholder={"TC_001 | SMV Device Binding | PASS | Registered successfully\nTC_002 | Invalid OTP        | FAIL | Error code mismatch\nTC_003 | Timeout scenario   | BLOCKED | Env issue"} value={testCases} onChange={e=>setTestCases(e.target.value)}/>
                </>
              ) : (
                <><input ref={testRef} type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.md,.csv" style={{display:"none"}} onChange={e=>addFiles(e.target.files,setTestFiles,setTestFC)}/>
                <Dropzone fileRef={testRef} onDrop={fl=>addFiles(fl,setTestFiles,setTestFC)} onBrowse={()=>testRef.current.click()} files={testFiles} onRemove={i=>removeFile(i,setTestFiles,setTestFC)} hint="Excel test plan, CSV results, PDF test report, log file"/></>
              )}
            </div>
          </Card>

          {/* Supporting Docs */}
          <Card style={{ marginBottom:16 }}>
            <SectionHeader icon="📄" title="Supporting Documents & Context" tag="Docs" tagColor="#a78bfa"/>
            <div style={{ padding:18 }}>
              <ModeTab modes={INPUT_MODES} active={docsMode} onChange={setDocsMode}/>
              {docsMode==="type" ? (
                <>
                  <label style={lbl}>NPCI Comms, Release Notes, Known Issues</label>
                  <textarea style={{...inp, minHeight:90}} placeholder="NPCI circular refs, release notes, known issues, signoff authority names..." value={docsText} onChange={e=>setDocsText(e.target.value)}/>
                </>
              ) : (
                <><input ref={docsRef} type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.md,.csv" style={{display:"none"}} onChange={e=>addFiles(e.target.files,setDocsFiles,setDocsFC)}/>
                <Dropzone fileRef={docsRef} onDrop={fl=>addFiles(fl,setDocsFiles,setDocsFC)} onBrowse={()=>docsRef.current.click()} files={docsFiles} onRemove={i=>removeFile(i,setDocsFiles,setDocsFC)} hint="NPCI documents, compliance specs, SRS, supporting material"/></>
              )}
            </div>
          </Card>

          {/* Options */}
          <Card style={{ padding:"16px 20px", marginBottom:16 }}>
            <div style={{ display:"flex", gap:28, alignItems:"center", flexWrap:"wrap" }}>
              <span style={{ fontSize:10, color:C.muted, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:C.font }}>Options</span>
              <Toggle on={webSearch} onChange={setWebSearch} icon="🌐" label="Enable Web Search (NPCI / RBI docs)"/>
            </div>
            <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
              <div style={{ fontSize:10, color:C.muted, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:C.font, marginBottom:10 }}>After generation, auto-publish to</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:16 }}>
                {["jira","telegram","email","slack"].map((ch) => (
                  <label key={ch} style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:12, color:C.text }}>
                    <input type="checkbox" checked={!!autoPublishChannels[ch]} onChange={(e)=>setAutoPublishChannels((p)=>({ ...p, [ch]: e.target.checked }))} />
                    {ch==="jira"&&"JIRA"}
                    {ch==="telegram"&&"Telegram"}
                    {ch==="email"&&"Email"}
                    {ch==="slack"&&"Slack"}
                  </label>
                ))}
              </div>
              <div style={{ fontSize:10, color:C.muted, marginTop:6 }}>Set default destinations in Connectors (top bar).</div>
            </div>
          </Card>

          {statusMsg && <div style={{ background:"#f59e0b18", border:"1px solid #f59e0b44", borderRadius:8, padding:"10px 16px", marginBottom:14, fontSize:12, color:C.gold, fontFamily:C.mono }}>{statusMsg}</div>}

          <div style={{ display:"flex", gap:12 }}>
            <Btn style={{ flex:1 }} size="lg" onClick={handleProceedToClarify} disabled={loading}>
              {loading ? <><Spinner/> &nbsp;Analyzing...</> : "Next: Clarify & Set Objective →"}
            </Btn>
            <Btn variant="ghost" onClick={()=>{resetAll();setView("home");}}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* ── Step 1: Clarify + Objective ── */}
      {step===1 && (
        <div className="fade-in">
          {/* Draft Objective */}
          <Card style={{ marginBottom:16, border:`1px solid ${C.gold}44` }}>
            <SectionHeader icon="🎯" title="Objective" tag="Review & Edit" tagColor={C.gold}/>
            <div style={{ padding:18 }}>
              <p style={{ fontSize:12, color:C.muted, margin:"0 0 12px", fontFamily:C.font, lineHeight:1.7 }}>
                TestSentinel drafted the objective below based on your inputs. <strong style={{color:C.text}}>Edit it freely</strong> — this will define the scope boundaries for the signoff.
              </p>
              <textarea style={{...inp, minHeight:110, border:`1px solid ${C.gold}44`}} value={editedObjective} onChange={e=>setEditedObjective(e.target.value)} placeholder="Objective will appear here..."/>
              <div style={{ marginTop:8, display:"flex", gap:8 }}>
                <Btn variant="outline" size="sm" onClick={()=>setEditedObjective(draftObjective)}>↺ Reset to Draft</Btn>
              </div>
            </div>
          </Card>

          {/* Clarifying Questions */}
          {clarifyRaw && (() => {
            const qMatch = clarifyRaw.match(/QUESTIONS:\s*([\s\S]*)/i);
            const qs = qMatch ? qMatch[1].trim() : "";
            return qs ? (
              <Card style={{ marginBottom:16 }}>
                <SectionHeader icon="💬" title="Clarifying Questions" tag="Optional" tagColor="#94a3b8"/>
                <div style={{ padding:18 }}>
                  <div style={{ background:C.surface, borderRadius:8, padding:16, marginBottom:14, fontSize:12, color:C.subtle, lineHeight:2, whiteSpace:"pre-wrap", fontFamily:C.mono, borderLeft:`3px solid ${C.gold}` }}>{qs}</div>
                  <label style={lbl}>Your Answers (leave blank to skip)</label>
                  <textarea style={{...inp, minHeight:90}} placeholder="Answer any questions to improve the signoff quality..." value={clarifyAnswers} onChange={e=>setClarifyAnswers(e.target.value)}/>
                </div>
              </Card>
            ) : null;
          })()}

          <div style={{ display:"flex", gap:12 }}>
            <Btn style={{ flex:1 }} size="lg" onClick={handleProceedToReview}>
              Next: Review & Generate →
            </Btn>
            <Btn variant="ghost" onClick={()=>setStep(0)}>← Back</Btn>
          </div>
        </div>
      )}

      {/* ── Step 2: Review summary before generating ── */}
      {step===2 && (
        <div className="fade-in">
          <Card style={{ marginBottom:16 }}>
            <SectionHeader icon="📋" title="Review Before Generating" tag="Final Check" tagColor={C.gold}/>
            <div style={{ padding:18 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:16 }}>
                {[
                  { label:"Domains", value: DOMAINS.filter(d=>selectedDomains.includes(d.id)).map(d=>`${d.icon} ${d.label}`).join(", ")||"—" },
                  { label:"JIRA", value: jiraSubject||(jiraFiles[0]?.name)||"From uploaded file" },
                  { label:"Test Cases", value: testCases ? `${testCases.split("\n").filter(Boolean).length} lines pasted` : testFiles.length>0 ? `${testFiles.length} file(s)` : "—" },
                  { label:"Supporting Docs", value: docsText?"Text provided":docsFiles.length>0?`${docsFiles.length} file(s)`:"—" },
                ].map((r,i)=>(
                  <div key={i} style={{ background:C.surface, borderRadius:8, padding:"12px 14px", border:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:10, color:C.muted, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:C.font }}>{r.label}</div>
                    <div style={{ fontSize:12, color:C.text, marginTop:5, fontFamily:C.mono, lineHeight:1.5 }}>{r.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ background:`${C.gold}08`, borderRadius:8, padding:"12px 16px", border:`1px solid ${C.gold}22` }}>
                <div style={{ fontSize:10, color:C.gold, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:C.font, marginBottom:6 }}>Confirmed Objective</div>
                <div style={{ fontSize:12, color:C.subtle, fontFamily:C.mono, lineHeight:1.7 }}>{editedObjective||"(No objective set)"}</div>
              </div>
            </div>
          </Card>

          {statusMsg && <div style={{ background:"#f59e0b18", border:"1px solid #f59e0b44", borderRadius:8, padding:"10px 16px", marginBottom:14, fontSize:12, color:C.gold, fontFamily:C.mono }}>{statusMsg}</div>}

          <div style={{ display:"flex", gap:12 }}>
            <Btn style={{ flex:1 }} size="lg" onClick={handleGenerate} disabled={loading}>
              {loading ? <><Spinner/> &nbsp;Generating Signoff...</> : "🚀 Generate UAT Signoff"}
            </Btn>
            <Btn variant="ghost" onClick={()=>setStep(1)}>← Back</Btn>
          </div>
        </div>
      )}
    </div>
  );

  const ResultView = () => (
    <div className="fade-in">
      {/* Header bar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:22 }}>✅</span>
            <h2 style={{ margin:0, color:C.text, fontFamily:C.font, fontWeight:800, fontSize:"1.2em" }}>UAT Signoff Ready</h2>
            <Tag color="#34d399">Ref #{result?.id}</Tag>
          </div>
          <p style={{ margin:"4px 0 0", color:C.muted, fontSize:11, fontFamily:C.mono }}>{new Date().toLocaleString()}</p>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <Btn variant="ghost" size="sm" onClick={()=>{navigator.clipboard.writeText(result?.signoff||"");setCopied(true);setTimeout(()=>setCopied(false),2000);}}>
            {copied?"✅ Copied":"📋 Copy Signoff"}
          </Btn>
          <Btn variant="outline" size="sm" onClick={()=>{resetAll();setView("new");}}>+ New Session</Btn>
        </div>
      </div>

      {/* Signoff document */}
      <Card style={{ padding:28, marginBottom:20 }}>
        {result?.signoff && <MarkdownRenderer content={result.signoff}/>}
      </Card>

      {result?.signoff && (
        <ShareAndScore
          docType="uat"
          title={jiraSubject || "UAT Signoff"}
          jiraKey={parseJiraIssueKey(jiraIssueKey) || parseJiraIssueKey(jiraSubject) || ""}
          content={result.signoff}
          autoPublish={allowAutoPublish ? Object.keys(autoPublishChannels).filter((k) => autoPublishChannels[k]) : []}
        />
      )}

      {/* ── Feedback Section ── */}
      <Card style={{ marginBottom:20, border:`1px solid #a78bfa44` }}>
        <SectionHeader icon="💬" title="Improve This Signoff" tag="Feedback" tagColor="#a78bfa"/>
        <div style={{ padding:18 }}>
          <p style={{ fontSize:12, color:C.muted, margin:"0 0 14px", fontFamily:C.font, lineHeight:1.7 }}>
            Not satisfied? Provide feedback as text or upload an annotated file. TestSentinel will regenerate an improved version.
          </p>
          <ModeTab modes={INPUT_MODES} active={feedbackMode} onChange={setFeedbackMode}/>
          {feedbackMode==="type" ? (
            <>
              <label style={lbl}>Your Feedback</label>
              <textarea style={{...inp, minHeight:100}} placeholder="e.g. 'TC_005 result should be FAIL not PASS — see bug #204. Also add more detail in risk assessment for fraud scenarios...'" value={feedbackText} onChange={e=>setFeedbackText(e.target.value)}/>
            </>
          ) : (
            <><input ref={fbRef} type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.md,.csv" style={{display:"none"}} onChange={e=>addFiles(e.target.files,setFeedbackFiles,setFeedbackFC)}/>
            <Dropzone fileRef={fbRef} onDrop={fl=>addFiles(fl,setFeedbackFiles,setFeedbackFC)} onBrowse={()=>fbRef.current.click()} files={feedbackFiles} onRemove={i=>removeFile(i,setFeedbackFiles,setFeedbackFC)} hint="Annotated DOCX, PDF review comments, updated test results"/></>
          )}
          {feedbackMemory.length > 0 && (
            <div style={{ marginTop:12, padding:"10px 14px", background:"#052E16", border:"1px solid #16A34A22", borderRadius:9 }}>
              <div style={{ fontSize:11, color:"#16A34A", fontWeight:600, marginBottom:6 }}>🧠 REMEMBERED FEEDBACK ({feedbackMemory.length})</div>
              {feedbackMemory.map((f,i) => <div key={i} style={{ fontSize:11, color:"#4ADE80", marginBottom:2 }}>• {f.slice(0,120)}{f.length>120?"…":""}</div>)}
              <button type="button" onClick={()=>setFeedbackMemory([])} style={{ marginTop:6, background:"none", border:"1px solid #EF444433", borderRadius:7, padding:"3px 10px", color:"#EF4444", fontSize:10, cursor:"pointer" }}>Clear memory</button>
            </div>
          )}
          <div style={{ marginTop:14 }}>
            <Btn onClick={handleFeedback} disabled={feedbackLoading||(!feedbackText.trim()&&feedbackFiles.length===0)}>
              {feedbackLoading?<><Spinner/> &nbsp;Regenerating...</>:"🔄 Regenerate with Feedback"}
            </Btn>
          </div>
        </div>
      </Card>

      <div style={{ display:"flex", gap:12 }}>
        <Btn variant="ghost" onClick={()=>setView("history")}>📚 View History</Btn>
        <Btn variant="ghost" onClick={()=>setView("home")}>🏠 Home</Btn>
      </div>
    </div>
  );

  const HistoryView = () => {
    const hist = getHistory();
    const now = Date.now();
    const groups = {
      "Today": hist.filter(h=>now-new Date(h.ts)<86400000),
      "This Week": hist.filter(h=>{ const d=now-new Date(h.ts); return d>=86400000&&d<7*86400000; }),
      "This Month": hist.filter(h=>{ const d=now-new Date(h.ts); return d>=7*86400000&&d<30*86400000; }),
    };
    return (
      <div className="fade-in">
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:22 }}>
          <div>
            <h2 style={{ margin:0, color:C.text, fontFamily:C.font, fontWeight:800 }}>UAT History</h2>
            <p style={{ margin:"3px 0 0", color:C.muted, fontSize:11, fontFamily:C.mono }}>Last 30 days · {hist.length} session{hist.length!==1?"s":""}</p>
          </div>
          <Btn onClick={()=>{resetAll();setView("new");}}>+ New Session</Btn>
        </div>

        {hist.length===0 ? (
          <Card style={{ textAlign:"center", padding:56 }}>
            <div style={{ fontSize:36, marginBottom:12 }}>📭</div>
            <div style={{ color:C.muted, fontSize:13, fontFamily:C.font }}>No UAT sessions yet.</div>
          </Card>
        ) : (
          Object.entries(groups).map(([groupName, items])=>
            items.length>0 ? (
              <div key={groupName} style={{ marginBottom:24 }}>
                <div style={{ fontSize:10, color:C.muted, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", fontFamily:C.font, marginBottom:10, paddingLeft:4 }}>{groupName}</div>
                {items.map(h=>(
                  <Card key={h.id} className="hover-lift" style={{ marginBottom:10, cursor:"pointer", transition:"all 0.2s" }}
                    onMouseEnter={e=>{ e.currentTarget.style.borderColor=C.gold; }}
                    onMouseLeave={e=>{ e.currentTarget.style.borderColor=C.border; }}
                    onClick={()=>{
                      if (!h.signoff || !String(h.signoff).trim()) return;
                      setAllowAutoPublish(false);
                      setJiraSubject(typeof h.jira === "string" ? h.jira : "");
                      if (h.jiraKey) setJiraIssueKey(String(h.jiraKey));
                      setEditedObjective(h.objective || "");
                      setStep(3);
                      setResult({ signoff: h.signoff, id: h.id, domains: h.domains || [] });
                      setView("result");
                    }}
                  >
                    <div style={{ padding:"14px 18px", display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, color:C.text, marginBottom:8, fontSize:13, fontFamily:C.font }}>
                          #{h.id} — {h.jira}
                        </div>
                        <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
                          <Tag color={C.muted}>{h.model}</Tag>
                          {h.domains?.map(d=>{ const dom=DOMAINS.find(x=>x.label===d); return <Tag key={d} color={dom?.color||C.muted}>{dom?.icon} {d}</Tag>; })}
                        </div>
                        {h.objective && <div style={{ marginTop:8, fontSize:11, color:C.muted, fontFamily:C.mono, lineHeight:1.5 }}>Objective: {h.objective.slice(0,120)}{h.objective.length>120?"...":""}</div>}
                      </div>
                      <div style={{ color:C.muted, fontSize:10, flexShrink:0, fontFamily:C.mono, textAlign:"right" }}>
                        {new Date(h.ts).toLocaleDateString()}<br/>
                        {new Date(h.ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : null
          )
        )}
      </div>
    );
  };

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text }}>
      {/* Nav */}
      <nav style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"13px 28px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, position:"sticky", top:0, zIndex:100, backdropFilter:"blur(10px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, cursor:"pointer" }} onClick={()=>setView("home")}>
          <div style={{ width:34, height:34, background:`linear-gradient(135deg, ${C.gold}, #f0cc6a)`, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0, boxShadow:`0 0 14px ${C.gold}44` }}>🛡️</div>
          <div>
            <div style={{ fontWeight:800, fontSize:15, color:C.text, letterSpacing:"-0.03em", fontFamily:C.font }}>TestSentinel</div>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.1em", textTransform:"uppercase", fontFamily:C.mono }}>UAT Signoff Agent</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          {[
            { id:"home", label:"Home" },
            { id:"new", label:"New Session" },
            { id:"history", label:`History${getHistory().length?` (${getHistory().length})`:""}`},
          ].map(tab=>(
            <button type="button" key={tab.id} onClick={()=>{ if(tab.id==="new"){resetAll();} setView(tab.id); }} style={{
              background: view===tab.id?`${C.gold}22`:"transparent",
              color: view===tab.id?C.gold:C.muted,
              border: view===tab.id?`1px solid ${C.gold}44`:"1px solid transparent",
              borderRadius:7, padding:"6px 14px", cursor:"pointer",
              fontSize:12, fontWeight:view===tab.id?700:500, fontFamily:C.font, transition:"all 0.15s"
            }}>{tab.label}</button>
          ))}
        </div>
        <ModelPicker selected={model} onChange={setModel}/>
      </nav>

      <main style={{ maxWidth:960, margin:"0 auto", padding:"28px 20px" }}>
        {view==="home" && <HomeView/>}
        {view==="new" && renderNewSession()}
        {view==="result" && result && <ResultView/>}
        {view==="history" && <HistoryView/>}
      </main>

      <footer style={{ borderTop:`1px solid ${C.border}`, padding:"14px 28px", textAlign:"center", fontSize:10, color:"#334155", fontFamily:C.mono }}>
        TestSentinel · Domain-Scoped UAT · RAG-enabled · Multi-model · <span style={{color:C.gold}}>Powered by Anthropic</span>
      </footer>
    </div>
  );
}
