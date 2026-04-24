import { useState, useRef, useEffect } from "react";
import { API_BASE, sendCompletionNotify } from "./config.js";
import ShareAndScore from "./ShareAndScore.jsx";
import { syncPublishDefaultJiraKey, loadPublishDefaults, syncPublishJiraSiteFromIssue, getLlmProviderForRequest, getLlmDisabledForRequest, getBedrockModelTierForRequest } from "./ConnectorsStatus.jsx";
import { exportAgentOutput } from "./agentExport.js";
import { buildShareSubjectLine } from "./shareSubject.js";
import { buildAgentPrefaceContext } from "./agentContextPipeline.js";

// ── Constants ────────────────────────────────────────────────────────────────
const MODELS = [
  { id: "claude-sonnet-4-20250514", label: "Sonnet 4.6", color: "#F59E0B" },
  { id: "claude-opus-4-20250514",   label: "Opus 4.6",   color: "#A78BFA" },
  { id: "claude-haiku-4-5-20251001",label: "Haiku 4.5",  color: "#34D399" },
];

const PRD_SECTIONS = [
  { key:"problem",       title:"Problem Statement",             icon:"🎯" },
  { key:"objective",     title:"Objective",                     icon:"📌" },
  { key:"scope",         title:"Scope of Work",                 icon:"📐" },
  { key:"current_arch",  title:"Current Architecture",          icon:"🏗️" },
  { key:"proposed_arch", title:"Proposed Architecture",         icon:"🔮" },
  { key:"timeout",       title:"Timeout / Idempotency / Retry", icon:"⏱️" },
  { key:"additional",    title:"Additional Requirements",       icon:"➕" },
  { key:"fund_loss",     title:"Fund Loss & Monitoring",        icon:"📊" },
  { key:"rollout",       title:"Rollout Plan",                  icon:"🚀" },
  { key:"backward",      title:"Backward Compatibility",        icon:"🔄" },
  { key:"references",    title:"Reference Documents",           icon:"📚" },
  { key:"uat",           title:"UAT Acceptance Cases",          icon:"✅" },
  { key:"npci_musts",    title:"NPCI-Mandated MUSTs",           icon:"📋" },
  { key:"appendix",      title:"Appendix (Ops / Compliance)",   icon:"🗂️" },
];

const BATCHES = [
  ["problem","objective","scope"],
  ["current_arch","proposed_arch"],
  ["timeout","additional","fund_loss"],
  ["rollout","backward","references","uat"],
  ["npci_musts","appendix"],
];

// ── Preset manual feedback items ─────────────────────────────────────────────
const PRESET_FEEDBACK = [
  {
    id: "spec_split",
    label: "Split Spec vs Assumptions",
    icon: "🔀",
    color: "#7C3AED",
    description: "Add 'NPCI-mandated MUSTs (with clause refs)' vs 'Paytm design choices' section",
    prompt: `Split the PRD into two clearly labeled subsections wherever requirements are stated:
1. "NPCI-Mandated MUSTs" — requirements directly mandated by NPCI/RBI circulars, with specific clause/circular references.
2. "Design Choices / Assumptions" — internal architectural or product decisions not mandated by regulation.
Update the npci_musts section to contain the NPCI-mandated items with clause references, and annotate proposed_arch and additional sections with [MUST] vs [CHOICE] tags.`,
  },
  {
    id: "protocol_story",
    label: "Normalize Protocol Story",
    icon: "🔌",
    color: "#0891B2",
    description: "One consistent description: POS→Switch format, Switch→NPCI format, ISO vs XML mapping",
    prompt: `Normalize the protocol/message format story across the PRD. Ensure there is exactly one consistent description covering:
- What format arrives from POS/terminal to your Switch (ISO 8583 fields, TLV, etc.)
- What transformation the Switch performs
- What format goes to NPCI (XML/JSON, UPI TSD fields)
- Where ISO vs XML vs JSON applies and at which hop
Update current_arch and proposed_arch to reflect this consistently. Remove any contradictions.`,
  },
  {
    id: "api_rationalize",
    label: "Rationalize APIs",
    icon: "🔧",
    color: "#059669",
    description: "Either extend /v1/upi/pay with txnType=TAP_PAY or keep /v2 with explicit versioning strategy",
    prompt: `Rationalize the API design in proposed_arch. Choose exactly one strategy and apply it consistently:
Option A: Extend existing /v1/upi/pay with txnType=TAP_PAY and additional payload fields — no new endpoint.
Option B: Keep /v2/... but explicitly define: versioning scheme, migration path from v1, backward compatibility contract, deprecation timeline for v1.
Whichever is chosen, remove the ambiguity and ensure backward section is consistent with the chosen strategy.`,
  },
  {
    id: "state_machine",
    label: "Tighten State Machine",
    icon: "⚙️",
    color: "#D97706",
    description: "Reduce to minimal states that map cleanly to ledger + recon + support tooling",
    prompt: `Tighten the transaction state machine in proposed_arch and current_arch.
Reduce to a minimal set of states (ideally ≤7) that:
- Map 1:1 to ledger entries (debit/credit/hold/release)
- Are directly queryable in recon reports
- Are meaningful to support tooling (L1/L2 can act on each state)
- Cover all terminal states (SUCCESS, FAILED, REVERSED, DEEMED, EXPIRED)
Label each state transition with the trigger event and the responsible system (Switch/NPCI/PG/TPAP).`,
  },
  {
    id: "appendix_move",
    label: "Move Ops/Compliance to Appendix",
    icon: "📎",
    color: "#6366F1",
    description: "Keep core PRD lean; move monitoring, compliance logging, PA reporting to appendix",
    prompt: `Restructure the PRD for leanness:
- Keep core sections focused on the feature's functional and technical requirements only.
- Move the following to the appendix section with stub references: Monitoring & alerting spec, Compliance logging spec, PA/PSP reporting spec, Dashboard requirements.
- In fund_loss and additional, replace moved content with a one-liner reference: "See Appendix — [spec name]".
- Update the appendix section to list each moved item with a brief description and owner team.`,
  },
];

const BASE_SYSTEM = `You are a senior product manager and technical architect specializing in UPI payment systems, NPCI regulations, and fintech infrastructure. You generate detailed, technically accurate PRD sections for UPI Switch features.
CRITICAL RULES:
- Return ONLY a valid JSON object — no markdown fences, no preamble, no explanation
- Keep each field value under 1200 characters to avoid truncation
- Use plain text with newlines (\\n) inside JSON strings — never actual line breaks inside a JSON string value
- Be concise but technically precise`;

const sectionPrompt = (keys, req) => {
  const D = {
    problem:      "What is needed and why, business/regulatory context, impact if not done",
    objective:    "3-5 measurable goals with KPIs (e.g. reduce deemed txn rate to <0.01%)",
    scope:        "In-Scope items and Out-of-Scope items as two clearly labeled subsections",
    current_arch: "Existing API flows, state machine states, data structures, known gaps",
    proposed_arch:"New/changed APIs, state machine changes, NPCI/PG/TPAP status codes, screen changes, Recon and Check-Status handling",
    timeout:      "Timeout thresholds per flow step (T+x min), retry intervals, max retries, idempotency key design, dedup window duration",
    additional:   "Reconciliation approach, Compliance service integration, Risk level classification, Refund flow, Reporting requirements",
    fund_loss:    "Key metrics: Success Rate, GMV, Pending txn count, Deemed rate %, TAT breaches, Error code monitoring; alert thresholds; dashboard requirements",
    rollout:      "Phased plan (Phase 1/2/3 with dates), feature flag names, canary traffic %, rollback trigger criteria",
    backward:     "API versioning strategy (v1 vs v2), migration path, deprecated endpoints and sunset timeline",
    references:   "List all relevant NPCI TSDs, NPCI circulars, RBI circulars, internal design docs",
    uat:          "Numbered test cases covering happy path, retry scenarios, timeout expiry, all error codes, edge cases",
    npci_musts:   "List all NPCI/RBI mandated requirements with exact circular/TSD clause references. Label each [MUST]. Separate from internal design choices.",
    appendix:     "Stubs for: Monitoring & Alerting spec, Compliance Logging spec, PA/PSP Reporting spec, Dashboard spec. Each with owner team and link placeholder.",
  };
  const fields = keys.map(k=>`"${k}": "..."`).join(",\n  ");
  const descs  = keys.map(k=>`- ${k}: ${D[k]}`).join("\n");
  return `Generate ONLY these PRD sections:\n\nREQUIREMENT:\n${req}\n\nReturn JSON with exactly:\n{\n  ${fields}\n}\n\n${descs}\n\nUse \\n for line breaks. Keep each value under 3000 chars. Be thorough — do NOT truncate or abbreviate. Return ONLY the JSON object.`;
};

const CLARIFY_PROMPT = `Give exactly 4 short clarifying questions to improve the PRD. Focus on UPI-specific technical gaps or regulatory ambiguity.\nReturn ONLY a JSON array: ["q1","q2","q3","q4"]`;

const DOMAIN_BOUNDARY_PROMPT = `You are a senior UPI architect reviewing a feature requirement before PRD generation.
Analyze the requirement and identify if there are ambiguous domain boundaries that need clarification — e.g. which system owns a flow (Switch vs TPAP vs PSP vs PG vs NPCI), which team is responsible for an API, or where a responsibility boundary is unclear.
Return ONLY a JSON object with no markdown:
{"needsClarification":true/false,"questions":["q1","q2"]}
Max 2 sharp questions. If clear enough, set needsClarification to false and questions to [].`;

const TERMINOLOGY_PROMPT = `You are a senior UPI architect reviewing a feature requirement before PRD generation.
Analyze the requirement and identify any ambiguous or undefined terms, acronyms, or UPI-specific jargon that could be interpreted differently by different teams.
Return ONLY a JSON object with no markdown:
{"needsClarification":true/false,"terms":[{"term":"...","question":"..."}]}
If all terms are standard and unambiguous, set needsClarification to false and terms to [].`;

