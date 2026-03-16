# BRDForge v2.0 — AI-Powered BRD Generator

> Generate production-grade Business Requirements Documents for UPI/payment systems  
> with JIRA connector, AI assistance, and 24-section gold-standard format.

---

## Quick Start (3 steps)

### 1. Install dependencies
```bash
cd brdforge
npm install
```

### 2. Configure credentials
```bash
cp .env.example .env
# Edit .env with your keys (see Configuration section below)
```

### 3. Run
```bash
npm start
# Open: http://localhost:3000
```

---

## Configuration

Edit `.env`:

| Variable | Description | Where to get |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key | [console.anthropic.com](https://console.anthropic.com) |
| `JIRA_URL` | Your Atlassian URL | e.g. `https://company.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian email | Your login email |
| `JIRA_TOKEN` | JIRA API token | [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `PORT` | Server port | Default: `3000` |

---

## JIRA Connector

BRDForge connects directly to your JIRA instance to fetch:

- Issue summary, description, acceptance criteria
- Priority, status, assignee, reporter
- Labels, components, fix versions
- Latest comments and attachments list

**Browser mode**: Configure JIRA credentials in the ⚙ Settings panel  
**Server mode**: Set in `.env` — the Node server proxies requests to bypass CORS

### Getting a JIRA API Token
1. Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a label like `BRDForge`
4. Copy the token — it won't be shown again

---

## BRD Format (24 Sections)

BRDForge generates the gold-standard UPI BRD format:

1. Document Metadata
2. Executive Summary
3. Regulatory / Compliance Reference
4. Problem Statement
5. Objective
6. Scope (In/Out)
7. Terminology
8. System Architecture Overview
9. Transaction Lifecycle
10. Current Flow (AS-IS)
11. Proposed Flow (TO-BE)
12. Business Rules
13. API Behaviour
14. Error Code Mapping
15. Edge Case Handling
16. Reconciliation Impact
17. Risk Assessment
18. Monitoring & Metrics
19. Configuration Management
20. UAT Test Scenarios
21. Rollout Strategy
22. Rollback Plan
23. Success Metrics
24. Failure Scenario Matrix *(Elite section)*

---

## Workflow

```
Step 1: Input
  ├── Enter JIRA ID → auto-fetch issue details
  ├── Or manually enter requirements
  └── Attach supporting files (.txt, .md, .csv, .json)

Step 2: Gather & Analyze
  └── Context combined from JIRA + files + web guidelines

Step 3: Clarify (Optional — toggle on/off)
  └── 6 targeted questions to improve BRD accuracy

Step 4: Generate
  └── Claude AI generates full 24-section BRD

Step 5: Output
  ├── View formatted BRD in browser
  ├── Copy as Markdown
  ├── Download as .md file
  └── Auto-saved to session history
```

---

## API Endpoints (Server Mode)

| Endpoint | Method | Description |
|---|---|---|
| `GET /` | GET | BRDForge web app |
| `GET /api/jira-issue/:id` | GET | Fetch JIRA issue by ID |
| `GET /api/jira-search?q=` | GET | Search JIRA issues |
| `POST /api/claude` | POST | Proxy to Anthropic API |
| `GET /api/config` | GET | Check configuration status |
| `GET /health` | GET | Health check |

---

## AI Models Supported

| Model | Speed | Quality | Best For |
|---|---|---|---|
| Claude Sonnet 4.6 | Fast | High | Everyday BRDs ✓ Recommended |
| Claude Opus 4.6 | Slower | Highest | Complex regulatory BRDs |
| Claude Haiku 4.5 | Fastest | Good | Quick drafts, testing |

---

## Using Without Node.js (Browser-only mode)

Just open `index.html` directly in your browser:
- JIRA fetch works via browser's fetch (may be blocked by CORS on some JIRA instances)
- Anthropic API calls go directly from browser
- Add API keys in ⚙ Settings panel

For full JIRA support, use the Node.js server — it proxies JIRA calls server-side.

---

## Upgrading

To upgrade BRDForge, replace `index.html` and `server.js` with new versions.  
Your `.env` settings and browser `localStorage` history are preserved.

---

## Troubleshooting

**JIRA fetch fails in browser**: Use Node.js server mode (CORS issue). Run `npm start`.

**"API key not configured"**: Add `ANTHROPIC_API_KEY` to `.env` or Settings panel.

**JIRA 401 error**: Check email/token. Tokens expire — regenerate at Atlassian.

**JIRA 404 error**: Check issue ID format (e.g. `UPI-1234` not `upi-1234`).

---

## License

MIT — Use freely, modify as needed.
