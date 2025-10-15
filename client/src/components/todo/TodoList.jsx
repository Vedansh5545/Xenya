// client/src/components/todo/TodoList.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/* --------------------------------------------------
   Storage & constants
-------------------------------------------------- */
const LS_KEY = "xenya.todo.v1";
const LS_BONUS_LAST = "xenya.todo.lastBonusType.v1";
const LS_LAST_SETTINGS = "xenya.todo.lastQuickAdd.v1";

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const BUCKETS = ["TODAY", "WEEK", "BACKLOG"];
const DUE_OPTS = ["NONE", "TODAY", "THIS_WEEK", "DATE"];

const BONUS_TYPES = ["DSA", "OUTREACH", "PORTFOLIO", "RESEARCH", "GENERIC"];

const uid = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 12);

const read = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || { tasks: [] }; } catch { return { tasks: [] }; } };
const write = (db) => {
  localStorage.setItem(LS_KEY, JSON.stringify(db || { tasks: [] }));
  try { window.dispatchEvent(new CustomEvent("todo:changed")); } catch {}
};
const saveLastSettings = (o) => { try { localStorage.setItem(LS_LAST_SETTINGS, JSON.stringify(o)); } catch {} };
const loadLastSettings = () => { try { return JSON.parse(localStorage.getItem(LS_LAST_SETTINGS)) || {}; } catch { return {}; } };

/* --------------------------------------------------
   Helpers
-------------------------------------------------- */
const todayISO = () => new Date().toISOString().slice(0, 10);
const startOfWeekISO = () => { const d = new Date(); const day = d.getDay(); const diff = (day === 0 ? -6 : 1) - day; d.setDate(d.getDate() + diff); return d.toISOString().slice(0, 10); };
const endOfWeekISO   = () => { const d = new Date(startOfWeekISO()); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); };
const inThisWeek = (iso) => { if (!iso) return false; const a = new Date(iso).getTime(); return a >= new Date(startOfWeekISO()).getTime() && a <= new Date(endOfWeekISO()).getTime(); };

const pScore = (p) => ({ CRITICAL: 1.0, HIGH: 0.8, MEDIUM: 0.5, LOW: 0.2 }[p] || 0.5);
const bucketScore = (b) => ({ TODAY: 1.0, WEEK: 0.7, BACKLOG: 0.4 }[b] || 0.4);
const dueUrgency = (t) => {
  if (t.due === "TODAY") return 1.0;
  if (t.due === "THIS_WEEK") return 0.7;
  if (t.due === "DATE") {
    const days = Math.floor((new Date(t.dueDate) - new Date(todayISO())) / 86400000);
    if (isNaN(days)) return 0.4;
    if (days <= 0) return 1.0;
    if (days <= 2) return 0.9;
    if (days <= 6) return 0.8;
    if (days <= 14) return 0.65;
    return 0.5;
  }
  return 0.5;
};
const baseScore = (t) => bucketScore(t.bucket) * pScore(t.priority) * dueUrgency(t);

function inferAIFromTodos(tasks) {
  const today = tasks.filter((t) => t.bucket === "TODAY");
  const doneToday = today.filter((t) => t.status === "DONE");
  const totalToday = today.length || 1;
  const completionRatio = doneToday.length / totalToday;
  const minutesDone = doneToday.reduce((s, t) => s + (Number(t.estimate) || 0), 0);
  const energyRatio = Math.min(1, minutesDone / 120);
  const focusAI = Math.max(1, Math.min(5, Math.round(1 + completionRatio * 4)));
  const energyAI = Math.max(1, Math.min(5, Math.round(1 + energyRatio * 4)));
  return { focusAI, energyAI, meta: { completionRatio, minutesDone } };
}

/* Bonus helpers */
const isBonus = (t) => t?.bonus === true || /^bonus:/i.test(t?.title || "");
const getLastBonusType = () => { try { return localStorage.getItem(LS_BONUS_LAST) || ""; } catch { return ""; } };
const setLastBonusType = (typ) => { try { localStorage.setItem(LS_BONUS_LAST, typ || ""); } catch {} };

