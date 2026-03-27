/**
 * Subject / notify line: <JIRAID>-<UAT|PRD|BRD|JIRA>-<JIRA-Subject>-<ISO-timestamp>
 * @param {'uat'|'prd'|'brd'|'jira'} docType
 * @param {string} [jiraKey] — e.g. TSP-1889
 * @param {string} [title] — JIRA subject or feature title
 */
export function buildShareSubjectLine(docType, jiraKey, title) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const jidRaw = String(jiraKey || "")
    .trim()
    .toUpperCase()
    .replace(/\s/g, "");
  const jid = /^[A-Z][A-Z0-9]*-\d+$/.test(jidRaw) ? jidRaw : "NOJIRA";
  const dt = String(docType || "DOC").toUpperCase();
  let sub = String(title || "Output").trim();
  sub = sub.replace(/^([A-Z][A-Z0-9]*-\d+)\s*[—:-]\s*/i, "").trim();
  sub = sub
    .replace(/[/\\?%*:|"<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Output";
  sub = sub.replace(/\s+/g, "-");
  return `${jid}-${dt}-${sub}-${ts}`;
}
