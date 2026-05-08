# Connectors – Input / Output and BRD Agent

## What connectors do today

| Connector | Role | How it’s used |
|-----------|------|----------------|
| **JIRA** | **Input** | In the BRD agent, enter an issue key (e.g. `TSP-1889`) or paste a JIRA browse URL and click **Fetch**. The app pulls summary, description, and acceptance criteria from JIRA and fills the BRD form. No “sending” from the app to JIRA. |
| **Slack, WhatsApp, Email, Telegram** | **Status only** | The top bar shows whether each is configured (via `.env`). There is no “send” or “receive” from these channels yet; they are ready for future integration. |

## JIRA (input into BRD)

1. Set in `.env`: `JIRA_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`.
2. In the BRD agent, under **JIRA Connector**:
   - Enter either:
     - **Issue key**: e.g. `TSP-1889`
     - **Full URL**: e.g. `https://finmate.atlassian.net/browse/TSP-1889`
   - Click **Fetch**.
3. The app calls the server, which calls JIRA’s API and returns issue data. Summary, description, and acceptance criteria are filled into the form. You then use that as **input** to generate or refine the BRD.

So: **JIRA is used only as input** – you “get” data from JIRA into the BRD agent.

## Using connectors for output (future)

Possible extensions:

- **Slack / Telegram**: After a BRD is generated, “Share to Slack” or “Share to Telegram” could post a summary or link.
- **Email**: “Email this BRD” to stakeholders.
- **JIRA**: “Push summary to JIRA” to update the issue description or add a comment.

Right now the app does not send anything to these services; it only shows whether they are configured.

## Adding new connector behaviour

- **Input**: Add a UI control (e.g. “Fetch from Slack/Telegram”) and a server route that calls the external API and returns data; then map that data into the BRD form (like JIRA).
- **Output**: Add a button (e.g. “Send to Slack”) and a server route that takes the current BRD (or markdown) and calls the external API (e.g. Slack webhook, Telegram sendMessage).

All secrets (tokens, webhook URLs) stay in `.env` on the server; the frontend only triggers actions via your API.
