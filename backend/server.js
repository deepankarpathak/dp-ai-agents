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
import { extractTextFromPDF } from "./pdfParser.js";
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

const JIRA_URL = (process.env.JIRA_URL || "").replace(/\/$/, "");
const JIRA_EMAIL = process.env.JIRA_EMAIL || "";
const JIRA_TOKEN = process.env.JIRA_TOKEN || process.env.JIRA_API_TOKEN || "";

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
  res.json({
    anthropicConfigured: !!LLM_API_KEY,
    jiraConfigured: !!(JIRA_URL && JIRA_EMAIL && JIRA_TOKEN),
    jiraUrl: JIRA_URL || "",
    jiraEmail: JIRA_EMAIL || "",
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

app.get("/api/connectors/status", (req, res) => {
  res.json({
    jira: !!(JIRA_URL && JIRA_EMAIL && JIRA_TOKEN),
    slack: !!(process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL),
    whatsapp: !!(process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_PHONE_ID),
    email: !!(process.env.EMAIL_SMTP_HOST || process.env.EMAIL_API_KEY),
    telegram: !!(process.env.TELEGRAM_BOT_TOKEN),
  });
});

app.get("/api/jira-test", async (req, res) => {
  if (!JIRA_URL || !JIRA_EMAIL || !JIRA_TOKEN) {
    return res.status(400).json({ ok: false, error: "JIRA not configured. Set JIRA_URL, JIRA_EMAIL, JIRA_TOKEN in .env" });
  }
  try {
    const r = await fetch(`${JIRA_URL}/rest/api/3/myself`, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64"),
        Accept: "application/json",
      },
    });
    const d = r.ok ? await r.json() : null;
    if (r.ok) return res.json({ ok: true, user: d?.displayName || d?.emailAddress });
    return res.status(r.status).json({ ok: false, error: `JIRA auth failed: ${r.status}` });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/jira-issue/:id", async (req, res) => {
  const issueId = (req.params.id || "").toUpperCase();
  if (!issueId) return res.status(400).json({ error: "Missing JIRA issue ID" });
  if (!JIRA_URL || !JIRA_EMAIL || !JIRA_TOKEN) {
    return res.status(400).json({ error: "JIRA not configured. Set JIRA_URL, JIRA_EMAIL, JIRA_TOKEN in .env" });
  }
  try {
    const r = await fetch(`${JIRA_URL}/rest/api/3/issue/${issueId}`, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64"),
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: e.errorMessages?.[0] || r.statusText });
    }
    const d = await r.json();
    const f = d.fields || {};
    const comments = (f.comment?.comments || []).slice(-3).map((c) => `[${c.author?.displayName}]: ${extractJiraText(c.body)}`).join("\n");
    res.json({
      id: d.key,
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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function jiraAuthHeader() {
  return "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");
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

async function jiraCreateIssue(fields) {
  const r = await fetch(`${JIRA_URL}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: jiraAuthHeader(),
    },
    body: JSON.stringify({ fields }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(formatJiraApiError(data));
    err.status = r.status;
    err.details = data;
    throw err;
  }
  return data;
}

app.get("/api/jira/issue-types", async (req, res) => {
  const projectKey = String(req.query.projectKey || "").trim().toUpperCase();
  if (!projectKey) return res.status(400).json({ success: false, error: "Missing projectKey query" });
  if (!JIRA_URL || !JIRA_EMAIL || !JIRA_TOKEN) {
    return res.status(400).json({ success: false, error: "JIRA not configured in .env" });
  }
  try {
    const url = `${JIRA_URL}/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes`;
    const r = await fetch(url, {
      headers: { Authorization: jiraAuthHeader(), Accept: "application/json" },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ success: false, error: formatJiraApiError(data) });
    }
    const proj = (data.projects || [])[0];
    const types = (proj?.issuetypes || []).map((t) => ({
      id: t.id,
      name: t.name,
      subtask: !!t.subtask,
    }));
    res.json({ success: true, projectKey, types });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/jira/create", async (req, res) => {
  try {
    const { projectKey, summary, description, issueType, issueTypeId } = req.body || {};
    if (!projectKey || !summary || !description) {
      return res.status(400).json({ success: false, error: "Missing projectKey, summary, or description" });
    }
    if (!JIRA_URL || !JIRA_EMAIL || !JIRA_TOKEN) {
      return res.status(400).json({ success: false, error: "JIRA not configured in .env" });
    }
    const cleanProjectKey = String(projectKey).trim().toUpperCase();
    const cleanSummary = String(summary).trim().slice(0, 255);
    if (!cleanSummary) {
      return res.status(400).json({ success: false, error: "Summary is empty — set Feature / Ticket Title or ensure the draft starts with # Title" });
    }
    const md = String(description);
    const adf = markdownToJiraAdf(md)?.body;
    const payload = {
      project: { key: cleanProjectKey },
      summary: cleanSummary,
      issuetype: buildIssuetypeField({ issueTypeName: issueType, issueTypeId }),
      ...(adf ? { description: adf } : {}),
    };
    const data = await jiraCreateIssue(payload);
    const key = data.key || "";
    res.json({
      success: true,
      key,
      id: data.id,
      self: data.self,
      browseUrl: key ? `${JIRA_URL}/browse/${key}` : "",
    });
  } catch (err) {
    const status = err.status && Number(err.status) >= 400 ? err.status : 500;
    res.status(status).json({ success: false, error: err.message || String(err) });
  }
});

app.post("/api/jira/create-with-subtasks", async (req, res) => {
  try {
    const { projectKey, parent, subtasks } = req.body || {};
    if (!projectKey || !parent?.summary || !parent?.description) {
      return res.status(400).json({ success: false, error: "Missing projectKey or parent.summary / parent.description" });
    }
    if (!JIRA_URL || !JIRA_EMAIL || !JIRA_TOKEN) {
      return res.status(400).json({ success: false, error: "JIRA not configured in .env" });
    }
    const cleanProjectKey = String(projectKey).trim().toUpperCase();
    const parentSummary = String(parent.summary).trim().slice(0, 255);
    if (!parentSummary) return res.status(400).json({ success: false, error: "Parent summary is empty" });
    const parentMd = String(parent.description);
    const parentAdf = markdownToJiraAdf(parentMd)?.body;
    const parentFields = {
      project: { key: cleanProjectKey },
      summary: parentSummary,
      issuetype: buildIssuetypeField({
        issueTypeName: parent.issueType,
        issueTypeId: parent.issueTypeId,
      }),
      ...(parentAdf ? { description: parentAdf } : {}),
    };
    const createdParent = await jiraCreateIssue(parentFields);
    const parentKey = createdParent.key || "";
    const createdSubs = [];
    const list = Array.isArray(subtasks) ? subtasks : [];
    for (const st of list) {
      const sum = String(st?.summary || "").trim().slice(0, 255);
      if (!sum) continue;
      const bodyMd = String(st?.description || st?.body || "").trim() || sum;
      const stAdf = markdownToJiraAdf(bodyMd)?.body;
      const subFields = {
        project: { key: cleanProjectKey },
        parent: { key: parentKey },
        summary: sum,
        issuetype: buildSubtaskIssuetypeField({
          issueTypeId: st.issueTypeId,
          issueTypeName: st.issueType,
        }),
        ...(stAdf ? { description: stAdf } : {}),
      };
      try {
        const subData = await jiraCreateIssue(subFields);
        createdSubs.push({
          key: subData.key,
          browseUrl: subData.key ? `${JIRA_URL}/browse/${subData.key}` : "",
        });
      } catch (e) {
        createdSubs.push({ error: e.message || String(e) });
      }
    }
    res.json({
      success: true,
      parentKey,
      parentBrowseUrl: parentKey ? `${JIRA_URL}/browse/${parentKey}` : "",
      subtasks: createdSubs,
    });
  } catch (err) {
    const status = err.status && Number(err.status) >= 400 ? err.status : 500;
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
  const data = await r.json().catch(() => ({}));
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
    const { issueKey, text, title } = req.body || {};
    if (!issueKey || !text) return res.status(400).json({ success: false, error: "Missing issueKey or text" });
    if (!JIRA_URL || !JIRA_EMAIL || !JIRA_TOKEN) return res.status(400).json({ success: false, error: "JIRA not configured in .env" });
    const key = String(issueKey).toUpperCase().replace(/\s/g, "");
    const md = title ? `## ${title}\n\n${text}` : String(text);
    const r = await fetch(`${JIRA_URL}/rest/api/3/issue/${key}/comment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64"),
      },
      body: JSON.stringify(markdownToJiraAdf(md)),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ success: false, error: data.errorMessages?.[0] || r.statusText });
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
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text();
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
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER || "noreply@local",
      to,
      subject: subject || "AI Agents Output",
      text: bodyText,
      html: bodyHtml,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Score (GPT 5.4 / configurable model) ─────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const SCORE_MODEL = process.env.SCORE_MODEL || "gpt-4o";

app.post("/api/score", async (req, res) => {
  try {
    const { type, content, title } = req.body || {};
    if (!type || !content) return res.status(400).json({ success: false, error: "Missing type (prd|uat|brd|jira) or content" });
    if (!OPENAI_API_KEY) return res.status(400).json({ success: false, error: "OPENAI_API_KEY not set in .env for scoring" });
    const docType =
      type === "uat" ? "UAT Signoff" : type === "brd" ? "BRD" : type === "jira" ? "JIRA ticket" : "PRD";
    const systemPrompt = `You are an expert reviewer. Score the following ${docType} document on a scale of 1-10 (10 = excellent). Consider: completeness, clarity, compliance with NPCI/UPI norms, structure, and actionability. Respond with ONLY a JSON object: { "score": number, "maxScore": 10, "rationale": "2-3 sentence explanation" }. No other text.`;
    const userContent = (title ? `Document: ${title}\n\n` : "") + String(content).slice(0, 12000);
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: SCORE_MODEL,
        messages: [{ role: "user", content: systemPrompt + "\n\n" + userContent }],
        max_tokens: 400,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (data.error) return res.status(r.status || 500).json({ success: false, error: data.error.message || "OpenAI error" });
    const raw = data.choices?.[0]?.message?.content || "";
    let result;
    try {
      result = JSON.parse(raw.replace(/```json?\s*|\s*```/g, "").trim());
    } catch (_) {
      result = { score: 0, maxScore: 10, rationale: "Could not parse score from model." };
    }
    res.json({ success: true, ...result });
  } catch (err) {
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
      } catch (e) { results.push("email:" + e.message); }
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
        results.push(r.ok ? "slack:ok" : "slack:failed");
      } catch (e) { results.push("slack:" + e.message); }
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
        results.push(r.ok ? "whatsapp:ok" : "whatsapp:failed");
      } catch (e) { results.push("whatsapp:" + e.message); }
    }

    // Telegram
    if (TELEGRAM_BOT_TOKEN) {
      const tgChatId = process.env.TELEGRAM_NOTIFY_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";
      if (tgChatId) {
        try {
          const { ok, data } = await telegramApiSendMessage(tgChatId, `<b>${escapeTelegramHtml(subject)}</b>`, "HTML");
          results.push(ok && data.ok ? "telegram:ok" : "telegram:failed");
        } catch (e) { results.push("telegram:" + e.message); }
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
