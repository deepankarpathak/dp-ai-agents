/**
 * Persist per-day LLM usage by agent app (PRD, BRD, JIRA, UAT, ANALYST) and provider.
 * File: backend/data/llm-usage-daily.json (created on first write).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FILE = path.join(__dirname, "data", "llm-usage-daily.json");

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function readAll() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const raw = fs.readFileSync(FILE, "utf8");
    const j = JSON.parse(raw);
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

/**
 * @param {{ agent?: string, provider?: string, model?: string, promptTokens?: number, completionTokens?: number }} evt
 */
function recordAgentDayUsage(evt) {
  const day = dayKey();
  const agent = String(evt.agent || "unknown").slice(0, 40) || "unknown";
  const provider = String(evt.provider || "unknown").slice(0, 32);
  const model = String(evt.model || "default").slice(0, 200);
  const pt = Math.max(0, Math.floor(Number(evt.promptTokens) || 0));
  const ct = Math.max(0, Math.floor(Number(evt.completionTokens) || 0));

  const all = readAll();
  if (!all[day]) all[day] = {};
  if (!all[day][agent]) all[day][agent] = {};
  if (!all[day][agent][provider]) {
    all[day][agent][provider] = {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      byModel: {},
    };
  }
  const rec = all[day][agent][provider];
  rec.calls += 1;
  rec.promptTokens += pt;
  rec.completionTokens += ct;
  if (!rec.byModel[model]) {
    rec.byModel[model] = { calls: 0, promptTokens: 0, completionTokens: 0 };
  }
  rec.byModel[model].calls += 1;
  rec.byModel[model].promptTokens += pt;
  rec.byModel[model].completionTokens += ct;

  writeAll(all);
}

/**
 * Last N calendar days (UTC) that have keys, merged with empty days.
 * @param {number} daysBack
 */
function getDailySummary(daysBack = 8) {
  const all = readAll();
  const out = {};
  const today = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const k = d.toISOString().slice(0, 10);
    out[k] = all[k] || {};
  }
  return out;
}

export { recordAgentDayUsage, getDailySummary, dayKey };
