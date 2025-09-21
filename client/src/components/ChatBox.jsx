import { useEffect, useMemo, useRef, useState } from "react";
import Mic from "./Mic.jsx";

/**
 * ComposerBox
 * - Replaces the plain input+buttons with a wave-animated composer.
 * - Shows animated sound waves directly INSIDE the composer while:
 *   listening, transcribing, or processing (busy).
 * - Hides the inner neon rectangle you disliked.
 *
 * Props:
 *  - value: string
 *  - onChange(next: string)
 *  - onSend()  -> call your existing send()
 *  - busy: boolean
 *  - onTranscript(text: string) -> same handler you already have
 */
export default function ComposerBox({
  value,
  onChange,
  onSend,
  busy = false,
  onTranscript,
}) {
  const [mode, setMode] = useState("idle"); // idle | listening | transcribing | processing
  const inputRef = useRef(null);

  // When the parent is busy, show "processing" waves in the bar
  useEffect(() => {
    if (busy) setMode((m) => (m === "listening" || m === "transcribing" ? m : "processing"));
    else setMode((m) => (m === "processing" ? "idle" : m));
  }, [busy]);

  // Build 28 animated bars with staggered delays/durations
  const bars = useMemo(() => Array.from({ length: 28 }), []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend?.();
    }
  };

  return (
    <div className={`composer ${busy ? "is-busy" : ""} ${mode !== "idle" ? "show-wave" : ""}`}>
      {/* INPUT — hidden while wave is showing */}
      <input
        ref={inputRef}
        className="input"
        placeholder="Message Xenya…"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{
          opacity: mode === "idle" ? 1 : 0,
          pointerEvents: mode === "idle" ? "auto" : "none",
        }}
      />

      {/* WAVE — appears only when listening/transcribing/processing */}
      {mode !== "idle" && (
        <div className={`voice-wave ${mode}`} aria-hidden="true">
          {bars.map((_, i) => (
            <span
              key={i}
              style={{
                animationDelay: `${i * 60}ms`,
                animationDuration: `${0.9 + (i % 5) * 0.08}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* TALK (Mic) */}
      <Mic
        onTranscript={async (text) => {
          setMode("transcribing");
          await onTranscript?.(text);
        }}
        onStatusChange={(s) => {
          // Mic should send: "listening" | "transcribing" | "idle"
          if (s === "listening" || s === "transcribing") setMode(s);
          else if (s === "idle") setMode(busy ? "processing" : "idle");
        }}
      />

      {/* SEND */}
      <button className="button" onClick={onSend} disabled={busy || !value?.trim?.()}>
        {busy ? "Processing…" : "Send"}
      </button>
    </div>
  );
}