// ── Helpers ──────────────────────────────────────────────────────────────────
function repairJSON(text) {
  let s = text.replace(/```json|```/g,"").trim();
  try { return JSON.parse(s); } catch(_) {}
  const a=s.indexOf("{"), b=s.lastIndexOf("}");
  if (a!==-1&&b!==-1){ s=s.slice(a,b+1); try{return JSON.parse(s);}catch(_){} }
  const res={}, re=/"([\w]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g; let m;
  while((m=re.exec(s))!==null){ try{res[m[1]]=JSON.parse(`"${m[2]}"`);}catch(_){res[m[1]]=m[2];} }
  if(Object.keys(res).length>0) return res;
  throw new Error("Could not parse JSON from response");
}

const HISTORY_KEY = "prd-history-v3";
const HISTORY_MAX_DAYS = 60;

const PRD_FEEDBACK_MEM_KEY = "prd-feedback-memory-v1";
function loadFeedbackMemory() { try { return JSON.parse(localStorage.getItem(PRD_FEEDBACK_MEM_KEY) || "[]"); } catch { return []; } }
function saveFeedbackMemoryLS(m) { try { localStorage.setItem(PRD_FEEDBACK_MEM_KEY, JSON.stringify(m.slice(0, 20))); } catch {} }

function getStorage() {
  if (typeof window === "undefined") return null;
  // Always use browser localStorage with { value } shape. A global `window.storage` from
  // another tool can return a different shape and silently empty PRD history.
  return {
    get: (key) => Promise.resolve({ value: localStorage.getItem(key) }),
    set: (key, value) => Promise.resolve(localStorage.setItem(key, value)),
  };
}

function historyEntryTimestampMs(h) {
  if (!h || typeof h !== "object") return NaN;
  if (typeof h.createdAt === "number" && !Number.isNaN(h.createdAt)) return h.createdAt;
  if (typeof h.updatedAt === "number" && !Number.isNaN(h.updatedAt)) return h.updatedAt;
  if (h.ts) {
    const t = Date.parse(String(h.ts));
    if (!Number.isNaN(t)) return t;
  }
  const id = h.id;
  if (id != null && id !== "") {
    const n = typeof id === "number" ? id : parseInt(String(id), 10);
    if (!Number.isNaN(n) && n > 1e11) return n;
  }
  return NaN;
}

function filterHistoryByRetention(entries, maxDays = HISTORY_MAX_DAYS) {
  if (!Array.isArray(entries)) return [];
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  return entries.filter((h) => {
    const ts = historyEntryTimestampMs(h);
    if (Number.isNaN(ts)) return true;
    return ts >= cutoff;
  });
}

async function loadHistory() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const r = await storage.get(HISTORY_KEY);
    const raw = r?.value != null ? r.value : null;
    const parsed = raw ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : [];
    return filterHistoryByRetention(Array.isArray(parsed) ? parsed : []);
  } catch (e) {
    console.warn("loadHistory:", e);
    return [];
  }
}

async function saveHistory(h) {
  const storage = getStorage();
  if (!storage) return;
  try {
    const toSave = filterHistoryByRetention(Array.isArray(h) ? h : [], HISTORY_MAX_DAYS);
    await storage.set(HISTORY_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn("saveHistory:", e);
  }
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ color="#F59E0B" }) {
  return <div style={{ width:14, height:14, border:"2px solid #1E293B", borderTop:`2px solid ${color}`, borderRadius:"50%", animation:"spin .7s linear infinite", flexShrink:0 }}/>;
}

