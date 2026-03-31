import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import mammoth from "mammoth";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import { extractTextFromPDF, extractTextFromPDFBuffer } from "./pdfParser.js";
import FormData from "form-data";
import { retrieve as ragRetrieve } from "./rag/retrieve.js";
import {
  markdownToEmailHtml,
  markdownToJiraAdf,
  markdownToSlackPayload,
  markdownToTelegramChunks,
} from "./shareMarkdown.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from backend/ or repo root (for cloud, env vars are often set by platform)
dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PRD_OUTPUT_DIR = path.join(__dirname, "prd-output");
const AGENT_EXPORT_DIR = path.join(__dirname, "agent-exports");
const SECTION_TITLES = {
  problem: "Problem Statement",
  objective: "Objective",
  scope: "Scope of Work",
  current_arch: "Current Architecture",
  proposed_arch: "Proposed Architecture",
  timeout: "Timeout / Idempotency / Retry",
  additional: "Additional Requirements",
  fund_loss: "Fund Loss & Monitoring",
  rollout: "Rollout Plan",
  backward: "Backward Compatibility",
  references: "Reference Documents",
  uat: "UAT Acceptance Cases",
  npci_musts: "NPCI-Mandated MUSTs",
  appendix: "Appendix (Ops / Compliance)",
};
const SECTION_ORDER = [
  "problem", "objective", "scope", "current_arch", "proposed_arch",
  "timeout", "additional", "fund_loss", "rollout", "backward",
  "references", "uat", "npci_musts", "appendix",
];

// Optional: load reference PDF if present (do not block server start)
let pdfText = "";
try {
  const pdfPath = path.join(__dirname, "..", "docs", "International_Inward_Remittance_TSD.pdf");
  if (fs.existsSync(pdfPath)) {
    pdfText = await extractTextFromPDF(pdfPath);
    console.log("[PDF] Loaded reference doc, length:", pdfText.length);
  }
} catch (err) {
  console.warn("[PDF] Reference PDF not loaded (optional):", err.message);
}

const LLM_URL = process.env.LLM_URL || "https://tfy.internal.ap-south-1.production.apps.pai.mypaytm.com/api/llm/messages";
const LLM_MODEL = process.env.LLM_MODEL;
const LLM_API_KEY = process.env.LLM_KEY_API || process.env.LLM_API_KEY;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const SCORE_MODEL = process.env.SCORE_MODEL || "gpt-4o";

function scoreFoundryBaseUrl() {
  return String(process.env.SCORE_LLM_URL || LLM_URL || "").trim().replace(/\/$/, "");
}

function scoreFoundryModel() {
  return String(process.env.SCORE_LLM_MODEL || LLM_MODEL || SCORE_MODEL).trim() || "gpt-4o";
}

/** Extract assistant text from OpenAI chat, Anthropic-style, or wrapped shapes. */
function extractAssistantTextFromLlmPayload(parsed) {
  if (parsed == null) return "";
  if (typeof parsed === "string") return parsed;
  const c0 = parsed.choices?.[0];
  if (c0?.message?.content != null) return String(c0.message.content);
  if (c0?.text != null) return String(c0.text);
  const inner = parsed.data ?? parsed;
  const c1 = inner?.choices?.[0];
  if (c1?.message?.content != null) return String(c1.message.content);
  const blocks = inner?.content;
  if (Array.isArray(blocks)) {
    return blocks
      .map((b) => (typeof b === "string" ? b : b?.text != null ? String(b.text) : ""))
      .filter(Boolean)
      .join("");
  }
  if (inner?.output_text != null) return String(inner.output_text);
  return "";
}

function parseScoreJsonFromModelOutput(raw) {
  const s = String(raw || "")
    .replace(/```json?\s*|\s*```/g, "")
    .trim();
  try {
    return JSON.parse(s);
  } catch {
    return { score: 0, maxScore: 10, rationale: "Could not parse score from model." };
  }
}

const JIRA_URL = (process.env.JIRA_URL || "").replace(/\/$/, "");
/** Second Atlassian site (e.g. TPAP on mypaytm). Same JIRA_EMAIL / JIRA_TOKEN as primary unless you add overrides later. */
const JIRA_URL_2 = (process.env.JIRA_URL_2 || process.env.JIRA_URL_SECONDARY || process.env.JIRA_URL_TPAP || "").replace(/\/$/, "");
const JIRA_EMAIL = process.env.JIRA_EMAIL || "";
const JIRA_TOKEN = process.env.JIRA_TOKEN || process.env.JIRA_API_TOKEN || "";
/** Project keys that live on JIRA_URL_2 (comma-separated). Used when creating/fetching by key only. */
const JIRA_SECONDARY_PROJECT_KEYS = new Set(
  String(process.env.JIRA_SECONDARY_PROJECT_KEYS || "TPAP,PCO,TPG")
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

function jiraAuthHeader() {
  return "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");
}

function normalizeJiraBaseUrl(u) {
  return String(u || "")
    .trim()
    .replace(/\/$/, "");
}

function listConfiguredJiraBases() {
  const out = [];
  if (JIRA_URL) {
    out.push({
      id: "primary",
      base: JIRA_URL,
      label: process.env.JIRA_SITE_LABEL_PRIMARY || "Primary (finmate)",
    });
  }
  if (JIRA_URL_2) {
    out.push({
      id: "secondary",
      base: JIRA_URL_2,
      label: process.env.JIRA_SITE_LABEL_SECONDARY || "TPAP (mypaytm)",
    });
  }
  return out;
}

function safeDecodeURIComponent(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Extract issue key + optional Atlassian host from pasted URL or plain key. */
function parseJiraIssueRequestParam(rawParam) {
  const s = safeDecodeURIComponent(String(rawParam || "").trim());
  let explicitBase = null;
  let issueKey = "";

  const selectedM = s.match(/[?&]selectedIssue=([A-Z][A-Z0-9]+-\d+)/i);
  if (selectedM) {
    issueKey = selectedM[1].toUpperCase();
    const hostM = s.match(/https?:\/\/([a-z0-9.-]+\.atlassian\.net)/i);
    if (hostM) explicitBase = normalizeJiraBaseUrl(`https://${hostM[1]}`);
    return { issueKey, explicitBase };
  }

  const hostKeyM = s.match(/https?:\/\/([a-z0-9.-]+\.atlassian\.net).*?([A-Z][A-Z0-9]+-\d+)/i);
  if (hostKeyM) {
    explicitBase = normalizeJiraBaseUrl(`https://${hostKeyM[1]}`);
    issueKey = hostKeyM[2].toUpperCase();
    return { issueKey, explicitBase };
  }

  const keyOnly = s.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i);
  if (keyOnly) {
    issueKey = keyOnly[1].toUpperCase();
    return { issueKey, explicitBase: null };
  }

  const upper = s.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(upper)) return { issueKey: upper, explicitBase: null };
  return { issueKey: "", explicitBase: null };
}

function resolveBasesForFetch(parsed, query) {
  const configured = listConfiguredJiraBases()
    .map((x) => x.base)
    .filter(Boolean);
  let site = String(query?.site || "").toLowerCase();
  if (!site || site === "auto") site = "";

  if (parsed.explicitBase) {
    const ex = normalizeJiraBaseUrl(parsed.explicitBase);
    const ordered = [ex];
    for (const b of configured) {
      if (b !== ex) ordered.push(b);
    }
    return [...new Set(ordered.filter(Boolean))];
  }

  let ordered;
  if (site === "secondary" && JIRA_URL_2) {
    ordered = [JIRA_URL_2, JIRA_URL].filter(Boolean);
  } else if (site === "primary" && JIRA_URL) {
    ordered = [JIRA_URL, JIRA_URL_2].filter(Boolean);
  } else {
    ordered = [JIRA_URL, JIRA_URL_2].filter(Boolean);
  }
  ordered = [...new Set(ordered.filter(Boolean))];

  const qBase = normalizeJiraBaseUrl(query?.jiraBase || query?.jiraBaseUrl || "");
  if (qBase && configured.includes(qBase)) {
    return [qBase, ...ordered.filter((b) => b !== qBase)];
  }
  return ordered.length ? ordered : configured;
}

