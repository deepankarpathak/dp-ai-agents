/**
 * Shared copy for JIRA connector success (UAT / PRD / BRD / JIRA agents).
 * Backend: status, devAssignee, qaAssignee, components, qaTestCaseSheetUrls (In UAT), attachmentItems.
 */

export function jiraFetchTwoLines(d) {
  if (!d || typeof d !== "object") {
    return { line1: "", line2: "" };
  }
  const st = d.status != null && String(d.status).trim() ? String(d.status).trim() : "—";
  const dev = d.devAssignee != null && String(d.devAssignee).trim() ? String(d.devAssignee).trim() : "—";
  const qa = d.qaAssignee != null && String(d.qaAssignee).trim() ? String(d.qaAssignee).trim() : "—";
  const comp = d.components != null && String(d.components).trim() ? String(d.components).trim() : "—";
  return {
    line1: "✓ JIRA fetched — subject & description filled below",
    line2: `✓ Status: ${st}, Dev: ${dev}, QA: ${qa}, Component: ${comp}`,
  };
}
