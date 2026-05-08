import { jiraFetchTwoLines } from "./jiraFetchHelpers.js";

/**
 * Two-line JIRA fetch confirmation + QA sheet links (In UAT) + attachment download links.
 * @param {object} props.data - API /api/jira-issue response (or null)
 * @param {React.CSSProperties} [props.lineStyle]
 * @param {React.CSSProperties} [props.linkStyle]
 */
export default function JiraConnectorFetchSummary({ data, lineStyle = {}, linkStyle = {} }) {
  if (!data) return null;
  const { line1, line2 } = jiraFetchTwoLines(data);
  const sheets = Array.isArray(data.qaTestCaseSheetUrls) ? data.qaTestCaseSheetUrls : [];
  const refs = Array.isArray(data.attachmentItems) ? data.attachmentItems : [];

  const baseLine = {
    color: "#22c55e",
    fontWeight: 600,
    lineHeight: 1.5,
    ...lineStyle,
  };
  const baseLink = {
    color: "#60a5fa",
    fontWeight: 600,
    marginRight: 12,
    ...linkStyle,
  };

  return (
    <div style={{ lineHeight: 1.55 }}>
      <div style={baseLine}>{line1}</div>
      <div style={{ ...baseLine, marginTop: 4 }}>{line2}</div>
      {sheets.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12 }}>
          QA test cases:{" "}
          {sheets.map((href, i) => (
            <a key={i} href={href} target="_blank" rel="noopener noreferrer" style={baseLink}>
              Google Sheet {sheets.length > 1 ? i + 1 : "link"}
            </a>
          ))}
        </div>
      )}
      {refs.length > 0 && (
        <div style={{ marginTop: sheets.length > 0 ? 14 : 10, fontSize: 12 }}>
          Reference docs:{" "}
          {refs.map((a, i) => (
            <span key={i}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" style={baseLink}>
                {a.filename || "file"}
              </a>
              {i < refs.length - 1 ? " · " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