/**
 * Base URL for create / comments / attachments.
 * body: { jiraSite?: 'primary'|'secondary', jiraBaseUrl?: string }
 */
function resolveJiraBaseForWrite(projectKey, body) {
  const pk = String(projectKey || "")
    .trim()
    .toUpperCase()
    .split(/-/)[0];
  const explicit = normalizeJiraBaseUrl(body?.jiraBaseUrl || body?.jiraBase || "");
  const configured = listConfiguredJiraBases().map((x) => x.base).filter(Boolean);
  if (explicit) {
    if (configured.includes(explicit)) return explicit;
    if (/^https:\/\/[a-z0-9.-]+\.atlassian\.net$/i.test(explicit)) {
      console.warn("[jira-write] using explicit jiraBaseUrl not listed in JIRA_URL / JIRA_URL_2:", explicit);
      return explicit;
    }
    throw new Error(`Invalid jiraBaseUrl. Use a configured site base or *.atlassian.net URL.`);
  }
  const site = String(body?.jiraSite || "").toLowerCase();
  if (site === "secondary") return JIRA_URL_2 || JIRA_URL;
  if (site === "primary") return JIRA_URL || JIRA_URL_2;
  // auto / empty / unknown
  if (pk && JIRA_SECONDARY_PROJECT_KEYS.has(pk)) return JIRA_URL_2 || JIRA_URL;
  return JIRA_URL || JIRA_URL_2;
}

function resolveJiraBaseFromIssueKey(issueKey, body) {
  const project = String(issueKey || "")
    .trim()
    .toUpperCase()
    .split(/-/)[0];
  return resolveJiraBaseForWrite(project, body || {});
}

/** User-picker custom field id for "Dev Assignee" (or set JIRA_DEV_ASSIGNEE_FIELD_ID= in .env to override). */
const JIRA_DEV_ASSIGNEE_FIELD_ID = String(process.env.JIRA_DEV_ASSIGNEE_FIELD_ID || "customfield_10236").trim();
/**
 * Multi-user picker fields expect an array: [{ id }]. Single-user picker: one object { id }.
 * @see https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post
 */
const JIRA_DEV_ASSIGNEE_SINGLE_USER_OBJECT =
  String(process.env.JIRA_DEV_ASSIGNEE_SINGLE_USER_OBJECT || "").toLowerCase() === "true";

if (JIRA_DEV_ASSIGNEE_SINGLE_USER_OBJECT) {
  console.warn(
    "[jira] JIRA_DEV_ASSIGNEE_SINGLE_USER_OBJECT=true — Dev Assignee is sent as a single object. If JIRA returns \"data was not an array\", remove this line from .env (multi-user fields need [{ id }])."
  );
}

function extractJiraText(doc) {
  if (!doc) return "";
  if (typeof doc === "string") return doc;
  try {
    return (doc.content || [])
      .map((block) => {
        if (block.type === "paragraph") return (block.content || []).map((n) => n.text || "").join("");
        if (block.type === "bulletList") return (block.content || []).map((li) => "• " + ((li.content?.[0]?.content || []).map((n) => n.text || "").join(""))).join("\n");
        if (block.type === "orderedList") return (block.content || []).map((li, i) => `${i + 1}. ` + ((li.content?.[0]?.content || []).map((n) => n.text || "").join(""))).join("\n");
        return "";
      })
      .filter(Boolean)
      .join("\n") || "";
  } catch {
    return "";
  }
}

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.post("/api/generate", async (req, res) => {
  try {
    if (!LLM_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "MISSING_API_KEY",
        message: "Set LLM_KEY_API (preferred) or LLM_API_KEY in .env",
      });
    }
    const incomingMessages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    let incomingSystem = typeof req.body?.system === "string" ? req.body.system : null;
    const incomingMaxTokens = typeof req.body?.max_tokens === "number" ? req.body.max_tokens : 8000;
    const messages = incomingMessages?.length ? incomingMessages : [{ role: "user", content: req.body?.prompt || "Generate PRD" }];
    const userText = (messages.find((m) => m.role === "user")?.content || req.body?.prompt || "").slice(0, 4000);
    const ragChunks = await ragRetrieve(userText, 5);
    if (ragChunks.length > 0) {
      const ragContext = "\n\n[Reference context from NPCI/UPI/PRD docs – use where relevant]\n" + ragChunks.join("\n\n");
      incomingSystem = (incomingSystem || "") + ragContext;
    }
    const requestBody = {
      model: LLM_MODEL,
      max_tokens: incomingMaxTokens,
      ...(incomingSystem ? { system: incomingSystem } : {}),
      messages,
    };
    const doCall = (authMode) =>
      fetch(LLM_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authMode === "x-api-key" ? { "x-api-key": LLM_API_KEY } : { Authorization: `Bearer ${LLM_API_KEY}` }),
        },
        body: JSON.stringify(requestBody),
      });
    let authMode = "x-api-key";
    let response = await doCall(authMode);
    if (response.status === 401) {
      authMode = "bearer";
      response = await doCall(authMode);
    }
    const responseText = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "LLM_GATEWAY_ERROR",
        status: response.status,
        message: responseText,
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (err) {
      return res.status(500).json({ success: false, error: "INVALID_JSON_FROM_LLM", message: responseText });
    }
    res.json({ success: true, data: parsed });
  } catch (error) {
    console.error("SERVER ERROR:", error);
    res.status(500).json({ success: false, error: "SERVER_EXCEPTION", message: error.message });
  }
});

app.post("/api/claude", async (req, res) => {
  try {
    if (!LLM_API_KEY) {
      return res.status(500).json({ error: { message: "Set LLM_KEY_API or LLM_API_KEY in .env" } });
    }
    const incomingMessages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    const incomingSystem = typeof req.body?.system === "string" ? req.body.system : null;
    const incomingMaxTokens = typeof req.body?.max_tokens === "number" ? req.body.max_tokens : 4000;
    const messages = incomingMessages?.length ? incomingMessages : [{ role: "user", content: req.body?.prompt || "" }];
    const requestBody = {
      model: req.body?.model || LLM_MODEL,
      max_tokens: incomingMaxTokens,
      ...(incomingSystem ? { system: incomingSystem } : {}),
      messages,
    };
    const doCall = (authMode) =>
      fetch(LLM_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authMode === "x-api-key" ? { "x-api-key": LLM_API_KEY } : { Authorization: `Bearer ${LLM_API_KEY}` }),
        },
        body: JSON.stringify(requestBody),
      });
    let response = await doCall("x-api-key");
    if (response.status === 401) response = await doCall("bearer");
    const responseText = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: { message: responseText } });
    }
    const parsed = JSON.parse(responseText);
    res.json(parsed);
  } catch (err) {
    console.error("BRD /api/claude error:", err);
    res.status(500).json({ error: { message: err.message } });
  }
});

