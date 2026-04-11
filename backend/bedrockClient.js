/**
 * AWS Bedrock for PRD/UAT/BRD/JIRA agents.
 *
 * Mode A — HTTP gateway (custom URL: API Gateway, Lambda Function URL, etc.):
 *   POST JSON { "model_id", "messages", "max_tokens" } + header x-api-key
 *   BEDROCK_INVOKE_URL + BEDROCK_API_KEY (or BEDROCK_INVOKE_API_KEY or BED_LLM_KEY)
 *   Model ids are sent as your gateway expects (often global.anthropic.*). Override via BEDROCK_PROFILE_* /
 *   BEDROCK_MODEL_ID. Native AWS SDK (Mode B) still uses ensureBedrockInferenceProfileId().
 *
 * Mode B — Native AWS SDK (Converse API):
 *   BEDROCK_MODEL_ID or BED_LLM_MODEL, AWS_REGION, credentials or BEDROCK_USE_DEFAULT_CREDENTIALS=true
 *
 * When both are set, the HTTP proxy is used.
 */
import fs from "node:fs";
import https from "node:https";
import fetch from "node-fetch";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

/** Optional file path for gateway debug NDJSON (set in env; never hardcode machine paths). */
function bedrockGatewayDebugLogPath() {
  return String(process.env.BEDROCK_GATEWAY_DEBUG_LOG || "").trim();
}

function agentDbg(location, message, data) {
  if (String(process.env.BEDROCK_GATEWAY_DEBUG || "").trim() === "1") {
    console.warn("[bedrock-gateway]", location, message, data);
  }
  const logPath = bedrockGatewayDebugLogPath();
  if (!logPath) return;
  try {
    fs.appendFileSync(
      logPath,
      JSON.stringify({
        location,
        message,
        data,
        timestamp: Date.now(),
      }) + "\n"
    );
  } catch {
    /* ignore missing dir / read-only FS */
  }
}

/**
 * Default model ids per Connectors tier. Lambda gateway example uses global.anthropic.* (see your curl).
 * Native AWS Converse path still runs ensureBedrockInferenceProfileId().
 * Override per tier: BEDROCK_PROFILE_SONNET, BEDROCK_PROFILE_OPUS, BEDROCK_PROFILE_HAIKU.
 */
export const BEDROCK_TIER_MODELS = {
  sonnet: "global.anthropic.claude-sonnet-4-6",
  opus: "global.anthropic.claude-opus-4-6",
  haiku: "global.anthropic.claude-haiku-4-6",
};

/** Map foundation-style ids to global inference profile ids when missing global./us./arn: prefix. */
export function ensureBedrockInferenceProfileId(modelId) {
  const s = String(modelId || "").trim();
  if (!s) return s;
  const lower = s.toLowerCase();
  if (
    lower.startsWith("global.") ||
    lower.startsWith("us.") ||
    lower.startsWith("eu.") ||
    lower.startsWith("apac.") ||
    lower.startsWith("arn:")
  ) {
    return s;
  }
  if (lower.startsWith("anthropic.claude-")) return `global.${s}`;
  if (lower.startsWith("claude-")) return `global.anthropic.${s}`;
  return s;
}

export function getBedrockEnv() {
  const region = String(process.env.AWS_REGION || process.env.BEDROCK_REGION || "ap-south-1").trim();
  const modelId = String(process.env.BEDROCK_MODEL_ID || process.env.BED_LLM_MODEL || "").trim();
  const accessKeyId = String(process.env.AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.AWS_SECRET_ACCESS_KEY || process.env.BED_LLM_KEY || "").trim();
  const useDefaultChain = String(process.env.BEDROCK_USE_DEFAULT_CREDENTIALS || "").toLowerCase() === "true";
  return { region, modelId, accessKeyId, secretAccessKey, useDefaultChain };
}

export function getBedrockHttpGatewayEnv() {
  const invokeUrl = String(process.env.BEDROCK_INVOKE_URL || "").trim();
  const apiKey = String(
    process.env.BEDROCK_API_KEY || process.env.BEDROCK_INVOKE_API_KEY || process.env.BED_LLM_KEY || ""
  ).trim();
  return { invokeUrl, apiKey };
}

export function isBedrockHttpGatewayConfigured() {
  const { invokeUrl, apiKey } = getBedrockHttpGatewayEnv();
  return !!(invokeUrl && apiKey);
}

