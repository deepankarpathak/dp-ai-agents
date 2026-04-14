import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { API_BASE, sendCompletionNotify } from "./config.js";
import ShareAndScore from "./ShareAndScore.jsx";
import {
  syncPublishDefaultJiraKey,
  loadPublishDefaults,
  syncPublishJiraSiteFromIssue,
  savePublishDefaults,
  getLlmProviderForRequest,
  getBedrockModelTierForRequest,
} from "./ConnectorsStatus.jsx";
import { exportAgentOutput } from "./agentExport.js";
import { buildShareSubjectLine } from "./shareSubject.js";

const MODELS = [
  { id: "claude-sonnet-4-20250514", label: "Sonnet 4.6", color: "#F59E0B" },
  { id: "claude-opus-4-20250514", label: "Opus 4.6", color: "#A78BFA" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", color: "#34D399" },
];

const DOMAINS = [
  { id: "switch", label: "Switch", icon: "🔀", color: "#e8b84b" },
  { id: "pms", label: "PMS", icon: "👤", color: "#60a5fa" },
  { id: "compliance", label: "Compliance", icon: "🛡️", color: "#fbbf24" },
  { id: "refund", label: "Refund", icon: "↩️", color: "#f87171" },
  { id: "reconciliation", label: "Reconciliation", icon: "⚖️", color: "#a78bfa" },
  { id: "mandates", label: "Mandates", icon: "📜", color: "#f472b6" },
  { id: "payout", label: "Payout", icon: "💸", color: "#34d399" },
  { id: "combination", label: "Combination", icon: "🔗", color: "#fb923c" },
  { id: "app", label: "App", icon: "📱", color: "#38bdf8" },
  { id: "mis", label: "MIS", icon: "📊", color: "#c084fc" },
  { id: "all", label: "All", icon: "🌐", color: "#94a3b8" },
];

/** UI domain id → JIRA `labels` value on create (unlisted domains: no label). */
const DOMAIN_ID_TO_JIRA_LABEL = {
  switch: "Transaction",
  pms: "PMS",
  compliance: "ComplianceService",
  refund: "Refund",
  reconciliation: "Recon",
  mandates: "mandate",
};

function jiraLabelsFromDomainIds(domainSet) {
  if (!domainSet || !(domainSet instanceof Set)) return [];
  const ids = [...domainSet];
  const out = new Set();
  if (ids.includes("all")) {
    Object.values(DOMAIN_ID_TO_JIRA_LABEL).forEach((l) => out.add(l));
    return [...out];
  }
  for (const id of ids) {
    const lab = DOMAIN_ID_TO_JIRA_LABEL[id];
    if (lab) out.add(lab);
  }
  return [...out];
}

function domainDisplayNamesForNotify(domainSet) {
  if (!domainSet || !(domainSet instanceof Set)) return [];
  const ids = [...domainSet];
  if (ids.includes("all")) return DOMAINS.filter((d) => d.id !== "all").map((d) => d.label);
  return DOMAINS.filter((d) => ids.includes(d.id) && d.id !== "all").map((d) => d.label);
}

function linkedJiraKeysFromHistoryItem(item) {
  if (item?.linkedJiraKeys?.length) return item.linkedJiraKeys;
  const jc = item?.jiraCreated;
  if (!jc?.parentKey) return [];
  return [jc.parentKey, ...(jc.subtasks || []).map((s) => s.key).filter(Boolean)].filter(Boolean);
}

const HISTORY_KEY = "jira-agent-history-v1";
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveHistoryLS(h) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50)));
  } catch {}
}

const CLARIFY_SYSTEM = `You are a JIRA delivery lead for UPI/fintech systems.
The user has provided a feature request. Return JSON only:
{"draftObjective":"...", "questions":["q1","q2","q3","q4"]}
Rules:
- draftObjective must be 2-3 concise sentences.
- questions should be targeted, implementation-relevant, and non-redundant.`;

const JIRA_SYSTEM = `You are a senior engineering program manager generating a production-ready JIRA ticket for fintech/UPI systems.

Return markdown only (no JSON, no preamble). Use this exact structure and rich formatting:

# <Concise, action-oriented title>

## Summary
2-4 bullets: what changes, why now, primary business/tech outcome.

## Objective
Clear goal statements (bullets).

## Problem Statement
User/system pain, current gap, impact if not done.

## Scope
### In scope
Bullets.

### Out of scope
Bullets.

## Functional requirements
Markdown table: | Requirement | Details | Acceptance hint |
(Minimum 4 rows.)

## Technical notes
APIs, states, configs, integrations (bullets + short table if useful).

## Dependencies
Table: | System / team | Dependency |

## Risks
Table: | Risk | Impact | Mitigation |

## UAT scenarios
Table: | ID | Scenario | Expected |

## Rollout & rollback
Bullets: flags, phases, rollback trigger.

## Success metrics
Measurable KPIs (bullets).

Rules: Do not invent compliance references without tags like [TBD]. Be concise but implementation-ready.
If DOMAIN SCOPE is provided in the user message, tailor examples, systems, and test scenarios to those domains only.`;

const SUBTASK_SYSTEM = `You break down a parent JIRA ticket into child work items for a UPI/fintech program.

Return JSON only:
{"subtasks":[{"summary":"max 120 chars","description":"markdown body for the child: scope, acceptance hints, links to parent context"}]}

Rules:
- 3-8 subtasks; no duplicate scope; each child is shippable by one team where possible.
- Summaries are imperative (e.g. "Implement retry policy on switch").
- Descriptions reference the parent but stay self-contained.`;

const FEEDBACK_SYSTEM = `You improve an existing JIRA ticket markdown.
Incorporate user feedback strictly and return only revised markdown.
Preserve structure unless feedback requests structural change.`;

const MAX_CLARIFY_CHARS = 100_000;
const MAX_GENERATE_CHARS = 350_000;

