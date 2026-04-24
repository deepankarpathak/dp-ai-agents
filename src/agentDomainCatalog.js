/**
 * Shared domain catalog for UAT / JIRA / BRD agents.
 * Maps each domain to JIRA project key, component (create API), site (finmate vs mypaytm), and optional issue labels.
 */

export const JIRA_SITE_FINMATE_URL = "https://finmate.atlassian.net";
export const JIRA_SITE_MYPAYTM_URL = "https://mypaytm.atlassian.net";

/** @typedef {"finmate" | "mypaytm"} JiraSiteKind */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   full: string,
 *   icon: string,
 *   color: string,
 *   jiraProjectKey: string,
 *   jiraComponent: string,
 *   jiraSite: JiraSiteKind,
 *   issueLabels?: string[],
 * }} AgentDomainEntry
 */

/** @type {AgentDomainEntry[]} */
export const AGENT_DOMAIN_ENTRIES = [
  { id: "pms", label: "PMS", full: "Profile Management System", icon: "👤", color: "#60a5fa", jiraProjectKey: "TSP", jiraComponent: "PMS", jiraSite: "finmate", issueLabels: ["PMS"] },
  { id: "payout", label: "Payout", full: "Payout", icon: "💸", color: "#34d399", jiraProjectKey: "TSP", jiraComponent: "Payout", jiraSite: "finmate", issueLabels: ["Payout"] },
  { id: "refunds", label: "Refunds", full: "Refunds", icon: "↩️", color: "#f87171", jiraProjectKey: "TSP", jiraComponent: "Refunds", jiraSite: "finmate", issueLabels: ["Refund"] },
  { id: "mandates", label: "Mandates", full: "Mandates", icon: "📜", color: "#f472b6", jiraProjectKey: "TSP", jiraComponent: "UPI_2.0_Man", jiraSite: "finmate", issueLabels: ["mandate"] },
  { id: "switch", label: "Switch", full: "Transactional Switch", icon: "🔀", color: "#e8b84b", jiraProjectKey: "TSP", jiraComponent: "Switch", jiraSite: "finmate", issueLabels: ["Transaction"] },
  { id: "compliance", label: "Compliance", full: "Compliance", icon: "🛡️", color: "#fbbf24", jiraProjectKey: "TSP", jiraComponent: "Compliance", jiraSite: "finmate", issueLabels: ["ComplianceService"] },
  { id: "reconciliation", label: "Reconciliation", full: "Reconciliation", icon: "⚖️", color: "#a78bfa", jiraProjectKey: "TSP", jiraComponent: "Recon", jiraSite: "finmate", issueLabels: ["Recon"] },
  { id: "hss", label: "HSS", full: "HSS", icon: "🔧", color: "#94a3b8", jiraProjectKey: "TPAP", jiraComponent: "", jiraSite: "mypaytm", issueLabels: ["HSS"] },
  { id: "hms", label: "HMS", full: "HMS", icon: "🏥", color: "#38bdf8", jiraProjectKey: "PCO", jiraComponent: "HMS", jiraSite: "mypaytm", issueLabels: ["HMS"] },
  { id: "passbook", label: "Passbook", full: "Passbook", icon: "📒", color: "#22d3ee", jiraProjectKey: "PCO", jiraComponent: "Passbook", jiraSite: "mypaytm", issueLabels: ["Passbook"] },
  { id: "gateway", label: "Gateway", full: "Gateway", icon: "🌐", color: "#818cf8", jiraProjectKey: "TPAP", jiraComponent: "Switch-GW", jiraSite: "mypaytm", issueLabels: ["Gateway"] },
  { id: "pps", label: "PPS", full: "PPS", icon: "📮", color: "#c084fc", jiraProjectKey: "TPAP", jiraComponent: "TPAP-Post-Payment", jiraSite: "mypaytm", issueLabels: ["PPS"] },
  { id: "tpap_switch", label: "TPAP Switch", full: "TPAP Switch", icon: "🔁", color: "#eab308", jiraProjectKey: "TPAP", jiraComponent: "Switch", jiraSite: "mypaytm", issueLabels: ["TPAP", "Switch"] },
  { id: "tpap_pms", label: "TPAP PMS", full: "TPAP PMS", icon: "👥", color: "#3b82f6", jiraProjectKey: "TPAP", jiraComponent: "PMS", jiraSite: "mypaytm", issueLabels: ["TPAP", "PMS"] },
  { id: "tpap_mandates", label: "TPAP Mandates", full: "TPAP Mandates", icon: "📋", color: "#ec4899", jiraProjectKey: "TPAP", jiraComponent: "UPI_2.0_Man", jiraSite: "mypaytm", issueLabels: ["TPAP", "mandate"] },
  { id: "config_updates", label: "Config Updates", full: "Config Updates", icon: "⚙️", color: "#64748b", jiraProjectKey: "CU", jiraComponent: "UPI", jiraSite: "mypaytm", issueLabels: ["Config"] },
  { id: "app_common", label: "App Common", full: "App Common", icon: "📱", color: "#2dd4bf", jiraProjectKey: "CAPP", jiraComponent: "UPI-H5", jiraSite: "mypaytm", issueLabels: ["CAPP"] },
  { id: "ios_app", label: "iOS App", full: "iOS App", icon: "📲", color: "#a1a1aa", jiraProjectKey: "CAI", jiraComponent: "UPI", jiraSite: "mypaytm", issueLabels: ["iOS"] },
  { id: "android_app", label: "Android App", full: "Android App", icon: "🤖", color: "#4ade80", jiraProjectKey: "CA", jiraComponent: "UPI", jiraSite: "mypaytm", issueLabels: ["Android"] },
  { id: "h5_changes", label: "H5 Changes", full: "H5 Changes", icon: "🖥️", color: "#fb923c", jiraProjectKey: "H5", jiraComponent: "TPAP-H5", jiraSite: "mypaytm", issueLabels: ["H5"] },
  { id: "combination", label: "Combination", full: "Combination", icon: "🔗", color: "#fb923c", jiraProjectKey: "PCO", jiraComponent: "Combination", jiraSite: "mypaytm", issueLabels: ["Combination"] },
];