app.get("/api/config", (req, res) => {
  const sites = listConfiguredJiraBases();
  const foundryScoreUrl = scoreFoundryBaseUrl();
  res.json({
    anthropicConfigured: !!LLM_API_KEY,
    jiraConfigured: !!(JIRA_EMAIL && JIRA_TOKEN && sites.length > 0),
    jiraUrl: JIRA_URL || "",
    jiraUrl2: JIRA_URL_2 || "",
    jiraSites: sites,
    jiraSecondaryProjectKeys: [...JIRA_SECONDARY_PROJECT_KEYS],
    jiraEmail: JIRA_EMAIL || "",
    scoreOpenAiConfigured: !!OPENAI_API_KEY,
    scoreFoundryConfigured: !!(LLM_API_KEY && foundryScoreUrl),
  });
});

app.post("/api/export-docx", async (req, res) => {
  try {
    const prd = req.body?.prd;
    if (!prd || typeof prd !== "object") {
      return res.status(400).json({ success: false, error: "Missing or invalid prd in body" });
    }
    const title = prd.title || "UPI Switch PRD";
    const version = prd.version || "v1.0";
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeTitle = title.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 60) || "PRD";
    const filename = `PRD-${safeTitle}-${dateStr}.docx`;
    const children = [
      new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
      new Paragraph({ text: `Version: ${version}  |  Date: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`, spacing: { after: 400 } }),
    ];
    for (const key of SECTION_ORDER) {
      const sectionTitle = SECTION_TITLES[key] || key;
      const content = prd[key];
      if (content != null && String(content).trim()) {
        children.push(new Paragraph({ text: sectionTitle, heading: HeadingLevel.HEADING_2 }));
        for (const line of String(content).split(/\n/)) {
          children.push(new Paragraph({ text: line.trim() || " ", spacing: { after: 120 } }));
        }
        children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
      }
    }
    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);
    if (!fs.existsSync(PRD_OUTPUT_DIR)) {
      fs.mkdirSync(PRD_OUTPUT_DIR, { recursive: true });
    }
    const outPath = path.join(PRD_OUTPUT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("Export DOCX error:", err);
    res.status(500).json({ success: false, error: "EXPORT_ERROR", message: err.message });
  }
});

app.post("/api/extract-docx", upload.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: "Missing file", message: "Upload a .docx file" });
    }
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    if (ext !== ".docx") {
      return res.status(400).json({ success: false, error: "Invalid type", message: "Only .docx files are supported" });
    }
    const result = await mammoth.extractRawText({ buffer: req.file.buffer });
    res.json({ success: true, text: result.value || "" });
  } catch (err) {
    console.error("Extract DOCX error:", err);
    res.status(500).json({ success: false, error: "EXTRACT_ERROR", message: err.message });
  }
});

