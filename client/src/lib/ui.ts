// Xenya tone: short, crisp, a hint of dry wit. Motto: "Consider it sorted."
export const TONE = {
  motto: "Consider it sorted.",
  error: (hint?: string) => `Didn't catch that${hint ? ` — ${hint}` : ""}. One more go?`,
  tip: (msg: string) => `Tip: ${msg}`,
  done: "All set.",
};

export const COPY = {
  emptyChat: "Consider it sorted. Start with a question or try /research.",
  emptyNotes: "No notes yet. Click + to jot things down.",
  loading: "Thinking…",
  errorGeneric: "Something went sideways. One more go?",
};

export function initShortcuts() {
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "enter")
      document.getElementById("send-btn")?.dispatchEvent(new MouseEvent("click"));
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n")
      document.getElementById("new-chat-btn")?.click();
  });
}
