import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOCS_DIR = path.join(__dirname, "..", "docs");
const MAX_TOTAL_CHARS = 12000;
const MAX_FILE_CHARS = 8000;

function tokenize(q) {
  return String(q || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((t) => t.length >= 3);
}

function scoreText(text, tokens) {
  const lower = text.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (lower.includes(t)) s += t.length > 6 ? 3 : 1;
  }
  return s;
}

/**
 * Load markdown from repo /docs and return a bounded excerpt relevant to `query`.
 * Prioritizes "UPI knowledge" style filenames, then token overlap.
 */
export async function buildDocsKnowledgeContext(query) {
  const tokens = tokenize(query);
  let files = [];
  try {
    const names = await fs.readdir(DOCS_DIR);
    files = names.filter((n) => /\.md$/i.test(n));
  } catch {
    return { text: "", filesUsed: [], error: "docs folder not readable" };
  }

  if (!files.length) {
    return { text: "", filesUsed: [], error: "no markdown files in docs/" };
  }

  const prioritized = [...files].sort((a, b) => {
    const pa = /upi/i.test(a) ? 1 : 0;
    const pb = /upi/i.test(b) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return a.localeCompare(b);
  });

  const chunks = [];
  const filesUsed = [];
  let total = 0;

  for (const name of prioritized) {
    if (total >= MAX_TOTAL_CHARS) break;
    let raw = "";
    try {
      raw = await fs.readFile(path.join(DOCS_DIR, name), "utf8");
    } catch {
      continue;
    }
    const slice = raw.slice(0, MAX_FILE_CHARS);
    const header = `### ${name}\n`;
    const body =
      tokens.length > 0
        ? pickRelevantExcerpt(slice, tokens, Math.min(6000, MAX_TOTAL_CHARS - total - header.length))
        : slice.slice(0, Math.min(4000, MAX_TOTAL_CHARS - total - header.length));
    const block = `${header}${body}\n`;
    if (block.length + total > MAX_TOTAL_CHARS) break;
    chunks.push(block);
    filesUsed.push(name);
    total += block.length;
  }

  const text = chunks.join("\n").trim();
  return { text, filesUsed };
}

function pickRelevantExcerpt(text, tokens, maxLen) {
  const lines = text.split(/\r?\n/);
  const scored = lines.map((line, i) => ({
    i,
    line,
    s: scoreText(line, tokens),
  }));
  scored.sort((a, b) => b.s - a.s);
  const picked = new Set();
  for (const row of scored) {
    if (row.s > 0) picked.add(row.i);
    if (picked.size >= 80) break;
  }
  if (picked.size === 0) {
    return text.slice(0, maxLen);
  }
  const ranges = [];
  for (const i of picked) {
    ranges.push([Math.max(0, i - 2), Math.min(lines.length - 1, i + 2)]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    if (!merged.length || r[0] > merged[merged.length - 1][1] + 1) {
      merged.push([...r]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    }
  }
  let out = "";
  for (const [a, b] of merged) {
    out += lines.slice(a, b + 1).join("\n") + "\n\n";
    if (out.length >= maxLen) break;
  }
  return out.slice(0, maxLen);
}