function truncateForLLM(text, maxChars) {
  const s = String(text || "");
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n\n[TRUNCATED: input exceeded ${maxChars.toLocaleString()} chars]`;
}

function parseJiraIssueKey(input) {
  const s = (input || "").trim();
  if (!s) return "";
  const m = s.match(/\b([A-Z][A-Z0-9]*-\d+)\b/i);
  if (m) return m[1].toUpperCase();
  try {
    const url = new URL(s.startsWith("http") ? s : "https://host/" + s);
    const segments = (url.pathname || "").split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && /^[A-Z0-9]+-\d+$/i.test(last)) return last.toUpperCase();
  } catch (_) {}
  return "";
}

function extractTitle(markdown) {
  const first = String(markdown || "").split("\n").find((l) => l.trim());
  if (!first) return "";
  return first.replace(/^#\s*/, "").trim().slice(0, 255);
}

function repairJSON(text) {
  let s = String(text || "").replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(s);
  } catch (_) {}
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1) {
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch (_) {}
  }
  throw new Error("Could not parse JSON from model response");
}

async function apiJson(path, body, method = "POST") {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  if (!res.ok) {
    const msg =
      data.error ||
      data.message ||
      (typeof data._raw === "string" ? data._raw.slice(0, 300) : null) ||
      `Request failed (${res.status})`;
    throw new Error(String(msg));
  }
  if (data.success === false && data.error) throw new Error(String(data.error));
  return data;
}

async function callLLM(systemPrompt, userMessage, maxTokens, modelId) {
  const data = await apiJson("/api/generate", {
    system: systemPrompt,
    model: modelId,
    messages: [{ role: "user", content: userMessage }],
    max_tokens: maxTokens,
    llmProvider: getLlmProviderForRequest(),
    bedrockModelTier: getBedrockModelTierForRequest(),
  });
  const payload = data.data ?? data;
  const blocks = payload?.content;
  if (!Array.isArray(blocks)) throw new Error("Unexpected LLM response shape");
  return blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
}

function Spinner({ color = "#F59E0B" }) {
  return (
    <div
      style={{
        width: 14,
        height: 14,
        border: "2px solid #1E293B",
        borderTop: `2px solid ${color}`,
        borderRadius: "50%",
        animation: "spin .7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

function renderJiraMarkdown(md) {
  if (!md) return null;
  const lines = md.split("\n");
  const elements = [];
  let tableRows = [];
  let key = 0;

  function flushTable() {
    if (tableRows.length < 2) {
      tableRows = [];
      return;
    }
    const headers = tableRows[0].split("|").map((h) => h.trim()).filter(Boolean);
    const body = tableRows.slice(2);
    elements.push(
      <table key={key++} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 16 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  background: "#111827",
                  color: "#F59E0B",
                  padding: "8px 12px",
                  textAlign: "left",
                  fontWeight: 600,
                  border: "1px solid #1E293B",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => {
            const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
            return cells.length ? (
              <tr key={ri}>
                {cells.map((c, ci) => (
                  <td key={ci} style={{ padding: "8px 12px", border: "1px solid #1E293B", color: "#94A3B8", verticalAlign: "top", lineHeight: 1.65 }}>
                    {c}
                  </td>
                ))}
              </tr>
            ) : null;
          })}
        </tbody>
      </table>
    );
    tableRows = [];
  }

  lines.forEach((line) => {
    if (line.startsWith("# ")) {
      flushTable();
      elements.push(
        <h1 key={key++} style={{ fontSize: 22, fontWeight: 700, color: "#F1F5F9", margin: "24px 0 12px", letterSpacing: "-0.02em" }}>
          {line.replace(/^#\s+/, "")}
        </h1>
      );
    } else if (line.startsWith("## ")) {
      flushTable();
      elements.push(
        <h2 key={key++} style={{ fontSize: 15, fontWeight: 700, color: "#93C5FD", margin: "20px 0 10px", paddingBottom: 6, borderBottom: "1px solid #1E293B" }}>
          {line.replace(/^##\s+/, "")}
        </h2>
      );
    } else if (line.startsWith("### ")) {
      flushTable();
      elements.push(
        <h3 key={key++} style={{ fontSize: 13, fontWeight: 600, color: "#CBD5E1", margin: "14px 0 6px" }}>
          {line.replace(/^###\s+/, "")}
        </h3>
      );
    } else if (line.startsWith("|")) {
      tableRows.push(line);
    } else {
      flushTable();
      if (line.startsWith("- ") || line.startsWith("* ")) {
        elements.push(
          <div key={key++} style={{ display: "flex", gap: 10, marginBottom: 6, paddingLeft: 4 }}>
            <span style={{ color: "#F59E0B", flexShrink: 0 }}>▸</span>
            <span style={{ fontSize: 13, color: "#94A3B8", lineHeight: 1.7 }}>{line.replace(/^[-*]\s+/, "")}</span>
          </div>
        );
      } else if (line.trim()) {
        elements.push(
          <p key={key++} style={{ fontSize: 13, color: "#94A3B8", margin: "0 0 8px", lineHeight: 1.75 }}>
            {line}
          </p>
        );
      }
    }
  });
  flushTable();
  return elements;
}

function HistoryPanel({ history, onLoad, onDelete, onClear, onClose }) {
  const [search, setSearch] = useState("");
  const q = search.toLowerCase();
  const filtered = history.filter((h) => {
    if (!q) return true;
    const keyLine = linkedJiraKeysFromHistoryItem(h).join(" ").toLowerCase();
    return (
      (h.featureName || "").toLowerCase().includes(q) ||
      (h.resultMd || "").toLowerCase().includes(q) ||
      keyLine.includes(q)
    );
  });
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        background: "#060D1A",
        borderLeft: "1px solid #1E293B",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        animation: "slideIn .25s ease",
      }}
    >
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #1E293B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F1F5F9" }}>📋 JIRA Agent History</div>
          <div style={{ fontSize: 11, color: "#374151" }}>{history.length} saved sessions</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {history.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              style={{ background: "none", border: "1px solid #EF444433", borderRadius: 7, padding: "4px 10px", color: "#EF4444", fontSize: 11, cursor: "pointer" }}
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{ background: "#1E293B", border: "none", borderRadius: 8, width: 28, height: 28, color: "#94A3B8", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            ×
          </button>
        </div>
      </div>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #111827" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          style={{ width: "100%", background: "#0D1626", border: "1px solid #1E293B", borderRadius: 8, color: "#CBD5E1", fontSize: 12, padding: "7px 12px", fontFamily: "inherit" }}
        />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "12px 14px" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#1E3A5F" }}>
            <div style={{ fontSize: 28 }}>📭</div>
            <div style={{ fontSize: 13, marginTop: 8 }}>{search ? "No results" : "No saved tickets yet"}</div>
          </div>
        ) : (
          filtered.map((item) => {
            const linkedKeys = linkedJiraKeysFromHistoryItem(item);
            return (
            <div key={item.id} style={{ background: "#0D1626", border: "1px solid #1E293B", borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.featureName || extractTitle(item.resultMd) || "Untitled"}
                  </div>
                  <div style={{ fontSize: 11, color: "#475569" }}>
                    {item.projectKey && <span style={{ marginRight: 8 }}>Proj {item.projectKey}</span>}
                    {(item.createdKey || linkedKeys[0]) && (
                      <span style={{ color: "#22c55e" }}>{item.createdKey || linkedKeys[0]}</span>
                    )}
                  </div>
                  {linkedKeys.length > 0 && (
                    <div style={{ fontSize: 10, color: "#86efac", marginTop: 6, lineHeight: 1.45, wordBreak: "break-word" }}>
                      Linked JIRAs: {linkedKeys.join(", ")}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "#334155", marginTop: 6 }}>{item.date}</div>
                </div>
                <button type="button" onClick={() => onDelete(item.id)} style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 16, alignSelf: "flex-start" }}>
                  🗑
                </button>
              </div>
              <button
                type="button"
                onClick={() => onLoad(item)}
                style={{
                  width: "100%",
                  marginTop: 10,
                  background: "linear-gradient(135deg,#1E3A5F,#1E293B)",
                  border: "1px solid #1E3A5F",
                  borderRadius: 8,
                  padding: "7px",
                  color: "#93C5FD",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                📂 Load session
              </button>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function JiraAgent() {
  const [model, setModel] = useState(MODELS[0]);
  const [phase, setPhase] = useState("input");
  const [view, setView] = useState("form"); // form | result
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [feedbackIncorporated, setFeedbackIncorporated] = useState(false);

  const [jiraIssueKey, setJiraIssueKey] = useState("");
  const [jiraFetchLoading, setJiraFetchLoading] = useState(false);
  const [projectKey, setProjectKey] = useState(() =>
    (loadPublishDefaults().jiraDefaultProjectKey || "").toUpperCase().trim()
  );
  /** Email, display name, or Atlassian accountId — maps to Dev Assignee custom field on create. */
  const [devAssignee, setDevAssignee] = useState(() => loadPublishDefaults().jiraDevAssignee || "");
  /** auto | primary | secondary — same as Connectors → Default JIRA site */
  const [jiraWriteSite, setJiraWriteSite] = useState(() => {
    const s = loadPublishDefaults().jiraWriteSite;
    return ["auto", "primary", "secondary"].includes(s) ? s : "auto";
  });
  const [issueType, setIssueType] = useState("Task");
  const [issueTypeId, setIssueTypeId] = useState("");
  const [issueTypes, setIssueTypes] = useState([]);
  const [issueTypesLoading, setIssueTypesLoading] = useState(false);
  const [issueTypesError, setIssueTypesError] = useState("");

  const [selectedDomains, setSelectedDomains] = useState(() => new Set(["switch"]));
  const [featureName, setFeatureName] = useState("");
  const [requirement, setRequirement] = useState("");
  const [objective, setObjective] = useState("");
  const [clarifyQuestions, setClarifyQuestions] = useState([]);
  const [clarifyAnswers, setClarifyAnswers] = useState("");
  const [includeSubJiras, setIncludeSubJiras] = useState(false);
  /** @type {{ id: string, name: string, extractedText: string, includeInPrompt: boolean, attachToJira: boolean, file: File }[]} */
  const [contextFiles, setContextFiles] = useState([]);
  const [contextUploading, setContextUploading] = useState(false);
  const contextFileRef = useRef(null);

  const [resultMd, setResultMd] = useState("");
  const [subtasks, setSubtasks] = useState([]);
  const [feedback, setFeedback] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdBundle, setCreatedBundle] = useState(null);
  const [attachStatus, setAttachStatus] = useState("");

  const [history, setHistory] = useState(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);
  /** History entry id used to persist linked JIRAs after create (set on generate or load). */
  const historyAnchorRef = useRef(null);
  const hasSentNotifyRef = useRef(false);
  const [openSubtaskIndex, setOpenSubtaskIndex] = useState(null);

  const jiraLabelsForCreate = useMemo(() => jiraLabelsFromDomainIds(selectedDomains), [selectedDomains]);
  const notifyDomainLabelsForCreate = useMemo(() => domainDisplayNamesForNotify(selectedDomains), [selectedDomains]);

  const patchHistoryJiraCreated = useCallback((snapshot) => {
    const anchor = historyAnchorRef.current;
    if (!anchor) return;
    setHistory((h) => {
      const next = h.map((item) =>
        item.id === anchor
          ? {
              ...item,
              jiraCreated: snapshot,
              createdKey: snapshot.parentKey,
              linkedJiraKeys: [
                snapshot.parentKey,
                ...(snapshot.subtasks || []).map((s) => s.key).filter(Boolean),
              ].filter(Boolean),
            }
          : item
      );
      saveHistoryLS(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onDefaults = () => {
      const d = loadPublishDefaults();
      setDevAssignee(d.jiraDevAssignee || "");
      const s = d.jiraWriteSite;
      if (["auto", "primary", "secondary"].includes(s)) setJiraWriteSite(s);
      const pk = (d.jiraDefaultProjectKey || "").toUpperCase().trim();
      if (pk) setProjectKey((prev) => (prev.trim() ? prev : pk));
    };
    window.addEventListener("publish-defaults-changed", onDefaults);
    return () => window.removeEventListener("publish-defaults-changed", onDefaults);
  }, []);

  useEffect(() => {
    const onImport = () => setHistory(loadHistory());
    window.addEventListener("agent-localstorage-imported", onImport);
    return () => window.removeEventListener("agent-localstorage-imported", onImport);
  }, []);

  const resolvedDevAssignee = useMemo(
    () => devAssignee.trim() || loadPublishDefaults().jiraDevAssignee?.trim() || undefined,
    [devAssignee]
  );

  const docTitle = useMemo(() => extractTitle(resultMd), [resultMd]);
  const derivedJiraKey = createdBundle?.parentKey || parseJiraIssueKey(jiraIssueKey);
  const jiraCreatedKey = createdBundle?.parentKey || "";
  const displayTitle = featureName.trim() || docTitle || "JIRA Ticket";

  const toggleDomain = (id) => {
    setSelectedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size <= 1) return next;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const domainLabels = useMemo(
    () =>
      [...selectedDomains]
        .map((id) => DOMAINS.find((d) => d.id === id)?.label)
        .filter(Boolean)
        .join(", "),
    [selectedDomains]
  );

  const buildContext = () => {
    const parts = [];
    if (featureName.trim()) parts.push(`Feature / title: ${featureName.trim()}`);
    if (domainLabels) parts.push(`DOMAIN SCOPE (multi-select): ${domainLabels}. Constrain analysis to these domains.`);
    if (projectKey.trim()) parts.push(`JIRA Project Key: ${projectKey.trim().toUpperCase()}`);
    if (jiraIssueKey.trim()) parts.push(`Reference JIRA: ${jiraIssueKey.trim()}`);
    if (objective.trim()) parts.push(`Objective:\n${objective.trim()}`);
    if (requirement.trim()) parts.push(`Requirement / context:\n${requirement.trim()}`);
    contextFiles
      .filter((f) => f.includeInPrompt && f.extractedText?.trim())
      .forEach((f) => parts.push(`--- Uploaded file: ${f.name} ---\n${f.extractedText}`));
    return parts.join("\n\n");
  };

  const handleContextFilesChange = async (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = "";
    if (!list.length) return;
    setContextUploading(true);
    for (const file of list) {
      const id = `${Date.now()}_${file.name}_${Math.random().toString(36).slice(2)}`;
      const lower = file.name.toLowerCase();
      const ok = /\.(docx|pdf|xlsx|xls|txt|csv|md)$/i.test(lower);
      if (!ok) {
        setStatusMsg(`Skipped ${file.name} — use .docx, .pdf, .xlsx, .xls, .txt, .csv, or .md`);
        continue;
      }
      try {
        const form = new FormData();
        form.append("file", file);
        const r = await fetch(`${API_BASE}/api/extract-context-file`, { method: "POST", body: form });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Extract failed ${r.status}`);
        setContextFiles((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            extractedText: d.text || "",
            includeInPrompt: true,
            attachToJira: false,
            file,
          },
        ]);
      } catch (err) {
        setStatusMsg(`Could not read ${file.name}: ${err.message}`);
      }
    }
    setContextUploading(false);
  };

  const uploadJiraAttachments = async (issueKey) => {
    const key = String(issueKey || "").trim().toUpperCase();
    if (!key) return;
    const files = contextFiles.filter((f) => f.attachToJira && f.file);
    if (!files.length) return;
    setAttachStatus("Uploading attachments…");
    try {
      const form = new FormData();
      form.append("issueKey", key);
      if (jiraWriteSite !== "auto") form.append("jiraSite", jiraWriteSite);
      files.forEach((f) => form.append("files", f.file, f.name));
      const r = await fetch(`${API_BASE}/api/jira/attach`, { method: "POST", body: form });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Attach failed ${r.status}`);
      setAttachStatus(`Attached ${Array.isArray(d.attachments) ? d.attachments.length : files.length} file(s) to ${key}.`);
    } catch (e) {
      setAttachStatus(`Attachments: ${e.message}`);
    }
  };

  const fetchJiraIntoRequirement = async () => {
    const raw = jiraIssueKey.trim();
    const key = parseJiraIssueKey(raw);
    if (!key && !raw) {
      setStatusMsg("Enter a JIRA key (e.g. TSP-1889) or paste a browse URL.");
      return;
    }
    setJiraFetchLoading(true);
    setStatusMsg("");
    try {
      const idParam = raw || key;
      const siteQs = jiraWriteSite !== "auto" ? `?site=${encodeURIComponent(jiraWriteSite)}` : "";
      const r = await fetch(`${API_BASE}/api/jira-issue/${encodeURIComponent(idParam)}${siteQs}`, { headers: { Accept: "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `JIRA error ${r.status}`);
      const block = [d.summary ? `${d.id} — ${d.summary}` : d.id, d.description, d.acceptanceCriteria ? `Acceptance criteria:\n${d.acceptanceCriteria}` : ""]
        .filter(Boolean)
        .join("\n\n");
      setRequirement((prev) => (prev ? `${prev}\n\n---\n\n${block}` : block));
      const resolvedKey = d.id || key;
      if (resolvedKey) syncPublishDefaultJiraKey(resolvedKey);
      syncPublishJiraSiteFromIssue(d);
      if (d.jiraSite === "secondary" || d.jiraSite === "primary") setJiraWriteSite(d.jiraSite);
      setStatusMsg(`Loaded ${d.id}`);
    } catch (e) {
      setStatusMsg("Error: " + e.message);
    } finally {
      setJiraFetchLoading(false);
    }
  };

  const loadIssueTypes = async () => {
    const pk = projectKey.trim().toUpperCase();
    if (!pk) {
      setIssueTypesError("Set project key first");
      return;
    }
    setIssueTypesLoading(true);
    setIssueTypesError("");
    try {
      const qs = new URLSearchParams({ projectKey: pk });
      if (jiraWriteSite !== "auto") qs.set("jiraSite", jiraWriteSite);
      const r = await fetch(`${API_BASE}/api/jira/issue-types?${qs}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (!d.success) throw new Error(d.error || "Failed to load issue types");
      const types = (d.types || []).filter((t) => !t.subtask);
      setIssueTypes(types);
      if (types.length && !issueTypeId) {
        const match = types.find((t) => t.name === issueType) || types[0];
        if (match) setIssueTypeId(match.id);
      }
    } catch (e) {
      setIssueTypesError(e.message);
      setIssueTypes([]);
    } finally {
      setIssueTypesLoading(false);
    }
  };

  useEffect(() => {
    setIssueTypeId("");
    setIssueTypes([]);
  }, [projectKey, jiraWriteSite]);

  const handleClarify = async () => {
    const filePromptText = contextFiles.some((f) => f.includeInPrompt && String(f.extractedText || "").trim());
    if (!requirement.trim() && !filePromptText) {
      setStatusMsg("Enter requirement text and/or upload files with “Include text in AI prompt” checked.");
      return;
    }
    setLoading(true);
    setStatusMsg("Analyzing input and drafting objective…");
    try {
      const ctx = truncateForLLM(buildContext(), MAX_CLARIFY_CHARS);
      const raw = await callLLM(CLARIFY_SYSTEM, ctx, 1400, model.id);
      let parsed = null;
      try {
        parsed = repairJSON(raw);
      } catch {
        parsed = null;
      }
      const draft = parsed?.draftObjective || "";
      const questions = Array.isArray(parsed?.questions) ? parsed.questions.slice(0, 6) : [];
      if (draft && !objective.trim()) setObjective(draft);
      setClarifyQuestions(questions);
      setPhase("clarify");
      setStatusMsg("");
    } catch (e) {
      setStatusMsg("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    const filePromptText = contextFiles.some((f) => f.includeInPrompt && String(f.extractedText || "").trim());
    if (!requirement.trim() && !filePromptText) {
      setStatusMsg("Enter requirement text and/or include uploaded file text in the AI prompt.");
      return;
    }
    setLoading(true);
    setStatusMsg("Generating JIRA ticket…");
    setCreatedBundle(null);
    try {
      let userMsg = buildContext();
      if (clarifyAnswers.trim()) userMsg += `\n\nClarification answers:\n${clarifyAnswers.trim()}`;
      userMsg = truncateForLLM(userMsg, MAX_GENERATE_CHARS);
      const md = await callLLM(JIRA_SYSTEM, userMsg, 8000, model.id);
      setResultMd(md);
      let nextSubs = [];
      if (includeSubJiras) {
        setStatusMsg("Generating sub-JIRAs…");
        const subRaw = await callLLM(
          SUBTASK_SYSTEM,
          truncateForLLM(`CONTEXT:\n${buildContext()}\n\nPARENT TICKET:\n${md}`, Math.min(MAX_GENERATE_CHARS, 120_000)),
          5000,
          model.id
        );
        try {
          const p = repairJSON(subRaw);
          nextSubs = Array.isArray(p?.subtasks) ? p.subtasks : [];
        } catch {
          nextSubs = [];
        }
      }
      setSubtasks(nextSubs);
      setPhase("done");
      setView("result");
      setFeedbackIncorporated(false);
      setAttachStatus("");
      setStatusMsg(nextSubs.length ? `Draft ready — ${nextSubs.length} sub-JIRAs proposed.` : "Draft ready.");

      const entry = {
        id: Date.now().toString(),
        date: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        featureName: featureName.trim(),
        projectKey: projectKey.trim().toUpperCase(),
        issueType,
        issueTypeId,
        objective,
        requirement: requirement.slice(0, 500),
        selectedDomains: [...selectedDomains],
        resultMd: md,
        subtasks: nextSubs,
        model: model.label,
      };
      const updated = [entry, ...history].slice(0, 50);
      setHistory(updated);
      saveHistoryLS(updated);
      historyAnchorRef.current = entry.id;

      void exportAgentOutput({
        agent: "JIRA",
        jiraId: derivedJiraKey || "NOJIRA",
        subject: displayTitle,
        content: md + (nextSubs.length ? `\n\n---\n## Proposed sub-JIRAs\n${JSON.stringify(nextSubs, null, 2)}` : ""),
      });
      if (!hasSentNotifyRef.current) {
        hasSentNotifyRef.current = true;
        await sendCompletionNotify({
          agentName: "JIRA Agent",
          identifier: displayTitle,
          notifySubject: buildShareSubjectLine("jira", derivedJiraKey, displayTitle),
        });
      }
    } catch (e) {
      setStatusMsg("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImprove = async () => {
    if (!feedback.trim() || !resultMd.trim()) return;
    setLoading(true);
    setStatusMsg("Improving ticket…");
    try {
      const prompt = `CURRENT TICKET:\n${resultMd}\n\nUSER FEEDBACK:\n${feedback}`;
      const improved = await callLLM(FEEDBACK_SYSTEM, truncateForLLM(prompt, MAX_GENERATE_CHARS), 8000, model.id);
      setResultMd(improved);
      setFeedback("");
      setFeedbackIncorporated(true);
      setStatusMsg("Feedback incorporated.");
    } catch (e) {
      setStatusMsg("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateJira = async () => {
    if (!resultMd.trim()) return;
    const pk = projectKey.trim().toUpperCase();
    if (!pk) {
      setStatusMsg("Set JIRA Project Key before creating.");
      return;
    }
    const summary = featureName.trim() || docTitle;
    if (!summary) {
      setStatusMsg("Set Feature / Ticket Title, or ensure the draft has a # heading.");
      return;
    }
    setCreating(true);
    setStatusMsg("Creating JIRA issue…");
    try {
      const data = await apiJson("/api/jira/create", {
        projectKey: pk,
        issueType,
        issueTypeId: issueTypeId || undefined,
        summary,
        description: resultMd,
        devAssignee: resolvedDevAssignee,
        labels: jiraLabelsForCreate,
        notifyDomainLabels: notifyDomainLabelsForCreate,
        ...(jiraWriteSite !== "auto" ? { jiraSite: jiraWriteSite } : {}),
      });
      setCreatedBundle({ parentKey: data.key, parentBrowseUrl: data.browseUrl || "", subtasks: [] });
      setJiraIssueKey(data.key || "");
      if (data.key) {
        syncPublishDefaultJiraKey(data.key);
        patchHistoryJiraCreated({
          parentKey: data.key,
          parentBrowseUrl: data.browseUrl || "",
          subtasks: [],
        });
      }
      setStatusMsg(data.key ? `Created ${data.key}` : "Created.");
      if (data.key) await uploadJiraAttachments(data.key);
    } catch (e) {
      const msg = "Error: " + (e?.message || String(e));
      console.error("[JiraAgent] Create JIRA failed:", msg);
      setStatusMsg(msg);
      setTimeout(() => {
        document.getElementById("jira-agent-status-banner")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 0);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateWithSubtasks = async () => {
    if (!resultMd.trim() || !subtasks.length) {
      setStatusMsg("Generate with “Also propose sub-JIRAs” checked, or wait for subtasks to appear.");
      return;
    }
    const pk = projectKey.trim().toUpperCase();
    if (!pk) {
      setStatusMsg("Set JIRA Project Key first.");
      return;
    }
    const summary = featureName.trim() || docTitle;
    if (!summary) {
      setStatusMsg("Set Feature / Ticket Title before creating.");
      return;
    }
    setCreating(true);
    setStatusMsg("Creating parent and sub-JIRAs…");
    try {
      const data = await apiJson("/api/jira/create-with-subtasks", {
        projectKey: pk,
        devAssignee: resolvedDevAssignee,
        labels: jiraLabelsForCreate,
        notifyDomainLabels: notifyDomainLabelsForCreate,
        ...(jiraWriteSite !== "auto" ? { jiraSite: jiraWriteSite } : {}),
        parent: {
          summary,
          description: resultMd,
          issueType,
          issueTypeId: issueTypeId || undefined,
        },
        subtasks: subtasks.map((s) => ({
          summary: s.summary,
          description: s.description || s.summary,
        })),
      });
      setCreatedBundle(data);
      if (data.parentKey) {
        setJiraIssueKey(data.parentKey);
        syncPublishDefaultJiraKey(data.parentKey);
        patchHistoryJiraCreated({
          parentKey: data.parentKey,
          parentBrowseUrl: data.parentBrowseUrl || "",
          subtasks: (data.subtasks || []).filter((s) => s.key).map((s) => ({ key: s.key, browseUrl: s.browseUrl || "" })),
        });
      }
      const okSubs = (data.subtasks || []).filter((s) => s.key).length;
      setStatusMsg(
        data.parentKey
          ? `Created parent ${data.parentKey} and ${okSubs}/${subtasks.length} sub-JIRAs (see errors on failed rows in server log if any).`
          : "Create finished."
      );
      if (data.parentKey) await uploadJiraAttachments(data.parentKey);
    } catch (e) {
      const msg = "Error: " + (e?.message || String(e));
      console.error("[JiraAgent] Create with subtasks failed:", msg);
      setStatusMsg(msg);
      setTimeout(() => {
        document.getElementById("jira-agent-status-banner")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 0);
    } finally {
      setCreating(false);
    }
  };

  const resetSession = () => {
    setPhase("input");
    setView("form");
    setResultMd("");
    setSubtasks([]);
    setClarifyQuestions([]);
    setClarifyAnswers("");
    setCreatedBundle(null);
    setFeedback("");
    setFeedbackIncorporated(false);
    setStatusMsg("");
    setAttachStatus("");
  };

  const startNewJira = () => {
    resetSession();
    setFeatureName("");
    setRequirement("");
    setObjective("");
    const d = loadPublishDefaults();
    setProjectKey((d.jiraDefaultProjectKey || "").toUpperCase().trim());
    setDevAssignee(d.jiraDevAssignee || "");
    setJiraIssueKey("");
    setContextFiles([]);
    setSelectedDomains(new Set(["switch"]));
    setIncludeSubJiras(false);
    setIssueType("Task");
    setIssueTypeId("");
    setIssueTypes([]);
  };

  const loadFromHistory = (item) => {
    historyAnchorRef.current = item.id;
    setFeatureName(item.featureName || "");
    setProjectKey(item.projectKey || "");
    setIssueType(item.issueType || "Task");
    setIssueTypeId(item.issueTypeId || "");
    if (Array.isArray(item.selectedDomains) && item.selectedDomains.length) {
      setSelectedDomains(new Set(item.selectedDomains));
    }
    setObjective(item.objective || "");
    setRequirement(item.requirement || "");
    setResultMd(item.resultMd || "");
    setSubtasks(Array.isArray(item.subtasks) ? item.subtasks : []);
    setContextFiles([]);
    setPhase(item.resultMd ? "done" : "input");
    setView(item.resultMd ? "result" : "form");
    setShowHistory(false);
    if (item.jiraCreated?.parentKey) {
      setCreatedBundle({
        parentKey: item.jiraCreated.parentKey,
        parentBrowseUrl: item.jiraCreated.parentBrowseUrl || "",
        subtasks: item.jiraCreated.subtasks || [],
      });
      setJiraIssueKey(item.jiraCreated.parentKey);
    } else {
      setCreatedBundle(null);
      setJiraIssueKey("");
    }
    setFeedbackIncorporated(false);
    setAttachStatus("");
    setStatusMsg("Loaded from history");
  };

  const deleteHistory = (id) => {
    const u = history.filter((h) => h.id !== id);
    setHistory(u);
    saveHistoryLS(u);
  };
  const clearHistory = () => {
    setHistory([]);
    saveHistoryLS([]);
  };

  const stepMeta = [
    { id: "input", label: "Inputs" },
    { id: "clarify", label: "Clarify" },
    { id: "ticket", label: "Ticket" },
    { id: "refine", label: "Refine" },
    { id: "done", label: "Done" },
  ];
  let activeStepIdx = 0;
  if (view === "form" && resultMd) activeStepIdx = 2;
  else if (view === "form" && phase === "clarify") activeStepIdx = 1;
  else if (view === "result" && resultMd && !jiraCreatedKey) activeStepIdx = 2;
  else if (view === "result" && jiraCreatedKey && !feedbackIncorporated) activeStepIdx = 3;
  else if (feedbackIncorporated) activeStepIdx = 4;
  else if (view === "result" && resultMd) activeStepIdx = 2;

  const ResultPanel = () => (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setView("form")}
          style={{ background: "#111827", border: "1px solid #334155", borderRadius: 8, padding: "8px 14px", color: "#93C5FD", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          ← Edit inputs
        </button>
        {attachStatus && <span style={{ fontSize: 11, color: "#94a3b8" }}>{attachStatus}</span>}
      </div>
      <div style={{ background: "#0A1120", border: "1px solid #1E3A5F", borderRadius: 14, padding: "28px 32px", marginBottom: 20 }}>
        <div style={{ borderBottom: "2px solid #1E3A5F", paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#38BDF8", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>JIRA ticket draft</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#F1F5F9" }}>{displayTitle}</div>
          <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>
            {projectKey ? `${projectKey} · ` : ""}
            {issueType}
            {domainLabels ? ` · ${domainLabels}` : ""}
          </div>
        </div>
        <div style={{ lineHeight: 1.75 }}>{renderJiraMarkdown(resultMd)}</div>
      </div>

      {subtasks.length > 0 && (
        <div style={{ background: "#0D1626", border: "1px solid #1E293B", borderRadius: 14, padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#A78BFA", marginBottom: 12 }}>Proposed sub-JIRAs ({subtasks.length})</div>
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
            Use <strong style={{ color: "#E2E8F0" }}>Create parent + sub-JIRAs</strong> to push all at once. Sub-task type must be enabled in JIRA; override in <code style={{ background: "#111827", padding: "2px 6px", borderRadius: 4 }}>.env</code> if needed.
          </p>
          {subtasks.map((s, i) => {
            const fullText = s.description || s.body || s.summary || "";
            const isOpen = openSubtaskIndex === i;
            return (
              <div
                key={i}
                style={{ border: "1px solid #1E293B", borderRadius: 10, padding: 14, marginBottom: 10, background: "#0B1220", cursor: "pointer" }}
                onClick={() => setOpenSubtaskIndex(isOpen ? null : i)}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0" }}>{s.summary || `Subtask ${i + 1}`}</div>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{isOpen ? "Hide" : "View full details"}</span>
                </div>
                {isOpen ? (
                  <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.6 }}>{renderJiraMarkdown(fullText)}</div>
                ) : (
                  <div style={{ fontSize: 12, color: "#94A3B8" }}>
                    {fullText.slice(0, 400)}
                    {fullText.length > 400 ? "…" : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(resultMd)}
          style={{ background: "linear-gradient(135deg,#1D4ED8,#2563EB)", border: "none", borderRadius: 9, padding: "10px 18px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          📋 Copy markdown
        </button>
        <button type="button" onClick={handleCreateJira} disabled={creating} style={{ background: "#0052CC", border: "none", borderRadius: 9, padding: "10px 18px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: creating ? "wait" : "pointer" }}>
          {creating ? "Creating…" : "Create JIRA (parent only)"}
        </button>
        <button
          type="button"
          onClick={handleCreateWithSubtasks}
          disabled={creating || !subtasks.length}
          style={{
            background: subtasks.length ? "#7C3AED" : "#334155",
            border: "none",
            borderRadius: 9,
            padding: "10px 18px",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: creating || !subtasks.length ? "not-allowed" : "pointer",
          }}
        >
          Create parent + sub-JIRAs
        </button>
        {createdBundle?.parentBrowseUrl && (
          <a href={createdBundle.parentBrowseUrl} target="_blank" rel="noreferrer" style={{ alignSelf: "center", color: "#7DD3FC", fontSize: 13, fontWeight: 600 }}>
            Open {createdBundle.parentKey}
          </a>
        )}
        {createdBundle?.subtasks?.some((s) => s.browseUrl) && (
          <div style={{ width: "100%", fontSize: 11, color: "#94a3b8", lineHeight: 1.6 }}>
            Sub-JIRAs:{" "}
            {createdBundle.subtasks
              .filter((s) => s.browseUrl)
              .map((s) => (
                <span key={s.key} style={{ marginRight: 10 }}>
                  <a href={s.browseUrl} target="_blank" rel="noreferrer" style={{ color: "#A78BFA", fontWeight: 600 }}>
                    {s.key}
                  </a>
                </span>
              ))}
          </div>
        )}
      </div>

      <div style={{ background: "#0D1626", border: "1px solid #1E293B", borderRadius: 14, padding: 24, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9", marginBottom: 10 }}>Refine (after JIRA is created, use feedback to revise the draft)</div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={4}
          placeholder="Feedback for the next revision"
          style={{ width: "100%", background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "10px 12px", fontSize: 12 }}
        />
        <button
          type="button"
          onClick={handleImprove}
          disabled={loading || !feedback.trim()}
          style={{ marginTop: 10, background: "linear-gradient(135deg,#A78BFA,#6366F1)", border: "none", borderRadius: 8, padding: "8px 16px", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          {loading ? "Improving…" : "Apply feedback"}
        </button>
      </div>

      <ShareAndScore docType="jira" title={displayTitle} content={resultMd} jiraKey={derivedJiraKey} jiraShareSite={jiraWriteSite} autoPublish={[]} />

      {subtasks.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#E5E7EB", marginBottom: 8 }}>Get score for sub-JIRAs</div>
          {subtasks.map((s, i) => (
            <div
              key={i}
              style={{
                marginBottom: 16,
                border: "1px solid #1E293B",
                borderRadius: 12,
                padding: 16,
                background: "#020617",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>
                {s.summary || `Sub-JIRA ${i + 1}`}
              </div>
              <ShareAndScore
                docType="jira"
                title={`${displayTitle} – ${s.summary || `Sub-JIRA ${i + 1}`}`}
                content={s.description || s.body || s.summary || ""}
                jiraKey=""
                jiraShareSite={jiraWriteSite}
                autoPublish={[]}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div style={{ fontFamily: "'IBM Plex Sans','Segoe UI',sans-serif", background: "#0B1120", minHeight: "100vh", color: "#E2E8F0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box}
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: none; } }
        textarea:focus, input:focus, select:focus { outline: none; border-color: #3B82F6 !important; }
      `}</style>

      <div style={{ background: "#060D1A", borderBottom: "1px solid #1E293B", height: 56, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#38BDF8,#0052CC)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
            🎫
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#F8FAFC" }}>UPI Switch · JIRA Agent</div>
            <div style={{ fontSize: 10, color: "#374151", letterSpacing: 0.5 }}>Clarify · Parent + sub-JIRAs · Share · History</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "52%", flex: 1 }}>
          {stepMeta.map((s, i) => {
            const done = i < activeStepIdx;
            const active = i === activeStepIdx;
            const refineLocked = s.id === "refine" && !jiraCreatedKey;
            const doneLocked = s.id === "done" && !feedbackIncorporated;
            const muted = (s.id === "refine" && refineLocked) || (s.id === "done" && doneLocked);
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div
                  title={s.id === "refine" ? "Unlocked after Create JIRA" : s.id === "done" ? "Unlocked after Apply feedback" : ""}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: 20,
                    background: done ? "#38BDF818" : active ? "#1E3A5F" : "transparent",
                    border: `1px solid ${done ? "#38BDF844" : active ? "#3B82F6" : "#1E293B"}`,
                    opacity: muted && !active ? 0.55 : 1,
                  }}
                >
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: done ? "#38BDF8" : active ? "#3B82F6" : "#1E293B" }} />
                  <span style={{ fontSize: 9, color: done ? "#38BDF8" : active ? "#93C5FD" : "#475569", fontWeight: 500 }}>{s.label}</span>
                </div>
                {i < stepMeta.length - 1 && <div style={{ width: 8, height: 1, background: done ? "#38BDF844" : "#1E293B" }} />}
              </div>
            );
          })}
          <button
            type="button"
            onClick={startNewJira}
            style={{
              background: "linear-gradient(135deg,#0EA5E9,#2563EB)",
              border: "none",
              borderRadius: 9,
              padding: "6px 12px",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              marginLeft: 8,
            }}
          >
            + New JIRA
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            style={{ background: "#0D1626", border: "1px solid #1E3A5F", borderRadius: 9, padding: "5px 12px", color: "#93C5FD", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            📋 History {history.length > 0 && <span style={{ background: "#1E3A5F", borderRadius: 10, padding: "1px 6px", fontSize: 10, color: "#38BDF8", fontWeight: 700 }}>{history.length}</span>}
          </button>
        </div>
      </div>

      {statusMsg ? (
        <div
          role="alert"
          id="jira-agent-status-banner"
          style={{
            position: "sticky",
            top: 40,
            zIndex: 50,
            padding: "12px 24px",
            fontSize: 13,
            lineHeight: 1.45,
            background: statusMsg.startsWith("Error") ? "#450a0a" : "#0c1e3d",
            color: statusMsg.startsWith("Error") ? "#fecaca" : "#7dd3fc",
            borderBottom: "1px solid #1e293b",
            fontWeight: statusMsg.startsWith("Error") ? 600 : 400,
          }}
        >
          {statusMsg}
        </div>
      ) : null}

      {view === "result" && resultMd ? (
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 20px 100px" }}>
          <ResultPanel />
        </div>
      ) : (
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 20px 100px" }}>
        <div style={{ background: "#0D1626", border: "1px solid #1E293B", borderRadius: 14, padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#38BDF8", marginBottom: 12 }}>JIRA connector</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Import from JIRA</label>
              <input
                value={jiraIssueKey}
                onChange={(e) => setJiraIssueKey(e.target.value)}
                placeholder="TSP-18, TPAP-113, TPG-1, or paste browse URL"
                style={{ width: "100%", marginTop: 4, background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "8px 12px", fontSize: 12 }}
              />
            </div>
            <div style={{ flex: "0 0 200px" }}>
              <label style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Site (key only)</label>
              <select
                value={jiraWriteSite}
                onChange={(e) => {
                  const v = e.target.value;
                  setJiraWriteSite(v);
                  const cur = loadPublishDefaults();
                  savePublishDefaults({ ...cur, jiraWriteSite: v });
                }}
                style={{ width: "100%", marginTop: 4, background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "8px 10px", fontSize: 12 }}
              >
                <option value="auto">Auto</option>
                <option value="primary">TSP</option>
                <option value="secondary">TPAP</option>
              </select>
            </div>
            <button
              type="button"
              onClick={fetchJiraIntoRequirement}
              disabled={jiraFetchLoading}
              style={{ background: "#1E3A5F", border: "1px solid #334155", borderRadius: 8, padding: "8px 14px", color: "#93C5FD", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              {jiraFetchLoading ? "Fetching…" : "Fetch into context"}
            </button>
          </div>
        </div>

        <div style={{ background: "#0D1626", border: "1px solid #1E293B", borderRadius: 14, padding: 24, marginBottom: 20 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#F1F5F9" }}>Model</div>
            {MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModel(m)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: model.id === m.id ? `1px solid ${m.color}` : "1px solid #1E293B",
                  background: model.id === m.id ? `${m.color}22` : "#0B1220",
                  color: model.id === m.id ? m.color : "#64748b",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", marginBottom: 8 }}>Domains (multi-select)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {DOMAINS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleDomain(d.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: selectedDomains.has(d.id) ? `1px solid ${d.color}` : "1px solid #1E293B",
                    background: selectedDomains.has(d.id) ? `${d.color}18` : "#0B1220",
                    color: selectedDomains.has(d.id) ? d.color : "#64748b",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <span>{d.icon}</span> {d.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Project key</label>
              <input
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                placeholder="TSP"
                style={{ width: "100%", marginTop: 4, background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "8px 12px", fontSize: 12 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Issue type</label>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <select
                  value={issueTypeId || issueType}
                  onChange={(e) => {
                    const v = e.target.value;
                    const byId = issueTypes.find((t) => t.id === v);
                    if (byId) {
                      setIssueTypeId(byId.id);
                      setIssueType(byId.name);
                    } else {
                      setIssueTypeId("");
                      setIssueType(v);
                    }
                  }}
                  style={{ flex: 1, background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "8px 10px", fontSize: 12 }}
                >
                  {issueTypes.length ? (
                    issueTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="Task">Task</option>
                      <option value="Story">Story</option>
                      <option value="Bug">Bug</option>
                      <option value="Epic">Epic</option>
                    </>
                  )}
                </select>
                <button
                  type="button"
                  onClick={loadIssueTypes}
                  disabled={issueTypesLoading}
                  style={{ whiteSpace: "nowrap", background: "#111827", border: "1px solid #334155", borderRadius: 8, padding: "8px 10px", color: "#93C5FD", fontSize: 11, cursor: "pointer" }}
                >
                  {issueTypesLoading ? "…" : "Load from JIRA"}
                </button>
              </div>
              {issueTypesError && <div style={{ fontSize: 10, color: "#f87171", marginTop: 4 }}>{issueTypesError}</div>}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Dev assignee (if required by JIRA)</label>
            <input
              value={devAssignee}
              onChange={(e) => setDevAssignee(e.target.value)}
              placeholder="e.g. Deepankar.pathak@finmate.tech or display name or Atlassian account ID"
              style={{ width: "100%", marginTop: 4, background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "8px 12px", fontSize: 12 }}
            />
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
              Also set under <strong style={{ color: "#94a3b8" }}>Connectors → Save defaults</strong>. Server can set <code style={{ background: "#111827", padding: "2px 6px", borderRadius: 4 }}>JIRA_DEV_ASSIGNEE</code> or{" "}
              <code style={{ background: "#111827", padding: "2px 6px", borderRadius: 4 }}>JIRA_DEV_ASSIGNEE_ACCOUNT_ID</code> in <code style={{ background: "#111827", padding: "2px 6px", borderRadius: 4 }}>.env</code>.
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Feature / ticket title (summary)</label>
            <input
              value={featureName}
              onChange={(e) => setFeatureName(e.target.value)}
              placeholder="Shown in JIRA summary field"
              style={{ width: "100%", marginTop: 4, background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "8px 12px", fontSize: 12 }}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Requirement / context</label>
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              rows={8}
              placeholder="Paste BRD snippet, incident notes, or specs…"
              style={{ width: "100%", marginTop: 4, background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "10px 12px", fontSize: 12, resize: "vertical", minHeight: 120 }}
            />
            <input ref={contextFileRef} type="file" multiple accept=".docx,.pdf,.xlsx,.xls,.txt,.csv,.md" style={{ display: "none" }} onChange={handleContextFilesChange} />
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => contextFileRef.current?.click()}
                disabled={contextUploading}
                style={{ background: "#111827", border: "1px solid #334155", borderRadius: 8, padding: "8px 12px", color: "#93C5FD", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
              >
                {contextUploading ? "Reading files…" : "📎 Upload documents"}
              </button>
              <span style={{ fontSize: 10, color: "#64748b" }}>.docx · .pdf · .xlsx · .xls · .txt · .csv · .md</span>
            </div>
            {contextFiles.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {contextFiles.map((cf) => (
                  <div key={cf.id} style={{ background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, padding: 10, fontSize: 11 }}>
                    <div style={{ fontWeight: 600, color: "#E2E8F0", marginBottom: 8 }}>{cf.name}</div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#94A3B8", cursor: "pointer", marginBottom: 4 }}>
                      <input
                        type="checkbox"
                        checked={cf.includeInPrompt}
                        onChange={(e) => setContextFiles((prev) => prev.map((x) => (x.id === cf.id ? { ...x, includeInPrompt: e.target.checked } : x)))}
                      />
                      Include text in AI prompt
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#94A3B8", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={cf.attachToJira}
                        onChange={(e) => setContextFiles((prev) => prev.map((x) => (x.id === cf.id ? { ...x, attachToJira: e.target.checked } : x)))}
                      />
                      Attach original file to JIRA when creating issue
                    </label>
                    <button
                      type="button"
                      onClick={() => setContextFiles((prev) => prev.filter((x) => x.id !== cf.id))}
                      style={{ marginTop: 8, background: "none", border: "1px solid #EF444433", borderRadius: 6, padding: "4px 8px", color: "#f87171", fontSize: 10, cursor: "pointer" }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Objective</label>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={3}
              style={{ width: "100%", marginTop: 4, background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "10px 12px", fontSize: 12, resize: "vertical" }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 12, color: "#94A3B8", cursor: "pointer" }}>
            <input type="checkbox" checked={includeSubJiras} onChange={(e) => setIncludeSubJiras(e.target.checked)} />
            Also propose sub-JIRAs ( decomposition after main ticket )
          </label>

          {resultMd && (
            <div style={{ marginTop: 14, padding: 12, background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12, color: "#94a3b8" }}>
              A draft already exists. Regenerate from current inputs (you’ll return to the result screen after).
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading}
                style={{
                  marginLeft: 10,
                  background: "#F59E0B",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 12px",
                  color: "#0B1120",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                Regenerate draft
              </button>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            {phase === "input" && (
              <>
                <button
                  type="button"
                  onClick={handleClarify}
                  disabled={loading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "linear-gradient(135deg,#0EA5E9,#3B82F6)",
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 20px",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: loading ? "wait" : "pointer",
                  }}
                >
                  {loading && <Spinner color="#fff" />}
                  Next: clarify &amp; set objective
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "#111827",
                    border: "1px solid #334155",
                    borderRadius: 10,
                    padding: "10px 16px",
                    color: "#93C5FD",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: loading ? "wait" : "pointer",
                  }}
                >
                  Skip clarify — generate now
                </button>
              </>
            )}
            <button type="button" onClick={resetSession} style={{ background: "#111827", border: "1px solid #334155", borderRadius: 8, padding: "10px 16px", color: "#94A3B8", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              Reset this screen
            </button>
          </div>
        </div>

        {phase === "clarify" && (
          <div style={{ background: "#0D1626", border: "1px solid #1E293B", borderRadius: 14, padding: 24, marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#F1F5F9", marginBottom: 10 }}>Clarifying questions</div>
            {clarifyQuestions.length ? (
              <ol style={{ color: "#CBD5E1", fontSize: 13, lineHeight: 1.7, paddingLeft: 18, marginBottom: 12 }}>
                {clarifyQuestions.map((q, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {q}
                  </li>
                ))}
              </ol>
            ) : (
              <p style={{ color: "#64748b", fontSize: 13 }}>No extra questions — continue when ready.</p>
            )}
            <textarea
              value={clarifyAnswers}
              onChange={(e) => setClarifyAnswers(e.target.value)}
              rows={5}
              placeholder="Answers (optional)"
              style={{ width: "100%", background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "10px 12px", fontSize: 12 }}
            />
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              style={{
                marginTop: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: "100%",
                background: "linear-gradient(135deg,#F59E0B,#EA580C)",
                border: "none",
                borderRadius: 10,
                padding: "12px 20px",
                color: "#0B1120",
                fontSize: 14,
                fontWeight: 800,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading && <Spinner />}
              Generate JIRA ticket
            </button>
          </div>
        )}
      </div>
      )}

      {showHistory && (
        <HistoryPanel history={history} onLoad={loadFromHistory} onDelete={deleteHistory} onClear={clearHistory} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
