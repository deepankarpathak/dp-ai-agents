import { useState } from "react";
import PRDAgent from "./prd-agent-v7.jsx";
import TestSentinel from "./uat-agent1.jsx";
import BRDAgent from "./brd-agent.jsx";
import JiraAgent from "./jira-agent.jsx";
import ConnectorsStatus from "./ConnectorsStatus.jsx";

const TAB_PRD = "prd";
const TAB_UAT = "uat";
const TAB_BRD = "brd";
const TAB_JIRA = "jira";

function App() {
  const [activeTab, setActiveTab] = useState(TAB_PRD);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Agent switcher — runs PRD, UAT, and BRD agents in parallel (switch without losing state) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          padding: "0 16px",
          minHeight: 40,
          background: "#0f172a",
          borderBottom: "1px solid #1e293b",
          fontFamily: "'Segoe UI', sans-serif",
          zIndex: 1000,
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab(TAB_PRD)}
          style={{
            padding: "8px 20px",
            margin: 0,
            border: "none",
            borderBottom: activeTab === TAB_PRD ? "2px solid #f59e0b" : "2px solid transparent",
            background: activeTab === TAB_PRD ? "#1e293b" : "transparent",
            color: activeTab === TAB_PRD ? "#f8fafc" : "#64748b",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          PRD Agent
        </button>
        <button
          type="button"
          onClick={() => setActiveTab(TAB_UAT)}
          style={{
            padding: "8px 20px",
            margin: 0,
            border: "none",
            borderBottom: activeTab === TAB_UAT ? "2px solid #e8b84b" : "2px solid transparent",
            background: activeTab === TAB_UAT ? "#1e293b" : "transparent",
            color: activeTab === TAB_UAT ? "#f8fafc" : "#64748b",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          UAT Agent
        </button>
        <button
          type="button"
          onClick={() => setActiveTab(TAB_JIRA)}
          style={{
            padding: "8px 20px",
            margin: 0,
            border: "none",
            borderBottom: activeTab === TAB_JIRA ? "2px solid #38bdf8" : "2px solid transparent",
            background: activeTab === TAB_JIRA ? "#1e293b" : "transparent",
            color: activeTab === TAB_JIRA ? "#f8fafc" : "#64748b",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          JIRA Agent
        </button>
        <button
          type="button"
          onClick={() => setActiveTab(TAB_BRD)}
          style={{
            padding: "8px 20px",
            margin: 0,
            border: "none",
            borderBottom: activeTab === TAB_BRD ? "2px solid #7c6fff" : "2px solid transparent",
            background: activeTab === TAB_BRD ? "#1e293b" : "transparent",
            color: activeTab === TAB_BRD ? "#f8fafc" : "#64748b",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          BRD Agent
        </button>

        {/* Connectors status — shared across all agents */}
        <div style={{ marginLeft: "auto" }}>
          <ConnectorsStatus />
        </div>
      </div>

      <div style={{ flex: 1, display: activeTab === TAB_PRD ? "block" : "none" }}>
        <PRDAgent />
      </div>
      <div style={{ flex: 1, display: activeTab === TAB_UAT ? "block" : "none" }}>
        <TestSentinel />
      </div>
      <div style={{ flex: 1, display: activeTab === TAB_BRD ? "block" : "none" }}>
        <BRDAgent />
      </div>
      <div style={{ flex: 1, display: activeTab === TAB_JIRA ? "block" : "none" }}>
        <JiraAgent />
      </div>
    </div>
  );
}

export default App;
