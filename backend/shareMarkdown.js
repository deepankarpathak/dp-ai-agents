/**
 * Lightweight markdown → HTML / Slack mrkdwn / Jira ADF / Telegram HTML
 * (covers headings, lists, bold, italic, inline code, paragraphs, hr.)
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeTelegramHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline **bold**, *italic* (single asterisk word), `code` */
function inlineToHtml(str) {
  let s = escapeHtml(str);
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code style="background:#1e293b;padding:2px 6px;border-radius:4px;font-family:monospace">${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return s;
}

export function markdownToEmailHtml(md) {
  const lines = String(md || "").split(/\n/);
  const out = [];
  let inUl = false;
  const closeUl = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
  };
  for (const line of lines) {
    const hr = /^[-*_]{3,}\s*$/.test(line.trim());
    if (hr) {
      closeUl();
      out.push("<hr style=\"border:none;border-top:1px solid #334155;margin:16px 0\" />");
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeUl();
      const level = Math.min(h[1].length, 6);
      out.push(`<h${level} style="color:#e8b84b;margin:8px 0 4px;font-family:Segoe UI,sans-serif">${inlineToHtml(h[2])}</h${level}>`);
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (!inUl) {
        out.push('<ul style="margin:8px 0;padding-left:20px;color:#e2e8f0">');
        inUl = true;
      }
      out.push(`<li style="margin:4px 0">${inlineToHtml(ul[1])}</li>`);
      continue;
    }
    closeUl();
    if (!line.trim()) {
      out.push("<br/>");
      continue;
    }
    out.push(`<p style="margin:6px 0;line-height:1.6;color:#cbd5e1;font-size:14px">${inlineToHtml(line)}</p>`);
  }
  closeUl();
  return `<div style="font-family:Segoe UI,Helvetica,sans-serif;background:#0f172a;padding:16px;border-radius:8px">${out.join("\n")}</div>`;
}

/** Telegram HTML (subset); chunks returned if over maxLen */
export function markdownToTelegramChunks(md, maxLen = 3900) {
  const lines = String(md || "").split(/\n/);
  const parts = [];
  let cur = "";
  const pushLine = (htmlLine) => {
    if ((cur + htmlLine).length > maxLen && cur.length > 0) {
      parts.push(cur);
      cur = "";
    }
    cur += htmlLine + "\n";
  };
  for (const line of lines) {
    const hr = /^[-*_]{3,}\s*$/.test(line.trim());
    if (hr) {
      pushLine("");
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) pushLine(`<b>${escapeTelegramHtml(h[2])}</b>`);
    else if (/^[-*]\s+/.test(line)) pushLine(`• ${escapeTelegramHtml(line.replace(/^[-*]\s+/, ""))}`);
    else if (!line.trim()) pushLine("");
    else {
      let t = escapeTelegramHtml(line);
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      pushLine(t);
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts.filter(Boolean);
}

function mdToSlackMrkdwnLine(line) {
  if (/^#{1,6}\s+/.test(line)) return `*${line.replace(/^#+\s+/, "").trim()}*`;
  if (/^[-*]\s+/.test(line)) return `• ${line.replace(/^[-*]\s+/, "")}`;
  let s = line.replace(/\*\*([^*]+)\*\*/g, "*$1*").replace(/`([^`]+)`/g, "`$1`");
  return s;
}

export function markdownToSlackPayload(title, md) {
  const safeTitle = title ? String(title).replace(/\*/g, "⋆") : "";
  const header = safeTitle ? `*${safeTitle}*\n\n` : "";
  const body = String(md || "")
    .split("\n")
    .map(mdToSlackMrkdwnLine)
    .join("\n");
  const combined = (header + body).slice(0, 38000);
  const chunks = chunkString(combined, 2900).slice(0, 45);
  return {
    blocks: chunks.map((c) => ({
      type: "section",
      text: { type: "mrkdwn", text: c },
    })),
  };
}

function chunkString(s, size) {
  const arr = [];
  for (let i = 0; i < s.length; i += size) arr.push(s.slice(i, i + size));
  return arr;
}

/** Parse **bold** in a line to Jira ADF inline nodes */
function jiraInlineNodes(text) {
  const t = text ?? "";
  if (!t.includes("**")) return [{ type: "text", text: t }];
  const nodes = [];
  const parts = t.split(/\*\*/);
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    if (i % 2 === 1) nodes.push({ type: "text", text: parts[i], marks: [{ type: "strong" }] });
    else nodes.push({ type: "text", text: parts[i] });
  }
  return nodes.length ? nodes : [{ type: "text", text: t }];
}

export function markdownToJiraAdf(md) {
  const maxLen = 32000;
  const text = String(md || "").slice(0, maxLen);
  const lines = text.split("\n");
  const content = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      content.push({ type: "paragraph", content: [{ type: "text", text: "—" }] });
      i++;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      content.push({
        type: "heading",
        attrs: { level: Math.min(h[1].length, 6) },
        content: jiraInlineNodes(h[2]),
      });
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^[-*]\s+/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: jiraInlineNodes(itemText) }],
        });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }
    content.push({ type: "paragraph", content: jiraInlineNodes(line) });
    i++;
  }
  if (!content.length) content.push({ type: "paragraph", content: [{ type: "text", text: "(empty)" }] });
  return { body: { type: "doc", version: 1, content } };
}
