// client/src/components/todo/TodoList.jsx
import React, { useEffect, useMemo, useState } from "react";

const LS_KEY = "xenya.todo.v1";
const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const BUCKETS = ["TODAY", "WEEK", "BACKLOG"];

const uid = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 12);

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || { tasks: [] };
  } catch {
    return { tasks: [] };
  }
};
const write = (db) => localStorage.setItem(LS_KEY, JSON.stringify(db || { tasks: [] }));

export default function TodoList() {
  const [db, setDb] = useState(read());
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [estimate, setEstimate] = useState(30);
  const [bucket, setBucket] = useState("TODAY");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("SCORE");

  useEffect(() => write(db), [db]);

  // Seed a couple of tasks on first run
  useEffect(() => {
    if ((db.tasks || []).length === 0) {
      setDb({
        tasks: [
          mk("Review class notes", "MEDIUM", 20, "TODAY"),
          mk("DSA warm-up (1 easy)", "HIGH", 25, "TODAY"),
          mk("Update resume bullet", "HIGH", 15, "WEEK"),
        ],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function mk(t, p = "MEDIUM", est = 30, b = "TODAY") {
    return {
      id: uid(),
      title: t,
      priority: p,
      estimate: Number(est) || 30,
      bucket: b,
      status: "PLANNED",
      createdAt: new Date().toISOString(),
    };
  }

  function add() {
    const t = title.trim();
    if (!t) return;
    setDb((d) => ({ ...d, tasks: [mk(t, priority, estimate, bucket), ...d.tasks] }));
    setTitle("");
    setEstimate(30);
  }

  const patch = (id, p) =>
    setDb((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) }));

  const remove = (id) =>
    setDb((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));

  const toggle = (id) =>
    setDb((d) => ({
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === id ? { ...t, status: t.status === "DONE" ? "PLANNED" : "DONE" } : t
      ),
    }));

  const moveBucket = (id, b) => patch(id, { bucket: b });

  // lightweight score: TODAY > WEEK > BACKLOG combined with priority band
  const pScore = (p) => ({ CRITICAL: 1, HIGH: 0.8, MEDIUM: 0.5, LOW: 0.2 }[p] || 0.5);
  const score = (t) => (t.bucket === "TODAY" ? 1 : t.bucket === "WEEK" ? 0.7 : 0.4) * pScore(t.priority);

  const filtered = useMemo(() => {
    let arr = (db.tasks || []).filter((t) =>
      t.title.toLowerCase().includes(query.toLowerCase())
    );
    if (sort === "SCORE") arr = arr.slice().sort((a, b) => score(b) - score(a));
    if (sort === "EST") arr = arr.slice().sort((a, b) => a.estimate - b.estimate);
    if (sort === "NEW") arr = arr.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return arr;
  }, [db, query, sort]);

  const stats = useMemo(() => {
    const today = db.tasks.filter((t) => t.bucket === "TODAY");
    const done = today.filter((t) => t.status === "DONE").length;
    const totalEst = today.reduce((s, t) => s + (Number(t.estimate) || 0), 0);
    return { today: today.length, done, totalEst };
  }, [db]);

  return (
    <div className="todo-wrap">
      <style>{`
        .todo-wrap{ display:grid; gap:12px }
        .row{ display:grid; grid-template-columns: 1fr 120px 110px 130px auto; gap:8px; }
        .list{ display:grid; gap:8px; }
        .card{ display:grid; grid-template-columns: 26px 1fr 96px 96px 96px auto; align-items:center;
               padding:10px; border-radius:12px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.10) }
        .btn{ padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.06); color:#fff }
        .btn:hover{ background:rgba(255,255,255,.10) }
        input, select{ background:rgba(0,0,0,.4); border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:8px 10px; color:#fff }
        .muted{ opacity:.75 }
        .strike{ text-decoration: line-through; opacity:.7 }
        .td-empty{ font-size:14px; color:#e6f7ff; opacity:.85; background:rgba(255,255,255,.05); border:1px dashed rgba(255,255,255,.12); border-radius:14px; padding:14px; }
      `}</style>

      {/* quick add */}
      <div className="row">
        <input
          placeholder="Add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
          {BUCKETS.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <input
          type="number"
          min="5"
          step="5"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
        />
        <button className="btn" onClick={add}>Add</button>
      </div>

      {/* controls */}
      <div className="row" style={{ gridTemplateColumns: "1fr 160px 160px auto" }}>
        <input
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="SCORE">Sort: Priority</option>
          <option value="EST">Sort: Estimate</option>
          <option value="NEW">Sort: Newest</option>
        </select>
        <div className="muted">
          Today: {stats.today} • Done: {stats.done} • Est: {stats.totalEst}m
        </div>
      </div>

      {/* list */}
      <div className="list">
        {filtered.map((t) => (
          <div key={t.id} className="card">
            <input type="checkbox" checked={t.status === "DONE"} onChange={() => toggle(t.id)} />
            <div className={t.status === "DONE" ? "strike" : ""}>{t.title}</div>

            <select value={t.priority} onChange={(e) => patch(t.id, { priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>

            <select value={t.bucket} onChange={(e) => moveBucket(t.id, e.target.value)}>
              {BUCKETS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>

            <input
              type="number"
              min="5"
              step="5"
              value={t.estimate}
              onChange={(e) => patch(t.id, { estimate: Number(e.target.value) || t.estimate })}
            />

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => patch(t.id, { status: "PLANNED" })}>Do</button>
              <button className="btn" onClick={() => patch(t.id, { status: "DEFERRED", bucket: "WEEK" })}>Defer</button>
              <button className="btn" onClick={() => remove(t.id)}>Delete</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="td-empty">No tasks yet. Add one above.</div>}
      </div>
    </div>
  );
}