app.post("/api/extract-context-file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: "Missing file" });
    }
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const name = req.file.originalname || "file";
    let text = "";
    if (ext === ".docx") {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value || "";
    } else if (ext === ".pdf") {
      text = await extractTextFromPDFBuffer(req.file.buffer);
    } else if (ext === ".xlsx" || ext === ".xls") {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const parts = [];
      for (const sn of wb.SheetNames || []) {
        const sheet = wb.Sheets[sn];
        if (sheet) parts.push(`--- Sheet: ${sn} ---\n${XLSX.utils.sheet_to_csv(sheet)}`);
      }
      text = parts.join("\n\n");
    } else if (ext === ".txt" || ext === ".csv" || ext === ".md") {
      text = req.file.buffer.toString("utf8");
    } else {
      return res.status(400).json({
        success: false,
        error: "Unsupported file type. Use .docx, .pdf, .xlsx, .xls, .txt, .csv, or .md",
      });
    }
    res.json({ success: true, text: String(text).slice(0, 200000), name });
  } catch (err) {
    console.error("extract-context-file:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/connectors/status", (req, res) => {
  const sites = listConfiguredJiraBases();
  res.json({
    jira: !!(JIRA_EMAIL && JIRA_TOKEN && sites.length > 0),
    jiraSites: sites,
    jiraSecondaryProjectKeys: [...JIRA_SECONDARY_PROJECT_KEYS],
    slack: !!(process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL),
    whatsapp: !!(process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_PHONE_ID),
    email: !!(process.env.EMAIL_SMTP_HOST || process.env.EMAIL_API_KEY),
    telegram: !!(process.env.TELEGRAM_BOT_TOKEN),
  });
});

app.get("/api/jira-test", async (req, res) => {
  const sites = listConfiguredJiraBases();
  if (!sites.length || !JIRA_EMAIL || !JIRA_TOKEN) {
    return res.status(400).json({ ok: false, error: "JIRA not configured. Set JIRA_URL, JIRA_EMAIL, JIRA_TOKEN in .env" });
  }
  try {
    const results = [];
    for (const s of sites) {
      const url = `${s.base}/rest/api/3/myself`;
      const r = await fetch(url, {
        headers: { Authorization: jiraAuthHeader(), Accept: "application/json" },
      });
      const data = await r.json().catch(() => ({}));
      const label = s.label || s.id;
      if (r.ok) {
        const u = data?.displayName || data?.emailAddress || "OK";
        console.log(`[jira-test] OK ${label} (${s.base}) as ${u}`);
        results.push({ id: s.id, base: s.base, label, ok: true, user: u });
      } else {
        const msg = Array.isArray(data?.errorMessages) ? data.errorMessages.join("; ") : `HTTP ${r.status}`;
        console.error(`[jira-test] FAIL ${label} (${s.base}):`, msg);
        results.push({ id: s.id, base: s.base, label, ok: false, error: msg });
      }
    }
    const firstOk = results.find((x) => x.ok);
    return res.json({
      ok: results.some((x) => x.ok),
      user: firstOk?.user,
      sites: results,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

function jiraSiteLabelForBase(base) {
  const b = normalizeJiraBaseUrl(base);
  if (b && JIRA_URL_2 && b === normalizeJiraBaseUrl(JIRA_URL_2)) return "secondary";
  return "primary";
}

function formatJiraIssueApiResponse(d, jiraBaseUrl) {
  const f = d.fields || {};
  const comments = (f.comment?.comments || []).slice(-3).map((c) => `[${c.author?.displayName}]: ${extractJiraText(c.body)}`).join("\n");
  return {
    id: d.key,
    jiraBaseUrl: jiraBaseUrl || "",
    jiraSite: jiraSiteLabelForBase(jiraBaseUrl),
    summary: f.summary || "",
    description: extractJiraText(f.description),
    status: f.status?.name || "",
    priority: f.priority?.name || "",
    assignee: f.assignee?.displayName || "Unassigned",
    reporter: f.reporter?.displayName || "",
    created: (f.created || "").split("T")[0] || "",
    updated: (f.updated || "").split("T")[0] || "",
    labels: (f.labels || []).join(", "),
    components: (f.components || []).map((c) => c.name).join(", "),
    fixVersions: (f.fixVersions || []).map((v) => v.name).join(", "),
    acceptanceCriteria: f.customfield_10023 || f.customfield_10034 || "",
    comments,
    attachments: (f.attachment || []).map((a) => a.filename).join(", "),
  };
}

app.get("/api/jira-issue/:id", async (req, res) => {
  if (!JIRA_EMAIL || !JIRA_TOKEN) {
    return res.status(400).json({ error: "JIRA not configured. Set JIRA_EMAIL, JIRA_TOKEN in .env" });
  }
  const parsed = parseJiraIssueRequestParam(req.params.id);
  const issueKey = parsed.issueKey;
  if (!issueKey) return res.status(400).json({ error: "Missing JIRA issue key — paste a key (e.g. TPAP-123) or full browse URL." });

  const basesToTry = resolveBasesForFetch(parsed, req.query);
  if (!basesToTry.length) {
    return res.status(400).json({ error: "No JIRA site configured. Set JIRA_URL (and optionally JIRA_URL_2) in .env." });
  }

  const tryLog = [];
  try {
    for (const base of basesToTry) {
      const apiUrl = `${base}/rest/api/3/issue/${issueKey}`;
      console.log(`[jira-fetch] GET ${apiUrl}`);
      const r = await fetch(apiUrl, {
        headers: { Authorization: jiraAuthHeader(), Accept: "application/json" },
      });
      const rawText = await r.text();
      let data;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }
      if (r.ok) {
        console.log(`[jira-fetch] OK ${issueKey} from ${base}`);
        return res.json(formatJiraIssueApiResponse(data, base));
      }
      const msg =
        (Array.isArray(data?.errorMessages) && data.errorMessages[0]) ||
        data?.message ||
        data?.errorMessage ||
        r.statusText ||
        `HTTP ${r.status}`;
      console.error(`[jira-fetch] FAIL ${base} ${issueKey} status=${r.status}:`, msg);
      if (data && typeof data === "object" && Object.keys(data).length) {
        console.error(`[jira-fetch] response body (truncated):`, JSON.stringify(data).slice(0, 800));
      }
      tryLog.push({ base, status: r.status, message: String(msg) });
    }

    const last = tryLog[tryLog.length - 1];
    const summary =
      tryLog.length > 1
        ? `${last?.message || "Not found"} (tried ${tryLog.length} sites — see server log for details)`
        : last?.message || "Issue does not exist or you do not have permission to see it.";
    return res.status(404).json({
      error: summary,
      tried: tryLog,
      issueKey,
    });
  } catch (err) {
    console.error("[jira-fetch] exception:", err);
    res.status(500).json({ error: err.message });
  }
});

function looksLikeJiraAccountId(s) {
  const t = String(s || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

/** Atlassian Cloud scoped account id, e.g. 712020:43e3961c-6f66-4321-8971-8e25d446eb56 */
function looksLikeJiraScopedAccountId(s) {
  const t = String(s || "").trim();
  return /^\d+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

/** Create issue / user fields: Atlassian samples use { id: "…" } (scoped or legacy id). */
function jiraUserFieldRef(accountIdOrId) {
  const id = String(accountIdOrId || "").trim();
  if (!id) return null;
  return { id };
}

/** Resolve email / display name → { id } for JIRA Cloud REST. */
async function jiraResolveUserPickerValue(query, jiraBase) {
  const base = normalizeJiraBaseUrl(jiraBase) || JIRA_URL;
  const q = String(query || "").trim();
  if (!q) return null;
  if (looksLikeJiraAccountId(q) || looksLikeJiraScopedAccountId(q)) return jiraUserFieldRef(q);
  const url = `${base}/rest/api/3/user/search?query=${encodeURIComponent(q)}&maxResults=10`;
  const r = await fetch(url, {
    headers: { Authorization: jiraAuthHeader(), Accept: "application/json" },
  });
  const users = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = Array.isArray(users?.errorMessages) ? users.errorMessages.join("; ") : `HTTP ${r.status}`;
    console.error(`[jira] user/search failed on ${base}:`, msg);
    throw new Error(`JIRA user search failed: ${msg}`);
  }
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error(
      `No JIRA user found for "${q}". Use full email (e.g. Deepankar.pathak@finmate.tech), display name, or paste Atlassian accountId (UUID).`
    );
  }
  if (users.length > 1) {
    const brief = users
      .slice(0, 5)
      .map((u) => `${u.displayName || "?"} <${u.emailAddress || u.accountId}>`)
      .join(" | ");
    console.warn(`[jira] user search "${q}" returned ${users.length} matches; using first. Sample: ${brief}`);
  }
  return jiraUserFieldRef(users[0].accountId);
}

/**
 * Sets Dev Assignee (user picker) on create. Priority: request devAssignee → JIRA_DEV_ASSIGNEE_ACCOUNT_ID → JIRA_DEV_ASSIGNEE.
 * Omit all to skip (JIRA may still error if the field is required).
 */
async function resolveDevAssigneeFields(bodyDevAssignee, jiraBase) {
  if (!JIRA_DEV_ASSIGNEE_FIELD_ID) return {};

  const body = String(bodyDevAssignee || "").trim();
  const envAccount = String(process.env.JIRA_DEV_ASSIGNEE_ACCOUNT_ID || "").trim();
  const envQuery = String(process.env.JIRA_DEV_ASSIGNEE || "").trim();

  let picker = null;
  if (body) {
    picker =
      looksLikeJiraAccountId(body) || looksLikeJiraScopedAccountId(body)
        ? jiraUserFieldRef(body)
        : await jiraResolveUserPickerValue(body, jiraBase);
  } else if (envAccount) {
    picker =
      looksLikeJiraAccountId(envAccount) || looksLikeJiraScopedAccountId(envAccount)
        ? jiraUserFieldRef(envAccount)
        : await jiraResolveUserPickerValue(envAccount, jiraBase);
  } else if (envQuery) {
    picker =
      looksLikeJiraAccountId(envQuery) || looksLikeJiraScopedAccountId(envQuery)
        ? jiraUserFieldRef(envQuery)
        : await jiraResolveUserPickerValue(envQuery, jiraBase);
  }

  if (!picker?.id) return {};
  // Multi-user picker → must be [{ id }]. Single-user custom field → { id } only if env set.
  const fieldValue = JIRA_DEV_ASSIGNEE_SINGLE_USER_OBJECT ? picker : [picker];
  return { [JIRA_DEV_ASSIGNEE_FIELD_ID]: fieldValue };
}

function normalizeJiraLabelStringsFromRequest(raw) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\n]/) : [];
  const out = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
  return out.slice(0, 25);
}

function mergeLabelsIntoJiraFields(fields, labelStrings) {
  const labels = normalizeJiraLabelStringsFromRequest(labelStrings);
  if (!labels.length) return fields;
  return { ...fields, labels };
}

function normalizeNotifyDomainLabels(body) {
  const n = body?.notifyDomainLabels;
  if (Array.isArray(n)) return n.map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
  return [];
}

/** After JIRA Agent creates issue(s); uses same SMTP as Share / NOTIFY. */
async function sendJiraAgentCreatedEmail({ issueKeys, summary, domainLabels }) {
  const keys = (Array.isArray(issueKeys) ? issueKeys : []).map((k) => String(k || "").trim()).filter(Boolean);
  if (!keys.length) return;
  const to = String(process.env.JIRA_CREATE_NOTIFY_TO || process.env.NOTIFY_EMAIL || process.env.EMAIL_USER || "").trim();
  const hasSmtp = !!(process.env.EMAIL_SMTP_HOST || process.env.EMAIL_USER);
  if (!to || !hasSmtp) {
    console.log("[jira-create-mail] skipped (set JIRA_CREATE_NOTIFY_TO or NOTIFY_EMAIL, and EMAIL_* for SMTP)");
    return;
  }
  const greeting = String(process.env.JIRA_CREATE_GREETING_NAME || "Deepankar").trim() || "Deepankar";
  const sum = String(summary || "Ticket").trim().slice(0, 240);
  const subject = `${keys.join(", ")} - ${sum} Created`;
  const domainPart =
    Array.isArray(domainLabels) && domainLabels.length ? domainLabels.join(", ") : "the selected domain(s)";
  const idsLine = keys.join(", ");
  const html = `Hi ${greeting},<br/>JIRA has been created successfully for ${domainPart}.<br/> Please refer to ${idsLine}.`;
  const text = `Hi ${greeting},\n\nJIRA has been created successfully for ${domainPart}.\n\nPlease refer to ${idsLine}.`;
  try {
    const nodemailer = (await import("nodemailer")).default;
    const transportOpts = {
      host: process.env.EMAIL_SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.EMAIL_SMTP_PORT) || 587,
      secure: process.env.EMAIL_SECURE === "true",
      auth: process.env.EMAIL_USER ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD } : undefined,
    };
    const transporter = nodemailer.createTransport(transportOpts);
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER || "noreply@local",
      to,
      subject,
      text,
      html,
    });
    console.log("[jira-create-mail] sent:", subject.slice(0, 100));
  } catch (e) {
    console.error("[jira-create-mail] failed:", e.message);
  }
}