// ── Flat PRD Document view ────────────────────────────────────────────────────
function PRDDocument({ prd, phase }) {
  if (!prd) return null;
  return (
    <div style={{ background:"#0A1120", borderRadius:12, padding:"28px 32px", fontFamily:"'IBM Plex Sans',sans-serif", lineHeight:1.8 }}>
      <div style={{ borderBottom:"2px solid #1E3A5F", paddingBottom:20, marginBottom:28 }}>
        <div style={{ fontSize:11, color:"#F59E0B", fontWeight:700, letterSpacing:2, textTransform:"uppercase", marginBottom:8 }}>Product Requirement Document</div>
        <div style={{ fontSize:24, fontWeight:700, color:"#F1F5F9", marginBottom:6 }}>{prd.title||"UPI Switch PRD"}</div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
          <span style={{ fontSize:12, color:"#475569" }}>Version: <span style={{ color:"#93C5FD" }}>{prd.version||"v1.0"}</span></span>
          <span style={{ fontSize:12, color:"#475569" }}>Date: <span style={{ color:"#93C5FD" }}>{new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</span></span>
          {phase==="generating"&&<span style={{ fontSize:12, color:"#F59E0B", animation:"shimmer 1.5s infinite" }}>⏳ Generating…</span>}
          {phase==="improving"&&<span style={{ fontSize:12, color:"#A78BFA", animation:"shimmer 1.5s infinite" }}>✨ Improving…</span>}
        </div>
      </div>
      {PRD_SECTIONS.map((sec, i) => {
        const content = prd[sec.key];
        if (!content && phase !== "generating" && phase !== "improving") return null;
        return (
          <div key={sec.key} style={{ marginBottom:32 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, paddingBottom:6, borderBottom:"1px solid #1E293B" }}>
              <span style={{ fontSize:18 }}>{sec.icon}</span>
              <span style={{ fontSize:15, fontWeight:700, color:"#E2E8F0" }}>{sec.title}</span>
              <span style={{ fontSize:10, color:"#334155", background:"#111827", borderRadius:4, padding:"2px 7px", fontFamily:"monospace" }}>§{String(i+1).padStart(2,"0")}</span>
              {!content && (phase==="generating"||phase==="improving") && <span style={{ fontSize:11, color:"#F59E0B", animation:"shimmer 1s infinite" }}>generating…</span>}
            </div>
            {content && content.split("\n").map((line, li) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={li} style={{ height:6 }}/>;
              const isBullet = trimmed.startsWith("- ") || trimmed.startsWith("• ");
              const isSubHead = trimmed.startsWith("## ");
              const isMust = trimmed.includes("[MUST]");
              const isChoice = trimmed.includes("[CHOICE]");
              if (isSubHead) return <div key={li} style={{ fontSize:13, fontWeight:700, color:"#93C5FD", marginTop:14, marginBottom:4 }}>{trimmed.replace(/^#+\s*/,"")}</div>;
              if (isBullet) return (
                <div key={li} style={{ display:"flex", gap:10, marginBottom:4, paddingLeft:8 }}>
                  <span style={{ color:"#F59E0B", flexShrink:0, fontSize:12, lineHeight:"22px" }}>▸</span>
                  <span style={{ fontSize:13, color: isMust?"#FCA5A5": isChoice?"#86EFAC":"#94A3B8", lineHeight:1.7 }}>{trimmed.slice(2)}</span>
                </div>
              );
              return <p key={li} style={{ fontSize:13, color: isMust?"#FCA5A5": isChoice?"#86EFAC":"#94A3B8", margin:"0 0 6px", lineHeight:1.75 }}>{trimmed}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── History panel ─────────────────────────────────────────────────────────────
function HistoryPanel({ history, onLoad, onDelete, onClear, onClose }) {
  const [search, setSearch] = useState("");
  const filtered = history.filter(h =>
    (h.prd?.title||"").toLowerCase().includes(search.toLowerCase()) ||
    (h.requirement||"").toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div style={{ position:"fixed", top:0, right:0, bottom:0, width:420, background:"#060D1A", borderLeft:"1px solid #1E293B", zIndex:100, display:"flex", flexDirection:"column", animation:"slideIn .25s ease" }}>
      <div style={{ padding:"16px 20px", borderBottom:"1px solid #1E293B", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div><div style={{ fontSize:14, fontWeight:700, color:"#F1F5F9" }}>📋 PRD History</div><div style={{ fontSize:11, color:"#374151" }}>{history.length} saved · entries older than 60 days are hidden</div></div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {history.length>0 && <button onClick={onClear} style={{ background:"none", border:"1px solid #EF444433", borderRadius:7, padding:"4px 10px", color:"#EF4444", fontSize:11, cursor:"pointer" }}>Clear all</button>}
          <button onClick={onClose} style={{ background:"#1E293B", border:"none", borderRadius:8, width:28, height:28, color:"#94A3B8", fontSize:18, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>
      </div>
      <div style={{ padding:"10px 16px", borderBottom:"1px solid #111827" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search PRDs…"
          style={{ width:"100%", background:"#0D1626", border:"1px solid #1E293B", borderRadius:8, color:"#CBD5E1", fontSize:12, padding:"7px 12px", fontFamily:"inherit" }}/>
      </div>
      <div style={{ flex:1, overflow:"auto", padding:"12px 14px" }}>
        {filtered.length===0
          ? <div style={{ textAlign:"center", padding:40, color:"#1E3A5F" }}><div style={{ fontSize:28 }}>📭</div><div style={{ fontSize:13, marginTop:8 }}>{search?"No results":"No PRDs yet"}</div></div>
          : filtered.map(item=>(
            <div key={item.id} style={{ background:"#0D1626", border:"1px solid #1E293B", borderRadius:12, padding:"14px 16px", marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:8 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"#E2E8F0", marginBottom:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.prd?.title||"Untitled PRD"}</div>
                  <div style={{ fontSize:11, color:"#475569", marginBottom:7, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.requirement?.slice(0,70)}{item.requirement?.length>70?"…":""}</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
                    <span style={{ fontSize:10, color:"#334155", background:"#111827", borderRadius:4, padding:"2px 7px" }}>{item.model}</span>
                    <span style={{ fontSize:10, color:"#334155", background:"#111827", borderRadius:4, padding:"2px 7px" }}>{item.prd?.version||"v1.0"}</span>
                    <span style={{ fontSize:10, color:"#334155" }}>{item.date}</span>
                  </div>
                  <div style={{ display:"flex", gap:3 }}>{PRD_SECTIONS.map(s=><span key={s.key} title={s.title} style={{ fontSize:12, opacity:item.prd?.[s.key]?1:.15 }}>{s.icon}</span>)}</div>
                </div>
                <button onClick={()=>onDelete(item.id)} style={{ background:"none", border:"none", color:"#334155", cursor:"pointer", fontSize:16, alignSelf:"flex-start" }}>🗑</button>
              </div>
              <button onClick={()=>onLoad(item)} style={{ width:"100%", marginTop:10, background:"linear-gradient(135deg,#1E3A5F,#1E293B)", border:"1px solid #1E3A5F", borderRadius:8, padding:"7px", color:"#93C5FD", fontSize:12, fontWeight:600, cursor:"pointer" }}>📂 Load PRD</button>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PRDAgent() {
  const [model, setModel]           = useState(MODELS[0]);
  const [input, setInput]           = useState("");
  const [files, setFiles]           = useState([]);
  const [phase, setPhase]           = useState("idle");
  const [prd, setPrd]               = useState(null);
  const [progress, setProgress]     = useState({ done:0, total:BATCHES.length });
  const [questions, setQuestions]   = useState([]);
  const [answers, setAnswers]       = useState(["","","",""]);
  const [loading, setLoading]       = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError]           = useState("");
  const [convHistory, setConvHistory] = useState([]);
  const [history, setHistory]       = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copyMdDone, setCopyMdDone]   = useState(false);
  const [copyTxtDone, setCopyTxtDone] = useState(false);
  const [skipClarify, setSkipClarify] = useState(false);
  const [otherFeedback, setOtherFeedback] = useState("");
  const [otherFeedbackUploading, setOtherFeedbackUploading] = useState(false);

  // ── Manual Feedback state ──────────────────────────────────────────────────
  const [selectedPresets, setSelectedPresets] = useState(new Set());
  const [manualFeedback, setManualFeedback]   = useState("");
  const [showFeedback, setShowFeedback]       = useState(false);
  const [feedbackLog, setFeedbackLog]         = useState([]);  // [{type,label,ts}]
  const [feedbackMemory, setFeedbackMemory]   = useState(() => loadFeedbackMemory());

  // ── Pre-generation feedback state ─────────────────────────────────────────
  const [preFeedbackPhase, setPreFeedbackPhase] = useState("idle");
  const [domainQuestions, setDomainQuestions]   = useState([]);
  const [domainAnswers, setDomainAnswers]       = useState([]);
  const [termItems, setTermItems]               = useState([]);
  const [termAnswers, setTermAnswers]           = useState([]);
  const [preFeedbackCtx, setPreFeedbackCtx]     = useState("");

  // ── JIRA Connector & auto-publish ─────────────────────────────────────────
  const [jiraIssueKey, setJiraIssueKey]         = useState("");
  const [jiraFetchLoading, setJiraFetchLoading] = useState(false);
  const [jiraFetchError, setJiraFetchError]     = useState("");
  const [autoPublishChannels, setAutoPublishChannels] = useState({ jira: false, telegram: false, email: false, slack: false });
  const [allowAutoPublish, setAllowAutoPublish] = useState(false);

  const fileRef   = useRef();
  const bottomRef = useRef();
  const hasSentNotifyRef = useRef(false);
  const latestPrefaceRef = useRef("");
  const [contextStage, setContextStage] = useState(null);

  useEffect(() => { loadHistory().then(setHistory); }, []);
  useEffect(() => {
    const onImport = () => {
      loadHistory().then(setHistory);
      setFeedbackMemory(loadFeedbackMemory());
    };
    window.addEventListener("agent-localstorage-imported", onImport);
    return () => window.removeEventListener("agent-localstorage-imported", onImport);
  }, []);
  useEffect(() => {
    if (phase === "done" && showFeedback) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [phase, prd, questions, progress]);
  useEffect(() => { saveFeedbackMemoryLS(feedbackMemory); }, [feedbackMemory]);

  const readFile = f => new Promise(res=>{
    const r=new FileReader();
    r.onload=e=>res(`[File: ${f.name}]\n${e.target.result.slice(0,4000)}`);
    r.onerror=()=>res(`[Could not read: ${f.name}]`);
    r.readAsText(f);
  });

  const preparePreface = async (reqSnippet) => {
    const histLines = history.slice(0, 4).map(
      (h) => `PRD: ${h.prd?.title || "Untitled"} — ${(h.requirement || "").slice(0, 180)}`
    );
    const convLines = (convHistory || []).slice(-8).map((m) => `${m.role}: ${String(m.content || "").slice(0, 220)}`);
    return buildAgentPrefaceContext({
      apiBase: API_BASE,
      query: reqSnippet,
      historyLines: histLines,
      convLines: convLines.filter(Boolean),
      onStep: (s) => setContextStage(s),
    });
  };

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

  const handleFetchJiraPRD = async () => {
    const raw = jiraIssueKey.trim();
    const key = parseJiraIssueKey(raw);
    if (!key && !raw) { setJiraFetchError("Enter a JIRA issue key (e.g. TSP-1889) or paste a JIRA URL."); return; }
    setJiraFetchError("");
    setJiraFetchLoading(true);
    try {
      const defs = loadPublishDefaults();
      const site = defs.jiraWriteSite;
      const siteQs = site && site !== "auto" ? `?site=${encodeURIComponent(site)}` : "";
      const idParam = raw || key;
      const r = await fetch(`${API_BASE}/api/jira-issue/${encodeURIComponent(idParam)}${siteQs}`, { headers: { Accept: "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `JIRA error ${r.status}`);
      const parts = [d.summary ? `JIRA: ${d.id} — ${d.summary}` : `JIRA: ${d.id}`, d.description, d.acceptanceCriteria ? `Acceptance criteria:\n${d.acceptanceCriteria}` : ""].filter(Boolean);
      setInput(parts.join("\n\n"));
      syncPublishDefaultJiraKey(d.id || key);
      syncPublishJiraSiteFromIssue(d);
    } catch (e) {
      setJiraFetchError(e.message || "JIRA fetch failed");
    }
    setJiraFetchLoading(false);
  };

  const callAPI = async (messages, sys, opts = {}) => {
    const prefaceContext = typeof opts.prefaceContext === "string" ? opts.prefaceContext.trim() : "";
    const res = await fetch(`${API_BASE}/api/generate`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:model.id,
        max_tokens:8000,
        system:sys||BASE_SYSTEM,
        messages,
        llmProvider: getLlmProviderForRequest(),
        llmDisabled: getLlmDisabledForRequest(),
        bedrockModelTier: getBedrockModelTierForRequest(),
        ...(prefaceContext ? { prefaceContext } : {}),
      }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { _raw: text }; }

    if (!res.ok) {
      const msg =
        (data && data.message) ||
        (data && data.error && (data.error.message || data.error)) ||
        (typeof data?._raw === "string" ? data._raw : null) ||
        `Request failed with status ${res.status}`;
      throw new Error(msg);
    }

    // Support both raw upstream shape and our proxy wrapper shape.
    const payload = (data && data.content) ? data : (data && data.data) ? data.data : data;
    const blocks = payload?.content;
    if (!Array.isArray(blocks)) {
      throw new Error("Unexpected LLM response shape (missing content array).");
    }
    return blocks.filter(b=>b.type==="text").map(b=>b.text).join("");
  };

  const generateInBatches = async (req, prefaceContext = "") => {
    let combined = {};
    for (let i=0; i<BATCHES.length; i++) {
      const batch = BATCHES[i];
      setLoadingMsg(`Generating batch ${i+1}/${BATCHES.length}: ${batch.map(k=>PRD_SECTIONS.find(s=>s.key===k)?.icon).join(" ")} …`);
      setProgress({ done:i, total:BATCHES.length });
      const raw = await callAPI([{ role:"user", content:sectionPrompt(batch, req) }], undefined, { prefaceContext });
      let parsed;
      try {
        parsed = repairJSON(raw);
      } catch (e) {
        parsed = {};
        batch.forEach(k=>{parsed[k]="(Generation failed — please retry)";});
      }
      combined = { ...combined, ...parsed };
      setPrd((prev) => ({ ...(prev || {}), ...parsed }));
    }
    setProgress({ done:BATCHES.length, total:BATCHES.length });
    return combined;
  };

  const persistToHistory = async (prdData, req) => {
    const now = Date.now();
    const entry = { id: now.toString(), createdAt: now, date: new Date().toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}), model: model.label, requirement: req.slice(0,200), prd: prdData };
    const updated = [entry, ...history].slice(0, 100);
    setHistory(updated);
    await saveHistory(updated);
  };

  // ── Pre-generation checks ──────────────────────────────────────────────────
  const handleStartPreFeedback = async () => {
    if (!input.trim() && files.length===0) { setError("Please enter a requirement or upload a document."); return; }
    setError(""); setLoading(true); setPreFeedbackPhase("domain_check");
    setLoadingMsg("Checking domain boundary ambiguities…");
    try {
      let req = input.trim();
      for (const f of files) req += "\n\n" + await readFile(f);
      let pf = "";
      try {
        pf = await preparePreface(req);
        latestPrefaceRef.current = pf;
      } finally {
        setContextStage(null);
      }
      const raw = await callAPI([{ role:"user", content:`REQUIREMENT:\n${req.slice(0,800)}\n\n${DOMAIN_BOUNDARY_PROMPT}` }], BASE_SYSTEM, { prefaceContext: pf });
      let parsed = { needsClarification: false, questions: [] };
      try { parsed = repairJSON(raw); } catch(_) {}
      if (parsed.needsClarification && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        setDomainQuestions(parsed.questions);
        setDomainAnswers(parsed.questions.map(()=>""));
        setPreFeedbackPhase("domain_input");
      } else {
        await runTermCheck(req, "", pf);
      }
    } catch(e) { setError("Error: "+e.message); setPreFeedbackPhase("idle"); }
    setLoading(false); setLoadingMsg("");
  };

  const handleDomainContinue = async () => {
    const ctx = domainQuestions.map((q,i)=> domainAnswers[i]?.trim() ? `Domain Q: ${q}\nA: ${domainAnswers[i]}` : null).filter(Boolean).join("\n\n");
    setPreFeedbackCtx(ctx);
    setPreFeedbackPhase("term_check"); setLoading(true); setLoadingMsg("Checking terminology ambiguities…");
    let req = input.trim();
    for (const f of files) req += "\n\n" + await readFile(f);
    await runTermCheck(req, ctx, latestPrefaceRef.current);
    setLoading(false); setLoadingMsg("");
  };

  const runTermCheck = async (req, domainCtx, prefaceContext = "") => {
    try {
      const pf = typeof prefaceContext === "string" && prefaceContext.trim() ? prefaceContext : latestPrefaceRef.current || "";
      const raw = await callAPI([{ role:"user", content:`REQUIREMENT:\n${req.slice(0,800)}\n\n${TERMINOLOGY_PROMPT}` }], BASE_SYSTEM, { prefaceContext: pf });
      let parsed = { needsClarification: false, terms: [] };
      try { parsed = repairJSON(raw); } catch(_) {}
      if (parsed.needsClarification && Array.isArray(parsed.terms) && parsed.terms.length > 0) {
        setTermItems(parsed.terms);
        setTermAnswers(parsed.terms.map(()=>""));
        setPreFeedbackCtx(domainCtx);
        setPreFeedbackPhase("term_input");
      } else {
        setPreFeedbackCtx(domainCtx);
        setPreFeedbackPhase("ready");
      }
    } catch(e) { setError("Error: "+e.message); setPreFeedbackPhase("idle"); }
  };

  const handleTermContinue = () => {
    const termCtx = termItems.map((t,i)=> termAnswers[i]?.trim() ? `Term "${t.term}": ${termAnswers[i]}` : null).filter(Boolean).join("\n");
    setPreFeedbackCtx(prev => [prev, termCtx].filter(Boolean).join("\n\n"));
    setPreFeedbackPhase("ready");
  };

  const buildMd = (p) =>
    `# ${p.title||"UPI Switch PRD"}\n**Version:** ${p.version||"v1.0"}  |  **Date:** ${new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}\n\n---\n\n` +
    PRD_SECTIONS.map(s=>`## ${s.icon} ${s.title}\n\n${p[s.key]||"_Not generated_"}`).join("\n\n---\n\n");

  const buildPlainText = (p) =>
    `${p.title||"UPI Switch PRD"}\nVersion: ${p.version||"v1.0"}  |  Date: ${new Date().toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}\n\n` +
    PRD_SECTIONS.map(s=>`${"=".repeat(60)}\n${s.icon}  ${s.title}\n${"=".repeat(60)}\n\n${p[s.key]||"(Not generated)"}`).join("\n\n");

  // ── Main generate ──────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!input.trim() && files.length===0) { setError("Please enter a requirement or upload a document."); return; }
    if (preFeedbackPhase !== "ready") { handleStartPreFeedback(); return; }
    setError(""); setLoading(true); setPhase("generating"); setPrd(null); setAllowAutoPublish(false);
    try {
      let req = input.trim();
      for (const f of files) req += "\n\n" + await readFile(f);
      if (preFeedbackCtx.trim()) req += "\n\nPRE-GENERATION CONTEXT:\n" + preFeedbackCtx;
      if (feedbackMemory.length > 0) req += "\n\nREMEMBERED FEEDBACK FROM PREVIOUS PRDs (apply these improvements):\n" + feedbackMemory.map(f => `- ${f}`).join("\n");

      let pf = "";
      try {
        pf = await preparePreface(req);
        latestPrefaceRef.current = pf;
      } finally {
        setContextStage(null);
      }

      setLoadingMsg("Setting up document metadata…");
      const metaRaw = await callAPI([{ role:"user", content:`For this UPI Switch requirement, return ONLY: {"title":"...(max 8 words)...","version":"v1.0"}\n\nRequirement: ${req.slice(0,500)}` }], undefined, { prefaceContext: pf });
      let meta = { title:"UPI Switch PRD", version:"v1.0" };
      try { meta={ ...meta, ...repairJSON(metaRaw) }; } catch(_) {}
      setPrd(meta);

      const sections = await generateInBatches(req, pf);
      const fullPrd  = { ...meta, ...sections };
      setPrd(fullPrd);
      await persistToHistory(fullPrd, req);
      {
        const jid = parseJiraIssueKey(jiraIssueKey) || parseJiraIssueKey(input);
        void exportAgentOutput({
          agent: "PRD",
          jiraId: jid || "NOJIRA",
          subject: fullPrd.title || "PRD",
          content: buildMd(fullPrd),
          steps: [
            "Context: session history + /docs preface",
            "LLM: document title/version metadata",
            "LLM: batched PRD section generation",
            "Persist PRD to local history",
            skipClarify ? "Skip clarify — complete" : "Enter clarification phase",
          ],
          input: req,
        });
      }

      if (skipClarify) {
        setPhase("done");
        setAllowAutoPublish(true);
        const jid = parseJiraIssueKey(jiraIssueKey) || parseJiraIssueKey(input);
        if (!hasSentNotifyRef.current) {
          hasSentNotifyRef.current = true;
          await sendCompletionNotify({
            agentName: "PRD Agent",
            identifier: fullPrd.title || input.slice(0, 60) || "PRD",
            notifySubject: buildShareSubjectLine("prd", jid, fullPrd.title || input.slice(0, 60) || "PRD"),
          });
        }
      } else {
        setLoadingMsg("Generating clarifying questions…");
        const summary = Object.entries(sections).slice(0,3).map(([k,v])=>`${k}: ${String(v).slice(0,200)}`).join("\n");
        const qRaw = await callAPI([
          { role:"user", content:`PRD summary:\n${summary}\n\nOriginal requirement: ${req.slice(0,400)}` },
          { role:"assistant", content:"PRD sections generated." },
          { role:"user", content:CLARIFY_PROMPT },
        ], undefined, { prefaceContext: pf });
        let qs=[]; try{ qs=repairJSON(qRaw); if(!Array.isArray(qs))qs=[]; }catch(_){}
        setQuestions(qs);
        setConvHistory([{ role:"user", content:req },{ role:"assistant", content:JSON.stringify(sections) }]);
        setPhase("clarifying");
      }
    } catch(e) { setError("Error: "+e.message); setPhase("idle"); }
    setLoading(false); setLoadingMsg("");
  };

  const handleRefine = async () => {
    const filled = answers.filter(a=>a.trim());
    const hasOther = otherFeedback.trim().length > 0;
    if (!filled.length && !hasOther) { setError("Please answer at least one question or add other feedback."); return; }
    setError(""); setLoading(true); setPhase("refining");
    try {
      const ansText = questions.map((q,i)=>answers[i]?.trim()?`Q: ${q}\nA: ${answers[i]}`:null).filter(Boolean).join("\n\n");
      const clarBlock = [ansText, hasOther ? `OTHER FEEDBACK:\n${otherFeedback.trim()}` : ""].filter(Boolean).join("\n\n---\n\n");
      const req = convHistory[0]?.content||input;
      let pf = "";
      try {
        pf = await preparePreface(req);
      } finally {
        setContextStage(null);
      }
      let refined = { ...prd };
      for (let i=0; i<BATCHES.length; i++) {
        setLoadingMsg(`Refining batch ${i+1}/${BATCHES.length}…`);
        setProgress({ done:i, total:BATCHES.length });
        const raw = await callAPI([{ role:"user", content:sectionPrompt(BATCHES[i], `${req}\n\nCLARIFICATIONS:\n${clarBlock}`) }], undefined, { prefaceContext: pf });
        let parsed; try{ parsed=repairJSON(raw); }catch{ parsed={}; }
        refined = { ...refined, ...parsed };
        setPrd({ ...refined });
      }
      setProgress({ done:BATCHES.length, total:BATCHES.length });
      const updated = history.map(h=>h.prd?.title===prd?.title?{...h,prd:refined}:h);
      setHistory(updated); await saveHistory(updated);

      // Remember "other feedback" for future PRDs
      if (otherFeedback.trim()) setFeedbackMemory(prev => [...prev, otherFeedback.trim().slice(0, 200)].slice(-20));

      setPhase("done");
      const jidRefined = parseJiraIssueKey(jiraIssueKey) || parseJiraIssueKey(input);
      void exportAgentOutput({
        agent: "PRD",
        jiraId: jidRefined || "NOJIRA",
        subject: (refined.title || "PRD") + "-refined",
        content: buildMd(refined),
        steps: [
          "Apply clarification answers and remembered feedback",
          "LLM: refine PRD in section batches",
          "Update session history",
        ],
        input: [req, clarBlock].filter(Boolean).join("\n\n---\n\n"),
      });
      setAllowAutoPublish(true);
      if (!hasSentNotifyRef.current) {
        hasSentNotifyRef.current = true;
        await sendCompletionNotify({
          agentName: "PRD Agent",
          identifier: refined.title || input.slice(0, 60) || "PRD",
          notifySubject: buildShareSubjectLine("prd", jidRefined, refined.title || "PRD"),
        });
      }
    } catch(e) { setError("Error: "+e.message); setPhase("clarifying"); }
    setLoading(false); setLoadingMsg("");
  };

  // ── Manual Feedback / Improve ──────────────────────────────────────────────
  const handleImprove = async () => {
    if (!prd) return;
    const presetInstructions = PRESET_FEEDBACK
      .filter(p => selectedPresets.has(p.id))
      .map(p => `[${p.label}]\n${p.prompt}`)
      .join("\n\n---\n\n");
    const combined = [presetInstructions, manualFeedback.trim()].filter(Boolean).join("\n\n---\n\n");
    if (!combined) { setError("Select at least one feedback item or write custom feedback."); return; }

    setError(""); setLoading(true); setPhase("improving");
    setProgress({ done:0, total:BATCHES.length });

    const currentPrdText = PRD_SECTIONS.map(s => `[${s.key}]\n${prd[s.key]||""}`).join("\n\n");

    try {
      const reqSnip = convHistory[0]?.content || input;
      let pf = "";
      try {
        pf = await preparePreface(reqSnip);
      } finally {
        setContextStage(null);
      }
      let improved = { ...prd };
      for (let i=0; i<BATCHES.length; i++) {
        setLoadingMsg(`Improving batch ${i+1}/${BATCHES.length}…`);
        setProgress({ done:i, total:BATCHES.length });
        const improvPrompt = `You have an existing PRD. Apply the following feedback instructions to improve it.\n\nFEEDBACK TO APPLY:\n${combined}\n\nEXISTING PRD SECTIONS (for context):\n${currentPrdText.slice(0,12000)}\n\n${sectionPrompt(BATCHES[i], convHistory[0]?.content||input)}`;
        const raw = await callAPI([{ role:"user", content:improvPrompt }], undefined, { prefaceContext: pf });
        let parsed; try{ parsed=repairJSON(raw); }catch{ parsed={}; }
        improved = { ...improved, ...parsed };
        setPrd({ ...improved });
      }
      setProgress({ done:BATCHES.length, total:BATCHES.length });

      // Log the feedback applied
      const logEntry = {
        ts: new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}),
        presets: PRESET_FEEDBACK.filter(p=>selectedPresets.has(p.id)).map(p=>p.label),
        manual: manualFeedback.trim().slice(0,80),
      };
      setFeedbackLog(prev=>[logEntry, ...prev].slice(0,10));

      // Remember feedback for future PRDs
      const memItems = [];
      PRESET_FEEDBACK.filter(p=>selectedPresets.has(p.id)).forEach(p => memItems.push(p.label + ": " + p.description));
      if (manualFeedback.trim()) memItems.push(manualFeedback.trim().slice(0, 200));
      if (memItems.length > 0) setFeedbackMemory(prev => [...prev, ...memItems].slice(-20));

      const updated = history.map(h=>h.prd?.title===prd?.title?{...h,prd:improved}:h);
      setHistory(updated); await saveHistory(updated);

      // Clear applied feedback
      setSelectedPresets(new Set());
      setManualFeedback("");
      setPhase("done");
      {
        const jid = parseJiraIssueKey(jiraIssueKey) || parseJiraIssueKey(input);
        void exportAgentOutput({
          agent: "PRD",
          jiraId: jid || "NOJIRA",
          subject: (improved.title || "PRD") + "-improved",
          content: buildMd(improved),
          steps: [
            "Apply preset + manual feedback to existing PRD",
            "LLM: improve PRD in section batches",
            "Update session history",
          ],
          input: [combined, convHistory[0]?.content || input].filter(Boolean).join("\n\n---\n\n"),
        });
      }
      setAllowAutoPublish(true);
      const jidI = parseJiraIssueKey(jiraIssueKey) || parseJiraIssueKey(input);
      await sendCompletionNotify({
        agentName: "PRD Agent",
        identifier: (improved.title || input.slice(0, 60) || "PRD") + " (improved)",
        notifySubject: buildShareSubjectLine("prd", jidI, (improved.title || "PRD") + "-improved"),
      });
    } catch(e) { setError("Error: "+e.message); setPhase("done"); }
    setLoading(false); setLoadingMsg("");
  };

  // ── Copy helpers ──────────────────────────────────────────────────────────
  const handleCopyMd = (prdData) => {
    const p = prdData||prd; if (!p) return;
    navigator.clipboard.writeText(buildMd(p)).then(()=>{
      setCopyMdDone(true); setTimeout(()=>setCopyMdDone(false), 2000);
    }).catch(()=>setError("Clipboard copy failed — try a different browser."));
  };

  const handleCopyTxt = (prdData) => {
    const p = prdData||prd; if (!p) return;
    navigator.clipboard.writeText(buildPlainText(p)).then(()=>{
      setCopyTxtDone(true); setTimeout(()=>setCopyTxtDone(false), 2000);
    }).catch(()=>setError("Clipboard copy failed — try a different browser."));
  };

  const handleExportDocx = async (prdData) => {
    const p = prdData||prd; if (!p) return;
    try {
      const res = await fetch(`${API_BASE}/api/export-docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prd: p }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Export failed: ${res.status}`);
      }
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="?([^";]+)/)?.[1] || "PRD-export.docx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError("Export DOCX failed: " + (e?.message || String(e)));
    }
  };

  const handleLoadHistory = (item) => {
    setAllowAutoPublish(false);
    setPrd(item.prd);
    setPhase("done");
    setQuestions([]);
    setAnswers(["","","",""]);
    setInput(item.requirement||"");
    setShowHistory(false);
    setFeedbackLog([]);
  };
  const handleDeleteHistory = async (id) => { const u=history.filter(h=>h.id!==id); setHistory(u); await saveHistory(u); };
  const handleClearHistory  = async () => { setHistory([]); await saveHistory([]); };

  const reset = () => {
    setPhase("idle"); setPrd(null); setInput(""); setFiles([]);
    setQuestions([]); setAnswers(["","","",""]);
    setError(""); setConvHistory([]); setProgress({done:0,total:BATCHES.length});
    setPreFeedbackPhase("idle"); setDomainQuestions([]); setDomainAnswers([]);
    setTermItems([]); setTermAnswers([]); setPreFeedbackCtx("");
    setSelectedPresets(new Set()); setManualFeedback(""); setShowFeedback(false); setFeedbackLog([]);
    setOtherFeedback("");
    setAllowAutoPublish(false);
  };

  const otherFeedbackDocxRef = useRef();
  const handleOtherFeedbackDocx = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { setError("Please select a .docx file."); return; }
    setOtherFeedbackUploading(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/api/extract-docx`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Failed to extract text from DOCX");
      const text = data.text || "";
      setOtherFeedback(prev => (prev ? prev + "\n\n" : "") + (text ? `[From ${file.name}]\n${text}` : ""));
    } catch (err) { setError("DOCX extract: " + (err?.message || String(err))); }
    setOtherFeedbackUploading(false);
    e.target.value = "";
  };

  const phaseOrder = ["idle","generating","clarifying","refining","improving","done"];
  const stepDone   = s => phaseOrder.indexOf(phase)>phaseOrder.indexOf(s);
  const stepActive = s => phase===s||(s==="idle"&&phase==="idle");

  const DownloadBar = ({ prdData }) => (
    <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
      <button onClick={()=>handleCopyMd(prdData)}
        style={{ display:"flex", alignItems:"center", gap:8, background:copyMdDone?"linear-gradient(135deg,#16A34A,#15803D)":"linear-gradient(135deg,#1D4ED8,#2563EB)", border:"none", borderRadius:9, padding:"10px 20px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", transition:"background .3s" }}>
        {copyMdDone ? "✅ Copied Markdown!" : "📋 Copy as Markdown"}
      </button>
      <button onClick={()=>handleCopyTxt(prdData)}
        style={{ display:"flex", alignItems:"center", gap:8, background:"#111827", border:"1px solid #1E293B", borderRadius:9, padding:"10px 16px", color:copyTxtDone?"#4ADE80":"#94A3B8", fontSize:13, fontWeight:600, cursor:"pointer", transition:"color .3s" }}>
        {copyTxtDone ? "✅ Copied!" : "📄 Copy as Plain Text"}
      </button>
      <button onClick={()=>handleExportDocx(prdData)}
        style={{ display:"flex", alignItems:"center", gap:8, background:"#0F766E", border:"none", borderRadius:9, padding:"10px 16px", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", transition:"opacity .2s" }}>
        📥 Export as DOCX
      </button>
    </div>
  );

  const totalFeedback = selectedPresets.size + (manualFeedback.trim() ? 1 : 0);

  return (
    <div style={{ fontFamily:"'IBM Plex Sans','Segoe UI',sans-serif", background:"#0B1120", minHeight:"100vh", color:"#E2E8F0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes spin    {to{transform:rotate(360deg)}}
        @keyframes fadeUp  {from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes shimmer {0%,100%{opacity:.4}50%{opacity:1}}
        @keyframes slideIn {from{transform:translateX(100%)}to{transform:none}}
        @keyframes pulse   {0%,100%{box-shadow:0 0 0 0 #A78BFA44}50%{box-shadow:0 0 0 6px #A78BFA11}}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1E3A5F;border-radius:2px}
        .hov{transition:all .15s}.hov:hover:not(:disabled){opacity:.85;transform:translateY(-1px)}
        .preset-card:hover{border-color:#334155!important;background:#111827!important}
        textarea:focus,input:focus{outline:none}
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={{ background:"#060D1A", borderBottom:"1px solid #1E293B", height:56, padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:"linear-gradient(135deg,#F59E0B,#EF4444)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>⚡</div>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:"#F8FAFC" }}>UPI Switch · PRD Agent</div>
            <div style={{ fontSize:10, color:"#374151", letterSpacing:.5 }}>Batch · Domain-aware · Manual Feedback · History</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {["Input","Domain","Terms","Generate","Refine","Done"].map((label,i)=>{
            const phases=["idle","domain_input","term_input","generating","clarifying","done"];
            const pfp=preFeedbackPhase;
            const isDone=stepDone(phases[i])||(i===1&&["term_input","term_check","ready","generating","clarifying","refining","improving","done"].includes(pfp))||(i===2&&["ready","generating","clarifying","refining","improving","done"].includes(pfp));
            const isActive=(i===1&&pfp==="domain_input")||(i===2&&pfp==="term_input")||stepActive(phases[i]);
            return (
              <div key={label} style={{ display:"flex", alignItems:"center", gap:4 }}>
                <div style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 9px", borderRadius:20, background:isDone?"#F59E0B18":isActive?"#1E3A5F":"transparent", border:`1px solid ${isDone?"#F59E0B44":isActive?"#3B82F6":"#1E293B"}` }}>
                  <div style={{ width:5, height:5, borderRadius:"50%", background:isDone?"#F59E0B":isActive?"#3B82F6":"#1E293B" }}/>
                  <span style={{ fontSize:10, color:isDone?"#F59E0B":isActive?"#93C5FD":"#374151", fontWeight:500 }}>{label}</span>
                </div>
                {i<5&&<div style={{ width:10, height:1, background:isDone?"#F59E0B44":"#1E293B" }}/>}
              </div>
            );
          })}
          <button onClick={()=>setShowHistory(true)} className="hov" style={{ background:"#0D1626", border:"1px solid #1E3A5F", borderRadius:9, padding:"5px 12px", color:"#93C5FD", fontSize:11, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:6, marginLeft:6 }}>
            📋 History {history.length>0&&<span style={{ background:"#1E3A5F", borderRadius:10, padding:"1px 6px", fontSize:10, color:"#F59E0B", fontWeight:700 }}>{history.length}</span>}
          </button>
        </div>
      </div>

      <div style={{ maxWidth:920, margin:"0 auto", padding:"28px 20px 100px" }}>

        {/* ── JIRA Connector ── */}
        <div style={{ background:"#0D1626", border:"1px solid #1E293B", borderRadius:14, padding:24, marginBottom:20, animation:"fadeUp .4s ease" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
            <div style={{ width:28, height:28, borderRadius:6, background:"linear-gradient(135deg,#0052cc,#2684ff)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#fff" }}>J</div>
            <span style={{ fontSize:14, fontWeight:600, color:"#F1F5F9" }}>JIRA Connector</span>
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            <input type="text" placeholder="e.g. TSP-1889 or paste JIRA browse URL" value={jiraIssueKey} onChange={e=>setJiraIssueKey(e.target.value)} onBlur={()=>{ const k = parseJiraIssueKey(jiraIssueKey); if (k) syncPublishDefaultJiraKey(k); }} onKeyDown={e=>{ if (e.key==="Enter") { e.preventDefault(); handleFetchJiraPRD(); } }}
              style={{ flex:1, minWidth:200, background:"#070E1A", border:"1px solid #1E3A5F", borderRadius:8, color:"#CBD5E1", fontSize:13, padding:"8px 12px" }} />
            <button type="button" onClick={handleFetchJiraPRD} disabled={jiraFetchLoading}
              style={{ padding:"8px 16px", borderRadius:8, fontSize:12, fontWeight:600, cursor:jiraFetchLoading?"wait":"pointer", border:"none", background:"#0052CC", color:"#fff" }}>
              {jiraFetchLoading ? "Fetching…" : "↓ Fetch"}
            </button>
          </div>
          {jiraFetchError && <div style={{ marginTop:8, fontSize:11, color:"#f87171" }}>{jiraFetchError}</div>}
          <div style={{ marginTop:8, fontSize:11, color:"#64748b" }}>Fetch summary & description into the requirement field. Configure JIRA in Connectors (top bar).</div>
        </div>

        {/* ── STEP 1: INPUT ── */}
        <div style={{ background:"#0D1626", border:"1px solid #1E293B", borderRadius:14, padding:24, marginBottom:20, animation:"fadeUp .4s ease" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:28, height:28, borderRadius:8, background:"#1E293B", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, color:"#F59E0B", fontSize:13 }}>1</div>
              <span style={{ fontSize:14, fontWeight:600, color:"#F1F5F9" }}>Describe Your Requirement</span>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              {MODELS.map(m=>(
                <button key={m.id} onClick={()=>setModel(m)} className="hov" style={{ padding:"4px 12px", borderRadius:20, border:`1px solid ${model.id===m.id?m.color:"#1E293B"}`, background:model.id===m.id?m.color+"18":"transparent", color:model.id===m.id?m.color:"#374151", fontSize:11, fontWeight:600, cursor:"pointer" }}>{m.label}</button>
              ))}
            </div>
          </div>

          <textarea value={input} onChange={e=>setInput(e.target.value)} disabled={loading}
            placeholder={"Describe the UPI feature requirement...\n\nExamples:\n• \"Implement UDIR flow for deemed transactions with T+5 min timeout and auto-reversal\"\n• \"Add VPA validation before collect request with risk scoring\"\n• \"Implement UPI Lite for offline small-value transactions per RBI circular Jan 2024\""}
            style={{ width:"100%", minHeight:120, background:"#070E1A", border:"1px solid #1E3A5F", borderRadius:10, color:"#CBD5E1", fontSize:13, padding:"14px 16px", resize:"vertical", fontFamily:"inherit", lineHeight:1.7, opacity:loading?.5:1 }}/>

          <div style={{ marginTop:12, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <button onClick={()=>fileRef.current?.click()} disabled={loading} style={{ background:"#111827", border:"1px dashed #1E3A5F", borderRadius:8, padding:"7px 14px", color:"#64748B", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
              📎 Attach Docs <span style={{ fontSize:10, color:"#374151" }}>(.pdf .docx .xlsx .txt)</span>
            </button>
            <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.doc,.xlsx,.xls,.txt,.md" style={{ display:"none" }} onChange={e=>setFiles(prev=>[...prev,...Array.from(e.target.files)])}/>
            {files.map((f,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:6, background:"#111827", border:"1px solid #1E293B", borderRadius:6, padding:"4px 10px", fontSize:11, color:"#94A3B8" }}>
                📄 {f.name.length>22?f.name.slice(0,22)+"…":f.name}
                <button onClick={()=>setFiles(prev=>prev.filter((_,j)=>j!==i))} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer", fontSize:14 }}>×</button>
              </div>
            ))}
          </div>

          <div style={{ marginTop:14, padding:"10px 14px", background:"#070E1A", borderRadius:9, border:"1px solid #1E293B", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
            <div style={{ fontSize:11, color:"#475569", fontWeight:600, letterSpacing:.8 }}>⚙️ OPTIONS</div>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
              <div onClick={()=>setSkipClarify(!skipClarify)} style={{ width:36, height:20, borderRadius:10, background:skipClarify?"#F59E0B":"#1E293B", position:"relative", cursor:"pointer", transition:"background .2s", flexShrink:0 }}>
                <div style={{ width:14, height:14, borderRadius:"50%", background:"#fff", position:"absolute", top:3, left:skipClarify?19:3, transition:"left .2s" }}/>
              </div>
              <span style={{ fontSize:12, color:skipClarify?"#F59E0B":"#475569", fontWeight:skipClarify?600:400 }}>Skip clarification &amp; go straight to Done</span>
            </label>
          </div>
          <div style={{ marginTop:12, paddingTop:12, borderTop:"1px solid #1E293B" }}>
            <div style={{ fontSize:11, color:"#475569", fontWeight:600, marginBottom:8 }}>After generation, auto-publish to</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:14 }}>
              {["jira","telegram","email","slack"].map(ch=>(
                <label key={ch} style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", fontSize:12, color:"#94A3B8" }}>
                  <input type="checkbox" checked={!!autoPublishChannels[ch]} onChange={e=>setAutoPublishChannels(p=>({ ...p, [ch]: e.target.checked }))} />
                  {ch==="jira"&&"JIRA"}
                  {ch==="telegram"&&"Telegram"}
                  {ch==="email"&&"Email"}
                  {ch==="slack"&&"Slack"}
                </label>
              ))}
            </div>
            <div style={{ fontSize:10, color:"#64748b", marginTop:4 }}>Set default destinations in Connectors (top bar).</div>
          </div>

          {feedbackMemory.length > 0 && (
            <div style={{ marginTop:12, padding:"10px 14px", background:"#052E16", border:"1px solid #16A34A22", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:11, color:"#4ADE80", fontWeight:600 }}>🧠 {feedbackMemory.length} feedback item{feedbackMemory.length>1?"s":""} remembered from previous PRDs</div>
                <div style={{ fontSize:10, color:"#16A34A", marginTop:2 }}>These will be applied to the next PRD automatically.</div>
              </div>
              <button onClick={()=>setFeedbackMemory([])} style={{ background:"none", border:"1px solid #EF444433", borderRadius:7, padding:"3px 10px", color:"#EF4444", fontSize:10, cursor:"pointer" }}>Clear</button>
            </div>
          )}

          {error && <div style={{ marginTop:10, padding:"8px 12px", background:"#EF444411", border:"1px solid #EF444433", borderRadius:8, color:"#FCA5A5", fontSize:12 }}>{error}</div>}

          {contextStage && (
            <div style={{ marginTop:10, padding:"10px 14px", background:"#0C1A2E", border:"1px solid #1E3A5F", borderRadius:10, display:"flex", alignItems:"center", gap:10, fontSize:12, color:"#93C5FD" }}>
              <Spinner color="#38BDF8" />
              <div>
                <div style={{ fontWeight:700, color:"#E0F2FE" }}>Context pipeline</div>
                <div style={{ fontSize:11, color:"#64748B", marginTop:2 }}>{contextStage.label}</div>
              </div>
              <span style={{ marginLeft:"auto", fontSize:10, color:"#475569", textTransform:"uppercase", letterSpacing:0.6 }}>{contextStage.step}</span>
            </div>
          )}

          <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end" }}>
            <button onClick={handleGenerate} disabled={loading||phase==="done"} className="hov"
              style={{ background:loading?"#1E293B":"linear-gradient(135deg,#F59E0B,#EF4444)", border:"none", borderRadius:10, padding:"11px 28px", color:loading?"#475569":"#0B1120", fontSize:14, fontWeight:700, cursor:loading?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:8 }}>
              {loading && (phase==="generating"||preFeedbackPhase==="domain_check"||preFeedbackPhase==="term_check")
                ? <><Spinner color="#F59E0B"/>{loadingMsg}</>
                : preFeedbackPhase==="ready" ? "⚡ Generate PRD" : "🔍 Check & Generate PRD"}
            </button>
          </div>
        </div>

        {/* ── PRE-FEEDBACK: DOMAIN BOUNDARY ── */}
        {preFeedbackPhase==="domain_input" && (
          <div style={{ background:"#0D1626", border:"1px solid #7C3AED44", borderRadius:14, padding:24, marginBottom:20, animation:"fadeUp .4s ease" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
              <div style={{ width:28, height:28, borderRadius:8, background:"#7C3AED22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>🗺️</div>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:"#C4B5FD" }}>Clarify Domain Boundaries</div>
                <div style={{ fontSize:11, color:"#475569" }}>Help assign ownership correctly across Switch / TPAP / PSP / PG / NPCI</div>
              </div>
              <button onClick={async()=>{ setPreFeedbackPhase("term_check"); setLoading(true); setLoadingMsg("Checking terminology…"); let req=input.trim(); for (const f of files) req += "\n\n" + await readFile(f); await runTermCheck(req,"", latestPrefaceRef.current); setLoading(false); setLoadingMsg(""); }}
                style={{ marginLeft:"auto", background:"none", border:"1px solid #334155", borderRadius:8, padding:"5px 12px", color:"#475569", fontSize:11, cursor:"pointer" }}>Skip →</button>
            </div>
            {domainQuestions.map((q,i)=>(
              <div key={i} style={{ marginBottom:14 }}>
                <div style={{ fontSize:12, color:"#C4B5FD", marginBottom:6, fontWeight:500 }}>🔷 {q}</div>
                <textarea value={domainAnswers[i]} onChange={e=>setDomainAnswers(prev=>{const n=[...prev];n[i]=e.target.value;return n;})}
                  placeholder="Your answer (optional)…" rows={2}
                  style={{ width:"100%", background:"#070E1A", border:"1px solid #4C1D95", borderRadius:8, color:"#94A3B8", fontSize:12, padding:"9px 12px", resize:"vertical", fontFamily:"inherit" }}/>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button onClick={handleDomainContinue} disabled={loading} className="hov"
                style={{ background:"linear-gradient(135deg,#7C3AED,#4F46E5)", border:"none", borderRadius:10, padding:"10px 24px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                Continue → Check Terminology
              </button>
            </div>
          </div>
        )}

        {/* ── PRE-FEEDBACK: TERMINOLOGY ── */}
        {preFeedbackPhase==="term_input" && (
          <div style={{ background:"#0D1626", border:"1px solid #0891B244", borderRadius:14, padding:24, marginBottom:20, animation:"fadeUp .4s ease" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
              <div style={{ width:28, height:28, borderRadius:8, background:"#0891B222", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>📖</div>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:"#67E8F9" }}>Clarify Terminology</div>
                <div style={{ fontSize:11, color:"#475569" }}>Define ambiguous terms so the PRD is precise</div>
              </div>
              <button onClick={()=>setPreFeedbackPhase("ready")} style={{ marginLeft:"auto", background:"none", border:"1px solid #334155", borderRadius:8, padding:"5px 12px", color:"#475569", fontSize:11, cursor:"pointer" }}>Skip →</button>
            </div>
            {termItems.map((t,i)=>(
              <div key={i} style={{ marginBottom:14 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                  <span style={{ background:"#164E63", color:"#67E8F9", borderRadius:5, padding:"2px 8px", fontSize:11, fontWeight:700, fontFamily:"monospace" }}>{t.term}</span>
                  <span style={{ fontSize:12, color:"#94A3B8" }}>{t.question}</span>
                </div>
                <textarea value={termAnswers[i]} onChange={e=>setTermAnswers(prev=>{const n=[...prev];n[i]=e.target.value;return n;})}
                  placeholder="Define or clarify this term… (optional)" rows={2}
                  style={{ width:"100%", background:"#070E1A", border:"1px solid #164E63", borderRadius:8, color:"#94A3B8", fontSize:12, padding:"9px 12px", resize:"vertical", fontFamily:"inherit" }}/>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <button onClick={handleTermContinue} className="hov"
                style={{ background:"linear-gradient(135deg,#0891B2,#0E7490)", border:"none", borderRadius:10, padding:"10px 24px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                Done — Ready to Generate ⚡
              </button>
            </div>
          </div>
        )}

        {/* ── PRE-FEEDBACK: READY BANNER ── */}
        {preFeedbackPhase==="ready" && phase==="idle" && (
          <div style={{ background:"#052E16", border:"1px solid #16A34A44", borderRadius:10, padding:"12px 20px", marginBottom:20, display:"flex", alignItems:"center", gap:12, animation:"fadeUp .3s ease" }}>
            <span style={{ fontSize:20 }}>✅</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:"#4ADE80" }}>Context captured — ready to generate</div>
              <div style={{ fontSize:11, color:"#16A34A" }}>Domain & terminology clarifications will be injected into the PRD.</div>
            </div>
            <button onClick={()=>{ setPreFeedbackPhase("idle"); setDomainQuestions([]); setDomainAnswers([]); setTermItems([]); setTermAnswers([]); setPreFeedbackCtx(""); }}
              style={{ background:"none", border:"1px solid #16A34A44", borderRadius:7, padding:"4px 10px", color:"#4ADE80", fontSize:11, cursor:"pointer" }}>Reset checks</button>
          </div>
        )}

        {/* ── PROGRESS BAR ── */}
        {(phase==="generating"||phase==="refining"||phase==="improving") && (
          <div style={{ marginBottom:20, background:"#0D1626", border:"1px solid #1E293B", borderRadius:10, padding:"14px 20px", animation:"fadeUp .3s ease" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ fontSize:12, color:"#64748B" }}>{loadingMsg}</span>
              <span style={{ fontSize:12, color: phase==="improving"?"#A78BFA":"#F59E0B", fontWeight:600 }}>{progress.done}/{progress.total} batches</span>
            </div>
            <div style={{ height:4, background:"#1E293B", borderRadius:4, overflow:"hidden" }}>
              <div style={{ height:"100%", background: phase==="improving"?"linear-gradient(90deg,#7C3AED,#A78BFA)":"linear-gradient(90deg,#F59E0B,#EF4444)", width:`${(progress.done/progress.total)*100}%`, borderRadius:4, transition:"width .4s ease" }}/>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:10 }}>
              {BATCHES.map((batch,i)=>(
                <div key={i} style={{ display:"flex", gap:3 }}>
                  {batch.map(k=>{
                    const sec=PRD_SECTIONS.find(s=>s.key===k);
                    const done=progress.done>i,active=progress.done===i;
                    return <span key={k} style={{ fontSize:15, opacity:done?1:active?.6:.2, transition:"opacity .3s" }}>{sec?.icon}</span>;
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP 2: PRD DOCUMENT ── */}
        {prd && (
          <div style={{ animation:"fadeUp .5s ease", marginBottom:20 }}>
            <div style={{ background:"#0D1626", border:"1px solid #1E3A5F", borderRadius:12, padding:"14px 20px", marginBottom:12, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:"#F1F5F9" }}>{prd.title||"UPI Switch PRD"}</div>
                <div style={{ fontSize:11, color:"#475569" }}>
                  {prd.version||"v1.0"} · {model.label}
                  {phase==="generating"&&<span style={{ color:"#F59E0B", marginLeft:8, animation:"shimmer 1.5s infinite" }}>· generating…</span>}
                  {phase==="improving"&&<span style={{ color:"#A78BFA", marginLeft:8, animation:"shimmer 1.5s infinite" }}>· improving…</span>}
                  {feedbackLog.length>0&&<span style={{ color:"#4ADE80", marginLeft:8 }}>· {feedbackLog.length} improvement{feedbackLog.length>1?"s":""} applied</span>}
                </div>
              </div>
              <DownloadBar/>
            </div>
            <PRDDocument prd={prd} phase={phase}/>
          </div>
        )}

        {/* ── STEP 3: AI CLARIFY ── */}
        {!skipClarify && (phase==="clarifying"||phase==="refining"||phase==="done") && questions.length>0 && (
          <div style={{ background:"#0D1626", border:"1px solid #1E3A5F", borderRadius:14, padding:24, marginBottom:20, animation:"fadeUp .5s ease" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:28, height:28, borderRadius:8, background:"#1E293B", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, color:"#93C5FD", fontSize:13 }}>3</div>
                <span style={{ fontSize:14, fontWeight:600, color:"#F1F5F9" }}>AI Clarifying Questions</span>
                <span style={{ fontSize:11, color:"#475569" }}>(answer any or all)</span>
              </div>
              {phase==="clarifying" && (
                <button onClick={()=>setPhase("done")} style={{ background:"none", border:"1px solid #334155", borderRadius:8, padding:"5px 12px", color:"#475569", fontSize:11, cursor:"pointer" }}>Skip → Done</button>
              )}
            </div>
            {questions.map((q,i)=>(
              <div key={i} style={{ marginBottom:16 }}>
                <div style={{ fontSize:12, color:"#93C5FD", marginBottom:7, fontWeight:500 }}><span style={{ color:"#1E3A5F", marginRight:6 }}>Q{i+1}.</span>{q}</div>
                <textarea value={answers[i]} onChange={e=>setAnswers(prev=>{const n=[...prev];n[i]=e.target.value;return n;})}
                  disabled={loading||phase==="done"} placeholder="Your answer..." rows={2}
                  style={{ width:"100%", background:"#070E1A", border:"1px solid #1E293B", borderRadius:8, color:"#94A3B8", fontSize:12, padding:"9px 12px", resize:"vertical", fontFamily:"inherit", opacity:phase==="done"?.5:1 }}/>
              </div>
            ))}

            {/* Other Feedbacks — paste or upload .docx */}
            <div style={{ marginTop:20, paddingTop:18, borderTop:"1px solid #1E293B" }}>
              <div style={{ fontSize:12, color:"#64748B", fontWeight:600, marginBottom:8, letterSpacing:.6 }}>OTHER FEEDBACKS</div>
              <div style={{ fontSize:11, color:"#475569", marginBottom:10 }}>Add extra feedback by pasting text below or uploading a .docx. This is included when you click Refine PRD.</div>
              <textarea value={otherFeedback} onChange={e=>setOtherFeedback(e.target.value)}
                disabled={loading||phase==="done"} placeholder="Paste additional feedback here, or upload a .docx below…"
                rows={4}
                style={{ width:"100%", background:"#070E1A", border:"1px solid #1E293B", borderRadius:8, color:"#94A3B8", fontSize:12, padding:"9px 12px", resize:"vertical", fontFamily:"inherit", marginBottom:10, opacity:phase==="done"?.5:1 }}/>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                <input ref={otherFeedbackDocxRef} type="file" accept=".docx" style={{ display:"none" }} onChange={handleOtherFeedbackDocx}/>
                <button type="button" onClick={()=>otherFeedbackDocxRef.current?.click()} disabled={loading||phase==="done"||otherFeedbackUploading}
                  style={{ background:"#111827", border:"1px solid #1E3A5F", borderRadius:8, padding:"7px 14px", color:"#93C5FD", fontSize:12, fontWeight:600, cursor:loading||phase==="done"||otherFeedbackUploading?"not-allowed":"pointer", opacity:phase==="done"?.5:1 }}>
                  {otherFeedbackUploading ? "… Extracting…" : "📎 Upload .docx"}
                </button>
                <span style={{ fontSize:11, color:"#475569" }}>Text from the file will be appended above.</span>
              </div>
            </div>

            {phase!=="done" && (
              <div style={{ display:"flex", justifyContent:"flex-end", marginTop:16 }}>
                <button onClick={handleRefine} disabled={loading} className="hov"
                  style={{ background:loading?"#1E293B":"linear-gradient(135deg,#2563EB,#7C3AED)", border:"none", borderRadius:10, padding:"11px 28px", color:loading?"#475569":"#fff", fontSize:14, fontWeight:700, cursor:loading?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:8 }}>
                  {loading&&phase==="refining"?<><Spinner color="#93C5FD"/>{loadingMsg}</>:"🔄 Refine PRD"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 4: MANUAL FEEDBACK & IMPROVE ── */}
        {(phase==="done"||phase==="improving") && prd && (
          <div style={{ background:"#0D1626", border:`1px solid ${showFeedback?"#A78BFA44":"#1E293B"}`, borderRadius:14, marginBottom:20, animation:"fadeUp .5s ease", overflow:"hidden" }}>
            {/* Header */}
            <div style={{ padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", borderBottom: showFeedback?"1px solid #1E293B":"none" }}
              onClick={()=>setShowFeedback(f=>!f)}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ width:28, height:28, borderRadius:8, background:"#A78BFA22", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, color:"#A78BFA", fontSize:13 }}>✨</div>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:"#F1F5F9" }}>Improve PRD with Feedback</div>
                  <div style={{ fontSize:11, color:"#475569" }}>Apply preset structural fixes or write custom instructions</div>
                </div>
                {totalFeedback>0&&<span style={{ background:"#A78BFA22", border:"1px solid #A78BFA44", color:"#A78BFA", borderRadius:12, padding:"2px 9px", fontSize:11, fontWeight:700 }}>{totalFeedback} selected</span>}
                {feedbackLog.length>0&&<span style={{ background:"#16A34A22", border:"1px solid #16A34A44", color:"#4ADE80", borderRadius:12, padding:"2px 9px", fontSize:11 }}>✓ {feedbackLog.length} applied</span>}
              </div>
              <span style={{ color:"#475569", fontSize:18, transition:"transform .2s", transform:showFeedback?"rotate(180deg)":"none" }}>⌄</span>
            </div>

            {showFeedback && (
              <div style={{ padding:"20px 24px" }}>
                {/* Preset chips */}
                <div style={{ marginBottom:20 }}>
                  <div style={{ fontSize:12, color:"#64748B", fontWeight:600, marginBottom:12, letterSpacing:.6 }}>PRESET IMPROVEMENTS</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:10 }}>
                    {PRESET_FEEDBACK.map(p=>{
                      const sel = selectedPresets.has(p.id);
                      return (
                        <div key={p.id} className="preset-card" onClick={()=>setSelectedPresets(prev=>{const n=new Set(prev); sel?n.delete(p.id):n.add(p.id); return n;})}
                          style={{ background: sel?p.color+"18":"#070E1A", border:`1px solid ${sel?p.color+"88":"#1E293B"}`, borderRadius:10, padding:"12px 14px", cursor:"pointer", transition:"all .15s" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
                            <span style={{ fontSize:16 }}>{p.icon}</span>
                            <span style={{ fontSize:12, fontWeight:700, color: sel?p.color:"#E2E8F0" }}>{p.label}</span>
                            {sel&&<span style={{ marginLeft:"auto", fontSize:14, color:p.color }}>✓</span>}
                          </div>
                          <div style={{ fontSize:11, color:"#475569", lineHeight:1.5 }}>{p.description}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Free-text feedback */}
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:12, color:"#64748B", fontWeight:600, marginBottom:8, letterSpacing:.6 }}>CUSTOM FEEDBACK</div>
                  <textarea value={manualFeedback} onChange={e=>setManualFeedback(e.target.value)}
                    placeholder={"Write any additional improvement instructions...\n\nExamples:\n• Add latency SLAs for each API endpoint (p50/p95/p99)\n• Include a decision table for PG vs NPCI error code mapping\n• Expand rollout phase 2 to include merchant onboarding steps"}
                    rows={5}
                    style={{ width:"100%", background:"#070E1A", border:"1px solid #1E3A5F", borderRadius:10, color:"#CBD5E1", fontSize:13, padding:"12px 14px", resize:"vertical", fontFamily:"inherit", lineHeight:1.7 }}/>
                  <div style={{ fontSize:11, color:"#334155", marginTop:4 }}>
                    {manualFeedback.length} chars · be specific for best results
                  </div>
                </div>

                {/* Applied log */}
                {feedbackLog.length>0 && (
                  <div style={{ marginBottom:16, padding:"10px 14px", background:"#052E16", border:"1px solid #16A34A22", borderRadius:9 }}>
                    <div style={{ fontSize:11, color:"#16A34A", fontWeight:600, marginBottom:6 }}>IMPROVEMENT HISTORY</div>
                    {feedbackLog.map((log,i)=>(
                      <div key={i} style={{ fontSize:11, color:"#4ADE80", marginBottom:3, display:"flex", gap:8 }}>
                        <span style={{ color:"#334155" }}>{log.ts}</span>
                        <span>{[...log.presets, log.manual&&`"${log.manual}${log.manual.length>=80?"…":""}"`].filter(Boolean).join(", ")}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Remembered feedback */}
                {feedbackMemory.length > 0 && (
                  <div style={{ marginBottom:16, padding:"10px 14px", background:"#052E16", border:"1px solid #16A34A22", borderRadius:9 }}>
                    <div style={{ fontSize:11, color:"#16A34A", fontWeight:600, marginBottom:6 }}>🧠 REMEMBERED FEEDBACK ({feedbackMemory.length})</div>
                    {feedbackMemory.map((f,i) => <div key={i} style={{ fontSize:11, color:"#4ADE80", marginBottom:2 }}>• {f.slice(0,120)}{f.length>120?"…":""}</div>)}
                    <button onClick={()=>setFeedbackMemory([])} style={{ marginTop:6, background:"none", border:"1px solid #EF444433", borderRadius:7, padding:"3px 10px", color:"#EF4444", fontSize:10, cursor:"pointer" }}>Clear memory</button>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                  <button onClick={()=>{setSelectedPresets(new Set()); setManualFeedback("");}}
                    style={{ background:"none", border:"1px solid #334155", borderRadius:8, padding:"7px 14px", color:"#475569", fontSize:12, cursor:"pointer" }}>
                    Clear selection
                  </button>
                  <button onClick={handleImprove} disabled={loading||totalFeedback===0} className="hov"
                    style={{ background: totalFeedback===0||loading?"#1E293B":"linear-gradient(135deg,#7C3AED,#A855F7)", border:"none", borderRadius:10, padding:"11px 28px", color:totalFeedback===0||loading?"#475569":"#fff", fontSize:14, fontWeight:700, cursor:totalFeedback===0||loading?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:8, animation: totalFeedback>0&&!loading?"pulse 2s infinite":"none" }}>
                    {loading&&phase==="improving"?<><Spinner color="#A78BFA"/>{loadingMsg}</>:<>✨ Apply {totalFeedback} Improvement{totalFeedback!==1?"s":""} to PRD</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 5: DONE ── */}
        {phase==="done" && (
          <>
            <div style={{ background:"#052E16", border:"1px solid #16A34A44", borderRadius:14, padding:20, animation:"fadeUp .4s ease" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <span style={{ fontSize:28 }}>🎉</span>
                  <div>
                    <div style={{ fontSize:14, fontWeight:700, color:"#4ADE80" }}>PRD Finalised & Saved!</div>
                    <div style={{ fontSize:12, color:"#16A34A" }}>Copy to clipboard, apply more feedback, or start a new PRD.</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                  <DownloadBar/>
                  <button onClick={()=>setShowHistory(true)} className="hov" style={{ background:"#0D1626", border:"1px solid #1E3A5F", borderRadius:10, padding:"10px 16px", color:"#93C5FD", fontSize:13, fontWeight:600, cursor:"pointer" }}>📋 History</button>
                  <button onClick={reset} className="hov" style={{ background:"#111827", border:"1px solid #1E293B", borderRadius:10, padding:"10px 16px", color:"#64748B", fontSize:13, fontWeight:600, cursor:"pointer" }}>+ New PRD</button>
                </div>
              </div>
            </div>
            {prd && (
              <ShareAndScore
                docType="prd"
                title={prd.title}
                jiraKey={parseJiraIssueKey(jiraIssueKey) || parseJiraIssueKey(input) || ""}
                content={buildMd(prd)}
                autoPublish={allowAutoPublish ? Object.keys(autoPublishChannels).filter((k) => autoPublishChannels[k]) : []}
              />
            )}
          </>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* ── HISTORY DRAWER ── */}
      {showHistory && (
        <>
          <div onClick={()=>setShowHistory(false)} style={{ position:"fixed", inset:0, background:"#00000066", zIndex:99 }}/>
          <HistoryPanel history={history} onLoad={handleLoadHistory} onDelete={handleDeleteHistory} onClear={handleClearHistory} onClose={()=>setShowHistory(false)}/>
        </>
      )}
    </div>
  );
}
