# PRD / UAT / BRD / JIRA Agents

This repo contains a small suite of internal agents:

- **PRD Agent** – generates production‑grade PRDs (`src/prd-agent-v7.jsx`).
- **UAT Agent** – generates UAT sign‑off documents (`src/uat-agent1.jsx`).
- **BRD Agent** – generates BRDs (`src/brd-agent.jsx`).
- **JIRA Agent** – drafts and creates Jira tickets (`src/jira-agent.jsx`).

All agents talk to a single Node.js backend (`backend/server.js`) which hides LLM and connector credentials behind environment variables. **No API keys or passwords are committed to this repo.**

---

## Setup (safe environment variables)

Create a `.env` file in the **repo root** based on `.env.example`. Only put **your own secrets** in `.env`; `.env.example` stays checked in with placeholders.

At minimum you will typically configure:

- **LLM gateway**
  - `LLM_KEY_API` or `LLM_API_KEY` – token for your LLM gateway (e.g. Anthropic/Foundry proxy).
  - `LLM_URL` – HTTPS URL of your gateway.
  - `LLM_MODEL` – model id to use for generation.

- **Jira**
  - `JIRA_URL` – primary Jira site base URL (e.g. `https://yourcompany.atlassian.net`).
  - `JIRA_URL_2` (optional) – secondary Jira site (e.g. TPAP board).
  - `JIRA_EMAIL` – Jira account email (used for API token auth).
  - `JIRA_TOKEN` – Jira API token (keep this only in `.env`, never in git).
  - Optional multi‑site routing envs are documented in `.env.example`.

- **Share & Score (LLM scoring)**
  - `OPENAI_API_KEY` and `SCORE_MODEL` (OpenAI scoring pipe), **or**
  - `LLM_KEY_API` / `LLM_API_KEY` plus optional `SCORE_LLM_URL` and `SCORE_LLM_MODEL` (Foundry scoring pipe).

- **Connectors (Jira / Email / Slack / Telegram / WhatsApp)**
  - Email SMTP: `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_USER`, `EMAIL_PASS`/`EMAIL_PASSWORD`, `EMAIL_FROM`.
  - Slack: `SLACK_WEBHOOK_URL`.
  - Telegram: `TELEGRAM_BOT_TOKEN`, optional `TELEGRAM_INSECURE_TLS=true` for corporate proxies.
  - WhatsApp Business: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_NOTIFY_NUMBER`.

> **Security note:** `.env` and any other secret‑bearing files are already ignored via `.gitignore`. Before committing, double‑check that you have **not added** any `.env`, `.log`, or temporary config files with real keys to git.

---

## Running locally

1. **Install dependencies**

   ```bash
   npm install
   cd backend && npm install
   cd ..
   ```

2. **Start the backend**

   From the repo root:

   ```bash
   npm run start:backend
   ```

   This runs `backend/server.js` (default port **5000**) and reads configuration from the repo‑root `.env` and/or `backend/.env`.

3. **Start the frontend**

   In a second terminal (repo root):

   ```bash
   npm start
   ```

   The React app will be available at `http://localhost:3000` and will talk to the backend on `http://localhost:5000` (or `REACT_APP_API_URL` if set in `.env`).

---

## Features overview

- **Multi‑Jira support**
  - Supports a primary Jira (`JIRA_URL`) and optional secondary Jira (`JIRA_URL_2`) with project‑key‑based routing.
  - Agents can fetch by **issue key or full Jira URL**, and can create issues/sub‑tasks on the configured site.

- **Share & Score**
  - Success screens for PRD/UAT/BRD/JIRA expose a **Share & score** panel (`src/ShareAndScore.jsx`).
  - **Publish** can send the current document to Jira (comment), Email, Slack, and/or Telegram using defaults from **Connectors**.
  - **Score** supports two backends:
    - **OpenAI** – via `OPENAI_API_KEY`, using `SCORE_MODEL`.
    - **Foundry/internal LLM** – via `LLM_KEY_API` / `LLM_API_KEY`, with optional `SCORE_LLM_URL` and `SCORE_LLM_MODEL`.
  - The user chooses the scoring backend in a small dropdown (“Score with: OpenAI / Foundry”) and the choice is saved in browser storage.

- **Auto‑notify on completion**
  - When a PRD/UAT/BRD/JIRA document is generated, the backend can send a **single auto‑notification** (email/Slack/WhatsApp/Telegram) via `/api/notify/complete`.
  - Each agent tracks a **one‑shot flag** so auto‑notification only fires once per session; manual “Send” buttons are fully separate.
  - Backend logs every notification attempt with subject lines and any 4xx/5xx errors to the terminal for debugging.

- **Connectors and defaults**
  - The **Connectors** screen (`src/ConnectorsStatus.jsx`) lets you test Jira/Email/Slack/Telegram connectivity and set default publish destinations:
    - Default Jira issue key.
    - Default Telegram chat ID.
    - Default email recipient.
    - Default Jira site (auto / primary / secondary).
    - Default scoring provider (`scoreProvider`).

For detailed Share & Score behavior and all connector env vars, see `docs/SHARE_AND_SCORE.md` and `.env.example`.

---

## Preparing to commit safely

Before committing:

- Run `git status` and ensure **no `.env` or other secret files** are staged.
- Check that only **code and documentation** changes are included (e.g. `backend/server.js`, `src/*.jsx`, `docs/*.md`, `.env.example`, `README.md`).
- If GitGuardian previously flagged secrets, make sure those have been:
  - **Rotated** in the external service (Jira, LLM gateway, etc.), and
  - **Removed from git history** or from any tracked config files.

Once those checks pass, you can safely commit and push the updated code and README.
