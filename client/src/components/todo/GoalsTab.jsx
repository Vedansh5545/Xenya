// client/src/components/todo/GoalsTab.jsx
import React, { useEffect, useState } from "react";
import { loadState, saveState } from "../../lib/stateStore";

const LS_TODO = "xenya.todo.v1";

/* ----------------------------- utils ----------------------------- */
const uid = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 12);

const readJson = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback } };
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (aISO, bISO) => (!aISO || !bISO) ? Infinity : Math.floor((new Date(bISO) - new Date(aISO)) / 86400000);

const totalSwatch = (v) => {
  if (v < 30) return { name: "Very low", color: "#ef4444" };
  if (v < 50) return { name: "Low",      color: "#f97316" };
  if (v < 70) return { name: "Okay",     color: "#eab308" };
  if (v < 85) return { name: "High",     color: "#22c55e" };
  return { name: "Peak", color: "#06b6d4" };
};
const capLabel = (v5) => ["Very low","Low","Okay","High","Peak"][Math.min(5,Math.max(1,v5))-1];

/* ----------------------- AI inference (local) -------------------- */
function inferAIFromTodos() {
  const db = readJson(LS_TODO, { tasks: [] });
  const tasks = Array.isArray(db?.tasks) ? db.tasks : [];
  const today = tasks.filter(t => t.bucket === "TODAY");
  const doneToday = today.filter(t => t.status === "DONE");
  const totalToday = today.length || 1;
  const completionRatio = doneToday.length / totalToday;
  const minutesDone = doneToday.reduce((s,t)=>s + (Number(t.estimate)||0), 0);
  const energyRatio = Math.min(1, minutesDone / 120);
  const focusAI  = Math.max(1, Math.min(5, Math.round(1 + completionRatio*4)));
  const energyAI = Math.max(1, Math.min(5, Math.round(1 + energyRatio*4)));
  return { focusAI, energyAI, meta: { completionRatio, minutesDone } };
}
const toMeter = (user5, ai5) => Math.round(((0.5*user5 + 0.5*ai5) - 1) / 4 * 100);

/* --------------------------- defaults ---------------------------- */
const DEFAULT_STATE = {
  goals: {
    long:  [{ id: uid(), title: "Get an AI/ML job",   weight: 80, targetDate: "" }],
    short: [{ id: uid(), title: "Daily DSA warm-up",  weight: 60, targetDate: "" }],
  },
  capacity: { userFocus: 3, userEnergy: 3 },
  updatedAt: new Date().toISOString(),
};

/* --------------------------- UI pieces --------------------------- */
function NeonMeter({ label, user5, ai5, total }) {
  const { name, color } = totalSwatch(total);
  const userPct = ((user5-1)/4)*100;
  const aiPct   = ((ai5-1)/4)*100;

  return (
    <div className="nm-wrap" role="group" aria-label={`${label} meter`}>
      <style>{`
        .nm-wrap{ position:relative; padding:10px 12px; background:rgba(255,255,255,0.04);
                  border:1px solid rgba(255,255,255,0.12); border-radius:16px; width:100%;
                  max-width:100%; overflow:hidden; }
        .nm-title{ display:flex; justify-content:space-between; align-items:center;
                   gap:12px; flex-wrap:wrap; font-weight:750; letter-spacing:.2px; margin-bottom:8px }
        .nm-total{ display:flex; align-items:center; gap:10px; font-weight:600; flex-wrap:wrap }
        .nm-chip{ height:22px; padding:0 8px; border-radius:999px; font-size:12px;
                  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14) }
        .nm-pill{ position:relative; height:22px; border-radius:999px;
                  background:linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.04));
                  border:1px solid rgba(255,255,255,.16); overflow:hidden; width:100%; }
        .nm-fill{ position:absolute; top:0; bottom:0; border-radius:999px; }
        .nm-glow{ position:absolute; inset:0; pointer-events:none; box-shadow:0 0 22px var(--glow), inset 0 0 18px rgba(255,255,255,.08); border-radius:999px; opacity:.55 }
        .nm-sub{ height:8px; border-radius:999px; background:rgba(255,255,255,.06); margin-top:8px; overflow:hidden; width:100%; }
        .nm-sub-fill{ height:100%; border-radius:999px; }
        .nm-legend{ display:flex; gap:10px; flex-wrap:wrap; margin-top:8px }
        .nm-dot{ width:10px; height:10px; border-radius:50%; box-shadow:0 0 10px currentColor }
      `}</style>

      <div className="nm-title">
        <div style={{fontSize:16, minWidth:0, overflow:'hidden', textOverflow:'ellipsis'}}>{label}</div>
        <div className="nm-total" style={{color}}>
          <span className="nm-chip" style={{borderColor:`${color}55`}}>Total {total}% • {name}</span>
        </div>
      </div>

      <div className="nm-pill">
        <div className="nm-fill" style={{left:0,width:`${userPct}%`,background:"linear-gradient(90deg,#60a5fa,#22d3ee)"}}/>
        <div className="nm-fill" style={{right:0,width:`${aiPct}%`,background:"linear-gradient(90deg,#fb7185,#f472b6)"}}/>
        <div className="nm-glow" style={{"--glow": `${color}66`}}/>
      </div>

      <div className="nm-sub">
        <div className="nm-sub-fill" style={{width: `${total}%`, background: color}}/>
      </div>

      {/* Legend moved below so it never overflows horizontally */}
      <div className="nm-legend">
        <span className="nm-chip" style={{display:"flex",alignItems:"center",gap:6}}>
          <span className="nm-dot" style={{color:"#22d3ee"}}/> You {user5}/5
        </span>
        <span className="nm-chip" style={{display:"flex",alignItems:"center",gap:6}}>
          <span className="nm-dot" style={{color:"#fb7185"}}/> AI {ai5}/5
        </span>
      </div>
    </div>
  );
}

