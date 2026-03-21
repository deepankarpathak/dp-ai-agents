# RAG (Smart Context Engine)

Placeholder for LangChain + FAISS (or Chroma) + OpenAI embeddings.

- **retrieve.js** – `retrieve(query, k)` returns top-k chunks; currently returns `[]` until you implement the vector store.
- **Ingest**: Add an `ingest.js` (or CLI) that loads docs from `docs/`, splits, embeds, and builds the index under `backend/data/`.

See **docs/SMART_CONTEXT_ENGINE.md** for full design and implementation steps.
