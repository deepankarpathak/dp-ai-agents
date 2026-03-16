# PRD Creation Strategy

This document describes the strategy and flow used by the UPI Switch PRD Agent to generate Product Requirement Documents.

---

## 1. Overview

The agent produces structured PRDs for UPI Switch features by:

- **Clarifying** the requirement (domain boundaries and terminology) before generation
- **Generating** content in fixed batches of sections via an LLM, with strict JSON output
- **Refining** with AI-suggested clarifying questions and optional manual feedback
- **Exporting** to Markdown, plain text, or DOCX

---

## 2. Pre-Generation Checks (Domain-Aware)

Before any PRD text is generated, the agent runs two optional clarification steps so the requirement is unambiguous.

### 2.1 Domain Boundary Check

- **Goal:** Identify ambiguous ownership (Switch vs TPAP vs PSP vs PG vs NPCI) or unclear responsibility boundaries.
- **Flow:** The LLM analyzes the requirement and returns `{ needsClarification, questions[] }`. If needed, the user answers up to 2 questions; answers are injected into the context for generation.

### 2.2 Terminology Check

- **Goal:** Surface undefined or ambiguous terms, acronyms, or UPI-specific jargon.
- **Flow:** The LLM returns `{ needsClarification, terms: [{ term, question }] }`. User can clarify terms; definitions are added to the pre-generation context.

Both steps can be skipped. When done (or skipped), the agent moves to “Ready to Generate.”

---

## 3. Section Structure and Batches

The PRD is split into **14 sections** (e.g. Problem Statement, Objective, Scope, Current/Proposed Architecture, Timeout/Idempotency, Rollout, UAT, NPCI MUSTs, Appendix). These are generated in **5 batches** to balance context size and latency:

| Batch | Sections |
|-------|----------|
| 1 | problem, objective, scope |
| 2 | current_arch, proposed_arch |
| 3 | timeout, additional, fund_loss |
| 4 | rollout, backward, references, uat |
| 5 | npci_musts, appendix |

Each batch is one LLM call. The **system prompt** enforces:

- Return **only** a valid JSON object (no markdown fences or preamble).
- Use `\n` for line breaks inside strings; keep each value under 1200 characters.
- Be concise and technically precise for UPI/NPCI/fintech.

The **user prompt** for each batch lists the required keys and short descriptions for those sections, plus the requirement text (and any pre-generation context from domain/terminology steps).

---

## 4. Generation Flow

1. **Metadata:** One LLM call to get `{ title, version }` for the document.
2. **Batches:** For each of the 5 batches, the agent calls the LLM with the section prompt and the current requirement + context. The raw response is parsed with a **repairJSON** helper (strips markdown, finds `{...}`, falls back to regex for key-value pairs).
3. **Merge:** Section outputs are merged into a single PRD object and shown in the UI. If a batch fails to parse, that batch’s sections show “(Generation failed — please retry).”
4. **Clarifying questions (optional):** Unless “Skip clarification” is set, the agent asks the LLM for 4 short clarifying questions to improve the PRD. The user can answer and trigger **Refine PRD**, which re-runs all batches with the answers in context.

---

## 5. Manual Feedback and Improvements

After generation (and optional refine), the user can apply **preset** or **custom** improvements:

- **Presets** (e.g. “Split Spec vs Assumptions,” “Normalize Protocol Story,” “Rationalize APIs,” “Tighten State Machine,” “Move Ops/Compliance to Appendix”) inject structured instructions into the prompt.
- **Custom feedback** is free-text instructions.

Improvements are applied by re-running the batch generation with the existing PRD plus the feedback instructions. The UI keeps an “Improvement history” of applied presets and custom text.

---

## 6. Output and Export

- **In-app:** The PRD is shown section by section with copy actions.
- **Copy as Markdown / Plain text:** Built from the same PRD object (title, version, date, then each section).
- **DOCX:** Generated (e.g. via backend or export flow) and placed in the **PRD output folder** (`prd-output/`), with a README describing the folder and how to use the exports.

---

## 7. Backend (LLM Proxy)

The Node server (`server.js`) acts as a proxy to the internal LLM gateway:

- **Auth:** Uses `LLM_KEY_API` or `LLM_API_KEY` from `.env`. Tries `x-api-key` first; on 401, retries with `Authorization: Bearer <token>`.
- **API shape:** Forwards `system` as a **top-level** parameter (not as a message role), plus `messages` and `max_tokens`, so the gateway receives the same structure the frontend sends.
- **Logging:** Logs to the terminal when a request is sent to the LLM server and when a response is received (e.g. “[LLM] Calling LLM server …”, “[LLM] Response received …”).

This keeps tokens and gateway URL on the server and ensures the model receives the full system prompt and message list for JSON-only, section-based generation.