export function isBedrockConfigured() {
  if (isBedrockHttpGatewayConfigured()) return true;
  const { modelId, accessKeyId, secretAccessKey, useDefaultChain } = getBedrockEnv();
  if (!modelId) return false;
  if (useDefaultChain) return true;
  return !!(accessKeyId && secretAccessKey);
}

/**
 * @param {{ modelFromBody?: string | null, bedrockModelTier?: string | null }} opts
 */
const TIER_PROFILE_ENV = {
  sonnet: "BEDROCK_PROFILE_SONNET",
  opus: "BEDROCK_PROFILE_OPUS",
  haiku: "BEDROCK_PROFILE_HAIKU",
};

export function resolveBedrockModelId({ modelFromBody, bedrockModelTier } = {}) {
  const tierRaw = String(bedrockModelTier || "").toLowerCase().trim();
  if (tierRaw === "opus" || tierRaw === "haiku" || tierRaw === "sonnet") {
    const envKey = TIER_PROFILE_ENV[tierRaw];
    const fromEnv = envKey ? String(process.env[envKey] || "").trim() : "";
    if (fromEnv) return fromEnv;
    return BEDROCK_TIER_MODELS[tierRaw];
  }
  const envId = String(process.env.BEDROCK_MODEL_ID || process.env.BED_LLM_MODEL || "").trim();
  if (envId) return envId;
  const mb = typeof modelFromBody === "string" ? modelFromBody.trim() : "";
  if (mb && /^(anthropic\.|claude-|global\.)/i.test(mb)) return mb;
  return BEDROCK_TIER_MODELS.sonnet;
}

function blockToPlainText(c) {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return String(c ?? "");
  return c
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object" && x.type === "text") return String(x.text ?? "");
      return String(x ?? "");
    })
    .join("");
}

function messagesForHttpGateway(messages, system) {
  const list = Array.isArray(messages) ? [...messages] : [];
  const normalized = list.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: blockToPlainText(m.content),
  }));
  const sys = String(system || "").trim();
  if (!sys) return normalized;
  const idx = normalized.findIndex((m) => m.role === "user");
  if (idx >= 0) {
    normalized[idx] = { ...normalized[idx], content: sys + "\n\n" + normalized[idx].content };
  } else if (normalized.length) {
    normalized[0] = { ...normalized[0], content: sys + "\n\n" + normalized[0].content };
  } else {
    normalized.push({ role: "user", content: sys });
  }
  return normalized;
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function maybeJsonValue(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || (!t.startsWith("{") && !t.startsWith("["))) return null;
  return tryParseJson(t);
}

/** Unwrap API Gateway / Lambda proxy: { statusCode, body: "<json string>" } */
function unwrapGatewayEnvelope(obj, depth = 0) {
  if (depth > 6 || obj == null || typeof obj !== "object") return obj;
  if (typeof obj.body === "string") {
    const inner = tryParseJson(obj.body);
    if (inner != null && typeof inner === "object") return unwrapGatewayEnvelope(inner, depth + 1);
    return obj;
  }
  if (obj.body && typeof obj.body === "object" && !Array.isArray(obj.body)) {
    return unwrapGatewayEnvelope(obj.body, depth + 1);
  }
  return obj;
}

/**
 * Parse raw HTTP response: single JSON, NDJSON first line, or SSE `data: {...}` lines.
 */
export function parseHttpGatewayResponseBody(raw) {
  const trimmed = String(raw || "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!trimmed) return null;
  let parsed = tryParseJson(trimmed);
  if (parsed == null) {
    const lines = trimmed.split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      const sse = t.startsWith("data:") ? t.slice(5).trim() : t;
      if (sse === "[DONE]") continue;
      parsed = tryParseJson(sse);
      if (parsed != null) break;
    }
  }
  if (parsed == null || typeof parsed !== "object") return parsed;
  return unwrapGatewayEnvelope(parsed);
}

function textFromContentBlocks(arr) {
  if (!Array.isArray(arr)) return "";
  return arr
    .map((b) => {
      if (typeof b === "string") return b;
      if (b && typeof b === "object") {
        if (b.type === "text" && b.text != null) return String(b.text);
        if (b.text != null) return String(b.text);
      }
      return "";
    })
    .filter(Boolean)
    .join("");
}

