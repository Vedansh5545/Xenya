import { useEffect, useRef, useState } from "react";

/* ---------- Local store ---------- */
const LS = "xenya.kanban.v1";
function load() {
  try { return JSON.parse(localStorage.getItem(LS)) || { tasks: [] }; } catch { return { tasks: [] }; }
}
function save(data) { localStorage.setItem(LS, JSON.stringify(data)); }
function newid() { return "t_" + Math.random().toString(36).slice(2, 8) + "_" + Date.now().toString(36); }
function writeAndNotify(data){ save(data); window.dispatchEvent(new CustomEvent("kanban:updated")); }

/* ===== Public API (chat ↔ Kanban) ===== */
export function addKanbanTask(title, col="inbox", colors=[], flags=[]){
  const db = load();
  const cleanFlags  = Array.from(new Set((flags||[]).map(f=>f.trim()).filter(Boolean)));
  const cleanColors = (colors||[]).slice(0,2);
  const task = {
    id:newid(),
    title: title.trim(),
    col,
    created: Date.now(),
    colors: cleanColors,
    flags : cleanFlags,
    // legacy mirrors (for backward compatibility with any old code)
    color: cleanColors[0] || "",
    flag : cleanFlags.join(",")
  };
  db.tasks.unshift(task);
  writeAndNotify(db);
  return true;
}
export function moveKanbanTaskByTitle(substr, col){
  const s = (substr||"").toLowerCase();
  if(!s) return false;
  const db = load();
  const t = db.tasks.find(x => (x.title||"").toLowerCase().includes(s));
  if(!t) return false;
  t.col = col;
  t.moved = Date.now();
  writeAndNotify(db);
  return true;
}

/* ----- helpers / migration ----- */
function normTask(t){
  const colors = Array.isArray(t.colors)
    ? t.colors.slice(0,2)
    : (t.color ? [t.color] : []);
  const flags = Array.isArray(t.flags)
    ? t.flags
    : ((t.flag || "").split(",").map(s=>s.trim()).filter(Boolean));
  return { ...t, colors, flags };
}
function updTask(id, patch){
  const db = load();
  const i = db.tasks.findIndex(t=>t.id===id);
  if(i>=0){
    db.tasks[i] = { ...db.tasks[i], ...patch };
    if (patch.colors) db.tasks[i].color = patch.colors[0] || "";
    if (patch.flags)  db.tasks[i].flag  = patch.flags.join(",");
    writeAndNotify(db);
    return true;
  }
  return false;
}
function delTask(id){
  const db = load();
  const next = db.tasks.filter(t=>t.id!==id);
  writeAndNotify({ tasks: next });
  return true;
}

/* ---------- Color + flag defs ---------- */
const PALETTE = [
  { key:'red',    hex:'#ff4d4f', label:'Red (P1)'    },
  { key:'orange', hex:'#ff9800', label:'Orange (P2)' },
  { key:'yellow', hex:'#f4d13d', label:'Yellow'      },
  { key:'green',  hex:'#22c55e', label:'Green'       },
  { key:'blue',   hex:'#3b82f6', label:'Blue'        },
  { key:'purple', hex:'#a855f7', label:'Purple'      },
  { key:'gray',   hex:'#9ca3af', label:'Gray'        },
];
const COLOR_INDEX = Object.fromEntries(PALETTE.map((c,i)=>[c.hex.toLowerCase(), i]));
const RED    = PALETTE[0].hex;
const ORANGE = PALETTE[1].hex;

function hasP1(flags){ return flags.some(f => /^p1$|^priority\s*1$|^urgent$|^important$/i.test(f)); }
function hasP2(flags){ return flags.some(f => /^p2$|^priority\s*2$|^high$/i.test(f)); }