const ENTRY_BY_ID = Object.fromEntries(AGENT_DOMAIN_ENTRIES.map((e) => [e.id, e]));

/** @param {string[]} domainIds */
export function getAgentDomainEntries(domainIds) {
  return (domainIds || []).map((id) => ENTRY_BY_ID[id]).filter(Boolean);
}

/** @param {string[]} domainIds @returns {string | undefined} */
export function jiraBaseUrlForDomains(domainIds) {
  const entries = getAgentDomainEntries(domainIds);
  if (!entries.length) return undefined;
  return entries[0].jiraSite === "finmate" ? JIRA_SITE_FINMATE_URL : JIRA_SITE_MYPAYTM_URL;
}

/** @param {string[]} domainIds */
export function domainsHaveMixedJiraSites(domainIds) {
  const sites = new Set(getAgentDomainEntries(domainIds).map((e) => e.jiraSite));
  return sites.size > 1;
}

/** First selected domain’s JIRA project key (Set/array order preserved by caller). @param {string[]} domainIds */
export function projectKeyFromDomains(domainIds) {
  const first = getAgentDomainEntries(domainIds)[0];
  return first?.jiraProjectKey || "";
}

/** Distinct JIRA component names for create (non-empty). @param {string[]} domainIds @returns {{ name: string }[]} */
export function jiraComponentsForDomainIds(domainIds) {
  const names = new Set();
  for (const e of getAgentDomainEntries(domainIds)) {
    const c = String(e.jiraComponent || "").trim();
    if (c) names.add(c);
  }
  return [...names].map((name) => ({ name }));
}

/** Flat string list for POST body `components`. @param {string[]} domainIds */
export function jiraComponentNamesForDomainIds(domainIds) {
  return jiraComponentsForDomainIds(domainIds).map((x) => x.name);
}

/** @param {string[]} domainIds @returns {string[]} */
export function issueLabelsForJiraCreate(domainIds) {
  const out = new Set();
  for (const e of getAgentDomainEntries(domainIds)) {
    (e.issueLabels || []).forEach((l) => out.add(l));
  }
  return [...out];
}

/** Labels for notify email / display. @param {string[]} domainIds */
export function domainLabelsForDisplay(domainIds) {
  return getAgentDomainEntries(domainIds).map((e) => e.label);
}

/** Map legacy single domain string (label or id) from history to catalog ids. */
/** Restore selection from UAT history `domains: string[]` (labels). */
export function domainIdsFromLabels(labels) {
  const legacyLabelToId = { Refund: "refunds", "All Services": "switch" };
  const ids = [];
  for (const lab of Array.isArray(labels) ? labels : []) {
    const mapped = legacyLabelToId[lab];
    if (mapped) {
      ids.push(mapped);
      continue;
    }
    const e = AGENT_DOMAIN_ENTRIES.find((x) => x.label === lab);
    if (e) ids.push(e.id);
  }
  return ids.length ? [...new Set(ids)] : ["switch"];
}

export function domainIdsFromLegacyDomainField(domainField) {
  const s = String(domainField || "").trim();
  if (!s) return ["switch"];
  const parts = s.split(/[,·|]/).map((x) => x.trim()).filter(Boolean);
  const ids = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    const byId = AGENT_DOMAIN_ENTRIES.find((e) => e.id === lower || e.id === p);
    const byLabel = AGENT_DOMAIN_ENTRIES.find((e) => e.label === p || e.label.toLowerCase() === lower);
    if (byId) ids.push(byId.id);
    else if (byLabel) ids.push(byLabel.id);
  }
  const uniq = [...new Set(ids)];
  if (uniq.length) return uniq;
  if (/^all\b/i.test(s)) return AGENT_DOMAIN_ENTRIES.map((e) => e.id);
  return ["switch"];
}

/** Normalize history / API domain ids to known catalog ids (drops unknown). */
export function sanitizeDomainIds(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  if (list.includes("all")) return AGENT_DOMAIN_ENTRIES.map((e) => e.id);
  const known = new Set(AGENT_DOMAIN_ENTRIES.map((e) => e.id));
  const out = list.filter((id) => known.has(id));
  return out.length ? out : ["switch"];
}
