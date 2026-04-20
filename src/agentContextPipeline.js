/**
 * Shared "history → /docs → LLM" preface for agents calling POST /api/generate
 * with { prefaceContext } (merged into system on the server).
 */

export async function fetchDocsKnowledge(apiBase, query) {
  const base = String(apiBase || "").replace(/\/$/, "");
  const r = await fetch(`${base}/api/context/knowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: String(query || "").slice(0, 4000) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.success === false) {
    return { text: "", filesUsed: [], error: d.error || `HTTP ${r.status}` };
  }
  return { text: d.text || "", filesUsed: d.filesUsed || [], error: d.error || null };
}

export function buildHistorySnippetBlock(title, lines) {
  const trimmed = (lines || []).map((s) => String(s || "").trim()).filter(Boolean).slice(0, 10);
  if (!trimmed.length) return "";
  return `${title}\n${trimmed.map((l) => `- ${l.replace(/\s+/g, " ").slice(0, 520)}`).join("\n")}`;
}

/**
 * @param {object} opts
 * @param {string} opts.apiBase
 * @param {string} opts.query
 * @param {string[]} [opts.historyLines]
 * @param {string[]} [opts.convLines]
 * @param {(s: { step: string, label: string }) => void} [opts.onStep]
 * @returns {Promise<string>}
 */
export async function buildAgentPrefaceContext(opts) {
  const { apiBase, query, historyLines = [], convLines = [], onStep } = opts;
  const q = String(query || "").slice(0, 4000);

  onStep?.({ step: "history", label: "Gathering prior session context…" });
  await new Promise((r) => setTimeout(r, 0));
  const hist = buildHistorySnippetBlock("### Prior sessions (saved in this browser)", historyLines);
  const conv = buildHistorySnippetBlock("### Recent conversation (this session)", convLines);

  onStep?.({ step: "docs", label: "Loading product docs from /docs…" });
  await new Promise((r) => setTimeout(r, 0));
  const { text: docsText } = await fetchDocsKnowledge(apiBase, q);

  onStep?.({ step: "llm", label: "Calling LLM…" });

  const parts = [];
  if (hist) parts.push(hist);
  if (conv) parts.push(conv);
  if (docsText?.trim()) parts.push(`### Product documentation (/docs, excerpt)\n${docsText.trim()}`);
  return parts.join("\n\n").slice(0, 11000);
}