/** Safe logging of fields (avoid dumping huge ADF). */
function summarizeJiraFieldsForLog(fields) {
  const f = fields && typeof fields === "object" ? { ...fields } : {};
  if (f.description && typeof f.description === "object") {
    const raw = JSON.stringify(f.description);
    f.description = `<ADF, ${raw.length} chars>`;
  } else if (typeof f.description === "string") {
    f.description = `<string, ${f.description.length} chars>`;
  }
  return f;
}

function formatJiraApiError(data) {
  if (!data || typeof data !== "object") return "JIRA request failed";
  const msgs = data.errorMessages;
  if (Array.isArray(msgs) && msgs.length) return msgs.join("; ");
  const errs = data.errors;
  if (errs && typeof errs === "object") {
    const pairs = Object.entries(errs).map(([k, v]) => `${k}: ${v}`);
    if (pairs.length) return pairs.join("; ");
  }
  return data.message || "Bad Request";
}

function buildIssuetypeField({ issueTypeName, issueTypeId }) {
  const id =
    (issueTypeId && String(issueTypeId).trim()) ||
    (process.env.JIRA_ISSUE_TYPE_ID && String(process.env.JIRA_ISSUE_TYPE_ID).trim()) ||
    "";
  if (id) return { id };
  const name = String(issueTypeName || process.env.JIRA_DEFAULT_ISSUE_TYPE || "Task").trim() || "Task";
  return { name };
}

function buildSubtaskIssuetypeField({ issueTypeId, issueTypeName }) {
  const id =
    (issueTypeId && String(issueTypeId).trim()) ||
    (process.env.JIRA_SUBTASK_ISSUE_TYPE_ID && String(process.env.JIRA_SUBTASK_ISSUE_TYPE_ID).trim()) ||
    "";
  if (id) return { id };
  const name = String(issueTypeName || process.env.JIRA_SUBTASK_ISSUE_TYPE_NAME || "Sub-task").trim() || "Sub-task";
  return { name };
}

async function jiraCreateIssue(fields, logLabel, jiraBase) {
  const base = normalizeJiraBaseUrl(jiraBase) || JIRA_URL;
  const postUrl = `${base}/rest/api/3/issue`;
  if (logLabel) {
    console.log(`${logLabel} POST ${postUrl} fields:`, JSON.stringify(summarizeJiraFieldsForLog(fields), null, 2));
  }
  const r = await fetch(postUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: jiraAuthHeader(),
    },
    body: JSON.stringify({ fields }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (logLabel) {
      console.error(`${logLabel} JIRA ${base} response ${r.status}:`, JSON.stringify(data, null, 2));
    }
    const err = new Error(formatJiraApiError(data));
    err.status = r.status;
    err.details = data;
    throw err;
  }
  return data;
}

/** JIRA sometimes rejects rich ADF; fall back to a single paragraph of plain text. */
function jiraMinimalDescriptionAdf(markdown) {
  const text = String(markdown || "")
    .replace(/\r/g, "")
    .replace(/\0/g, "")
    .slice(0, 32000);
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: text.trim() ? text : "(empty)" }] }],
  };
}

async function jiraCreateIssueWithMarkdownDescription(fieldsBase, markdown, logLabel, jiraBase) {
  const md = String(markdown || "");
  const adf = markdownToJiraAdf(md)?.body;
  const fields = { ...fieldsBase, ...(adf ? { description: adf } : {}) };
  try {
    return await jiraCreateIssue(fields, logLabel, jiraBase);
  } catch (e) {
    const m = String(e.message || "").toLowerCase();
    const errKeys = e.details?.errors ? Object.keys(e.details.errors).join(" ").toLowerCase() : "";
    const retry =
      fields.description &&
      (m.includes("description") ||
        m.includes("document") ||
        m.includes("adf") ||
        errKeys.includes("description"));
    if (retry) {
      return await jiraCreateIssue(
        {
          ...fieldsBase,
          description: jiraMinimalDescriptionAdf(md),
        },
        logLabel ? `${logLabel} (retry minimal description)` : undefined,
        jiraBase
      );
    }
    throw e;
  }
}

