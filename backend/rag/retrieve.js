/**
 * Smart Context Engine (RAG) – retrieval stub.
 *
 * When you implement RAG (LangChain + FAISS/Chroma + OpenAI or local embeddings),
 * replace this with real similarity search over NPCI circulars, UPI guidelines,
 * previous PRDs, and merchant docs. See docs/SMART_CONTEXT_ENGINE.md.
 *
 * @param {string} query - User requirement or requirement + feedback text
 * @param {number} [k=5] - Max number of chunks to return
 * @returns {Promise<string[]>} - Array of relevant text chunks (empty if RAG not enabled)
 */
export async function retrieve(query, k = 5) {
  if (!query || typeof query !== "string") return [];

  // Stub: no vector store yet. When RAG is implemented:
  // - Load FAISS/Chroma index from backend/data/ (or backend/rag/)
  // - Embed query (OpenAI or local), search top-k, return chunk texts
  try {
    // Optional: enable via env so you can turn on RAG when ready
    if (process.env.RAG_ENABLED !== "true") return [];
    // Placeholder for real implementation
    return [];
  } catch (err) {
    console.warn("[RAG] retrieve error:", err.message);
    return [];
  }
}
