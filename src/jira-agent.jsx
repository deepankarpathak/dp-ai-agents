import { useEffect, useMemo, useState } from "react";
import { API_BASE, sendCompletionNotify } from "./config.js";
import ShareAndScore from "./ShareAndScore.jsx";
import { syncPublishDefaultJiraKey } from "./ConnectorsStatus.jsx";
import { exportAgentOutput } from "./agentExport.js";
import { buildShareSubjectLine } from "./shareSubject.js";

const MODELS = [
  { id: "claude-sonnet-4-20250514", label: "Sonnet 4.6", color: "#F59E0B" },
  { id: "claude-opus-4-20250514", label: "Opus 4.6", color: "#A78BFA" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", color: "#34D399" },
];

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

Rules: Do not invent compliance references without tags like [TBD]. Be concise but implementation-ready.`;

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
  const filtered = history.filter(
    (h) =>
      (h.featureName || "").toLowerCase().includes(search.toLowerCase()) ||
      (h.resultMd || "").toLowerCase().includes(search.toLowerCase())
  );
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
          filtered.map((item) => (
            <div key={item.id} style={{ background: "#0D1626", border: "1px solid #1E293B", borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.featureName || extractTitle(item.resultMd) || "Untitled"}
                  </div>
                  <div style={{ fontSize: 11, color: "#475569" }}>
                    {item.projectKey && <span style={{ marginRight: 8 }}>Proj {item.projectKey}</span>}
                    {item.createdKey && <span style={{ color: "#22c55e" }}>{item.createdKey}</span>}
                  </div>
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
          ))
        )}
      </div>
    </div>
  );
}

export default function JiraAgent() {
  const [model, setModel] = useState(MODELS[0]);
  const [phase, setPhase] = useState("input");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const [jiraIssueKey, setJiraIssueKey] = useState("");
  const [jiraFetchLoading, setJiraFetchLoading] = useState(false);
  const [projectKey, setProjectKey] = useState("");
  const [issueType, setIssueType] = useState("Task");
  const [issueTypeId, setIssueTypeId] = useState("");
  const [issueTypes, setIssueTypes] = useState([]);
  const [issueTypesLoading, setIssueTypesLoading] = useState(false);
  const [issueTypesError, setIssueTypesError] = useState("");

  const [featureName, setFeatureName] = useState("");
  const [requirement, setRequirement] = useState("");
  const [objective, setObjective] = useState("");
  const [clarifyQuestions, setClarifyQuestions] = useState([]);
  const [clarifyAnswers, setClarifyAnswers] = useState("");
  const [includeSubJiras, setIncludeSubJiras] = useState(false);

  const [resultMd, setResultMd] = useState("");
  const [subtasks, setSubtasks] = useState([]);
  const [feedback, setFeedback] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdBundle, setCreatedBundle] = useState(null);

  const [history, setHistory] = useState(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);

  const docTitle = useMemo(() => extractTitle(resultMd), [resultMd]);
  const derivedJiraKey = createdBundle?.parentKey || parseJiraIssueKey(jiraIssueKey);
  const displayTitle = featureName.trim() || docTitle || "JIRA Ticket";

  const buildContext = () => {
    const parts = [];
    if (featureName.trim()) parts.push(`Feature / title: ${featureName.trim()}`);
    if (projectKey.trim()) parts.push(`JIRA Project Key: ${projectKey.trim().toUpperCase()}`);
    if (jiraIssueKey.trim()) parts.push(`Reference JIRA: ${jiraIssueKey.trim()}`);
    if (objective.trim()) parts.push(`Objective:\n${objective.trim()}`);
    if (requirement.trim()) parts.push(`Requirement / context:\n${requirement.trim()}`);
    return parts.join("\n\n");
  };

  const fetchJiraIntoRequirement = async () => {
    const key = parseJiraIssueKey(jiraIssueKey);
    if (!key) {
      setStatusMsg("Enter a JIRA key (e.g. TSP-1889) or paste a browse URL.");
      return;
    }
    setJiraFetchLoading(true);
    setStatusMsg("");
    try {
      const r = await fetch(`${API_BASE}/api/jira-issue/${encodeURIComponent(key)}`, { headers: { Accept: "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `JIRA error ${r.status}`);
      const block = [d.summary ? `${d.id} — ${d.summary}` : d.id, d.description, d.acceptanceCriteria ? `Acceptance criteria:\n${d.acceptanceCriteria}` : ""]
        .filter(Boolean)
        .join("\n\n");
      setRequirement((prev) => (prev ? `${prev}\n\n---\n\n${block}` : block));
      syncPublishDefaultJiraKey(d.id || key);
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
      const r = await fetch(`${API_BASE}/api/jira/issue-types?projectKey=${encodeURIComponent(pk)}`);
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
  }, [projectKey]);

  const handleClarify = async () => {
    if (!requirement.trim()) {
      setStatusMsg("Please enter requirement/context first.");
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
        resultMd: md,
        subtasks: nextSubs,
        model: model.label,
      };
      const updated = [entry, ...history].slice(0, 50);
      setHistory(updated);
      saveHistoryLS(updated);

      void exportAgentOutput({
        agent: "JIRA",
        jiraId: derivedJiraKey || "NOJIRA",
        subject: displayTitle,
        content: md + (nextSubs.length ? `\n\n---\n## Proposed sub-JIRAs\n${JSON.stringify(nextSubs, null, 2)}` : ""),
      });
      await sendCompletionNotify({
        agentName: "JIRA Agent",
        identifier: displayTitle,
        notifySubject: buildShareSubjectLine("jira", derivedJiraKey, displayTitle),
      });
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
      setStatusMsg("Improved.");
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
      });
      setCreatedBundle({ parentKey: data.key, subtasks: [] });
      setJiraIssueKey(data.key || "");
      if (data.key) syncPublishDefaultJiraKey(data.key);
      setStatusMsg(data.key ? `Created ${data.key}` : "Created.");
    } catch (e) {
      setStatusMsg("Error: " + e.message);
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
      }
      const okSubs = (data.subtasks || []).filter((s) => s.key).length;
      setStatusMsg(
        data.parentKey
          ? `Created parent ${data.parentKey} and ${okSubs}/${subtasks.length} sub-JIRAs (see errors on failed rows in server log if any).`
          : "Create finished."
      );
    } catch (e) {
      setStatusMsg("Error: " + e.message);
    } finally {
      setCreating(false);
    }
  };

  const resetSession = () => {
    setPhase("input");
    setResultMd("");
    setSubtasks([]);
    setClarifyQuestions([]);
    setClarifyAnswers("");
    setCreatedBundle(null);
    setFeedback("");
    setStatusMsg("");
  };

  const loadFromHistory = (item) => {
    setFeatureName(item.featureName || "");
    setProjectKey(item.projectKey || "");
    setIssueType(item.issueType || "Task");
    setIssueTypeId(item.issueTypeId || "");
    setObjective(item.objective || "");
    setRequirement(item.requirement || "");
    setResultMd(item.resultMd || "");
    setSubtasks(Array.isArray(item.subtasks) ? item.subtasks : []);
    setPhase(item.resultMd ? "done" : "input");
    setShowHistory(false);
    setCreatedBundle(null);
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

  const phaseStep = phase === "input" ? 0 : phase === "clarify" ? 1 : 2;

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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {["Inputs", "Clarify", "Ticket"].map((label, i) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 9px",
                  borderRadius: 20,
                  background: phaseStep > i ? "#38BDF818" : phaseStep === i ? "#1E3A5F" : "transparent",
                  border: `1px solid ${phaseStep > i ? "#38BDF844" : phaseStep === i ? "#3B82F6" : "#1E293B"}`,
                }}
              >
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: phaseStep > i ? "#38BDF8" : phaseStep === i ? "#3B82F6" : "#1E293B" }} />
                <span style={{ fontSize: 10, color: phaseStep > i ? "#38BDF8" : phaseStep === i ? "#93C5FD" : "#374151", fontWeight: 500 }}>{label}</span>
              </div>
              {i < 2 && <div style={{ width: 10, height: 1, background: phaseStep > i ? "#38BDF844" : "#1E293B" }} />}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            style={{ background: "#0D1626", border: "1px solid #1E3A5F", borderRadius: 9, padding: "5px 12px", color: "#93C5FD", fontSize: 11, fontWeight: 600, cursor: "pointer", marginLeft: 6 }}
          >
            📋 History {history.length > 0 && <span style={{ background: "#1E3A5F", borderRadius: 10, padding: "1px 6px", fontSize: 10, color: "#38BDF8", fontWeight: 700 }}>{history.length}</span>}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 20px 100px" }}>
        <div style={{ background: "#0D1626", border: "1px solid #1E293B", borderRadius: 14, padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#38BDF8", marginBottom: 12 }}>JIRA connector</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Import from JIRA</label>
              <input
                value={jiraIssueKey}
                onChange={(e) => setJiraIssueKey(e.target.value)}
                placeholder="TSP-1889 or URL"
                style={{ width: "100%", marginTop: 4, background: "#0B1220", border: "1px solid #1E293B", borderRadius: 8, color: "#E2E8F0", padding: "8px 12px", fontSize: 12 }}
              />
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

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            {phase === "input" && (
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
            )}
            {(phase === "clarify" || phase === "done") && (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={loading}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "linear-gradient(135deg,#F59E0B,#EA580C)",
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 20px",
                  color: "#0B1120",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading && <Spinner />}
                Regenerate / generate ticket
              </button>
            )}
            <button type="button" onClick={resetSession} style={{ background: "#111827", border: "1px solid #334155", borderRadius: 8, padding: "10px 16px", color: "#94A3B8", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              New session
            </button>
          </div>
          {statusMsg && (
            <div style={{ marginTop: 12, fontSize: 12, color: statusMsg.startsWith("Error") ? "#FC8999" : "#7DD3FC", lineHeight: 1.5 }}>
              {statusMsg}
            </div>
          )}
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
          </div>
        )}

        {phase === "done" && resultMd && (
          <>
            <div style={{ background: "#0A1120", border: "1px solid #1E3A5F", borderRadius: 14, padding: "28px 32px", marginBottom: 20 }}>
              <div style={{ borderBottom: "2px solid #1E3A5F", paddingBottom: 16, marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: "#38BDF8", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>JIRA ticket draft</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#F1F5F9" }}>{displayTitle}</div>
                <div style={{ fontSize: 12, color: "#475569", marginTop: 6 }}>{projectKey ? `${projectKey} · ` : ""}{issueType}</div>
              </div>
              <div style={{ lineHeight: 1.75 }}>{renderJiraMarkdown(resultMd)}</div>
            </div>

            {subtasks.length > 0 && (
              <div style={{ background: "#0D1626", border: "1px solid #1E293B", borderRadius: 14, padding: 24, marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#A78BFA", marginBottom: 12 }}>Proposed sub-JIRAs ({subtasks.length})</div>
                <p style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
                  These are drafts. Use <strong style={{ color: "#E2E8F0" }}>Create parent + sub-JIRAs</strong> to push all at once (requires a sub-task type on your JIRA project — configure{" "}
                  <code style={{ background: "#111827", padding: "2px 6px", borderRadius: 4 }}>JIRA_SUBTASK_ISSUE_TYPE_NAME</code> or{" "}
                  <code style={{ background: "#111827", padding: "2px 6px", borderRadius: 4 }}>JIRA_SUBTASK_ISSUE_TYPE_ID</code> in <code style={{ background: "#111827", padding: "2px 6px", borderRadius: 4 }}>.env</code> if not default).
                </p>
                {subtasks.map((s, i) => (
                  <div key={i} style={{ border: "1px solid #1E293B", borderRadius: 10, padding: 14, marginBottom: 10, background: "#0B1220" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0", marginBottom: 8 }}>{s.summary || `Subtask ${i + 1}`}</div>
                    <div style={{ fontSize: 12, color: "#94A3B8" }}>{(s.description || "").slice(0, 400)}{(s.description || "").length > 400 ? "…" : ""}</div>
                  </div>
                ))}
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
              <button
                type="button"
                onClick={handleCreateJira}
                disabled={creating}
                style={{ background: "#0052CC", border: "none", borderRadius: 9, padding: "10px 18px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: creating ? "wait" : "pointer" }}
              >
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
            </div>

            <div style={{ background: "#0D1626", border: "1px solid #1E293B", borderRadius: 14, padding: 24, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#F1F5F9", marginBottom: 10 }}>Improve this ticket</div>
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

            <ShareAndScore docType="jira" title={displayTitle} content={resultMd} jiraKey={derivedJiraKey} autoPublish={[]} />
          </>
        )}
      </div>

      {showHistory && (
        <HistoryPanel history={history} onLoad={loadFromHistory} onDelete={deleteHistory} onClear={clearHistory} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