app.get("/api/jira/issue-types", async (req, res) => {
  const projectKey = String(req.query.projectKey || "").trim().toUpperCase();
  if (!projectKey) return res.status(400).json({ success: false, error: "Missing projectKey query" });
  if (!listConfiguredJiraBases().length || !JIRA_EMAIL || !JIRA_TOKEN) {
    return res.status(400).json({ success: false, error: "JIRA not configured in .env" });
  }
  try {
    const jiraBase = resolveJiraBaseForWrite(projectKey, {
      jiraSite: req.query.jiraSite,
      jiraBaseUrl: req.query.jiraBaseUrl,
    });
    const url = `${jiraBase}/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes`;
    console.log(`[api/jira/issue-types] GET ${url}`);
    const r = await fetch(url, {
      headers: { Authorization: jiraAuthHeader(), Accept: "application/json" },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[api/jira/issue-types] FAIL ${jiraBase}:`, formatJiraApiError(data));
      return res.status(r.status).json({ success: false, error: formatJiraApiError(data), jiraBaseUrl: jiraBase });
    }
    const proj = (data.projects || [])[0];
    const types = (proj?.issuetypes || []).map((t) => ({
      id: t.id,
      name: t.name,
      subtask: !!t.subtask,
    }));
    res.json({ success: true, projectKey, types, jiraBaseUrl: jiraBase });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/jira/create", async (req, res) => {
  const logP = "[api/jira/create]";
  try {
    const { projectKey, summary, description, issueType, issueTypeId, devAssignee, labels, jiraSite, jiraBaseUrl } = req.body || {};
    let jiraBase;
    try {
      jiraBase = resolveJiraBaseForWrite(projectKey, { jiraSite, jiraBaseUrl });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message || String(e) });
    }
    console.log(`${logP} JIRA base:`, jiraBase);
    console.log(
      `${logP} incoming body:`,
      JSON.stringify(
        {
          projectKey: projectKey || null,
          summary: summary ? String(summary).slice(0, 120) + (String(summary).length > 120 ? "…" : "") : null,
          description: `(markdown, ${String(description || "").length} chars)`,
          issueType: issueType || null,
          issueTypeId: issueTypeId || null,
          devAssignee: devAssignee || null,
          labels: Array.isArray(labels) ? labels : null,
          jiraSite: jiraSite || null,
        },
        null,
        2
      )
    );
    if (!projectKey || !summary || !description) {
      console.error("[api/jira/create] 400 validation:", {
        hasProjectKey: !!projectKey,
        hasSummary: !!summary,
        hasDescription: !!description,
      });
      return res.status(400).json({ success: false, error: "Missing projectKey, summary, or description" });
    }
    if (!jiraBase || !JIRA_EMAIL || !JIRA_TOKEN) {
      console.error("[api/jira/create] 400 JIRA credentials missing in env");
      return res.status(400).json({ success: false, error: "JIRA not configured in .env" });
    }
    const cleanProjectKey = String(projectKey).trim().toUpperCase();
    const cleanSummary = String(summary).trim().slice(0, 255);
    if (!cleanSummary) {
      console.error("[api/jira/create] 400 empty summary after trim");
      return res.status(400).json({ success: false, error: "Summary is empty — set Feature / Ticket Title or ensure the draft starts with # Title" });
    }
    let assigneeFields = {};
    try {
      assigneeFields = await resolveDevAssigneeFields(devAssignee, jiraBase);
    } catch (e) {
      console.error(`${logP} dev assignee resolution failed:`, e.message);
      return res.status(400).json({ success: false, error: e.message || String(e) });
    }
    if (Object.keys(assigneeFields).length) {
      console.log(`${logP} resolved Dev Assignee (${JIRA_DEV_ASSIGNEE_FIELD_ID}):`, JSON.stringify(assigneeFields, null, 2));
    }
    const md = String(description);
    const fieldsBase = mergeLabelsIntoJiraFields(
      {
        project: { key: cleanProjectKey },
        summary: cleanSummary,
        issuetype: buildIssuetypeField({ issueTypeName: issueType, issueTypeId }),
        ...assigneeFields,
      },
      labels
    );
    const data = await jiraCreateIssueWithMarkdownDescription(fieldsBase, md, logP, jiraBase);
    const key = data.key || "";
    void sendJiraAgentCreatedEmail({
      issueKeys: key ? [key] : [],
      summary: cleanSummary,
      domainLabels: normalizeNotifyDomainLabels(req.body),
    });
    res.json({
      success: true,
      key,
      id: data.id,
      self: data.self,
      browseUrl: key ? `${jiraBase}/browse/${key}` : "",
      jiraBaseUrl: jiraBase,
    });
  } catch (err) {
    const status = err.status && Number(err.status) >= 400 ? err.status : 500;
    const details = err.details && typeof err.details === "object" ? JSON.stringify(err.details) : "";
    console.error("[api/jira/create] failed:", status, err.message || err, details || "");
    res.status(status).json({ success: false, error: err.message || String(err) });
  }
});

app.post("/api/jira/attach", upload.array("files", 12), async (req, res) => {
  try {
    const issueKey = String(req.body.issueKey || "").trim().toUpperCase().replace(/\s/g, "");
    if (!issueKey || !req.files?.length) {
      return res.status(400).json({ success: false, error: "Missing issueKey or files" });
    }
    if (!listConfiguredJiraBases().length || !JIRA_EMAIL || !JIRA_TOKEN) {
      return res.status(400).json({ success: false, error: "JIRA not configured in .env" });
    }
    let jiraBase;
    try {
      jiraBase = resolveJiraBaseFromIssueKey(issueKey, {
        jiraSite: req.body.jiraSite,
        jiraBaseUrl: req.body.jiraBaseUrl,
      });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message || String(e) });
    }
    const form = new FormData();
    for (const f of req.files) {
      form.append("file", f.buffer, {
        filename: f.originalname || "attachment",
        contentType: f.mimetype || "application/octet-stream",
      });
    }
    const url = `${jiraBase}/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`;
    console.log(`[api/jira/attach] POST ${url}`);
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: jiraAuthHeader(),
        "X-Atlassian-Token": "no-check",
        ...form.getHeaders(),
      },
      body: form,
    });
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : [];
    } catch {
      data = text;
    }
    if (!r.ok) {
      const errMsg =
        typeof data === "object" && data?.errorMessages?.[0] ? data.errorMessages[0] : String(text).slice(0, 400) || r.statusText;
      console.error(`[api/jira/attach] FAIL ${url}:`, errMsg);
      return res.status(r.status).json({
        success: false,
        error: errMsg,
      });
    }
    res.json({ success: true, attachments: Array.isArray(data) ? data : [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/jira/create-with-subtasks", async (req, res) => {
  const logP = "[api/jira/create-with-subtasks]";
  try {
    const { projectKey, parent, subtasks, devAssignee, labels, jiraSite, jiraBaseUrl } = req.body || {};
    let jiraBase;
    try {
      jiraBase = resolveJiraBaseForWrite(projectKey, { jiraSite, jiraBaseUrl });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message || String(e) });
    }
    console.log(`${logP} JIRA base:`, jiraBase);
    console.log(
      `${logP} incoming:`,
      JSON.stringify(
        {
          projectKey: projectKey || null,
          devAssignee: devAssignee || null,
          parentSummary: parent?.summary ? String(parent.summary).slice(0, 120) : null,
          parentDescriptionLen: String(parent?.description || "").length,
          subtaskCount: Array.isArray(subtasks) ? subtasks.length : 0,
          labels: Array.isArray(labels) ? labels : null,
          jiraSite: jiraSite || null,
        },
        null,
        2
      )
    );
    if (!projectKey || !parent?.summary || !parent?.description) {
      return res.status(400).json({ success: false, error: "Missing projectKey or parent.summary / parent.description" });
    }
    if (!jiraBase || !JIRA_EMAIL || !JIRA_TOKEN) {
      return res.status(400).json({ success: false, error: "JIRA not configured in .env" });
    }
    let assigneeFields = {};
    try {
      assigneeFields = await resolveDevAssigneeFields(devAssignee, jiraBase);
    } catch (e) {
      console.error(`${logP} dev assignee resolution failed:`, e.message);
      return res.status(400).json({ success: false, error: e.message || String(e) });
    }
    const cleanProjectKey = String(projectKey).trim().toUpperCase();
    const parentSummary = String(parent.summary).trim().slice(0, 255);
    if (!parentSummary) return res.status(400).json({ success: false, error: "Parent summary is empty" });
    const parentMd = String(parent.description);
    const parentFieldsBase = mergeLabelsIntoJiraFields(
      {
        project: { key: cleanProjectKey },
        summary: parentSummary,
        issuetype: buildIssuetypeField({
          issueTypeName: parent.issueType,
          issueTypeId: parent.issueTypeId,
        }),
        ...assigneeFields,
      },
      labels
    );
    const createdParent = await jiraCreateIssueWithMarkdownDescription(parentFieldsBase, parentMd, `${logP} parent`, jiraBase);
    const parentKey = createdParent.key || "";
    const createdSubs = [];
    const list = Array.isArray(subtasks) ? subtasks : [];
    for (const st of list) {
      const sum = String(st?.summary || "").trim().slice(0, 255);
      if (!sum) continue;
      const bodyMd = String(st?.description || st?.body || "").trim() || sum;
      const subFieldsBase = mergeLabelsIntoJiraFields(
        {
          project: { key: cleanProjectKey },
          parent: { key: parentKey },
          summary: sum,
          issuetype: buildSubtaskIssuetypeField({
            issueTypeId: st.issueTypeId,
            issueTypeName: st.issueType,
          }),
          ...assigneeFields,
        },
        labels
      );
      try {
        const subData = await jiraCreateIssueWithMarkdownDescription(subFieldsBase, bodyMd, `${logP} sub`, jiraBase);
        createdSubs.push({
          key: subData.key,
          browseUrl: subData.key ? `${jiraBase}/browse/${subData.key}` : "",
        });
      } catch (e) {
        console.error(`${logP} subtask create failed:`, e.message);
        createdSubs.push({ error: e.message || String(e) });
      }
    }
    const subKeys = createdSubs.map((s) => s.key).filter(Boolean);
    const allKeys = parentKey ? [parentKey, ...subKeys] : subKeys;
    void sendJiraAgentCreatedEmail({
      issueKeys: allKeys,
      summary: parentSummary,
      domainLabels: normalizeNotifyDomainLabels(req.body),
    });
    res.json({
      success: true,
      parentKey,
      parentBrowseUrl: parentKey ? `${jiraBase}/browse/${parentKey}` : "",
      subtasks: createdSubs,
      jiraBaseUrl: jiraBase,
    });
  } catch (err) {
    const status = err.status && Number(err.status) >= 400 ? err.status : 500;
    const details = err.details && typeof err.details === "object" ? JSON.stringify(err.details) : "";
    console.error(`${logP} failed:`, status, err.message || err, details || "");
    res.status(status).json({ success: false, error: err.message || String(err) });
  }
});

// ── Share: JIRA comment, Telegram, Email ─────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
/** Corporate SSL inspection: set TELEGRAM_INSECURE_TLS=true in .env (dev only). */
const telegramHttpsAgent =
  process.env.TELEGRAM_INSECURE_TLS === "true"
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

async function telegramApiSendMessage(chatId, textBody, parseMode) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: textBody,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
    ...(telegramHttpsAgent ? { agent: telegramHttpsAgent } : {}),
  });
  let data = {};
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  // #region agent log
  fetch('http://127.0.0.1:7842/ingest/8fc1decb-c4f1-4183-ab20-ebd1f89b284b',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'X-Debug-Session-Id':'5fdef1'
    },
    body:JSON.stringify({
      sessionId:'5fdef1',
      runId:'post-fix',
      hypothesisId:'T1',
      location:'backend/server.js:1211',
      message:'telegramApiSendMessage result',
      data:{ status:r.status, ok:r.ok, hasDescription:!!data?.description, hasMessage:!!data?.message },
      timestamp:Date.now()
    })
  }).catch(()=>{});
  // #endregion
  return { ok: r.ok, data };
}

app.post("/api/save-agent-output", (req, res) => {
  try {
    const { agent, jiraId, subject, content } = req.body || {};
    const text = String(content || "");
    if (!text.trim()) return res.status(400).json({ ok: false, error: "empty content" });
    if (!fs.existsSync(AGENT_EXPORT_DIR)) fs.mkdirSync(AGENT_EXPORT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const safe = (s) =>
      String(s || "")
        .replace(/[/\\?%*:|"<>#\s]+/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 100);
    const jid = safe((jiraId || "NOJIRA").toUpperCase().slice(0, 40));
    const ag = safe((agent || "DOC").toUpperCase());
    const subj = safe(subject || "output");
    const filename = `${jid}-${ag}-${subj}-${ts}.md`;
    fs.writeFileSync(path.join(AGENT_EXPORT_DIR, filename), text, "utf8");
    res.json({ ok: true, filename });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/share/jira", async (req, res) => {
  try {
    const { issueKey, text, title, jiraSite, jiraBaseUrl } = req.body || {};
    if (!issueKey || !text) return res.status(400).json({ success: false, error: "Missing issueKey or text" });
    if (!listConfiguredJiraBases().length || !JIRA_EMAIL || !JIRA_TOKEN) {
      return res.status(400).json({ success: false, error: "JIRA not configured in .env" });
    }
    const key = String(issueKey).toUpperCase().replace(/\s/g, "");
    let jiraBase;
    try {
      jiraBase = resolveJiraBaseFromIssueKey(key, { jiraSite, jiraBaseUrl });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message || String(e) });
    }
    const md = title ? `## ${title}\n\n${text}` : String(text);
    const commentUrl = `${jiraBase}/rest/api/3/issue/${key}/comment`;
    console.log(`[api/share/jira] POST ${commentUrl}`);
    const r = await fetch(commentUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: jiraAuthHeader(),
      },
      body: JSON.stringify(markdownToJiraAdf(md)),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[api/share/jira] FAIL:`, data.errorMessages?.[0] || r.statusText, JSON.stringify(data).slice(0, 400));
      return res.status(r.status).json({ success: false, error: data.errorMessages?.[0] || r.statusText });
    }
    res.json({ success: true, id: data.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function escapeTelegramHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

app.post("/api/share/telegram", async (req, res) => {
  try {
    const { chatId, text, title } = req.body || {};
    if (!chatId || !text) return res.status(400).json({ success: false, error: "Missing chatId or text" });
    if (!TELEGRAM_BOT_TOKEN) return res.status(400).json({ success: false, error: "TELEGRAM_BOT_TOKEN not set in .env" });
    const subjectPreview = title || (String(text).slice(0, 80) || "Telegram share");
    console.log("[api/share/telegram] sending", { chatId, subject: subjectPreview });
    let chunks = markdownToTelegramChunks(String(text));
    if (title) {
      const prefix = `<b>${escapeTelegramHtml(title)}</b>\n\n`;
      if (chunks.length) chunks[0] = prefix + chunks[0];
      else chunks = [prefix];
    }
    let lastId;
    for (const chunk of chunks) {
      const { ok, data } = await telegramApiSendMessage(chatId, chunk.slice(0, 4096), "HTML");
      if (!ok || !data.ok) {
        console.error("[api/share/telegram] Telegram API error:", data?.description || data?.message || "unknown");
        return res.status(400).json({ success: false, error: data.description || data.message || "Telegram API error" });
      }
      lastId = data.result?.message_id;
    }
    res.json({ success: true, message_id: lastId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";

app.post("/api/share/slack", async (req, res) => {
  try {
    const { text, title, channel } = req.body || {};
    if (!text) return res.status(400).json({ success: false, error: "Missing text" });
    const webhookUrl = SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) return res.status(400).json({ success: false, error: "SLACK_WEBHOOK_URL not set in .env" });
    const formatted = markdownToSlackPayload(title || "", String(text));
    const preview = String(title ? `${title}\n\n${text}` : text).slice(0, 500);
    const payload = { ...formatted, text: preview };
    if (channel) payload.channel = channel;
    console.log("[api/share/slack] sending", { channel: channel || "default", subject: title || preview.slice(0, 80) });
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error("[api/share/slack] webhook failed:", r.status, String(err).slice(0, 400));
      return res.status(r.status).json({ success: false, error: err || "Slack webhook failed" });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/share/email", async (req, res) => {
  try {
    const { to, subject, text, title } = req.body || {};
    if (!to || !text) return res.status(400).json({ success: false, error: "Missing to or text" });
    const nodemailer = (await import("nodemailer")).default;
    const transportOpts = {
      host: process.env.EMAIL_SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.EMAIL_SMTP_PORT) || 587,
      secure: process.env.EMAIL_SECURE === "true",
      auth: process.env.EMAIL_USER ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD } : undefined,
    };
    const transporter = nodemailer.createTransport(transportOpts);
    const md = title ? `## ${title}\n\n${text}` : String(text);
    const bodyText = title ? `${title}\n\n${text}` : text;
    const bodyHtml = markdownToEmailHtml(md);
    console.log("[api/share/email] sending", {
      to,
      subject: subject || "AI Agents Output",
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER || "noreply@local",
      to,
      subject: subject || "AI Agents Output",
      text: bodyText,
      html: bodyHtml,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("[api/share/email] failed:", err.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Score (OpenAI or internal Foundry / LLM gateway) ─────────────────────────
app.post("/api/score", async (req, res) => {
  try {
    const { type, content, title, scoreProvider } = req.body || {};
    if (!type || !content) return res.status(400).json({ success: false, error: "Missing type (prd|uat|brd|jira) or content" });
    const provider = String(scoreProvider || "openai").toLowerCase() === "foundry" ? "foundry" : "openai";
    const docType =
      type === "uat" ? "UAT Signoff" : type === "brd" ? "BRD" : type === "jira" ? "JIRA ticket" : "PRD";
    const systemPrompt = `You are an expert reviewer. Score the following ${docType} document on a scale of 1-10 (10 = excellent). Consider: completeness, clarity, compliance with NPCI/UPI norms, structure, and actionability. Respond with ONLY a JSON object: { "score": number, "maxScore": 10, "rationale": "2-3 sentence explanation" }. No other text.`;
    const userContent = (title ? `Document: ${title}\n\n` : "") + String(content).slice(0, 12000);
    const combinedUserMessage = `${systemPrompt}\n\n${userContent}`;

    if (provider === "openai") {
      if (!OPENAI_API_KEY) {
        return res.status(400).json({ success: false, error: "OPENAI_API_KEY not set in .env for OpenAI scoring" });
      }
      console.log("[api/score] provider=openai model=", SCORE_MODEL);
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: SCORE_MODEL,
          messages: [{ role: "user", content: combinedUserMessage }],
          max_tokens: 400,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = data?.error?.message || data?.message || `HTTP ${r.status}`;
        console.error("[api/score] OpenAI failed:", r.status, String(msg).slice(0, 400));
        return res.status(r.status || 500).json({ success: false, error: msg || "OpenAI error" });
      }
      if (data.error) return res.status(r.status || 500).json({ success: false, error: data.error.message || "OpenAI error" });
      const raw = data.choices?.[0]?.message?.content || "";
      const result = parseScoreJsonFromModelOutput(raw);
      return res.json({ success: true, scoreProvider: "openai", ...result });
    }

    // Foundry / internal LLM (same gateway style as /api/generate)
    if (!LLM_API_KEY) {
      return res.status(400).json({
        success: false,
        error: "Foundry scoring requires LLM_KEY_API or LLM_API_KEY in .env",
      });
    }
    const foundryUrl = scoreFoundryBaseUrl();
    if (!foundryUrl) {
      return res.status(400).json({
        success: false,
        error: "Set SCORE_LLM_URL or LLM_URL in .env for Foundry scoring",
      });
    }
    const foundryModel = scoreFoundryModel();
    const requestBody = {
      model: foundryModel,
      max_tokens: 400,
      messages: [{ role: "user", content: combinedUserMessage }],
    };
    const doFoundryCall = (authMode) =>
      fetch(foundryUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authMode === "x-api-key" ? { "x-api-key": LLM_API_KEY } : { Authorization: `Bearer ${LLM_API_KEY}` }),
        },
        body: JSON.stringify(requestBody),
      });
    console.log("[api/score] provider=foundry url=", foundryUrl, "model=", foundryModel);
    let authMode = "x-api-key";
    let response = await doFoundryCall(authMode);
    if (response.status === 401) {
      authMode = "bearer";
      response = await doFoundryCall(authMode);
    }
    const responseText = await response.text();
    if (!response.ok) {
      console.error("[api/score] Foundry failed:", response.status, responseText.slice(0, 600));
      return res.status(response.status).json({
        success: false,
        error: `Foundry LLM error (${response.status}): ${responseText.slice(0, 200).replace(/\s+/g, " ")}`,
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      console.error("[api/score] Foundry invalid JSON:", responseText.slice(0, 300));
      return res.status(500).json({ success: false, error: "Invalid JSON from Foundry scoring gateway" });
    }
    const root = parsed && typeof parsed === "object" && parsed.data != null ? parsed.data : parsed;
    const rawText = extractAssistantTextFromLlmPayload(root) || extractAssistantTextFromLlmPayload(parsed);
    if (!rawText.trim()) {
      console.error("[api/score] Foundry empty assistant text:", JSON.stringify(parsed).slice(0, 500));
      return res.status(500).json({ success: false, error: "Could not read model text from Foundry response" });
    }
    const result = parseScoreJsonFromModelOutput(rawText);
    return res.json({ success: true, scoreProvider: "foundry", ...result });
  } catch (err) {
    console.error("[api/score] exception:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Completion notification (Email + Slack/WhatsApp) ─────────────────────────
app.post("/api/notify/complete", async (req, res) => {
  try {
    const { agentName, identifier, notifySubject } = req.body || {};
    if (!agentName || !identifier) return res.status(400).json({ success: false, error: "Missing agentName or identifier" });
    const subject =
      notifySubject && String(notifySubject).trim()
        ? String(notifySubject).trim()
        : `${agentName} — ${identifier} is done`;
    const body = `${subject}\n\nGenerated at ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
    const results = [];
    console.log("[api/notify/complete] sending completion notification", { agentName, identifier, subject });

    // Email
    const emailTo = process.env.NOTIFY_EMAIL || process.env.EMAIL_USER || "";
    if (emailTo && (process.env.EMAIL_SMTP_HOST || process.env.EMAIL_USER)) {
      try {
        const nodemailer = (await import("nodemailer")).default;
        const transportOpts = {
          host: process.env.EMAIL_SMTP_HOST || "smtp.gmail.com",
          port: Number(process.env.EMAIL_SMTP_PORT) || 587,
          secure: process.env.EMAIL_SECURE === "true",
          auth: process.env.EMAIL_USER ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD } : undefined,
        };
        const transporter = nodemailer.createTransport(transportOpts);
        await transporter.sendMail({
          from: process.env.EMAIL_FROM || process.env.EMAIL_USER || "noreply@local",
          to: emailTo,
          subject,
          text: body,
        });
        results.push("email:ok");
      } catch (e) {
        console.error("[api/notify/complete] email failed:", e.message || e);
        results.push("email:" + e.message);
      }
    }

    // Slack
    const slackUrl = process.env.SLACK_WEBHOOK_URL || "";
    if (slackUrl) {
      try {
        const r = await fetch(slackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: subject }),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          console.error("[api/notify/complete] slack failed:", r.status, String(txt).slice(0, 300));
        }
        results.push(r.ok ? "slack:ok" : "slack:failed");
      } catch (e) {
        console.error("[api/notify/complete] slack exception:", e.message || e);
        results.push("slack:" + e.message);
      }
    }

    // WhatsApp (Meta Business API)
    const waToken = process.env.WHATSAPP_TOKEN || "";
    const waPhoneId = process.env.WHATSAPP_PHONE_ID || "";
    const waRecipient = process.env.WHATSAPP_NOTIFY_NUMBER || process.env.WHATSAPP_RECIPIENT || "";
    if (waToken && waPhoneId && waRecipient) {
      try {
        const r = await fetch(`https://graph.facebook.com/v18.0/${waPhoneId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${waToken}` },
          body: JSON.stringify({ messaging_product: "whatsapp", to: waRecipient, type: "text", text: { body: subject } }),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          console.error("[api/notify/complete] whatsapp failed:", r.status, String(txt).slice(0, 300));
        }
        results.push(r.ok ? "whatsapp:ok" : "whatsapp:failed");
      } catch (e) {
        console.error("[api/notify/complete] whatsapp exception:", e.message || e);
        results.push("whatsapp:" + e.message);
      }
    }

    // Telegram
    if (TELEGRAM_BOT_TOKEN) {
      const tgChatId = process.env.TELEGRAM_NOTIFY_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";
      if (tgChatId) {
        try {
          const { ok, data } = await telegramApiSendMessage(tgChatId, `<b>${escapeTelegramHtml(subject)}</b>`, "HTML");
          if (!ok || !data?.ok) {
            console.error(
              "[api/notify/complete] telegram failed:",
              data?.description || data?.message || "unknown error"
            );
          }
          results.push(ok && data.ok ? "telegram:ok" : "telegram:failed");
        } catch (e) {
          console.error("[api/notify/complete] telegram exception:", e.message || e);
          results.push("telegram:" + e.message);
        }
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Production: serve frontend build from parent directory (single deploy)
const buildPath = path.join(__dirname, "..", "build");
if (NODE_ENV === "production" && fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(buildPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`AI agents backend (ai-agents-backend) running on port ${PORT} [${NODE_ENV}]`);
});
