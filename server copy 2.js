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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();

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

const pdfText = await extractTextFromPDF(
  "./docs/International_Inward_Remittance_TSD.pdf"
);

console.log(pdfText.substring(0,500));

const LLM_URL = "https://tfy.internal.ap-south-1.production.apps.pai.mypaytm.com/api/llm/messages";
const LLM_MODEL = process.env.LLM_MODEL;
const LLM_API_KEY = process.env.LLM_KEY_API || process.env.LLM_API_KEY;


const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.post("/api/generate", async (req, res) => {
  try {

    console.log("Incoming request:", req.body);

    if (!LLM_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "MISSING_API_KEY",
        message: "Set LLM_KEY_API (preferred) or LLM_API_KEY in .env",
      });
    }

    const incomingMessages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    const incomingSystem = typeof req.body?.system === "string" ? req.body.system : null;
    const incomingMaxTokens =
      typeof req.body?.max_tokens === "number" ? req.body.max_tokens : 2000;

    const messages = incomingMessages?.length
      ? incomingMessages
      : [
          {
            role: "user",
            content: req.body?.prompt || "Generate PRD",
          },
        ];

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
          ...(authMode === "x-api-key"
            ? { "x-api-key": LLM_API_KEY }
            : { Authorization: `Bearer ${LLM_API_KEY}` }),
        },
        body: JSON.stringify(requestBody),
      });

    console.log("[LLM] Calling LLM server (Internet):", LLM_URL);
    console.log("[LLM] Request: POST, model:", LLM_MODEL, "| messages:", messages.length);

    let authMode = "x-api-key";
    let response = await doCall(authMode);
    if (response.status === 401) {
      authMode = "bearer";
      response = await doCall(authMode);
    }

    const responseText = await response.text();

    console.log("[LLM] Response received from LLM server: status", response.status, "| body length:", responseText.length);

console.log("----- LLM CONFIGURATION -----");
console.log("LLM URL   :", LLM_URL);
console.log("LLM MODEL :", LLM_MODEL);
console.log("LLM KEY   :", LLM_API_KEY ? "Loaded ✅" : "Missing ❌");
console.log("------------------------------");

    console.log("LLM STATUS:", response.status);
    console.log("LLM RAW RESPONSE:", responseText);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "LLM_GATEWAY_ERROR",
        status: response.status,
        message: responseText
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(responseText);
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "INVALID_JSON_FROM_LLM",
        message: responseText
      });
    }

    res.json({
      success: true,
      data: parsed
    });

  } catch (error) {

    console.error("SERVER ERROR:", error);

    res.status(500).json({
      success: false,
      error: "SERVER_EXCEPTION",
      message: error.message
    });

  }
});

// BRD Agent (BRDForge) — same API/token/model as PRD & UAT; returns raw gateway shape so BRD’s d.content works
app.post("/api/claude", async (req, res) => {
  try {
    if (!LLM_API_KEY) {
      return res.status(500).json({ error: { message: "Set LLM_KEY_API or LLM_API_KEY in .env" } });
    }
    const incomingMessages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    const incomingSystem = typeof req.body?.system === "string" ? req.body.system : null;
    const incomingMaxTokens = typeof req.body?.max_tokens === "number" ? req.body.max_tokens : 4000;
    const messages = incomingMessages?.length
      ? incomingMessages
      : [{ role: "user", content: req.body?.prompt || "" }];
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
    console.log("[LLM] BRD /api/claude →", LLM_URL);
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
    jiraConfigured: false,
    jiraUrl: "",
    jiraEmail: "",
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

    const doc = new Document({
      sections: [{ children }],
    });
    const buffer = await Packer.toBuffer(doc);

    if (!fs.existsSync(PRD_OUTPUT_DIR)) {
      fs.mkdirSync(PRD_OUTPUT_DIR, { recursive: true });
    }
    const outPath = path.join(PRD_OUTPUT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log("[PRD] Exported DOCX to", outPath);

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

app.listen(5000, () => {
  console.log("AI proxy server running on port 5000");
});