/* ---------- UI ---------- */
export default function MiniKanban({ open, onClose }) {
  const [data, setData] = useState(() => load());

  // creator controls
  const [input, setInput] = useState("");
  const [newColors, setNewColors] = useState([]);
  const [newFlags, setNewFlags]   = useState([]);
  const [newFlagInput, setNewFlagInput] = useState('');

  // filters
  const [flagFilter, setFlagFilter] = useState('all');
  const [colorFilter, setColorFilter] = useState('any');
  const [sortBy, setSortBy] = useState('none'); // 'flag' | 'color'

  const overlayRef = useRef(null);

  useEffect(() => {
    function onUpd(){ setData(load()); }
    function onKey(e){ if(!open) return; if(e.key === "Escape") onClose?.(); }
    window.addEventListener("kanban:updated", onUpd);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("kanban:updated", onUpd); window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  // Hide dock (Notes + Productivity) while open
  useEffect(()=>{
    if(!open) return;
    const dock = document.getElementById('x-dock');
    if (dock) dock.classList.add('dock-hidden');
    return ()=>{ if (dock) dock.classList.remove('dock-hidden'); };
  }, [open]);

  /* ----- creator helpers ----- */
  function toggleNewColor(hex){
    setNewColors(prev=>{
      const exists = prev.includes(hex);
      let next = exists ? prev.filter(c=>c!==hex) : [...prev, hex];
      if (next.length > 2) next = next.slice(-2);
      // auto flags for priority colors
      if (!exists && hex === RED && !newFlags.includes('p1')) setNewFlags(f => [...f, 'p1']);
      if (!exists && hex === ORANGE && !newFlags.includes('p2')) setNewFlags(f => [...f, 'p2']);
      return next;
    });
  }
  function addNewFlagsFromInput(){
    const raw = newFlagInput.trim();
    if(!raw) return;
    const parts = raw.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);
    setNewFlags(prev => Array.from(new Set([...prev, ...parts.map(p=>p.toLowerCase())])));
    setNewFlagInput('');
  }
  function removeNewFlag(f){ setNewFlags(prev => prev.filter(x=>x!==f)); }

  function addTask(){
    const t = input.trim();
    if(!t) return;
    addKanbanTask(t, "inbox", newColors, newFlags);
    setInput("");
    setNewColors([]);
    setNewFlags([]);
    setNewFlagInput('');
  }

  function onDrop(col, e){
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if(id) updTask(id, { col });
  }

  /* ----- derived ----- */
  const allTasks = (data.tasks||[]).map(normTask);
  const allFlags = Array.from(new Set(allTasks.flatMap(t => t.flags))).sort((a,b)=>a.localeCompare(b));
  const colorOptions = PALETTE;

  function applyFilters(items){
    let out = items;
    if (flagFilter !== 'all') out = out.filter(t => t.flags.includes(flagFilter));
    if (colorFilter !== 'any') out = out.filter(t => (t.colors||[]).includes(colorFilter));
    if (sortBy === 'flag'){
      out = out.slice().sort((a,b)=>{
        const aw = hasP1(a.flags)?2 : hasP2(a.flags)?1 : 0;
        const bw = hasP1(b.flags)?2 : hasP2(b.flags)?1 : 0;
        if (bw !== aw) return bw - aw;
        return (b.created||0) - (a.created||0);
      });
    } else if (sortBy === 'color'){
      out = out.slice().sort((a,b)=>{
        const ai = Math.min(...(a.colors||[]).map(c=>COLOR_INDEX[(c||'').toLowerCase()] ?? 99), 99);
        const bi = Math.min(...(b.colors||[]).map(c=>COLOR_INDEX[(c||'').toLowerCase()] ?? 99), 99);
        if (ai !== bi) return ai - bi;
        return (b.created||0) - (a.created||0);
      });
    }
    return out;
  }

  if(!open) return null;

  return (
    <>
      {/* inline styles so no extra CSS file is needed */}
      <style>{`
        .mk-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.45);backdrop-filter:blur(6px);z-index:9998;}
        .mk-card{position:fixed;right:24px;top:96px;width:min(980px, calc(100vw - 48px));background:rgba(18,18,32,0.96);
          border:1px solid rgba(255,255,255,0.08);border-radius:16px;box-shadow:0 12px 36px rgba(0,0,0,0.5);z-index:10060;}
        .mk-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.06)}
        .mk-title{font-weight:600;opacity:.9}
        .mk-close{background:transparent;border:0;color:#ddd;cursor:pointer}

        .mk-add{display:flex;flex-direction:column;gap:8px;padding:12px;border-bottom:1px solid rgba(255,255,255,0.06)}
        .mk-add-top{display:flex;gap:8px}
        .mk-add input.mk-title{flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#eee;border-radius:10px;padding:8px}
        .mk-btn{background:rgba(122,62,255,0.2);border:1px solid rgba(122,62,255,0.6);color:#eee;border-radius:10px;padding:8px 12px;cursor:pointer}

        .mk-add-row{display:flex;flex-wrap:wrap;gap:6px}
        .mk-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.05);padding:4px 8px;border-radius:999px;cursor:pointer}
        .mk-chip.selected{outline:2px solid rgba(255,255,255,0.25)}
        .mk-dot-big{width:14px;height:14px;border-radius:999px}
        .mk-input{flex:1 1 220px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#eee;border-radius:8px;padding:6px}
        .mk-chip-x{margin-left:4px;opacity:.8;cursor:pointer}

        .mk-filters{display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06)}
        .mk-select{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#eee;border-radius:10px;padding:6px 10px}

        .mk-body{padding:12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
        .mk-col{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;min-height:240px;padding:8px}
        .mk-col h4{margin:0 0 6px 0;font-size:13px;letter-spacing:.08em;opacity:.85;display:flex;justify-content:space-between}
        .mk-list{display:flex;flex-direction:column;gap:6px;min-height:180px}
        .mk-item{background:rgba(255,255,255,0.05);border:1.8px solid rgba(255,255,255,0.1);border-radius:10px;padding:8px;cursor:grab;display:flex;flex-direction:column;gap:6px}
        .mk-row{display:flex;align-items:center;gap:8px}
        .mk-dot{width:12px;height:12px;border-radius:999px;outline:1px solid rgba(255,255,255,0.25)}
        .mk-titleline{flex:1;font-weight:600}
        .mk-actions{display:flex;gap:6px}
        .mk-icon{font-size:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);padding:4px 6px;border-radius:8px;color:#eee;cursor:pointer}
        .mk-flag{font-size:11px;padding:2px 6px;border-radius:999px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15)}
        .mk-empty{opacity:.7;font-style:italic;padding:6px}
        .mk-edit{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
        .mk-save{background:rgba(0,229,255,0.18);border:1px solid rgba(0,229,255,0.5);color:#e6feff;border-radius:8px;padding:6px 10px;cursor:pointer}
        .mk-danger{background:rgba(255,0,64,0.14);border:1px solid rgba(255,0,64,0.5);color:#ffd6de;border-radius:8px;padding:6px 10px;cursor:pointer}
      `}</style>

      <div className="mk-overlay" ref={overlayRef} onClick={(e)=>{ if(e.target===overlayRef.current) onClose?.() }} />

      <div className="mk-card" role="dialog" aria-modal="true">
        <div className="mk-head">
          <div className="mk-title">Xenya • Kanban (MVP)</div>
          <button className="mk-close" onClick={onClose} title="Close">✕</button>
        </div>

        {/* Create new task with colors + flags */}
        <div className="mk-add">
          <div className="mk-add-top">
            <input
              className="mk-title"
              placeholder='Add task to Inbox… (Enter to add)'
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') addTask() }}
            />
            <button className="mk-btn" onClick={addTask}>Add</button>
          </div>

          <div className="mk-add-row">
            {/* quick P1 / P2 */}
            <span className="mk-chip" onClick={()=>{ if(!newFlags.includes('p1')) setNewFlags([...newFlags,'p1']); toggleNewColor(RED); }}>
              P1 <span className="mk-dot-big" style={{background:RED}}/>
            </span>
            <span className="mk-chip" onClick={()=>{ if(!newFlags.includes('p2')) setNewFlags([...newFlags,'p2']); toggleNewColor(ORANGE); }}>
              P2 <span className="mk-dot-big" style={{background:ORANGE}}/>
            </span>

            {/* palette (max 2) */}
            {PALETTE.map(c=>(
              <span
                key={c.hex}
                className={`mk-chip ${newColors.includes(c.hex)?'selected':''}`}
                onClick={()=>toggleNewColor(c.hex)}
                title={c.label}
              >
                <span className="mk-dot-big" style={{background:c.hex}}/>
                {c.key}
              </span>
            ))}

            {/* flags input */}
            {(newFlags||[]).map(f=>(
              <span key={f} className="mk-chip">
                {f}
                <span className="mk-chip-x" onClick={()=>removeNewFlag(f)}>×</span>
              </span>
            ))}
            <input
              className="mk-input"
              placeholder="Add flags… (Enter or ,)"
              value={newFlagInput}
              onChange={e=>setNewFlagInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter' || e.key===','){ e.preventDefault(); addNewFlagsFromInput(); } }}
              style={{minWidth:180}}
            />
          </div>
        </div>

        {/* Filters */}
        <div className="mk-filters">
          <label>Flag:&nbsp;
            <select className="mk-select" value={flagFilter} onChange={e=>setFlagFilter(e.target.value)}>
              <option value="all">All</option>
              {['p1','p2', ...allFlags.filter(f=>!/^p[12]$/i.test(f))].map(f=>(
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <label>Color:&nbsp;
            <select className="mk-select" value={colorFilter} onChange={e=>setColorFilter(e.target.value)}>
              <option value="any">Any</option>
              {colorOptions.map(c=>(
                <option key={c.hex} value={c.hex}>{c.label}</option>
              ))}
            </select>
          </label>
          <label>Sort:&nbsp;
            <select className="mk-select" value={sortBy} onChange={e=>setSortBy(e.target.value)}>
              <option value="none">Default</option>
              <option value="flag">Flag (P1→P2→others)</option>
              <option value="color">Color order (R→…)</option>
            </select>
          </label>
        </div>

        <div className="mk-body">
          {["inbox","doing","done"].map(col=>{
            const items = applyFilters(allTasks.filter(t=>t.col===col));
            return (
              <div key={col} className="mk-col" onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(col, e)}>
                <h4>{col.toUpperCase()} <span>{items.length}</span></h4>
                <div className="mk-list">
                  {items.map(t=>(
                    <TaskCard key={t.id} t={t} />
                  ))}
                  {!items.length && <div className="mk-empty">Nothing here.</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ---------- Task Card ---------- */
function TaskCard({ t }){
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [colors, setColors] = useState(Array.isArray(t.colors) ? t.colors.slice(0,2) : []);
  const [flags, setFlags]   = useState(Array.isArray(t.flags) ? t.flags : []);
  const [flagInput, setFlagInput] = useState('');

  useEffect(()=>{ 
    setTitle(t.title);
    setColors(Array.isArray(t.colors)? t.colors.slice(0,2) : []);
    setFlags(Array.isArray(t.flags)? t.flags : []);
    setFlagInput('');
  }, [t.id]);

  const effectiveColors = (() => {
    if (colors.length >= 1) return colors.slice(0,2);
    if (hasP1(flags)) return [RED];
    if (hasP2(flags)) return [ORANGE];
    return [];
  })();

  const styleBorder = (() => {
    if (effectiveColors.length >= 2) {
      const [c1, c2] = effectiveColors;
      return {
        borderColor: 'transparent',
        borderImage: `linear-gradient(90deg, ${c1} 0 50%, ${c2} 50% 100%) 1`
      };
    }
    if (effectiveColors.length === 1) {
      return { borderColor: effectiveColors[0] };
    }
    return {};
  })();

  const dotStyle = (() => {
    if (effectiveColors.length >= 2) {
      const [c1, c2] = effectiveColors;
      return { background: `linear-gradient(90deg, ${c1} 0 50%, ${c2} 50% 100%)` };
    }
    if (effectiveColors.length === 1) {
      return { background: effectiveColors[0] };
    }
    return { background:'transparent' };
  })();

  function toggleColor(hex){
    setColors(prev=>{
      const exists = prev.includes(hex);
      let next = exists ? prev.filter(c=>c!==hex) : [...prev, hex];
      if (next.length > 2) next = next.slice(-2);
      if (!exists && hex === RED && !flags.includes('p1')) setFlags(f => [...f, 'p1']);
      if (!exists && hex === ORANGE && !flags.includes('p2')) setFlags(f => [...f, 'p2']);
      return next;
    });
  }

  function addFlagFromInput(){
    const raw = flagInput.trim();
    if(!raw) return;
    const parts = raw.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);
    setFlags(prev=>{
      const set = new Set(prev.map(s=>s.toLowerCase()));
      parts.forEach(p => set.add(p.toLowerCase()));
      return Array.from(set);
    });
    setFlagInput('');
  }
  function removeFlag(f){ setFlags(prev => prev.filter(x=>x!==f)); }

  return (
    <div
      className="mk-item"
      draggable={!editing}
      onDragStart={e=>e.dataTransfer.setData("text/plain", t.id)}
      style={styleBorder}
      title="Drag to move"
    >
      {!editing ? (
        <>
          <div className="mk-row">
            <span className="mk-dot" style={dotStyle} />
            <div className="mk-titleline">{t.title}</div>
            {(flags||[]).map(f=>(
              <span key={f} className="mk-flag">{f}</span>
            ))}
            <div className="mk-actions">
              <button className="mk-icon" onClick={()=>setEditing(true)} title="Edit">Edit</button>
              <button className="mk-icon" onClick={()=>delTask(t.id)} title="Delete">Delete</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mk-edit" style={{width:'100%'}}>
            <input className="mk-input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title"/>

            {/* quick flags */}
            <span className="mk-chip" onClick={()=>{ if(!flags.includes('p1')) setFlags([...flags,'p1']); toggleColor(RED); }}>
              P1 <span className="mk-dot-big" style={{background:RED}}/>
            </span>
            <span className="mk-chip" onClick={()=>{ if(!flags.includes('p2')) setFlags([...flags,'p2']); toggleColor(ORANGE); }}>
              P2 <span className="mk-dot-big" style={{background:ORANGE}}/>
            </span>

            {/* Color palette (max 2) */}
            {PALETTE.map(c=>(
              <span
                key={c.hex}
                className={`mk-chip ${colors.includes(c.hex)?'selected':''}`}
                onClick={()=>toggleColor(c.hex)}
                title={c.label}
              >
                <span className="mk-dot-big" style={{background:c.hex}}/>
                {c.key}
              </span>
            ))}

            {/* Flags editor */}
            <div style={{display:'flex', gap:6, flexWrap:'wrap', width:'100%'}}>
              {(flags||[]).map(f=>(
                <span key={f} className="mk-chip">
                  {f}
                  <span className="mk-chip-x" onClick={()=>removeFlag(f)}>×</span>
                </span>
              ))}
              <input
                className="mk-input"
                placeholder="Add flags… (Enter or ,)"
                value={flagInput}
                onChange={e=>setFlagInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter' || e.key===','){ e.preventDefault(); addFlagFromInput(); } }}
                style={{minWidth:180, flex:'1 1 220px'}}
              />
            </div>

            <button
              className="mk-save"
              onClick={()=>{
                const cleanTitle = title.trim() || t.title;
                const cleanFlags = Array.from(new Set(flags.map(f=>f.trim()).filter(Boolean)));
                const cleanColors = (colors||[]).slice(0,2);
                updTask(t.id, { title: cleanTitle, flags: cleanFlags, colors: cleanColors });
                setEditing(false);
              }}
            >
              Save
            </button>
            <button className="mk-danger" onClick={()=>setEditing(false)}>Cancel</button>
            <button className="mk-danger" onClick={()=>delTask(t.id)}>Delete</button>
          </div>
        </>
      )}
    </div>
  );
}