/**
 * Extract assistant text from common gateway shapes (OpenAI, Anthropic, Bedrock Converse, Lambda-wrapped).
 * @param {unknown} parsed
 * @param {number} depth
 */
export function extractHttpGatewayAssistantText(parsed, depth = 0) {
  if (depth > 10 || parsed == null) return "";
  if (typeof parsed === "string") return parsed;
  if (typeof parsed !== "object") return "";

  if (typeof parsed.text === "string") return parsed.text;
  if (typeof parsed.output_text === "string") return parsed.output_text;
  if (typeof parsed.completion === "string") return parsed.completion;
  if (typeof parsed.response === "string") return parsed.response;
  if (typeof parsed.answer === "string") return parsed.answer;
  if (typeof parsed.result === "string") return parsed.result;

  const msg = parsed.message;
  if (msg) {
    if (typeof msg === "string") return msg;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      const t = textFromContentBlocks(msg.content);
      if (t) return t;
    }
  }

  if (Array.isArray(parsed.content)) {
    const joined = textFromContentBlocks(parsed.content);
    if (joined) return joined;
  }

  const c0 = parsed.choices?.[0]?.message?.content ?? parsed.choices?.[0]?.text;
  if (typeof c0 === "string") return c0;
  if (Array.isArray(c0)) {
    const t = textFromContentBlocks(c0);
    if (t) return t;
  }

  const delta = parsed.choices?.[0]?.delta?.content;
  if (typeof delta === "string" && delta) return delta;
  if (Array.isArray(delta)) {
    const t = textFromContentBlocks(delta);
    if (t) return t;
  }

  const gemParts = parsed.candidates?.[0]?.content?.parts;
  if (Array.isArray(gemParts)) {
    const t = textFromContentBlocks(gemParts);
    if (t) return t;
  }

  const out = parsed.output?.message?.content;
  if (Array.isArray(out)) {
    const t = textFromContentBlocks(out);
    if (t) return t;
  }
  if (typeof out === "string") return out;

  if (typeof parsed.output === "string") return parsed.output;

  const outMsg = parsed.output?.message;
  if (outMsg && Array.isArray(outMsg.content)) {
    const t = textFromContentBlocks(outMsg.content);
    if (t) return t;
  }

  for (const key of ["data", "result", "response", "output", "payload", "body"]) {
    const v = parsed[key];
    if (v == null) continue;
    if (typeof v === "string") {
      const inner = maybeJsonValue(v);
      if (inner != null) {
        const t = extractHttpGatewayAssistantText(inner, depth + 1);
        if (String(t).trim()) return t;
      }
      const t = extractHttpGatewayAssistantText(v, depth + 1);
      if (String(t).trim()) return t;
    } else if (typeof v === "object") {
      const t = extractHttpGatewayAssistantText(v, depth + 1);
      if (String(t).trim()) return t;
    }
  }

  return "";
}

function isMultiChunkSseRaw(raw) {
  const m = String(raw || "").match(/^data:/gm);
  return m && m.length > 1;
}

/**
 * Sum assistant text from SSE / NDJSON streams (OpenAI-style delta chunks, etc.).
 */
function extractAggregatedStreamingAssistantText(raw) {
  const s = String(raw || "");
  if (!s.includes("\n")) return "";
  let acc = "";
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const payload = t.startsWith("data:") ? t.slice(5).trim() : t;
    if (!payload || payload === "[DONE]") continue;
    const chunk = tryParseJson(payload);
    if (chunk == null) continue;
    const piece = extractHttpGatewayAssistantText(chunk);
    const deltaStr =
      typeof chunk?.choices?.[0]?.delta?.content === "string" ? chunk.choices[0].delta.content : "";
    const part = String(piece || deltaStr || "");
    if (part) acc += part;
  }
  return acc.trim();
}

/**
 * node-fetch + https.Agent for the gateway. Node often fails with "unable to get local issuer certificate"
 * while curl works (macOS Keychain vs Node's CA bundle, corporate TLS inspection).
 * Default: skip certificate verification for this URL only (rejectUnauthorized: false).
 * Set BEDROCK_GATEWAY_REJECT_UNAUTHORIZED=true to verify (production with proper CA / NODE_EXTRA_CA_CERTS).
 * Legacy: BEDROCK_INSECURE_TLS=true forces skip verification even if REJECT_UNAUTHORIZED is set.
 */
