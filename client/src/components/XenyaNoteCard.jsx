// client/src/components/XenyaNoteCard.jsx
import React, { useRef, useEffect, useState } from "react";

const NOTE_COLORS = ["#111827", "#0f172a", "#020617", "#1e293b"];

export default function XenyaNoteCard({
  id,
  x,
  y,
  body,
  bgColor,
  textColor,
  z,
  width = 260,
  onBodyChange,
  onMoveEnd,
  onDelete,
  onBringToFront,
  onColorChange,
}) {
  const textRef = useRef(null);

  // local position for smooth drag
  const [pos, setPos] = useState({ x: x ?? 40, y: y ?? 40 });
  useEffect(() => {
    setPos({ x: x ?? 40, y: y ?? 40 });
  }, [x, y]);

  // minimizable state
  const [collapsed, setCollapsed] = useState(false);

  // auto-grow when not collapsed
  useEffect(() => {
    if (collapsed) return;
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 40)}px`;
  }, [body, collapsed]);

  /* ---------------------- Dragging (non-sticky) ---------------------- */
  const drag = useRef({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const handleHeaderMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    onBringToFront?.(id);

    drag.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!drag.current.active) return;

    // if button is released but mouseup somehow missed, stop dragging
    if (e.buttons === 0) {
      handleMouseUp();
      return;
    }

    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    const nx = Math.max(0, drag.current.originX + dx);
    const ny = Math.max(0, drag.current.originY + dy);
    setPos({ x: nx, y: ny });
  };

  const handleMouseUp = () => {
    if (!drag.current.active) return;
    drag.current.active = false;

    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);

    onMoveEnd?.(id, pos.x, pos.y);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  /* --------------------------- Handlers --------------------------- */

  const handleBodyChange = (e) => {
    onBodyChange?.(id, e.target.value);
  };

  const handleColorClick = (color, e) => {
    e.stopPropagation();
    onColorChange?.(id, { bgColor: color });
  };

  const handleToggleCollapsed = (e) => {
    e.stopPropagation();
    setCollapsed((c) => !c);
  };

  const effectiveBg = bgColor || "#020617";
  const effectiveText = textColor || "#e5e7eb";

  const containerWidth = collapsed ? 120 : width;

  /* --------------------------- Render --------------------------- */

  return (
    <div
      data-note-card="true"
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        zIndex: z || 1,
        width: containerWidth,
        borderRadius: 14,
        overflow: "hidden",
        background: "rgba(15,23,42,0.85)",
        border: "1px solid rgba(148,163,184,0.35)",
        boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
        backdropFilter: "blur(14px)",
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onBringToFront?.(id);
      }}
      onMouseUp={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header: drag + collapse + controls */}
      <div
        onMouseDown={handleHeaderMouseDown}
        style={{
          height: 30,
          padding: collapsed ? "4px 8px" : "6px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "grab",
          userSelect: "none",
          background:
            "linear-gradient(90deg, rgba(15,23,42,0.95), rgba(15,23,42,0.7))",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {/* collapse toggle */}
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleToggleCollapsed}
            style={{
              border: "none",
              background: "transparent",
              color: "#e5e7eb",
              fontSize: 12,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
            }}
          >
            {collapsed ? "▸" : "▾"}
          </button>
          {!collapsed && (
            <span
              style={{
                fontSize: 12,
                color: "#e5e7eb",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                opacity: 0.85,
              }}
            >
              Note
            </span>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {/* small color dots – hidden in ultra tiny mode? keep them but tight */}
          {!collapsed &&
            NOTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => handleColorClick(c, e)}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "999px",
                  border:
                    effectiveBg === c
                      ? "2px solid #38bdf8"
                      : "1px solid rgba(148,163,184,0.7)",
                  background: c,
                  cursor: "pointer",
                }}
              />
            ))}

          {/* clear trash icon */}
          <button
            type="button"
            title="Delete note"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(id);
            }}
            style={{
              border: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(248,113,113,0.15)",
              color: "#fecaca",
              cursor: "pointer",
              fontSize: 12,
              borderRadius: 999,
              padding: "3px 7px",
            }}
          >
            🗑
          </button>
        </div>
      </div>

      {/* Body (hidden when collapsed) */}
      {!collapsed && (
        <div
          style={{
            padding: "8px 10px 10px 10px",
            background: effectiveBg,
          }}
        >
          <textarea
            ref={textRef}
            value={body}
            onChange={handleBodyChange}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            placeholder="Write your note..."
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              resize: "none",
              background: "transparent",
              fontSize: 14,
              lineHeight: 1.5,
              fontFamily:
                "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
              color: effectiveText,
              overflow: "hidden",
            }}
            rows={1}
          />
        </div>
      )}
    </div>
  );
}
