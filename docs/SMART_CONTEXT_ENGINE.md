# Smart Context Engine (RAG) & Feedback Loop

This document describes how to add **RAG-based context retrieval** and a clear **feedback loop** so the same repo works **offline** and **on GitHub/cloud**.

---

## 1. Smart Context Engine (RAG) – How to Do It

### Goal

Before generating or refining a PRD, retrieve relevant chunks from:

- NPCI circulars (PDFs)
- UPI guidelines
- Previous PRDs (from history or exported docs)
- Merchant / switch architecture docs

and inject them into the LLM prompt so outputs are more accurate and compliant.

### Suggested Stack

| Layer | Option A (Cloud / OpenAI) | Option B (Offline / Local) |
|-------|---------------------------|----------------------------|
| **Embeddings** | OpenAI `text-embedding-3-small` | Local: `@xenova/transformers` (e.g. `all-MiniLM-L6-v2`) or HuggingFace Inference API |
| **Vector store** | FAISS (via LangChain), Chroma, or Pinecone | FAISS (built locally), Chroma (local), or in-memory |
| **Orchestration** | LangChain (load → split → embed → store → retrieve) | Same; LangChain supports local embeddings |

**Recommended for your repo:** LangChain + **OpenAI embeddings** (when online) + **FAISS** or **Chroma** so you can switch to local embeddings later for offline.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Document ingestion (one-time or on doc add)                     │
│  NPCI PDFs, UPI guidelines, previous PRDs, merchant docs        │
│       → Load & split (e.g. RecursiveCharacterTextSplitter)       │
│       → Embed (OpenAI or local model)                            │
│       → Store in FAISS / Chroma (e.g. backend/data/faiss_index)  │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  At PRD generate / refine time (backend)                         │
│  User requirement (or requirement + feedback)                    │
│       → Embed query → similarity search (top-k chunks)           │
│       → Build context string → append to system/user prompt      │
│       → Call existing LLM flow (/api/generate)                   │
└─────────────────────────────────────────────────────────────────┘
```

### Where It Lives

- **Backend only**: ingestion scripts, vector store, retrieval. Frontend stays unchanged; it only sends “requirement” (and feedback) and receives PRD.
- **New paths** (optional):
  - `POST /api/rag/ingest` – admin: add a document (file or URL) to the store.
  - `POST /api/rag/retrieve` – returns top-k chunks for a query (or the main `/api/generate` can call this internally and inject context).

### Implementation Steps

1. **Backend RAG module** (e.g. `backend/rag/`)
   - `ingest.js` – load PDFs/docs from `docs/` or uploads, split with LangChain, embed, add to FAISS/Chroma.
   - `retrieve.js` – `retrieve(query, k)` returns top-k text chunks.
   - Persist index under `backend/data/` (or `backend/rag/faiss_index`) so it works offline after first run.

2. **Dependencies** (add to `backend/package.json` when you implement)
   - `langchain` – document loaders, text splitters, vector store integration.
   - `@langchain/openai` – OpenAI embeddings (or `@langchain/community` for local).
   - `faiss-node` or `chromadb` – vector store. (LangChain’s in-memory store is enough for a first version.)

3. **Wire into PRD flow**
   - In `server.js`, before calling the LLM in `/api/generate` (and optionally in a “refine” path), call `retrieve(requirementText, 5)`, then append to the system prompt, e.g.:
     - “Use the following reference context when relevant:\n\n” + retrievedChunks.join(“\n\n”).

4. **Documents to ingest**
   - Place NPCI circulars, UPI guidelines, and architecture docs under `docs/` (e.g. `docs/npci/`, `docs/upi/`, `docs/architecture/`).
   - Previous PRDs: either export from app history to markdown and put under `docs/prds/`, or add an “Export to RAG” action that writes to a folder and re-runs ingest.

### Offline vs Online

- **Online**: Use OpenAI embeddings and your existing LLM gateway; RAG works as above.
- **Offline**: Use a **local embedding model** (e.g. via `@xenova/transformers` or a small HuggingFace model) and your **local LLM** (or a gateway that runs on your machine). FAISS/Chroma index can be built once and reused without network.

---

## 2. Feedback Loop – How to Do It

### Current State

You already have:

- **Improve PRD with Feedback** – presets + custom text; applies and refines the PRD.
- **Other Feedbacks** – paste or upload .docx; “Refine PRD” uses that plus clarification answers.

So the flow is already: **Generate → Review → Provide feedback → Refine.**

### Making the Feedback Loop Explicit and RAG-Aware

1. **Formalize the steps in the UI**
   - Step 1: Generate PRD (optionally with RAG context).
   - Step 2: “Review & feedback” – show PRD + a single feedback box (text + optional file).
   - Step 3: “Refine” – send (current PRD + feedback) to backend; backend optionally retrieves RAG context again (e.g. using “feedback” as part of the query) and calls LLM to produce refined PRD.
   - Step 4: Repeat 2–3 until satisfied (optional “Refine again” button).

2. **Backend**
   - Existing “refine” behaviour (re-prompt LLM with PRD + feedback) stays.
   - Optional: when saving a refined PRD, add it (or a summary) to the RAG corpus so future PRDs can benefit from “similar feedback was applied in the past.”

3. **No breaking changes**
   - The current “Improve PRD with Feedback” and “Refine PRD” can stay; you’re mainly naming the loop and optionally feeding refinements into RAG.

---

## 3. Offline + GitHub: Same Repo for Both

The GitHub-ready setup **does** allow running on your machine and offline.

### How It Works

| Scenario | Backend | Frontend | API base | Network |
|----------|---------|----------|----------|---------|
| **Local dev** | `cd backend && npm start` (port 5000) | `npm start` (proxy to 5000) | `''` (proxy) | LLM can be cloud or local |
| **Local “offline”** | Same | Same, or build + serve from backend | `''` | Use local LLM + local embeddings (RAG) |
| **Cloud deploy** | Same server, `PORT` + `NODE_ENV=production` | Built and served from backend | `''` | Cloud LLM + optional RAG |

- **API_BASE**: `process.env.REACT_APP_API_URL || ''` means “same origin.” When the frontend is served by the same Express app (production build) or by the dev server (which proxies to the backend), no hardcoded host is needed. So it works offline as long as the backend runs on your machine.
- **Backend**: Reads `.env` from repo root or `backend/`. No mandatory cloud dependency; only the LLM (and optionally embedding API) need network unless you use local models.

### What You Need for “Full” Offline

1. **Backend and frontend run locally** – already supported.
2. **LLM**: Use a model that runs on your machine (e.g. Ollama, or a gateway that points to a local model) and set `LLM_URL` / `LLM_API_KEY` (or equivalent) in `.env` for that.
3. **RAG (when you add it)**: Use local embeddings (see table above) and a local vector store (FAISS/Chroma on disk). Ingest once (e.g. from `docs/`) and reuse the index without internet.

### Ensuring “Both Together”

- **No code change required** for “run on my machine” vs “deploy to GitHub/cloud.” Same repo, same commands; only env (and optionally LLM/embedding endpoints) differ.
- Add to **DEPLOYMENT.md** (or README) a short “Running offline” section:
  - Run backend from `backend/`, frontend from root (or serve build from backend).
  - For offline: set `LLM_URL` (and if needed embedding URL) to local endpoints; use local RAG index built beforehand.

---

## 4. Suggested Implementation Order

1. **RAG (minimal)**  
   - Add `backend/rag/` with a stub `retrieve(query)` that returns `[]` if RAG is disabled or not installed.  
   - In `server.js`, if `retrieve` returns chunks, append them to the prompt; otherwise current behaviour unchanged.  
   - Then implement real ingestion (LangChain + OpenAI + FAISS or Chroma) and wire `retrieve` to it.

2. **Feedback loop**  
   - Keep current “Improve PRD” and “Refine” flows; add a short “Review → Feedback → Refine” description in the UI.  
   - Optionally: “Save refined PRD to RAG” so future runs can use it.

3. **Offline**  
   - Document in DEPLOYMENT.md: run backend + frontend locally; for full offline, use local LLM and local RAG (local embeddings + local index).

4. **Docs and .env.example**  
   - Add `OPENAI_API_KEY` (or your embedding key) and `RAG_ENABLED` to `.env.example` when you add RAG.  
   - Keep `.env` and `backend/data/` (or RAG index path) in `.gitignore`.

This keeps your repo working for both **offline** and **GitHub/cloud** while you add the Smart Context Engine and a clear feedback loop.