/* ============================== Component ============================== */
export default function GoalsTab(){
  const [state, setState] = useState(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    const s = await loadState(); if (s) setState(prev => ({ ...prev, ...s })); setLoading(false);
  })(); }, []);

  useEffect(() => {
    if (loading) return;
    const id = setTimeout(() => {
      saveState(state).then(() => { try { window.dispatchEvent(new CustomEvent("goals:changed")) } catch {} });
    }, 200);
    return () => clearTimeout(id);
  }, [state, loading]);

  const [ai, setAI] = useState(() => inferAIFromTodos());
  useEffect(() => {
    const h = () => setAI(inferAIFromTodos());
    window.addEventListener("todo:changed", h);
    return () => window.removeEventListener("todo:changed", h);
  }, []);

  const { goals, capacity } = state;
  const focusMeter  = toMeter(capacity.userFocus, ai.focusAI);
  const energyMeter = toMeter(capacity.userEnergy, ai.energyAI);

  /* -------------------------- helpers -------------------------- */
  const setCapacity = (patch) => setState(s => ({ ...s, capacity: { ...s.capacity, ...patch } }));
  const setGoals    = (g)    => setState(s => ({ ...s, goals: g }));

  const canRemove = (kind) => (goals[kind]?.length || 0) > 1;
  const addGoal = (kind) => setGoals({
    ...goals,
    [kind]: [{ id: uid(), title:"", weight:50, targetDate:"" }, ...(goals[kind]||[])],
  });
  const patchGoal = (kind, id, patch) =>
    setGoals({ ...goals, [kind]: goals[kind].map(it => it.id===id ? { ...it, ...patch } : it) });
  const removeGoal = (kind, id) =>
    setGoals(!canRemove(kind) ? goals : { ...goals, [kind]: goals[kind].filter(it => it.id!==id) });

  const urgency = (days) => {
    if (days === Infinity || isNaN(days)) return { label:"No date", color:"#94a3b8" };
    if (days <= 6)  return { label:`${days}d`, color:"#ef4444" };
    if (days <= 29) return { label:`${days}d`, color:"#f97316" };
    if (days <= 60) return { label:`${days}d`, color:"#eab308" };
    return { label:`${days}d`, color:"#22c55e" };
  };

  const mapWithDays = (arr) => arr.map(g => {
    const d = g.targetDate ? daysBetween(todayISO(), g.targetDate) : Infinity;
    return { ...g, daysLeft: d, urg: urgency(d) };
  });
  const longList  = mapWithDays(goals.long);
  const shortList = mapWithDays(goals.short);

  /* ----------------------------- view ----------------------------- */
  return (
    <div className="gx-wrap">
      <style>{`
        .gx-wrap{ display:grid; gap:16px; width:100%; max-width:100%; overflow-x:hidden }
        .gx-wrap *{ min-width:0; box-sizing:border-box } /* stop grid children from forcing overflow */

        .grid-2{ display:grid; gap:12px; grid-template-columns: 1fr 1fr; }
        @media (max-width: 1024px){ .grid-2{ grid-template-columns: 1fr } }

        .cols{ display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap:12px }
        @media (max-width: 1024px){ .cols{ grid-template-columns: 1fr } }

        .card{ background:rgba(12,14,20,.72); border:1px solid rgba(255,255,255,.14);
               border-radius:16px; padding:14px; backdrop-filter: blur(12px) saturate(120%);
               width:100%; max-width:100%; overflow:hidden }

        .h{ font-weight:800; letter-spacing:.25px; margin-bottom:8px }
        .muted{ opacity:.8 }
        .warn{ color:#ffd29d }

        /* Controls never exceed width; date column shrinks on small screens */
        .row{ display:grid; grid-template-columns: minmax(0,1fr) 88px minmax(120px, 22vw) 36px;
              gap:8px; align-items:center }
        @media (max-width: 820px){
          .row{ grid-template-columns: minmax(0,1fr) minmax(100px, 30vw); grid-auto-rows:auto }
          .row > :nth-child(2){ order:3 } /* weight */
          .row > :nth-child(3){ order:2 } /* date */
          .row > :nth-child(4){ order:4 } /* delete */
        }

        .list{ display:grid; gap:8px }

        .btn{ padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
              background:rgba(255,255,255,.06); color:#fff; max-width:100% }
        .btn:hover{ background:rgba(255,255,255,.10) }

        input[type="text"], input[type="date"], input[type="number"]{
          background:rgba(0,0,0,.4); border:1px solid rgba(255,255,255,.12); color:#fff; border-radius:10px;
          padding:8px 10px; width:100%;
        }

        .cap-ctl{ display:grid; grid-template-columns: 110px minmax(0,1fr) 92px; gap:10px; align-items:center }
        .slider{ appearance:none; width:100%; height:6px; border-radius:999px; background:rgba(255,255,255,.18); outline:none }
        .slider::-webkit-slider-thumb{ appearance:none; width:16px; height:16px; border-radius:50%;
          background:linear-gradient(180deg,#22d3ee,#06b6d4); border:1px solid rgba(255,255,255,.6); box-shadow:0 0 14px #22d3ee88 }

        .goal-chip{ display:flex; align-items:center; gap:10px; padding:10px; border-radius:12px;
                    background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.10); width:100% }
        .dot{ width:10px; height:10px; border-radius:50% }
        .title{ font-weight:650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
        .meta{ font-size:12px; opacity:.8; white-space:nowrap }
      `}</style>

      {/* Focus & Energy */}
      <div className="card">
        <div className="h">Focus & Mental Capacity</div>
        <div className="muted" style={{marginBottom:10}}>
          Each score = <b>50% AI</b> (from your To-Do activity) + <b>50% You</b> (how you feel today).
        </div>

        <NeonMeter label="Focus" user5={capacity.userFocus} ai5={ai.focusAI} total={focusMeter} />
        <div className="cap-ctl" style={{marginTop:10}}>
          <div className="muted">Your Focus</div>
          <input className="slider" type="range" min="1" max="5"
                 value={capacity.userFocus}
                 onChange={(e)=>setCapacity({ userFocus: Number(e.target.value) })}/>
          <div>{capacity.userFocus} • {capLabel(capacity.userFocus)}</div>
        </div>

        <div style={{height:12}}/>
        <NeonMeter label="Energy" user5={capacity.userEnergy} ai5={ai.energyAI} total={energyMeter} />
        <div className="cap-ctl" style={{marginTop:10}}>
          <div className="muted">Your Energy</div>
          <input className="slider" type="range" min="1" max="5"
                 value={capacity.userEnergy}
                 onChange={(e)=>setCapacity({ userEnergy: Number(e.target.value) })}/>
          <div>{capacity.userEnergy} • {capLabel(capacity.userEnergy)}</div>
        </div>

        <div className="muted" style={{marginTop:10}}>
          AI context: {Math.round(ai.meta.completionRatio*100)}% of TODAY done • {ai.meta.minutesDone}m completed.
        </div>
      </div>

{/* Editors + Lists */}
<div className="cols">
  {/* ====== EDITOR (reworked, non-overlapping) ====== */}
  <div className="card">
    <div className="h">Edit Goals</div>

    <style>{`
      .goal-row{ display:grid; gap:10px; padding:10px; border-radius:12px;
                 background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08) }
      .goal-title{ width:100%; min-width:0; background:rgba(0,0,0,.4);
                   border:1px solid rgba(255,255,255,.12); color:#fff; border-radius:10px; padding:10px }
      .mini{ display:flex; gap:10px; align-items:center; flex-wrap:wrap }
      .field{ display:flex; flex-direction:column; gap:4px; min-width:150px; flex:1 }
      .field label{ font-size:12px; opacity:.8 }
      .field input{ width:100%; background:rgba(0,0,0,.4); border:1px solid rgba(255,255,255,.12);
                    color:#fff; border-radius:10px; padding:8px 10px }
      .kill{ padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
             background:rgba(255,255,255,.06); color:#fff }
      .kill:hover{ background:rgba(255,255,255,.12) }
      .add-btn{ padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.12);
                background:rgba(255,255,255,.06); color:#fff; width:100% }
      .col-head{ font-weight:600; margin:6px 0 8px; opacity:.9 }
      .grid-2-tight{ display:grid; gap:14px; grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
      @media (max-width: 1024px){ .grid-2-tight{ grid-template-columns: 1fr } }
    `}</style>

    <div className="grid-2-tight">
      {/* Long-term */}
      <div>
        <div className="col-head">Long-Term (≥ 3 months). Must keep ≥1.</div>
        <button className="add-btn" onClick={()=>addGoal("long")}>+ Add long-term goal</button>
        <div className="list" style={{marginTop:10}}>
          {goals.long.map(g=>(
            <div key={g.id} className="goal-row">
              <input
                className="goal-title"
                type="text"
                placeholder="e.g., Get an AI/ML job"
                value={g.title}
                onChange={e=>patchGoal("long", g.id, { title: e.target.value })}
              />
              <div className="mini">
                <div className="field">
                  <label>Importance (0–100)</label>
                  <input
                    type="number" min="0" max="100" value={g.weight}
                    onChange={e=>patchGoal("long", g.id, { weight: Math.max(0,Math.min(100,Number(e.target.value)||g.weight)) })}
                  />
                </div>
                <div className="field" style={{minWidth:200}}>
                  <label>Deadline</label>
                  <input
                    type="date" value={g.targetDate}
                    onChange={e=>patchGoal("long", g.id, { targetDate: e.target.value })}
                  />
                </div>
                <button className="kill" disabled={!canRemove("long")} onClick={()=>removeGoal("long", g.id)}>✕ Remove</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Short-term */}
      <div>
        <div className="col-head">Short-Term (1–3 months). Must keep ≥1.</div>
        <button className="add-btn" onClick={()=>addGoal("short")}>+ Add short-term goal</button>
        <div className="list" style={{marginTop:10}}>
          {goals.short.map(g=>(
            <div key={g.id} className="goal-row">
              <input
                className="goal-title"
                type="text"
                placeholder="e.g., Ship portfolio site"
                value={g.title}
                onChange={e=>patchGoal("short", g.id, { title: e.target.value })}
              />
              <div className="mini">
                <div className="field">
                  <label>Importance (0–100)</label>
                  <input
                    type="number" min="0" max="100" value={g.weight}
                    onChange={e=>patchGoal("short", g.id, { weight: Math.max(0,Math.min(100,Number(e.target.value)||g.weight)) })}
                  />
                </div>
                <div className="field" style={{minWidth:200}}>
                  <label>Deadline</label>
                  <input
                    type="date" value={g.targetDate}
                    onChange={e=>patchGoal("short", g.id, { targetDate: e.target.value })}
                  />
                </div>
                <button className="kill" disabled={!canRemove("short")} onClick={()=>removeGoal("short", g.id)}>✕ Remove</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="muted" style={{marginTop:10}}>Changes auto-save to <code>data/user-state.json</code>.</div>
  </div>

        {/* Lists column (saved state) */}
        <div className="card">
          <div className="h">Saved Goals & Deadlines</div>
          <div className="list">
            <div className="goal-chip">
              <span className="title">Long-Term</span><span className="meta">≥ 3 months</span>
            </div>
            {longList.map(g=>(
              <div key={g.id} className="goal-chip">
                <span className="dot" style={{background:g.urg.color}}/>
                <div style={{flex:1, minWidth:0}}>
                  <div className="title">{g.title || <span className="meta">Untitled</span>}</div>
                  <div className="meta">Importance {g.weight}/100 • {g.targetDate ? `Due ${g.targetDate}` : "No date set"}</div>
                </div>
                <div className="meta" style={{color:g.urg.color}}>{g.urg.label}</div>
              </div>
            ))}

            <div className="goal-chip" style={{marginTop:8}}>
              <span className="title">Short-Term</span><span className="meta">1–3 months</span>
            </div>
            {shortList.map(g=>(
              <div key={g.id} className="goal-chip">
                <span className="dot" style={{background:g.urg.color}}/>
                <div style={{flex:1, minWidth:0}}>
                  <div className="title">{g.title || <span className="meta">Untitled</span>}</div>
                  <div className="meta">Importance {g.weight}/100 • {g.targetDate ? `Due ${g.targetDate}` : "No date set"}</div>
                </div>
                <div className="meta" style={{color:g.urg.color}}>{g.urg.label}</div>
              </div>
            ))}
          </div>
        </div>
</div>


  

      {/* Status */}
      <div className="card">
        <div className="h">Status & Rules</div>
        <div className="muted">
          Long-term ≥ 3 months • Short-term 1–3 months • &lt; 1 month belongs in the To-Do tab.
          Data is shared via <code>/api/state</code> and events <code>goals:changed</code>.
        </div>
      </div>
    </div>
  );
}
