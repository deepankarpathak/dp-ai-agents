import { useState, useRef, useCallback, useEffect } from "react";

const API_BASE = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";

function ts() {
  return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export default function AlphaAgent() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Hello! I'm Alpha Agent — your UPI Intelligence assistant. I have full access to the UPI Alpha knowledge base: wiki pages (282 feature teardowns, 66 competitor app profiles), 279+ SQL query references, and live schema. Ask me anything about UPI strategy, competitor analysis, product gaps, or Paytm-specific insights.",
      filesUsed: [],
      ts: ts(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    const userMsg = { role: "user", content: msg, ts: ts() };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/alpha/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Alpha Agent failed");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply,
          filesUsed: data.filesUsed || [],
          llmProvider: data.llmProvider,
          ms: data.ms,
          ts: ts(),
        },
      ]);
    } catch (e) {
      setError(e.message);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ Error: ${e.message}`, filesUsed: [], ts: ts() },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const onKey = useCallback(
    (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 40px)",
        background: "#0b1120",
        fontFamily: "'Segoe UI', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 20px",
          background: "#0f2d1a",
          borderBottom: "1px solid #10b981",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#10b981",
            boxShadow: "0 0 8px #10b981",
          }}
        />
        <div>
          <div style={{ color: "#10b981", fontWeight: 700, fontSize: 15, letterSpacing: 0.5 }}>
            α Alpha Agent — UPI Intelligence
          </div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 1 }}>
            Powered by UPI Alpha knowledge base · wiki · queries · schema · live from Google Drive
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            setMessages([
              {
                role: "assistant",
                content: "New chat started. What would you like to explore?",
                filesUsed: [],
                ts: ts(),
              },
            ])
          }
          style={{
            marginLeft: "auto",
            padding: "4px 12px",
            background: "transparent",
            border: "1px solid #10b981",
            color: "#10b981",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          New Chat
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: m.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "78%",
                padding: "10px 14px",
                borderRadius: 8,
                background: m.role === "user" ? "#1e3a5f" : "#0f2d1a",
                borderLeft: m.role === "assistant" ? "3px solid #10b981" : "none",
                color: "#e2e8f0",
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {m.content}
            </div>
            <div
              style={{
                display: "flex",
                gap: 6,
                marginTop: 4,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "#475569", fontSize: 10 }}>{m.ts}</span>
              {m.llmProvider && (
                <span style={{ color: "#334155", fontSize: 10 }}>· {m.llmProvider}</span>
              )}
              {m.ms && (
                <span style={{ color: "#334155", fontSize: 10 }}>
                  · {(m.ms / 1000).toFixed(1)}s
                </span>
              )}
              {(m.filesUsed || []).map((f, fi) => (
                <span
                  key={fi}
                  style={{
                    background: "#0f2d1a",
                    border: "1px solid #065f46",
                    color: "#6ee7b7",
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 10,
                  }}
                >
                  {f.split("/").pop()}
                </span>
              ))}
            </div>
          </div>
        ))}
        {loading && (
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, color: "#10b981", fontSize: 13 }}
          >
            <span>◉</span>
            <span>Alpha Agent thinking…</span>
          </div>
        )}
        {error && (
          <div style={{ color: "#f87171", fontSize: 12, padding: "4px 8px" }}>
            Last error: {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: "12px 16px",
          background: "#0f172a",
          borderTop: "1px solid #1e293b",
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about UPI strategy, competitor features, product gaps, SQL queries… (Ctrl+Enter to send)"
          rows={2}
          style={{
            flex: 1,
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 6,
            color: "#e2e8f0",
            fontSize: 14,
            padding: "8px 12px",
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
            lineHeight: 1.5,
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            padding: "8px 18px",
            background: loading || !input.trim() ? "#1e293b" : "#10b981",
            color: loading || !input.trim() ? "#475569" : "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            height: 40,
          }}
        >
          {loading ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
