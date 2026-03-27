/**
 * JIRA Agent — Standalone React App
 * 
 * SETUP INSTRUCTIONS:
 * ─────────────────────────────────────────────────────
 * 1. Install dependencies:
 *    npm install react react-dom @vitejs/plugin-react vite
 *
 * 2. Create project structure:
 *    mkdir jira-agent-app && cd jira-agent-app
 *    npm create vite@latest . -- --template react
 *    Replace src/App.jsx with this file
 *
 * 3. Set your API key in a .env file:
 *    VITE_ANTHROPIC_API_KEY=sk-ant-...
 *
 * 4. Run:
 *    npm run dev
 *
 * NOTE: For production, proxy API calls through a backend to
 *       keep your API key secure.
 * ─────────────────────────────────────────────────────
 */

import { useState, useRef, useEffect } from "react";

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Syne:wght@400;500;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0c10;
    --surface: #111318;
    --surface2: #181c24;
    --border: #1e2430;
    --border-bright: #2d3448;
    --accent: #4f8ef7;
    --accent2: #a78bfa;
    --accent3: #34d399;
    --danger: #f87171;
    --warn: #fbbf24;
    --text: #e2e8f0;
    --text-muted: #64748b;
    --text-dim: #94a3b8;
    --mono: 'JetBrains Mono', monospace;
    --sans: 'Syne', sans-serif;
    --radius: 10px;
    --glow: 0 0 20px rgba(79,142,247,0.15);
  }

  html, body, #root {
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.6;
  }

  /* ── Layout ── */
  .app {
    display: grid;
    grid-template-columns: 320px 1fr;
    grid-template-rows: 56px 1fr;
    height: 100vh;
    overflow: hidden;
  }

  /* ── Topbar ── */
  .topbar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    position: relative;
    z-index: 10;
  }
  .topbar-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 800;
    font-size: 16px;
    letter-spacing: -0.5px;
  }
  .logo-badge {
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    color: #fff;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 6px;
    letter-spacing: 1px;
  }
  .topbar-sub {
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 400;
    font-family: var(--mono);
  }
  .topbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .api-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-muted);
  }
  .api-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    transition: background 0.3s;
  }
  .api-dot.connected { background: var(--accent3); box-shadow: 0 0 6px var(--accent3); }
  .api-dot.error { background: var(--danger); }

  /* ── Sidebar ── */
  .sidebar {
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sidebar-header {
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    font-family: var(--mono);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1.5px;
  }
  .sidebar-content { padding: 12px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; flex: 1; }

  .field-group { display: flex; flex-direction: column; gap: 4px; }
  .field-label {
    font-size: 10px;
    font-family: var(--mono);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .field-input, .field-textarea, .field-select {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: var(--mono);
    font-size: 12px;
    padding: 7px 10px;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    width: 100%;
    resize: none;
  }
  .field-input:focus, .field-textarea:focus, .field-select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(79,142,247,0.1);
  }
  .field-textarea { min-height: 70px; }
  .field-select option { background: var(--surface2); }

  .checkbox-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .checkbox-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-family: var(--mono);
    color: var(--text-dim);
    cursor: pointer;
    padding: 3px 4px;
    border-radius: 4px;
    transition: background 0.15s;
  }
  .checkbox-item:hover { background: var(--surface2); }
  .checkbox-item input[type=checkbox] { accent-color: var(--accent); }
  .checkbox-item.checked { color: var(--accent); }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  .api-key-section {
    padding: 12px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .api-key-input-wrap { position: relative; }
  .api-key-toggle {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer; color: var(--text-muted);
    font-size: 11px; font-family: var(--mono); padding: 2px 4px;
  }
  .api-key-toggle:hover { color: var(--text); }

  /* ── Generate Button ── */
  .generate-btn {
    margin: 0 12px 12px;
    padding: 12px;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    border: none;
    border-radius: var(--radius);
    color: #fff;
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.3px;
    cursor: pointer;
    transition: opacity 0.2s, transform 0.15s;
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .generate-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .generate-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
  .generate-btn .btn-shimmer {
    position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%);
    transform: translateX(-100%);
    animation: shimmer 2s infinite;
  }
  @keyframes shimmer { to { transform: translateX(100%); } }

  /* ── Main output area ── */
  .main {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
  }
  .output-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .toolbar-label {
    font-size: 11px;
    font-family: var(--mono);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-right: auto;
  }
  .toolbar-btn {
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--border-bright);
    background: var(--surface2);
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .toolbar-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .toolbar-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .toolbar-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(79,142,247,0.08); }

  /* ── Output content ── */
  .output-area {
    flex: 1;
    overflow-y: auto;
    padding: 28px 36px;
    scrollbar-width: thin;
    scrollbar-color: var(--border-bright) transparent;
  }
  .output-area::-webkit-scrollbar { width: 5px; }
  .output-area::-webkit-scrollbar-track { background: transparent; }
  .output-area::-webkit-scrollbar-thumb { background: var(--border-bright); border-radius: 3px; }

  /* ── Empty state ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 16px;
    color: var(--text-muted);
    text-align: center;
  }
  .empty-icon {
    width: 64px; height: 64px;
    border-radius: 16px;
    background: var(--surface2);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
  }
  .empty-title { font-size: 18px; font-weight: 700; color: var(--text-dim); }
  .empty-sub { font-size: 13px; font-family: var(--mono); max-width: 380px; line-height: 1.7; }

  /* ── Streaming / Rendered markdown ── */
  .markdown-output {
    font-family: var(--sans);
    font-size: 13.5px;
    line-height: 1.8;
    color: var(--text);
    max-width: 900px;
    margin: 0 auto;
  }
  .markdown-output h1 {
    font-size: 22px; font-weight: 800;
    color: #fff;
    margin: 0 0 20px;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--accent);
    letter-spacing: -0.5px;
  }
  .markdown-output h2 {
    font-size: 16px; font-weight: 700;
    color: var(--accent);
    margin: 28px 0 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .markdown-output h2::before {
    content: '';
    display: block;
    width: 3px; height: 16px;
    background: var(--accent);
    border-radius: 2px;
  }
  .markdown-output h3 {
    font-size: 13px; font-weight: 700;
    color: var(--accent2);
    margin: 18px 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .markdown-output h4 {
    font-size: 13px; font-weight: 600;
    color: var(--text-dim);
    margin: 12px 0 6px;
  }
  .markdown-output p { margin: 8px 0; }
  .markdown-output ul, .markdown-output ol { padding-left: 20px; margin: 8px 0; }
  .markdown-output li { margin: 4px 0; }
  .markdown-output strong { color: #fff; font-weight: 700; }
  .markdown-output em { color: var(--text-dim); font-style: italic; }
  .markdown-output code {
    font-family: var(--mono);
    font-size: 11.5px;
    background: var(--surface2);
    border: 1px solid var(--border);
    padding: 1px 6px;
    border-radius: 4px;
    color: var(--accent3);
  }
  .markdown-output pre {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    overflow-x: auto;
    margin: 10px 0;
  }
  .markdown-output pre code {
    background: none;
    border: none;
    padding: 0;
    color: var(--text);
    font-size: 12px;
    line-height: 1.7;
  }
  .markdown-output table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 12px;
    font-family: var(--mono);
  }
  .markdown-output th {
    background: var(--surface2);
    border: 1px solid var(--border-bright);
    padding: 7px 12px;
    text-align: left;
    color: var(--accent);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .markdown-output td {
    border: 1px solid var(--border);
    padding: 7px 12px;
    color: var(--text-dim);
    vertical-align: top;
  }
  .markdown-output tr:hover td { background: rgba(255,255,255,0.02); }
  .markdown-output blockquote {
    border-left: 3px solid var(--warn);
    padding: 8px 14px;
    margin: 10px 0;
    background: rgba(251,191,36,0.05);
    border-radius: 0 6px 6px 0;
    color: var(--text-dim);
  }
  .markdown-output hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 20px 0;
  }
  .markdown-output a { color: var(--accent); text-decoration: none; }
  .markdown-output a:hover { text-decoration: underline; }

  /* ── Cursor blink for streaming ── */
  .cursor {
    display: inline-block;
    width: 2px; height: 14px;
    background: var(--accent);
    border-radius: 1px;
    animation: blink 1s step-end infinite;
    vertical-align: middle;
    margin-left: 2px;
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

  /* ── Progress bar ── */
  .progress-bar-wrap {
    height: 2px;
    background: var(--border);
    position: relative;
    overflow: hidden;
  }
  .progress-bar-fill {
    position: absolute; left: 0; top: 0; height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
    transition: width 0.3s;
    border-radius: 2px;
  }
  .progress-bar-anim {
    position: absolute; top: 0; height: 100%;
    width: 40%;
    background: linear-gradient(90deg, transparent, rgba(79,142,247,0.4), transparent);
    animation: prog 1.5s infinite;
  }
  @keyframes prog { from { left: -40%; } to { left: 100%; } }

  /* ── Toast ── */
  .toast {
    position: fixed;
    bottom: 20px; right: 20px;
    background: var(--surface2);
    border: 1px solid var(--border-bright);
    padding: 10px 16px;
    border-radius: var(--radius);
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text);
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    animation: toastIn 0.3s ease, toastOut 0.3s ease 2.2s forwards;
    z-index: 1000;
  }
  @keyframes toastIn { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes toastOut { from { opacity: 1; } to { opacity: 0; } }

  /* ── Sub-JIRA pills ── */
  .subjira-tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .subjira-tab {
    padding: 4px 12px;
    border-radius: 20px;
    border: 1px solid var(--border-bright);
    background: var(--surface2);
    color: var(--text-muted);
    font-family: var(--mono);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .subjira-tab:hover, .subjira-tab.active {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(79,142,247,0.08);
  }

  /* ── Scrollbar ── */
  .sidebar-content::-webkit-scrollbar { width: 4px; }
  .sidebar-content::-webkit-scrollbar-track { background: transparent; }
  .sidebar-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
`;

// ─── Simple Markdown Renderer ────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Headings
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // HR
    .replace(/^---$/gm, "<hr>")
    // Blockquote
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    // Tables
    .replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g, (match, header, rows) => {
      const th = header.split("|").filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join("");
      const trs = rows.trim().split("\n").map(row => {
        const tds = row.split("|").filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join("");
        return `<tr>${tds}</tr>`;
      }).join("");
      return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
    })
    // Unordered lists
    .replace(/^(\s*[-*] .+(\n\s+.+)*)+/gm, match => {
      const items = match.split(/\n(?=\s*[-*] )/).map(item => {
        const content = item.replace(/^\s*[-*] /, "");
        return `<li>${content}</li>`;
      }).join("");
      return `<ul>${items}</ul>`;
    })
    // Ordered lists
    .replace(/^(\d+\. .+\n?)+/gm, match => {
      const items = match.split(/\n(?=\d+\. )/).map(item => {
        const content = item.replace(/^\d+\. /, "");
        return `<li>${content}</li>`;
      }).join("");
      return `<ol>${items}</ol>`;
    })
    // Paragraphs
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(?!<[h|u|o|p|t|b|c|h])(.+)$/gm, (m) => m ? `<p>${m}</p>` : "");

  return html;
}

// ─── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a Senior Product Manager and Technical Architect specializing in UPI payment systems, NPCI regulations, and fintech infrastructure (Switch, PMS, Compliance, Refunds, Reconciliation, Payouts, TPAP/PSP integrations).

Your task: Generate a production-grade, CAB-ready, audit-compliant JIRA ticket with ALL 18 sections listed below. Be highly specific — use real fintech terminology (ReqPay, ReqAuth, IIN, PSP, TPAP, MCC, U16, SR, NPCI circulars, etc.). Think like a Switch engineer, Compliance auditor, Recon team member, and Risk team simultaneously.

OUTPUT FORMAT: Use clean Markdown with headers (##, ###), tables, and code blocks for IF-ELSE logic.

MANDATORY SECTIONS (all 18 must appear, fully populated — NEVER leave placeholders):

## 1. 🏷️ Title
## 2. 🎯 Objective / Problem Statement
## 3. 📋 Background / Context
## 4. 📐 Scope of Change (In-Scope ✅ + Out-of-Scope ❌)
## 5. ⚙️ Functional Changes
   ### 5.1 High-Level Flow (Before vs After table)
   ### 5.2 Transaction Processing Behaviour Table
   ### 5.3 Logic Implementation (MANDATORY: full IF-ELSE / decision-tree logic — no vague descriptions)
   ### 5.4 API / Field-Level Changes
   ### 5.5 System-wise Changes (one sub-section each for impacted systems)
## 6. 📊 Impact Analysis (Positive ✅ + Negative/Trade-offs ❌)
## 7. ⚠️ Risk Assessment (Table: Risk ID, Type, Description, Probability, Impact, Mitigation)
## 8. 🔗 Dependencies (Table)
## 9. 📈 Success Metrics & Monitoring (SR impact, failure codes, log lines, dashboard spec)
## 10. 🚀 Rollout Plan (MANDATORY: feature flag + phased rollout table with gates)
## 11. 🔙 Rollback Plan (trigger conditions, steps, RTO, RPO)
## 12. ✅ Acceptance Criteria / UAT Scenarios (Positive ✅, Negative ❌, Edge ⚠️, Retry/Special 🔁 — minimum 8 TCs)
## 13. 👤 User Stories (minimum 3, across compliance/PSP/recon perspectives)
## 14. 🧾 Reconciliation Impact
## 15. 📜 Compliance / Regulatory Alignment (table)
## 16. ❓ Open Questions (table: question, owner, due date, status)
## 17. 📎 References / Annexure
## 18. 📖 Terminology Table

IMPORTANT RULES:
- Section 5.3 (Logic) MUST have explicit IF-ELSE or decision-tree code block — never prose
- Risk table MUST have ≥5 rows with probability + mitigation
- UAT must cover all 4 case types (positive, negative, edge, retry)
- Feature flag is MANDATORY in rollout plan
- Rollback RTO must be defined
- Be UPI/NPCI specific — never generic SaaS/app terminology`;

// ─── Sub-JIRA System Prompt ──────────────────────────────────────────────────
const SUBJIRA_PROMPT = `You are a Senior Technical PM generating a sub-JIRA ticket for a specific system within a UPI payment change.

Generate a concise but complete sub-JIRA with:
## Title
System-specific one-liner

## Summary
3–5 sentences describing what this system needs to do

## Technical Changes
Bullet list of specific code/config changes required

## Acceptance Criteria
5–8 bullet points (system-specific, testable, DONE criteria)

## Dependencies
What this sub-task needs from other sub-tasks / systems

## Risks
2–3 risks specific to this system

## Effort Estimate
[S / M / L / XL] with brief reasoning

Be technical and system-specific. Use fintech/UPI terminology.`;

// ─── Main Component ────────────────────────────────────────────────────────
export default function JiraAgent() {
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem("jira_agent_api_key") || import.meta.env?.VITE_ANTHROPIC_API_KEY || ""; }
    catch { return ""; }
  });
  const [showKey, setShowKey] = useState(false);
  const [form, setForm] = useState({
    title: "",
    objective: "",
    context: "",
    npciCircular: "",
    systems: { switch: false, compliance: false, pms: false, refund: false, recon: false, payout: false, tpap: false },
    txnTypes: "",
    instruments: "",
    currentBehavior: "",
    expectedBehavior: "",
    logic: "",
    risks: "",
    generateSubJiras: false,
  });
  const [output, setOutput] = useState("");
  const [subOutputs, setSubOutputs] = useState({});
  const [activeTab, setActiveTab] = useState("main");
  const [isStreaming, setIsStreaming] = useState(false);
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState(null);
  const [apiConnected, setApiConnected] = useState(null);
  const outputRef = useRef(null);
  const abortRef = useRef(null);

  // Save API key
  useEffect(() => {
    if (apiKey) {
      try { localStorage.setItem("jira_agent_api_key", apiKey); } catch {}
    }
  }, [apiKey]);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current && isStreaming) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, isStreaming]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const selectedSystems = Object.entries(form.systems)
    .filter(([, v]) => v)
    .map(([k]) => ({ switch: "UPI Switch", compliance: "Compliance Service", pms: "PMS", refund: "Refund System", recon: "Reconciliation", payout: "Payout/M2P", tpap: "TPAP/PSP" }[k]));

  const buildPrompt = () => {
    return `Generate a complete 18-section JIRA ticket for the following:

**JIRA Title**: ${form.title || "Not specified"}
**Objective**: ${form.objective || "Not specified"}
**Context/Background**: ${form.context || "Not specified"}
**NPCI Circular**: ${form.npciCircular || "Not applicable"}
**Systems Impacted**: ${selectedSystems.length ? selectedSystems.join(", ") : "Not specified"}
**Transaction Types**: ${form.txnTypes || "Not specified"}
**Instrument Types**: ${form.instruments || "Not specified"}
**Current Behavior**: ${form.currentBehavior || "Not specified"}
**Expected Behavior**: ${form.expectedBehavior || "Not specified"}
**Key Logic / Rule Change**: ${form.logic || "Not specified"}
**Known Risks**: ${form.risks || "Not specified"}

Generate the complete JIRA now.`;
  };

  const buildSubJiraPrompt = (system, mainJiraContent) => {
    return `Based on this main JIRA ticket:

${mainJiraContent.slice(0, 3000)}...

Generate a sub-JIRA for the **${system}** team/system. Be specific to what ${system} needs to implement.`;
  };

  const stream = async (userPrompt, systemPrompt, onChunk) => {
    const key = apiKey.trim();
    if (!key) throw new Error("API key required");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        system: systemPrompt,
        stream: true,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: abortRef.current?.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "content_block_delta" && data.delta?.text) {
              onChunk(data.delta.text);
            }
          } catch {}
        }
      }
    }
  };

  const handleGenerate = async () => {
    if (!form.title && !form.objective) {
      showToast("⚠️ Fill in at least Title and Objective");
      return;
    }
    if (!apiKey.trim()) {
      showToast("⚠️ Enter your Anthropic API key");
      return;
    }

    abortRef.current = new AbortController();
    setIsStreaming(true);
    setOutput("");
    setSubOutputs({});
    setActiveTab("main");
    setProgress(10);
    setApiConnected(null);

    try {
      let mainContent = "";
      await stream(buildPrompt(), SYSTEM_PROMPT, (chunk) => {
        mainContent += chunk;
        setOutput(mainContent);
        setProgress(p => Math.min(p + 0.3, 85));
      });

      setApiConnected(true);
      setProgress(90);

      // Generate sub-JIRAs if requested
      if (form.generateSubJiras && selectedSystems.length > 0) {
        const newSubs = {};
        for (const sys of selectedSystems.slice(0, 4)) {
          let subContent = "";
          await stream(buildSubJiraPrompt(sys, mainContent), SUBJIRA_PROMPT, (chunk) => {
            subContent += chunk;
            setSubOutputs(prev => ({ ...prev, [sys]: subContent }));
          });
          newSubs[sys] = subContent;
        }
      }

      setProgress(100);
      showToast("✅ JIRA generated successfully");
    } catch (e) {
      if (e.name !== "AbortError") {
        setApiConnected(false);
        showToast(`❌ ${e.message}`);
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    showToast("⏹ Generation stopped");
  };

  const handleCopy = async () => {
    const content = activeTab === "main" ? output : subOutputs[activeTab] || "";
    await navigator.clipboard.writeText(content);
    showToast("📋 Copied to clipboard");
  };

  const handleExport = () => {
    const content = activeTab === "main" ? output : subOutputs[activeTab] || "";
    const blob = new Blob([content], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `jira_${form.title.replace(/\s+/g, "_").toLowerCase() || "ticket"}_${Date.now()}.md`;
    a.click();
    showToast("💾 Exported as Markdown");
  };

  const allTabs = ["main", ...Object.keys(subOutputs)];
  const currentContent = activeTab === "main" ? output : subOutputs[activeTab] || "";

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-logo">
            <span className="logo-badge">JIRA</span>
            <span>Agent</span>
          </div>
          <span className="topbar-sub">UPI · NPCI · Fintech Infrastructure</span>
          <div className="topbar-right">
            <div className="api-status">
              <div className={`api-dot ${apiConnected === true ? "connected" : apiConnected === false ? "error" : ""}`} />
              {apiConnected === true ? "Connected" : apiConnected === false ? "Error" : "Idle"}
            </div>
          </div>
        </header>

        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-header">Input Parameters</div>
          <div className="sidebar-content">
            <FieldGroup label="JIRA Title *">
              <input className="field-input" placeholder="e.g. Restrict P2M Collect on Android" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </FieldGroup>
            <FieldGroup label="Objective / Problem Statement *">
              <textarea className="field-textarea" placeholder="What problem are we solving? Why now?" value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} rows={3} />
            </FieldGroup>
            <FieldGroup label="Context / Background">
              <textarea className="field-textarea" placeholder="Existing behavior, NPCI alignment, prior work..." value={form.context} onChange={e => setForm(f => ({ ...f, context: e.target.value }))} rows={2} />
            </FieldGroup>
            <FieldGroup label="NPCI Circular (if any)">
              <input className="field-input" placeholder="e.g. NPCI/2026/001" value={form.npciCircular} onChange={e => setForm(f => ({ ...f, npciCircular: e.target.value }))} />
            </FieldGroup>
            <div className="divider" />
            <FieldGroup label="Systems Impacted">
              <div className="checkbox-grid">
                {[["switch","UPI Switch"],["compliance","Compliance"],["pms","PMS"],["refund","Refund"],["recon","Recon"],["payout","Payout/M2P"],["tpap","TPAP/PSP"]].map(([k, label]) => (
                  <label key={k} className={`checkbox-item ${form.systems[k] ? "checked" : ""}`}>
                    <input type="checkbox" checked={form.systems[k]} onChange={e => setForm(f => ({ ...f, systems: { ...f.systems, [k]: e.target.checked } }))} />
                    {label}
                  </label>
                ))}
              </div>
            </FieldGroup>
            <FieldGroup label="Transaction Types">
              <input className="field-input" placeholder="P2P, P2M, Collect, Intent, Mandate..." value={form.txnTypes} onChange={e => setForm(f => ({ ...f, txnTypes: e.target.value }))} />
            </FieldGroup>
            <FieldGroup label="Instrument Types">
              <input className="field-input" placeholder="Savings, RuPay CC, eRUPI, Wallet..." value={form.instruments} onChange={e => setForm(f => ({ ...f, instruments: e.target.value }))} />
            </FieldGroup>
            <div className="divider" />
            <FieldGroup label="Current Behavior">
              <textarea className="field-textarea" placeholder="What happens today?" value={form.currentBehavior} onChange={e => setForm(f => ({ ...f, currentBehavior: e.target.value }))} rows={2} />
            </FieldGroup>
            <FieldGroup label="Expected Behavior">
              <textarea className="field-textarea" placeholder="What should happen after the change?" value={form.expectedBehavior} onChange={e => setForm(f => ({ ...f, expectedBehavior: e.target.value }))} rows={2} />
            </FieldGroup>
            <FieldGroup label="Key Logic / Rule Change">
              <textarea className="field-textarea" placeholder="Core rule, IF-ELSE logic sketch, exemptions..." value={form.logic} onChange={e => setForm(f => ({ ...f, logic: e.target.value }))} rows={2} />
            </FieldGroup>
            <FieldGroup label="Known Risks / Concerns">
              <textarea className="field-textarea" placeholder="Risks, edge cases, concerns..." value={form.risks} onChange={e => setForm(f => ({ ...f, risks: e.target.value }))} rows={2} />
            </FieldGroup>
            <div className="divider" />
            <label className={`checkbox-item ${form.generateSubJiras ? "checked" : ""}`} style={{ marginLeft: 0 }}>
              <input type="checkbox" checked={form.generateSubJiras} onChange={e => setForm(f => ({ ...f, generateSubJiras: e.target.checked }))} />
              Also generate Sub-JIRAs per system
            </label>
          </div>

          {/* API Key */}
          <div className="api-key-section">
            <span className="field-label">Anthropic API Key</span>
            <div className="api-key-input-wrap">
              <input
                className="field-input"
                type={showKey ? "text" : "password"}
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                style={{ paddingRight: 40 }}
              />
              <button className="api-key-toggle" onClick={() => setShowKey(s => !s)}>
                {showKey ? "hide" : "show"}
              </button>
            </div>
          </div>

          {/* Generate Button */}
          <button
            className="generate-btn"
            onClick={isStreaming ? handleStop : handleGenerate}
            disabled={false}
          >
            {isStreaming && <span className="btn-shimmer" />}
            {isStreaming ? (
              <><span>⏹</span> Stop Generation</>
            ) : (
              <><span>⚡</span> Generate JIRA</>
            )}
          </button>
        </aside>

        {/* Main Output */}
        <main className="main">
          {/* Toolbar */}
          <div className="output-toolbar">
            <span className="toolbar-label">
              {isStreaming ? "Generating..." : output ? "JIRA Output" : "Output"}
            </span>
            {allTabs.length > 1 && (
              <div className="subjira-tabs" style={{ margin: 0 }}>
                {allTabs.map(tab => (
                  <button key={tab} className={`subjira-tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
                    {tab === "main" ? "Main JIRA" : `Sub: ${tab}`}
                  </button>
                ))}
              </div>
            )}
            <button className="toolbar-btn" onClick={handleCopy} disabled={!currentContent}>
              📋 Copy
            </button>
            <button className="toolbar-btn" onClick={handleExport} disabled={!currentContent}>
              💾 Export .md
            </button>
          </div>

          {/* Progress bar */}
          {isStreaming && (
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
              <div className="progress-bar-anim" />
            </div>
          )}

          {/* Output content */}
          <div className="output-area" ref={outputRef}>
            {!currentContent && !isStreaming ? (
              <div className="empty-state">
                <div className="empty-icon">🎫</div>
                <div className="empty-title">Ready to Generate</div>
                <div className="empty-sub">
                  Fill in the input fields on the left — at minimum a Title and Objective — then hit Generate JIRA.
                  The agent will produce a full 18-section CAB-ready ticket.
                </div>
              </div>
            ) : (
              <div
                className="markdown-output"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(currentContent) + (isStreaming && activeTab === "main" ? '<span class="cursor"></span>' : "")
                }}
              />
            )}
          </div>
        </main>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function FieldGroup({ label, children }) {
  return (
    <div className="field-group">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}
