# JIRA Agent — Local Setup Guide

A production-grade JIRA ticket generator for UPI / NPCI fintech workflows.
Powered by Claude claude-sonnet-4-20250514 via the Anthropic API.

---

## ⚡ Quick Start (3 steps)

### 1. Create the project

```bash
# Create a new Vite + React project
npm create vite@latest jira-agent -- --template react
cd jira-agent

# Remove default files
rm src/App.jsx src/App.css src/index.css src/assets/react.svg
```

### 2. Copy the files into place

```
jira-agent/
├── index.html          ← copy from this zip
├── package.json        ← copy from this zip
├── vite.config.js      ← copy from this zip
├── .env.example        ← copy as .env and fill in your key
└── src/
    ├── main.jsx        ← copy from this zip
    └── App.jsx         ← copy JiraAgent.jsx → rename to App.jsx
```

### 3. Install and run

```bash
npm install
cp .env.example .env
# Edit .env and add your Anthropic API key

npm run dev
# Opens at http://localhost:3000
```

---

## 🔑 API Key

- Get your key at: https://console.anthropic.com/
- Paste it in the `.env` file: `VITE_ANTHROPIC_API_KEY=sk-ant-...`
- OR enter it directly in the app's sidebar (it saves to localStorage)

---

## 🧠 What It Generates

A full 18-section CAB-ready JIRA ticket:

1. Title (system + action oriented)
2. Objective / Problem Statement
3. Background / Context
4. Scope of Change (In + Out of scope)
5. Functional Changes (flow tables, IF-ELSE logic, API fields, system breakdown)
6. Impact Analysis
7. Risk Assessment Table (5+ rows)
8. Dependencies
9. Success Metrics & Monitoring (logs, dashboards, SR impact)
10. Rollout Plan (feature flag mandatory, phased gates)
11. Rollback Plan (RTO defined)
12. UAT Scenarios (positive, negative, edge, retry)
13. User Stories (3 min)
14. Reconciliation Impact
15. Compliance / Regulatory Alignment
16. Open Questions
17. References / Annexure
18. Terminology Table

**Sub-JIRAs**: Check "Also generate Sub-JIRAs" to get system-specific tickets for each impacted system (Switch, Compliance, PMS, Recon, etc.)

---

## 📦 Export

- **Copy** — copies raw Markdown to clipboard
- **Export .md** — downloads as a Markdown file (importable to Confluence, Notion, JIRA description field)

---

## ⚠️ Security Note

This app calls the Anthropic API directly from the browser (fine for local use).
For a team deployment, proxy the API call through a backend server to keep the key secure.

---

## Requirements

- Node.js 18+
- npm 9+
- Anthropic API key (Claude claude-sonnet-4-20250514)
