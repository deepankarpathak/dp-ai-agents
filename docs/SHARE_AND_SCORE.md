# Share & Score

## Prerequisites (avoid “Backend error: 404”)

1. **Run the backend** from the repo root: `npm run start:backend` (starts `backend/server.js` on port **5000** by default). Share, Score, and JIRA fetch APIs live only in that server.
2. **Easiest:** run frontend + backend together: `npm install` once, then `npm run dev`.
3. If the backend uses another port, set **`REACT_APP_API_URL=http://127.0.0.1:YOUR_PORT`** in `.env` and restart `npm start`.

---

On the **success screen** of each agent (PRD, UAT, BRD) you get:

1. **Publish** – One-click send to JIRA, Slack, Telegram, and/or Email using **pre-configured defaults** (no typing).
2. **Share** – Buttons to post to JIRA, send to Telegram, or email. All use the **defaults from Connectors** (no duplicate inputs).
3. **Score** – Get a 1–10 score and short rationale using **OpenAI** or **Foundry** (your internal LLM gateway), chosen in the UI.

---

## Publish (configure upfront)

- **Configure defaults:** Open **Connectors** (top bar) → scroll to **Default publish destinations** → set Default JIRA issue key, Default Telegram chat ID, Default email (to) → **Save defaults**.
- **Session option:** When starting a new UAT/PRD/BRD session, under **Options** you can tick **After generation, auto-publish to** (JIRA, Telegram, Email, Slack). When the document is ready, it will automatically be sent to those channels using the saved defaults.
- **On the final screen:** Use the **Publish** checkboxes to select JIRA, Telegram, Email, Slack and click **Publish**. No inputs needed if defaults are set.

---

## Share (uses Connector defaults)

JIRA, Telegram, and Email **use the same defaults** you set in Connectors → Default publish destinations. No need to enter issue key, chat ID, or email again in Share & Score.

### JIRA

- **Button:** “Post to JIRA” — uses default JIRA issue key from Connectors.
- **Env:** `JIRA_URL`, `JIRA_EMAIL`, `JIRA_TOKEN` in `.env`.

### Telegram

- **Button:** “Send to Telegram” — uses default Telegram chat ID from Connectors.
- **Env:** `TELEGRAM_BOT_TOKEN` in `.env`.
- **How to get chat ID:** Send a message to your bot, then open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` and look at `message.chat.id`.

### Email

- **Button:** “Send via Email” — uses default email (to) from Connectors.
- **Env:** `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_USER`, `EMAIL_PASS` (or `EMAIL_PASSWORD`), and optionally `EMAIL_FROM`.

### Slack

- **Publish:** Select “Slack” in the Publish checkboxes and click **Publish** (uses webhook; no per-use input).
- **Env:** `SLACK_WEBHOOK_URL` in `.env` (Slack Incoming Webhook URL).

---

## Score (OpenAI or Foundry)

- **Control:** Dropdown **Score with:** — **OpenAI** or **Foundry / internal LLM**. The choice is saved in browser defaults (same storage as Connectors publish defaults: `scoreProvider`).
- **Buttons:** “Get score (OpenAI)” or “Get score (Foundry)” depending on selection.
- **Backend:** `POST /api/score` with `scoreProvider: "openai" | "foundry"` (default `openai` if omitted).
- **`GET /api/config`** exposes `scoreOpenAiConfigured` and `scoreFoundryConfigured` so the UI can disable unavailable options.

### OpenAI pipe

- **Env:** `OPENAI_API_KEY` (required for this pipe), `SCORE_MODEL` (default `gpt-4o`).

### Foundry pipe

- **Auth:** Same as agents — `LLM_KEY_API` or `LLM_API_KEY`.
- **Env (optional overrides used only for scoring):**
  - `SCORE_LLM_URL` — e.g. `https://tfy.internal.ap-south-1.production.apps.pai.mypaytm.com/api/llm` (can differ from `LLM_URL` if agents use `.../messages`).
  - `SCORE_LLM_MODEL` — e.g. `azure-paytm-east-us2/gpt-5.1` or `azure-paytm-east-us2/gpt-5.4`.
- If `SCORE_LLM_URL` / `SCORE_LLM_MODEL` are unset, scoring uses `LLM_URL` and `LLM_MODEL` from your main LLM block in `.env`.

---

## Troubleshooting: "Backend error: 404"

This usually means the frontend cannot reach the backend API.

1. **Start the backend**  
   From the repo root run:  
   `npm run start:backend`  
   (or `cd backend && npm start`).  
   You should see e.g. `AI agents backend ... running on port 5000`.

2. **Keep the backend on port 5000**  
   The React app is configured to proxy `/api/*` to `http://localhost:5000`. If the backend runs on another port (e.g. you set `PORT=5001` in `backend/.env`), either:
   - Run the backend on 5000, or  
   - In the **repo root** `.env` add:  
     `REACT_APP_API_URL=http://localhost:5001`  
     (use your backend port), then restart the React app (`npm start`).

3. **Restart after changing .env**  
   After changing `REACT_APP_API_URL` or `PORT`, restart both the backend and the React dev server.
