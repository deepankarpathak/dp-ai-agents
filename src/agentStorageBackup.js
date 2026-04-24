/**
 * Keys used by PRD / UAT / BRD / JIRA agents for history & connector defaults.
 * Browsers isolate localStorage by origin — http://localhost:3000 vs http://127.0.0.1:3000
 * are different; export from one and import on the other to migrate.
 */
export const AGENT_LOCAL_STORAGE_KEYS = [
  "prd-history-v3",
  "prd-feedback-memory-v1",
  "uat-sentinel-history-v1",
  "uat-feedback-memory-v1",
  "brdforge-history-v2",
  "brdforge-feedback-memory",
  "jira-agent-history-v1",
  "publish-defaults-v1",
  "agent-run-artifacts-v1",
];

export function collectAgentLocalStorage() {
  const out = {};
  for (const k of AGENT_LOCAL_STORAGE_KEYS) {
    try {
      const v = localStorage.getItem(k);
      if (v != null) out[k] = v;
    } catch {
      /* quota / private mode */
    }
  }
  return {
    ...out,
    _agentBackup: {
      version: 1,
      exportedAt: new Date().toISOString(),
      origin: typeof window !== "undefined" ? window.location.origin : "",
    },
  };
}

/** @param {Record<string, unknown>} data */
export function applyAgentLocalStorageImport(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid backup file.");
  }
  let count = 0;
  for (const k of AGENT_LOCAL_STORAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
    let v = data[k];
    if (v == null) continue;
    if (typeof v === "object") v = JSON.stringify(v);
    else if (typeof v !== "string") v = String(v);
    try {
      localStorage.setItem(k, v);
      count += 1;
    } catch (e) {
      throw new Error(`Could not write ${k}: ${e?.message || e}`);
    }
  }
  return count;
}

export function downloadAgentBackupJson() {
  const payload = collectAgentLocalStorage();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `prd-agent-browser-backup-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
