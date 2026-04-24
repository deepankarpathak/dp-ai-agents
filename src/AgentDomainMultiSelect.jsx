import { useEffect, useRef, useState } from "react";
import { AGENT_DOMAIN_ENTRIES } from "./agentDomainCatalog.js";

const defaultPalette = {
  surface: "#0B1220",
  elevated: "#111827",
  border: "#1E293B",
  text: "#E2E8F0",
  muted: "#64748b",
  accent: "#38bdf8",
};

/**
 * Multi-select domain dropdown; selected labels shown as text beside the control when closed.
 * @param {{
 *   value: string[],
 *   onChange: (ids: string[]) => void,
 *   domains?: typeof AGENT_DOMAIN_ENTRIES,
 *   minSelected?: number,
 *   colors?: Partial<typeof defaultPalette>,
 *   label?: string,
 * }} props
 */
export default function AgentDomainMultiSelect({
  value,
  onChange,
  domains = AGENT_DOMAIN_ENTRIES,
  minSelected = 1,
  colors,
  label = "Domains",
}) {
  const C = { ...defaultPalette, ...colors };
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (id) => {
    const has = value.includes(id);
    if (has && value.length <= minSelected) return;
    if (has) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  const selectedLabels = value
    .map((id) => domains.find((d) => d.id === id)?.label)
    .filter(Boolean);
  const summaryText = selectedLabels.length ? selectedLabels.join(", ") : "None";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 12 }}>
      <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", marginBottom: 6, letterSpacing: "0.04em" }}>{label}</div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 200,
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${open ? C.accent : C.border}`,
            background: C.surface,
            color: C.text,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <span style={{ flex: 1, textAlign: "left" }}>
            {value.length} selected — {label}
          </span>
          <span style={{ opacity: 0.6, fontSize: 10 }}>{open ? "▴" : "▾"}</span>
        </button>
        {open && (
          <div
            style={{
              position: "absolute",
              zIndex: 400,
              top: "100%",
              left: 0,
              marginTop: 4,
              minWidth: 280,
              maxWidth: 360,
              maxHeight: 280,
              overflowY: "auto",
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: C.elevated,
              boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
            }}
          >
            {domains.map((d) => {
              const on = value.includes(d.id);
              return (
                <label
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "8px 12px",
                    cursor: "pointer",
                    borderBottom: `1px solid ${C.border}`,
                    fontSize: 12,
                    color: on ? d.color || C.accent : C.text,
                    background: on ? `${d.color || C.accent}12` : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={on && value.length <= minSelected}
                    onChange={() => toggle(d.id)}
                    style={{ marginTop: 2, accentColor: d.color || C.accent }}
                  />
                  <span style={{ fontSize: 14, lineHeight: 1.2 }}>{d.icon}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700 }}>{d.label}</span>
                    {d.full && d.full !== d.label ? (
                      <span style={{ display: "block", fontSize: 10, color: C.muted, fontWeight: 400, marginTop: 2 }}>{d.full}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ flex: "1 1 180px", minWidth: 0, paddingTop: 22 }}>
        <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", marginBottom: 4, letterSpacing: "0.04em" }}>Selected</div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.45, wordBreak: "break-word" }}>{summaryText}</div>
      </div>
    </div>
  );
}