/* Smart quick-add tokens */
function parseQuickAdd(raw, defaults) {
  const out = { ...defaults };
  let title = raw;

  const p = raw.match(/!(critical|crit|high|med|medium|low)\b/i);
  if (p) { const m = p[1].toLowerCase(); out.priority = m.startsWith("crit") ? "CRITICAL" : m.startsWith("high") ? "HIGH" : m.startsWith("med") ? "MEDIUM" : "LOW"; title = title.replace(p[0], "").trim(); }
  const b = raw.match(/#(today|week|backlog)\b/i);
  if (b) { const m = b[1].toUpperCase(); out.bucket = m === "WEEK" ? "WEEK" : m === "BACKLOG" ? "BACKLOG" : "TODAY"; title = title.replace(b[0], "").trim(); }
  const e = raw.match(/~\s*(\d+)\s*m?/i);
  if (e) { out.estimate = Math.max(5, Math.min(480, Number(e[1] || 0))); title = title.replace(e[0], "").trim(); }
  const d = raw.match(/due:(today|week|this_week|\d{4}-\d{2}-\d{2})/i);
  if (d) { const v = d[1].toLowerCase(); if (v === "today") { out.due = "TODAY"; out.dueDate = ""; } else if (v === "week" || v === "this_week") { out.due = "THIS_WEEK"; out.dueDate = ""; } else { out.due = "DATE"; out.dueDate = v; } title = title.replace(d[0], "").trim(); }
  title = title.replace(/\s{2,}/g, " ").trim();
  return { title, ...out };
}

/* --------------------------------------------------
   Component
-------------------------------------------------- */
export default function TodoList() {
  const [db, setDb] = useState(read());

  // quick-add controls
  const last = loadLastSettings();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(last.priority || "MEDIUM");
  const [estimate, setEstimate] = useState(last.estimate || 25);
  const [bucket, setBucket] = useState(last.bucket || "TODAY");
  const [due, setDue] = useState(last.due || "NONE");
  const [dueDate, setDueDate] = useState(last.dueDate || "");
  const titleRef = useRef(null);

  // list controls
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("SCORE");

  // goals / capacity (from /api/state)
  const [goalsState, setGoalsState] = useState({ goals: { long: [], short: [] }, capacity: { userFocus: 3, userEnergy: 3 } });
  const [aiView, setAiView] = useState({ focusAI: 3, energyAI: 3, meta: { completionRatio: 0, minutesDone: 0 } });
  const [capSummary, setCapSummary] = useState({ totalPct: 50, minutesCap: 120, focus: 3, energy: 3 });

  useEffect(() => write(db), [db]);

  // Seed first run
  useEffect(() => {
    if ((db.tasks || []).length === 0) {
      setDb({
        tasks: [
          mk("Review class notes", "MEDIUM", 20, "TODAY"),
          mk("DSA warm-up (1 easy)", "HIGH", 25, "TODAY"),
          mk("Update resume bullet", "HIGH", 15, "WEEK", "THIS_WEEK"),
        ],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function mk(t, p = "MEDIUM", est = 30, b = "TODAY", d = "NONE", date = "", extras = {}) {
    return { id: uid(), title: t, priority: p, estimate: Number(est) || 30, bucket: b, status: "PLANNED", due: DUE_OPTS.includes(d) ? d : "NONE", dueDate: date || "", createdAt: new Date().toISOString(), ...extras };
  }

  function add(raw) {
    const base = { priority, estimate, bucket, due, dueDate };
    const parsed = parseQuickAdd(raw.trim(), base);
    const t = (parsed.title || "").trim();
    if (!t) return;
    const newTask = mk(t, parsed.priority, parsed.estimate, parsed.bucket, parsed.due, parsed.dueDate);
    setDb((d) => ({ ...d, tasks: [newTask, ...d.tasks] }));
    saveLastSettings({ priority: parsed.priority, estimate: parsed.estimate, bucket: parsed.bucket, due: parsed.due, dueDate: parsed.dueDate });
    setTitle("");
  }

  const patch  = (id, p) => setDb((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  const remove = (id)     => setDb((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
  const toggle = (id)     => setDb((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, status: t.status === "DONE" ? "PLANNED" : "DONE" } : t)) }));
  const moveBucket = (id, b) => patch(id, { bucket: b });

  const clearAll = () => { if (!confirm("Delete ALL tasks? This cannot be undone.")) return; setDb({ tasks: [] }); };

  /* ---------- Goals & capacity I/O ---------- */
  async function fetchGoalsState() {
    try {
      const r = await fetch("/api/state");
      const s = await r.json();
      const goals = s?.goals || { long: [], short: [] };
      const capacity = s?.capacity || { userFocus: 3, userEnergy: 3 };
      setGoalsState({ goals, capacity });
    } catch {}
  }
  useEffect(() => {
    fetchGoalsState();
    const onGoals = () => fetchGoalsState();
    window.addEventListener("goals:changed", onGoals);
    return () => window.removeEventListener("goals:changed", onGoals);
  }, []);

  /* ---------- Capacity blend & minutes cap ---------- */
  useEffect(() => {
    const ai = inferAIFromTodos(db.tasks || []);
    setAiView(ai);

    const userF = Number(goalsState.capacity.userFocus || 3);
    const userE = Number(goalsState.capacity.userEnergy || 3);
    const focus = 0.5 * userF + 0.5 * ai.focusAI;   // 1..5
    const energy = 0.5 * userE + 0.5 * ai.energyAI; // 1..5

    const focusPct = (focus - 1) / 4;
    const energyPct = (energy - 1) / 4;
    const totalPct = Math.round(100 * (0.5 * focusPct + 0.5 * energyPct));
    const minutesCap = Math.round(60 + (totalPct / 100) * 180);

    setCapSummary({ totalPct, minutesCap, focus, energy });
  }, [db.tasks, goalsState.capacity]);

  /* ---------- AI planner ---------- */
  function plannerScore(t) {
    const dueBoost = dueUrgency(t);
    const lenBoost = Math.max(0.85, Math.min(1.1, 45 / Math.max(15, Number(t.estimate) || 30)));
    return baseScore(t) * dueBoost * lenBoost;
  }

  // Allowed bonuses from blended focus/energy
  function allowedBonusCount() {
    const avg = Math.round((Number(capSummary.focus || 3) + Number(capSummary.energy || 3)) / 2);
    return { 1: 0, 2: 1, 3: 1, 4: 2, 5: 3 }[avg] ?? 1;
  }

  function nextBonusType(goals, excludeTypes = []) {
    const last = getLastBonusType();
    const gtext = [...(goals?.short || []), ...(goals?.long || [])].map(g => (g.title || "") + " " + (g.desc || "")).join(" ").toLowerCase();
    const pool = new Set();
    if (/(job|intern|interview|offer|leetcode|dsa)/i.test(gtext)) { pool.add("DSA"); pool.add("OUTREACH"); }
    if (/(portfolio|site|website|github|readme)/i.test(gtext)) { pool.add("PORTFOLIO"); }
    if (/(research|paper|survey|iclr|neurips|cvpr)/i.test(gtext)) { pool.add("RESEARCH"); }
    if (pool.size === 0) pool.add("GENERIC");
    for (const x of excludeTypes) pool.delete(x);
    let list = Array.from(pool);
    if (list.length === 0) list = BONUS_TYPES.filter(t => !excludeTypes.includes(t));
    if (list.length === 1 && list[0] !== last) return list[0];
    const all = [...list, ...BONUS_TYPES.filter(t => !list.includes(t) && !excludeTypes.includes(t))];
    const idx = Math.max(0, all.indexOf(last));
    return all[(idx + 1) % all.length];
  }

  function mkBonus(type) {
    switch (type) {
      case "DSA":       return mk("Bonus: DSA warm-up (1 easy)", "MEDIUM", 20, "TODAY", "NONE", "", { bonus: true, bonusType: "DSA" });
      case "OUTREACH":  return mk("Bonus: Draft a 10m outreach note", "LOW", 10, "TODAY", "NONE", "", { bonus: true, bonusType: "OUTREACH" });
      case "PORTFOLIO": return mk("Bonus: Polish one portfolio card", "LOW", 20, "TODAY", "NONE", "", { bonus: true, bonusType: "PORTFOLIO" });
      case "RESEARCH":  return mk("Bonus: Skim 1 related paper", "LOW", 20, "TODAY", "NONE", "", { bonus: true, bonusType: "RESEARCH" });
      default:          return mk("Bonus: 20m toward a key goal", "LOW", 20, "TODAY", "NONE", "", { bonus: true, bonusType: "GENERIC" });
    }
  }

  function ensureBonuses(tasks, used, cap) {
    // normalize
    for (const t of tasks) { if (/^bonus:/i.test(t.title) && t.bonus !== true) { t.bonus = true; if (!t.bonusType) t.bonusType = "GENERIC"; } }

    const allowed = allowedBonusCount();
    let active = tasks.filter((t) => isBonus(t) && t.status !== "DONE");
    for (const t of active) if (t.bucket === "TODAY") t.bucket = "WEEK";

    active = active.sort((a,b) => (a.estimate||0) - (b.estimate||0));
    let pulled = 0;
    for (const t of active) {
      if (pulled >= allowed) break;
      const est = Number(t.estimate) || 0;
      if (used + est <= cap) { t.bucket = "TODAY"; used += est; pulled++; }
    }

    const typesInUse = new Set(active.map(t => t.bonusType).filter(Boolean));
    while (pulled < allowed && (cap - used) >= 10) {
      const typ = nextBonusType(goalsState.goals, Array.from(typesInUse));
      const bonus = mkBonus(typ);
      tasks.push(bonus);
      typesInUse.add(typ);
      setLastBonusType(typ);
      used += bonus.estimate;
      pulled++;
    }
    return { tasks, used };
  }

  function rebuildTodayPlan() {
    let tasks = [...(db.tasks || [])];

    const doneIds = new Set(tasks.filter((t) => t.status === "DONE").map((t) => t.id));
    const candidates = tasks.filter((t) => !doneIds.has(t.id));

    const hardToday = candidates.filter((t) => t.due === "TODAY");
    hardToday.forEach((t) => (t.bucket = "TODAY"));

    const ranked = candidates.filter((t) => t.due !== "TODAY").slice().sort((a, b) => plannerScore(b) - plannerScore(a));

    let keepToday = hardToday.slice();
    let used = hardToday.reduce((s, t) => s + (Number(t.estimate) || 0), 0);
    const cap = capSummary.minutesCap;

    for (const t of ranked) {
      const est = Number(t.estimate) || 0;
      const duePush = t.due === "THIS_WEEK" || (t.due === "DATE" && inThisWeek(t.dueDate));
      if (used + est <= cap && (t.bucket !== "TODAY" || duePush) && !isBonus(t)) { t.bucket = "TODAY"; keepToday.push(t); used += est; }
    }

    const bonusResult = ensureBonuses(tasks, used, cap);
    tasks = bonusResult.tasks; used = bonusResult.used;

    const todayBonus = tasks.filter((t) => isBonus(t) && t.status !== "DONE" && t.bucket === "TODAY");
    for (const b of todayBonus) if (!keepToday.find((k) => k.id === b.id)) keepToday.push(b);

    const overflow = tasks.filter((t) => t.bucket === "TODAY" && !doneIds.has(t.id) && !keepToday.find((k) => k.id === t.id) && t.due !== "TODAY");
    overflow.forEach((t) => (t.bucket = "WEEK"));

    setDb({ tasks });
  }

  useEffect(() => {
    const id = setTimeout(rebuildTodayPlan, 120);
    return () => clearTimeout(id);
  }, [goalsState, db.tasks.length, capSummary.minutesCap, capSummary.focus, capSummary.energy]);

  /* ---------- Filtering & stats ---------- */
  const filtered = useMemo(() => {
    let arr = (db.tasks || []).filter((t) => t.title.toLowerCase().includes(query.toLowerCase()));
    if (sort === "SCORE") arr = arr.slice().sort((a, b) => baseScore(b) - baseScore(a));
    if (sort === "EST")   arr = arr.slice().sort((a, b) => a.estimate - b.estimate);
    if (sort === "NEW")   arr = arr.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return arr;
  }, [db, query, sort]);

  const stats = useMemo(() => {
    const today = db.tasks.filter((t) => t.bucket === "TODAY");
    const done = today.filter((t) => t.status === "DONE").length;
    const totalEst = today.reduce((s, t) => s + (Number(t.estimate) || 0), 0);
    const bonusCount = today.filter((t) => isBonus(t)).length;
    return { today: today.length, done, totalEst, bonusCount };
  }, [db]);

  /* ---------- Keyboard shortcuts ---------- */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === "Enter" && (e.metaKey || e.ctrlKey))) { if (document.activeElement === titleRef.current) add(title); }
      else if (e.key === "/") { if (document.activeElement !== titleRef.current) { e.preventDefault(); document.getElementById("todo-search")?.focus(); } }
      else if (e.key.toLowerCase() === "n") { if (document.activeElement !== titleRef.current) { e.preventDefault(); titleRef.current?.focus(); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [title]);

  /* --------------------------------------------------
     UI (Paper/Diary style)
  -------------------------------------------------- */
  return (
    <div className="paper-wrap">
      <style>{`
        /* Page background */
        .paper-wrap{
          --paper:#fdfaf5; --ink:#1c1b1a; --rule:#cfd6e6; --punch:#e7d3c8; --tab:#ffb4b4;
          --tab2:#c5f1ff; --tab3:#ffe6a7; --muted:#756e64; --ring:#d2cbc4;
          display:grid; gap:18px; padding:18px;
          background:
            radial-gradient(60% 40% at 20% 0%, rgba(255,255,255,.35), transparent 60%),
            linear-gradient(180deg,#f6efe7, #f2ece6);
          border-radius:22px; position:relative; box-shadow: 0 10px 40px rgba(0,0,0,.25) inset;
        }
        /* Binder holes */
        .paper-wrap:before{
          content:""; position:absolute; left:-14px; top:22px; bottom:22px; width:10px;
          background:
            radial-gradient(circle at center, #0002 0 4px, transparent 5px) 0 0/100% 42px repeat-y,
            radial-gradient(circle at center, var(--punch) 0 4px, transparent 4.5px) 0 0/100% 42px repeat-y;
          filter: blur(.2px);
        }
        /* Tabs */
        .tabs{
          position:absolute; right:-10px; top:18px; display:flex; flex-direction:column; gap:8px;
        }
        .tab{ width:80px; height:20px; border-radius:4px 4px 0 0; box-shadow:0 2px 6px rgba(0,0,0,.15); opacity:.95 }
        .tab:nth-child(1){ background:var(--tab) }
        .tab:nth-child(2){ background:var(--tab2) }
        .tab:nth-child(3){ background:var(--tab3) }

        /* Page */
        .page{
          background:
            repeating-linear-gradient(180deg, var(--paper) 0 34px, var(--paper) 34px 66px),
            repeating-linear-gradient(180deg, transparent 0 33px, var(--rule) 33px 34px);
          border-radius:16px; padding:18px; border:1px solid #0000000f;
          box-shadow: 0 2px 12px rgba(0,0,0,.08);
        }
        .page h1{
          font-family: ui-rounded, "SF Pro Rounded", system-ui, -apple-system, Segoe UI, Roboto, "Segoe Print", "Comic Sans MS", cursive;
          letter-spacing:.3px; margin:0 0 6px; font-size:22px; color:var(--ink);
        }
        .subtitle{ color:var(--muted); font-size:12px; margin-bottom:10px }

        /* Sticky note Quick Add */
        .sticky{
          display:grid; grid-template-columns: 1fr auto; align-items:center; gap:10px;
          background:linear-gradient(180deg,#fff8c6,#ffe99a);
          border:1px solid #e9d57b; border-radius:10px; padding:10px 12px;
          box-shadow: 0 8px 18px rgba(0,0,0,.12), 0 2px 0 #e0c86a inset;
          transform: rotate(-.4deg);
        }
        .sticky input{ background:transparent; border:none; outline:none; color:#5b4f2f; font-size:14px }
        .sticky .pill{ background:#fff4a8; border-color:#e7cf72; color:#5b4f2f }
        .sticky .btn{ background:#fff4a8; border-color:#e7cf72; color:#5b4f2f }

        /* Small controls */
        .pill{ display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px; border:1px solid #d9d3c9; background:#faf6ef; color:#574d44; cursor:pointer; transition:transform .08s ease, background .15s ease; }
        .pill:hover{ background:#f3ede4 }
        .btn{ padding:8px 12px; border-radius:10px; border:1px solid #d9d3c9; background:#faf6ef; color:#574d44; transition:transform .08s ease, background .15s ease; }
        .btn:hover{ background:#f3ede4 }
        .muted{ color:#766f67 }

        /* Planner strip */
        .plan{
          display:flex; flex-wrap:wrap; gap:10px; align-items:center;
          background:linear-gradient(180deg,#ffffff,#faf7f3); border:1px solid #e8e2da; border-radius:12px; padding:10px;
        }
        .chip{ height:26px; padding:0 10px; display:flex; align-items:center; gap:8px; border-radius:999px; background:#f5efe7; border:1px solid #e8e1d6; font-size:12px; }

        .bar{ position:relative; height:8px; border-radius:999px; background:#eadfd1; overflow:hidden; min-width:160px }
        .bar > span{ position:absolute; left:0; top:0; bottom:0; width:var(--w); background:linear-gradient(90deg,#ffa7a7,#ffd38a,#aee3ff) }

        /* List (ruled) */
        .list{ display:grid; gap:6px; margin-top:6px }
        .card{
          display:grid; grid-template-columns: 26px 1fr 96px 96px 120px 120px 90px auto;
          align-items:center; padding:8px 10px; border-radius:10px; background:linear-gradient(180deg, #fff, #fcfaf7);
          border:1px solid #e7e0d7; position:relative;
        }
        .card:after{
          content:""; position:absolute; left:12px; right:12px; bottom:8px; height:1px; background:#eadfd1; opacity:.7;
        }
        .line{ font-size:14px; color:#2f2c29 }
        select, .card input[type="number"], .card input[type="date"]{
          background:#fff; border:1px solid #e2dbd3; border-radius:8px; padding:6px 8px; color:#403a34
        }
        .strike{ text-decoration: line-through; opacity:.55 }

        .row-ctl{ display:grid; grid-template-columns: 1fr 160px auto; gap:10px; align-items:center; margin-top:8px }
        #todo-search{ background:#fff; border:1px solid #e2dbd3; border-radius:10px; padding:8px 10px; color:#403a34 }

        .td-empty{ font-size:14px; color:#6e655d; background:linear-gradient(180deg,#fff,#fcfaf7); border:1px dashed #e2dbd3; border-radius:12px; padding:14px; text-align:center }

        /* Print friendly */
        @media print{
          .paper-wrap{ box-shadow:none; padding:0; background:#fff }
          .tabs{ display:none }
          .sticky{ transform:none; box-shadow:none }
        }
      `}</style>

      {/* decorative tabs */}
      <div className="tabs" aria-hidden>
        <div className="tab" />
        <div className="tab" />
        <div className="tab" />
      </div>

      <div className="page">
        <h1>Daily Planner</h1>
        <div className="subtitle">Week {startOfWeekISO()} → {endOfWeekISO()}</div>

        {/* Plan summary */}
        <div className="plan" role="group" aria-label="AI planning summary">
          <span className="chip">Focus (You/AI): {goalsState.capacity.userFocus}/5 • {aiView.focusAI}/5</span>
          <span className="chip">Energy (You/AI): {goalsState.capacity.userEnergy}/5 • {aiView.energyAI}/5</span>
          <span className="chip">Capacity: {capSummary.minutesCap}m</span>
          <div className="bar" aria-hidden><span style={{"--w": capSummary.totalPct + "%"}}/></div>
          <button className="btn" onClick={rebuildTodayPlan}>Plan Today</button>
          <button className="btn" onClick={clearAll} title="Delete ALL tasks">Delete all</button>
          <span className="muted">Today: {stats.today} • Done: {stats.done} • Est: {stats.totalEst}m • Bonus: {stats.bonusCount}/{allowedBonusCount()}</span>
        </div>

        {/* Sticky-note quick add */}
        <div className="sticky" style={{marginTop:12, marginBottom:10}}>
          <input
            ref={titleRef}
            placeholder='Add a task… (tips: !high #today ~25m due:today / due:2025-10-30) · Enter to add'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(title); } }}
          />
          <div style={{display:"flex", gap:8, alignItems:"center"}}>
            <button className="pill" title="Priority" onClick={() => { const i = PRIORITIES.indexOf(priority); const next = PRIORITIES[(i+1)%PRIORITIES.length]; setPriority(next); saveLastSettings({ priority: next, estimate, bucket, due, dueDate }); }}>⚑ {priority.toLowerCase()}</button>
            <button className="pill" title="Bucket"   onClick={() => { const i = BUCKETS.indexOf(bucket); const next = BUCKETS[(i+1)%BUCKETS.length]; setBucket(next); saveLastSettings({ priority, estimate, bucket: next, due, dueDate }); }}>📥 {bucket.toLowerCase()}</button>
            <button className="pill" title="Due"      onClick={() => { const i = DUE_OPTS.indexOf(due); const next = DUE_OPTS[(i+1)%DUE_OPTS.length]; setDue(next); if (next !== "DATE") setDueDate(""); saveLastSettings({ priority, estimate, bucket, due: next, dueDate: next==="DATE" ? (dueDate||todayISO()) : "" }); }}>
              📅 {due === "DATE" ? (dueDate || "date") : due.toLowerCase().replace("_"," ")}
            </button>
            {due === "DATE" && (
              <input type="date" value={dueDate || todayISO()} onChange={(e) => { setDueDate(e.target.value); saveLastSettings({ priority, estimate, bucket, due, dueDate: e.target.value }); }} style={{ width: 150 }} />
            )}
            <button className="btn" onClick={() => { const v = Math.max(5, estimate - 5); setEstimate(v); saveLastSettings({ priority, estimate: v, bucket, due, dueDate }); }}>−5m</button>
            <span className="muted">~{estimate}m</span>
            <button className="btn" onClick={() => { const v = Math.min(480, estimate + 5); setEstimate(v); saveLastSettings({ priority, estimate: v, bucket, due, dueDate }); }}>+5m</button>
            <button className="btn" onClick={() => add(title)}>Add</button>
          </div>
        </div>

        {/* Controls */}
        <div className="row-ctl">
          <input id="todo-search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="SCORE">Sort: Priority</option>
            <option value="EST">Sort: Estimate</option>
            <option value="NEW">Sort: Newest</option>
          </select>
          <div className="muted">{new Date().toLocaleDateString()}</div>
        </div>

        {/* List */}
        <div className="list">
          {filtered.map((t) => (
            <div key={t.id} className="card">
              <input type="checkbox" checked={t.status === "DONE"} onChange={() => toggle(t.id)} />
              <div className={`line ${t.status === "DONE" ? "strike" : ""}`}>
                {t.title} {isBonus(t) && <span className="muted"> • bonus</span>}
              </div>

              <select value={t.priority} onChange={(e) => patch(t.id, { priority: e.target.value })}>
                {PRIORITIES.map((p) => (<option key={p}>{p}</option>))}
              </select>

              <select value={t.bucket} onChange={(e) => moveBucket(t.id, e.target.value)}>
                {BUCKETS.map((b) => (<option key={b}>{b}</option>))}
              </select>

              <select value={t.due} onChange={(e) => patch(t.id, { due: e.target.value, dueDate: e.target.value === "DATE" ? (t.dueDate || todayISO()) : "" })}>
                {DUE_OPTS.map((d) => (<option key={d} value={d}>{d.replace("_"," ")}</option>))}
              </select>

              <input type="date" disabled={t.due !== "DATE"} value={t.dueDate || ""} onChange={(e) => patch(t.id, { dueDate: e.target.value })} />
              <input type="number" min="5" step="5" value={t.estimate} onChange={(e) => patch(t.id, { estimate: Number(e.target.value) || t.estimate })} />

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => patch(t.id, { status: "PLANNED", bucket: "TODAY" })}>Do</button>
                <button className="btn" onClick={() => patch(t.id, { status: "DEFERRED", bucket: "WEEK" })}>Defer</button>
                <button className="btn" onClick={() => remove(t.id)}>Delete</button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="td-empty">Nothing here yet. Add a task or hit “Plan Today”.</div>}
        </div>
      </div>
    </div>
  );
}
