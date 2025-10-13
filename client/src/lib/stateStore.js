// client/src/lib/stateStore.js
const LS_KEY = "xenya.userState.v1";

export async function loadState() {
  try {
    const r = await fetch("/api/state");
    if (!r.ok) throw new Error("server");
    const data = await r.json();
    localStorage.setItem(LS_KEY, JSON.stringify(data)); // cache
    return data;
  } catch {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || null } catch { return null }
  }
}

export async function saveState(next) {
  localStorage.setItem(LS_KEY, JSON.stringify(next)); // optimistic cache
  try {
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  } catch {
    // offline: cached; server will catch up next time
  }
}