function bedrockGatewayFetchInit(invokeUrl) {
  const timeoutMs = Math.min(Math.max(Number(process.env.BEDROCK_HTTP_TIMEOUT_MS) || 120000, 5000), 600000);
  let agent;
  try {
    const u = new URL(invokeUrl);
    if (u.protocol === "https:") {
      const wantVerify =
        String(process.env.BEDROCK_GATEWAY_REJECT_UNAUTHORIZED || "").toLowerCase() === "true";
      const legacyInsecure =
        String(process.env.BEDROCK_INSECURE_TLS || "").toLowerCase() === "true";
      const rejectUnauthorized = wantVerify && !legacyInsecure;
      agent = new https.Agent({ rejectUnauthorized });
    }
  } catch {
    /* invalid URL — fetch will throw */
  }
  let signal;
  try {
    signal = AbortSignal.timeout(timeoutMs);
  } catch {
    signal = undefined;
  }
  return { agent, signal };
}

async function invokeBedrockHttpGateway({ messages, system, maxTokens, modelId }) {
  const { invokeUrl, apiKey } = getBedrockHttpGatewayEnv();
  const httpMessages = messagesForHttpGateway(messages, system);
  const cappedMax = Math.min(Math.max(Number(maxTokens) || 4096, 1), 8192);
  const body = { model_id: modelId, messages: httpMessages, max_tokens: cappedMax };

  const { agent, signal } = bedrockGatewayFetchInit(invokeUrl);
  let res;
  try {
    res = await fetch(invokeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
      ...(agent ? { agent } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    const c = err?.cause;
    const detail = [err?.message, c?.code, c?.message].filter(Boolean).join(" | ");
    agentDbg("bedrockClient.js:invokeBedrockHttpGateway", "fetch_threw", {
      detail: String(detail).slice(0, 400),
      modelIdSuffix: String(modelId).slice(-40),
    });
    throw new Error(`Bedrock HTTP gateway network error: ${detail || String(err)}`);
  }
  const raw = await res.text();
  const parsed = parseHttpGatewayResponseBody(raw);

  if (!res.ok) {
    agentDbg("bedrockClient.js:invokeBedrockHttpGateway", "http_not_ok", {
      status: res.status,
      bodySnippetLen: Math.min(raw.length, 500),
      modelIdSuffix: String(modelId).slice(-40),
    });
    throw new Error(`Bedrock HTTP gateway ${res.status}: ${raw.slice(0, 500)}`);
  }

  let text = "";
  if (isMultiChunkSseRaw(raw)) {
    text = extractAggregatedStreamingAssistantText(raw);
  }
  if (!String(text).trim()) {
    text = extractHttpGatewayAssistantText(parsed);
  }
  if (!String(text).trim()) {
    text = extractAggregatedStreamingAssistantText(raw);
  }
  if (!String(text).trim() && parsed == null) {
    const plain = String(raw || "").trim();
    if (plain && !/^\s*[\[{]/.test(plain)) text = plain;
  }
  if (!String(text).trim()) {
    agentDbg("bedrockClient.js:invokeBedrockHttpGateway", "empty_assistant_text", {
      topKeys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
      rawHead: String(raw).slice(0, 280),
    });
    throw new Error("Bedrock HTTP gateway returned no assistant text");
  }

  agentDbg("bedrockClient.js:invokeBedrockHttpGateway", "success", {
    modelIdSuffix: String(modelId).slice(-24),
    textLen: text.length,
  });
  return {
    content: [{ type: "text", text }],
  };
}

function toBedrockMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((m) => {
    const role = m.role === "assistant" ? "assistant" : "user";
    let content;
    if (typeof m.content === "string") {
      content = [{ text: m.content }];
    } else if (Array.isArray(m.content)) {
      content = m.content.map((c) => {
        if (typeof c === "string") return { text: c };
        if (c && typeof c === "object" && c.type === "text") return { text: String(c.text ?? "") };
        return { text: String(c ?? "") };
      });
    } else {
      content = [{ text: String(m.content ?? "") }];
    }
    return { role, content };
  });
}

function extractConverseText(output) {
  const msg = output?.output?.message;
  const blocks = msg?.content;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((b) => (b && b.text != null ? String(b.text) : ""))
    .filter(Boolean)
    .join("");
}

/**
 * Returns Anthropic-shaped payload for existing agents: { content: [{ type: "text", text }] }
 * @param {{ messages: unknown[], system?: string, maxTokens?: number, modelId?: string | null, bedrockModelTier?: string | null }} opts
 */
export async function converseBedrock({ messages, system, maxTokens, modelId: modelOverride, bedrockModelTier }) {
  const resolved = resolveBedrockModelId({ modelFromBody: modelOverride, bedrockModelTier });
  const mid = isBedrockHttpGatewayConfigured()
    ? String(resolved || "").trim()
    : ensureBedrockInferenceProfileId(resolved);
  if (!mid) throw new Error("Missing Bedrock model id");

  if (isBedrockHttpGatewayConfigured()) {
    return invokeBedrockHttpGateway({ messages, system, maxTokens, modelId: mid });
  }

  const { region, accessKeyId, secretAccessKey, useDefaultChain } = getBedrockEnv();
  const clientConfig = { region };
  if (!useDefaultChain && accessKeyId && secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey,
      ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
    };
  }

  const client = new BedrockRuntimeClient(clientConfig);
  const bedrockMessages = toBedrockMessages(messages);
  const cappedMax = Math.min(Math.max(Number(maxTokens) || 4096, 1), 8192);

  const input = {
    modelId: mid,
    messages: bedrockMessages,
    inferenceConfig: { maxTokens: cappedMax },
  };
  if (system && String(system).trim()) {
    input.system = [{ text: String(system).trim() }];
  }

  const out = await client.send(new ConverseCommand(input));
  const text = extractConverseText(out);
  return {
    content: [{ type: "text", text }],
  };
}

let readinessProbeStarted = false;

/** Last Bedrock readiness result for GET /api/connectors/status */
export const bedrockHealth = {
  configured: false,
  ok: null,
  error: null,
  at: null,
};

async function executeBedrockReadinessProbe({ logStartup }) {
  bedrockHealth.configured = isBedrockConfigured();
  if (!isBedrockConfigured()) {
    bedrockHealth.ok = false;
    bedrockHealth.error = "Not configured — set BEDROCK_INVOKE_URL + API key, or native Bedrock env (see .env.example)";
    bedrockHealth.at = Date.now();
    if (logStartup) {
      console.log(
        "[bedrock] not configured — set BEDROCK_INVOKE_URL + BEDROCK_API_KEY (or BED_LLM_KEY), or native: BEDROCK_MODEL_ID, AWS_REGION, credentials / BEDROCK_USE_DEFAULT_CREDENTIALS. See .env.example."
      );
    }
    return;
  }
  const http = isBedrockHttpGatewayConfigured();
  const env = getBedrockEnv();
  if (logStartup) {
    if (http) {
      console.log("[bedrock] mode=http-gateway url configured=", !!getBedrockHttpGatewayEnv().invokeUrl);
    } else {
      console.log(
        "[bedrock] mode=aws-sdk region=",
        env.region,
        "model=",
        env.modelId,
        "auth=",
        env.useDefaultChain ? "default credential chain" : "explicit access key"
      );
    }
  }
  try {
    if (logStartup) console.log("[bedrock] running readiness probe…");
    const data = await converseBedrock({
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      system: "You are a health check. Reply with exactly: OK",
      maxTokens: 16,
      bedrockModelTier: "sonnet",
    });
    const t = data?.content?.[0]?.text?.trim() || "";
    if (logStartup) console.log("[bedrock] readiness probe succeeded; sample:", JSON.stringify(t.slice(0, 80)));
    bedrockHealth.ok = true;
    bedrockHealth.error = null;
    bedrockHealth.at = Date.now();
  } catch (e) {
    console.error("[bedrock] readiness probe failed:", e.message || e);
    bedrockHealth.ok = false;
    bedrockHealth.error = e?.message || String(e);
    bedrockHealth.at = Date.now();
  }
}

export async function runBedrockReadinessProbe() {
  if (readinessProbeStarted) return;
  readinessProbeStarted = true;
  console.log("[bedrock] startup: checking configuration…");
  await executeBedrockReadinessProbe({ logStartup: true });
}

/** Re-run Bedrock probe (e.g. Connectors refresh). */
export async function rerunBedrockReadinessProbe() {
  await executeBedrockReadinessProbe({ logStartup: false });
}
