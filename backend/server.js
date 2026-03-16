import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import mammoth from "mammoth";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import { extractTextFromPDF } from "./pdfParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from backend/ or repo root (for cloud, env vars are often set by platform)
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const PRD_OUTPUT_DIR = path.join(__dirname, "prd-output");
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
    const incomingSystem = typeof req.body?.system === "string" ? req.body.system : null;
    const incomingMaxTokens = typeof req.body?.max_tokens === "number" ? req.body.max_tokens : 2000;
    const messages = incomingMessages?.length ? incomingMessages : [{ role: "user", content: req.body?.prompt || "Generate PRD" }];
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
