# Share & Score

On the **success screen** of each agent (PRD, UAT, BRD) you get:

1. **Publish** – One-click send to JIRA, Slack, Telegram, and/or Email using **pre-configured defaults** (no typing).
2. **Share** – Buttons to post to JIRA, send to Telegram, or email. All use the **defaults from Connectors** (no duplicate inputs).
3. **Score** – Get a 1–10 score and short rationale using OpenAI (e.g. GPT 5.4 when available).

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

## Score (GPT 5.4 / configurable)

- **Button:** “Get score (GPT)”
- **Backend:** Calls OpenAI API with the document and a scoring prompt; returns `score`, `maxScore` (10), and `rationale`.
- **Env:**
  - `OPENAI_API_KEY` – required for scoring.
  - `SCORE_MODEL` – model name (default `gpt-4o`). Set to `gpt-5.4` (or the exact name when available) for GPT 5.4.

Scoring is separate from the main PRD/UAT/BRD LLM (Anthropic/gateway): it uses OpenAI only for this step.

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
