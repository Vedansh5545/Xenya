// components/XenyaProductivitySuite.jsx
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

/**
 * XenyaProductivitySuite.jsx
 * - Pluggable tools (Kanban, Outlook Calendar, Timer, etc.)
 * - Drag to reorder
 * - Minimize / Restore / Maximize
 * - Per-tile Resize (width: 1/2 cols, height: 1/2 rows)
 * - Preset Layouts (contextual to number of visible tiles)
 * - Full-screen canvas toggle
 * - Layout persisted in localStorage
 */

const LS_KEY = "xenya.ps.v2"; // keep version; upgrade logic below adds new tools safely

// Lazy tools
const ToolRegistry = {
  kanban: {
    id: "kanban",
    title: "Kanban",
    Comp: lazy(() => import("./MiniKanban.jsx")),
    defaultVisible: true,
    defaultWide: true,
    defaultTall: false,
    defaultProps: { embedded: true },
  },
  calendar: {
    id: "calendar",
    title: "Calendar",
    Comp: lazy(() => import("./OutlookCalendar.jsx")),
    defaultVisible: true,
    defaultWide: true,
    defaultTall: false,
    defaultProps: { embed: true },
  },
  // NEW: Focus / Pomodoro Timer tile
  timer: {
    id: "timer",
    title: "Timer",
    Comp: lazy(() => import("./FocusTimer.jsx")),
    defaultVisible: true,      // show by default like Kanban + Calendar
    defaultWide: false,        // timer is comfy as a single column tile
    defaultTall: false,
    defaultProps: { embedded: true },
  },
    capture: {
    id: "capture",
    title: "Quick Capture • History",
    Comp: lazy(() => import("./CaptureCenter.jsx")),
    defaultVisible: true,
    defaultWide: false,
    defaultTall: false,
    defaultProps: { embedded: true },
  },

};

function useLocalState() {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw) || {};

        // --- Upgrade path: ensure newly added default-visible tools appear
        const visible = new Set(p.visible || []);
        const order = Array.isArray(p.order) ? [...p.order] : [];
        const wide  = new Set(p.wide || []);
        const tall  = new Set(p.tall || []);

        for (const t of Object.values(ToolRegistry)) {
          const id = t.id;
          const inOrder = order.includes(id);

          // If a tool is defaultVisible and isn't in saved visible set, add it.
          if (t.defaultVisible && !visible.has(id)) visible.add(id);

          // Ensure every known tool has a place in order (append to end if missing).
          if (!inOrder) order.push(id);

          // For *new* tools (not in original order array), seed their wide/tall defaults.
          if (!p.order || !p.order.includes(id)) {
            if (t.defaultWide) wide.add(id);
            if (t.defaultTall) tall.add(id);
          }
        }

        return {
          visible,
          order,
          wide,
          tall,
          minimized  : new Set(p.minimized  || []),
          maximizedId: p.maximizedId        || null,
          locked     : !!p.locked,
          fullscreen : !!p.fullscreen,
        };
      }
    } catch {}

    // Fresh defaults
    const defaults = Object.values(ToolRegistry).filter(t => t.defaultVisible).map(t => t.id);
    return {
      visible    : new Set(defaults),
      order      : Object.values(ToolRegistry).map(t => t.id),
      wide       : new Set(Object.values(ToolRegistry).filter(t=>t.defaultWide).map(t=>t.id)),
      tall       : new Set(Object.values(ToolRegistry).filter(t=>t.defaultTall).map(t=>t.id)),
      minimized  : new Set(),
      maximizedId: null,
      locked     : false,
      fullscreen : false,
    };
  });

  const stable = useMemo(() => ({
    visible    : Array.from(state.visible || []),
    order      : state.order || [],
    wide       : Array.from(state.wide || []),
    tall       : Array.from(state.tall || []),
    minimized  : Array.from(state.minimized || []),
    maximizedId: state.maximizedId || null,
    locked     : !!state.locked,
    fullscreen : !!state.fullscreen,
  }), [state]);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(stable)); } catch {}
  }, [stable]);

  const setField   = (key, next) => setState(s => ({ ...s, [key]: next }));
  const addToSet   = (key, id)   => setState(s => { const ns = new Set(s[key]); ns.add(id);   return { ...s, [key]: ns }; });
  const delFromSet = (key, id)   => setState(s => { const ns = new Set(s[key]); ns.delete(id); return { ...s, [key]: ns }; });

  return { state, setState, stable, setField, addToSet, delFromSet };
}

function Chip({ children, onClick, title, right }) {
  return (
    <div className="xps-chip" title={title || ""} onClick={onClick}>
      <span className="xps-chip-txt">{children}</span>
      {right}
    </div>
  );
}

// Layout presets --------------------------------------------------------------

function presetsFor(n) {
  // Pattern = [{w:1|2, h:1|2}, ...] in visual order.
  // We always apply to the first n visible tiles.
  const S11 = { w:1, h:1 }, S21 = { w:2, h:1 }, S22 = { w:2, h:2 };

  if (n <= 1) return [
    { id: "solo-max", label: "Full (2×2)", pattern: [S22] },
    { id: "solo-wide", label: "Banner (2×1)", pattern: [S21] },
  ];

  if (n === 2) return [
    { id: "side", label: "Side-by-side (1+1)", pattern: [S11,S11] },
    { id: "stacked", label: "Stacked banners (2×1, 2×1)", pattern: [S21,S21] },
  ];

  if (n === 3) return [
    { id: "banner+two", label: "Banner + two", pattern: [S21,S11,S11] },
    { id: "three", label: "Three grid", pattern: [S11,S11,S11] },
  ];

  if (n === 4) return [
    { id: "grid22", label: "2×2 grid", pattern: [S11,S11,S11,S11] },
    { id: "banner+2", label: "Banner + singles", pattern: [S21,S11,S11,S11] },
    { id: "hero", label: "Hero (2×2) + 2 singles", pattern: [S22,S11,S11,S11] },
  ];

  if (n === 5) return [
    { id: "hero+3", label: "Hero (2×2) + 3 singles", pattern: [S22,S11,S11,S11,S11] },
    { id: "two-banners", label: "Two banners + singles", pattern: [S21,S21,S11,S11,S11] },
  ];

  // 6 or more: two good generics
  return [
    { id: "balanced", label: "Balanced grid", pattern: new Array(n).fill(S11) },
    { id: "hero-row", label: "Hero row + grid", pattern: [S21,S21, ...new Array(n-2).fill(S11)] },
  ];
}

// Component -------------------------------------------------------------------

export default function XenyaProductivitySuite({ open, onClose }) {
  const { state, setState, stable, setField, addToSet, delFromSet } = useLocalState();
  const dragging = useRef({ id: null });

  const allTools = Object.values(ToolRegistry);
  const visSet   = useMemo(()=> new Set(stable.visible),   [stable.visible]);
  const minSet   = useMemo(()=> new Set(stable.minimized), [stable.minimized]);
  const wideSet  = useMemo(()=> new Set(stable.wide),      [stable.wide]);
  const tallSet  = useMemo(()=> new Set(stable.tall),      [stable.tall]);

  const visibleOrdered = useMemo(() =>
    stable.order.filter(id => visSet.has(id) && !minSet.has(id)).map(id => ToolRegistry[id]).filter(Boolean),
  [stable.order, visSet, minSet]);

  const minimizedList = useMemo(() =>
    stable.order.filter(id => visSet.has(id) && minSet.has(id)),
  [stable.order, visSet, minSet]);

  const hiddenList = useMemo(() =>
    allTools.map(t => t.id).filter(id => !visSet.has(id)),
  [allTools, visSet]);

  const isLocked = !!stable.locked;
  const isMax    = !!stable.maximizedId;

  // --- Drag & drop (order) ---
  function onDragStart(id) { if (!isLocked && !isMax) dragging.current.id = id; }
  function onDragOver(e) { if (dragging.current.id) e.preventDefault(); }
  function onDrop(overId) {
    const dragId = dragging.current.id;
    dragging.current.id = null;
    if (!dragId || dragId === overId || isLocked || isMax) return;
    setState(s => {
      const order = [...s.order];
      const from = order.indexOf(dragId);
      const to   = order.indexOf(overId);
      if (from < 0 || to < 0) return s;
      order.splice(from, 1); order.splice(to, 0, dragId);
      return { ...s, order };
    });
  }
  function onDragEnd(){ dragging.current.id = null; }

  // --- Tile toggles ---
  function toggleWide(id){ wideSet.has(id) ? delFromSet("wide", id) : addToSet("wide", id); }
  function toggleTall(id){ tallSet.has(id) ? delFromSet("tall", id) : addToSet("tall", id); }
  function minimize(id){ addToSet("minimized", id); }
  function restore(id){ delFromSet("minimized", id); }
  function hide(id){
    delFromSet("minimized", id);
    setState(s => { const vis = new Set(s.visible); vis.delete(id); return { ...s, visible: vis }; });
  }
  function show(id){
    setState(s => {
      const vis = new Set(s.visible); vis.add(id);
      const order = s.order.includes(id) ? s.order : [...s.order, id];
      const mini = new Set(s.minimized); mini.delete(id);
      return { ...s, visible: vis, order, minimized: mini };
    });
  }
  const maximize   = (id) => setField("maximizedId", id);
  const unmaximize = ()   => setField("maximizedId", null);

  // --- Full screen canvas ---
  const toggleFullscreen = () => setField("fullscreen", !stable.fullscreen);

  // --- Apply layout presets ---
  function applyPattern(pattern) {
    setState(s => {
      const wide = new Set(s.wide);
      const tall = new Set(s.tall);

      // Visible + not minimized in *current* order:
      const visibleIds = s.order.filter(id => s.visible.has(id) && !s.minimized.has(id));
      visibleIds.forEach((id, idx) => {
        const p = pattern[idx] || { w:1, h:1 };
        (p.w === 2) ? wide.add(id) : wide.delete(id);
        (p.h === 2) ? tall.add(id) : tall.delete(id);
      });
      return { ...s, wide, tall };
    });
  }

  const nTiles = visibleOrdered.length;
  const layoutOptions = presetsFor(nTiles);
  const [showLayouts, setShowLayouts] = useState(false);

  function resetLayout(){
    const defaults = Object.values(ToolRegistry).filter(t => t.defaultVisible).map(t => t.id);
    setState({
      visible    : new Set(defaults),
      order      : Object.values(ToolRegistry).map(t => t.id),
      wide       : new Set(Object.values(ToolRegistry).filter(t=>t.defaultWide).map(t=>t.id)),
      tall       : new Set(Object.values(ToolRegistry).filter(t=>t.defaultTall).map(t=>t.id)),
      minimized  : new Set(),
      maximizedId: null,
      locked     : false,
      fullscreen : false,
    });
  }

  // Escape to un-max or close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (stable.maximizedId) unmaximize();
        else onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stable.maximizedId, onClose]);

  // Hide the external floating dock while suite is open
  useEffect(() => {
    if (!open) return;
    const dock = document.getElementById('x-dock');
    if (dock) dock.classList.add('dock-hidden');
    return () => { if (dock) dock.classList.remove('dock-hidden'); };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <style>{`
        .xps-overlay{position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center;
          background:rgba(5,6,20,0.55); backdrop-filter:saturate(140%) blur(10px)}
        .xps-card{width:min(1200px,90vw); height:min(760px,88vh); background:rgba(13,13,26,0.92);
          border:1px solid rgba(255,255,255,0.08); border-radius:16px; box-shadow:0 10px 40px rgba(0,0,0,.5); display:flex; flex-direction:column; overflow:hidden}
        .xps-card.full{width:100vw; height:100vh; border-radius:0}

        .xps-head{display:flex; align-items:center; justify-content:space-between; padding:10px 12px; gap:10px;
          background:linear-gradient(180deg, rgba(122,62,255,0.12), rgba(122,62,255,0.02)); border-bottom:1px solid rgba(255,255,255,0.08)}
        .xps-title{font-weight:700; letter-spacing:.02em; color:#EEE}
        .xps-actions{display:flex; gap:8px; align-items:center}
        .xps-btn{padding:7px 10px; border-radius:10px; background:rgba(255,255,255,0.06); color:#EEE; border:1px solid rgba(255,255,255,0.12); cursor:pointer}
        .xps-btn.primary{background:rgba(0,229,255,0.18); border-color:rgba(0,229,255,0.5); color:#e6feff}
        .xps-switch{display:inline-flex; gap:6px; align-items:center; font-size:12px; opacity:.9}

        .xps-body{flex:1; overflow:auto; padding:12px}
        .xps-grid{
          display:grid; grid-template-columns:repeat(2, minmax(260px, 1fr)); gap:10px;
          grid-auto-rows: 240px; /* base row height for tall tiles (span 2) */
        }
        @media (max-width: 980px){ .xps-grid{grid-template-columns:1fr} }
        .xps-tile{display:flex; flex-direction:column; border:1px solid rgba(255,255,255,0.10); border-radius:12px;
          background:rgba(255,255,255,0.04); overflow:hidden; min-height:170px}
        .xps-tile.wide{grid-column: span 2}
        .xps-tile.tall{grid-row: span 2}
        .xps-thead{display:flex; align-items:center; justify-content:space-between; padding:8px 10px; gap:8px;
          background:linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.00))}
        .xps-tname{font-weight:600; color:#EEE; display:flex; align-items:center; gap:8px}
        .xps-handle{cursor:grab; opacity:.7; padding:2px 6px; border-radius:8px; border:1px dashed rgba(255,255,255,0.15)}
        .xps-tcontrols{display:flex; gap:6px}
        .xps-icon{font-size:12px; padding:5px 8px; border-radius:8px; border:1px solid rgba(255,255,255,0.12);
          background:rgba(255,255,255,0.06); color:#EEE; cursor:pointer}
        .xps-tbody{flex:1; overflow:auto; padding:8px 10px}
        .xps-empty{opacity:.7; font-style:italic; text-align:center; padding:20px}

        .xps-dock{display:flex; gap:6px; padding:8px 10px; border-top:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03); flex-wrap:wrap}
        .xps-chip{display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px;
          border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.05); color:#EEE; cursor:default}
        .xps-chip .xps-chip-txt{max-width:160px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
        .xps-chip .xps-chip-btn{padding:3px 6px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.06); color:#EEE; cursor:pointer}

        .xps-palette{display:flex; gap:8px; flex-wrap:wrap}
        .xps-pcard{border:1px solid rgba(255,255,255,0.10); background:rgba(255,255,255,0.04); border-radius:12px; padding:10px; width:220px}
        .xps-pcard h4{margin:0 0 6px 0}
        .xps-pcard .xps-btn{width:100%}

        .xps-layouts{position:relative}
        .xps-menu{position:absolute; right:0; top:36px; z-index:3; min-width:260px;
          background:rgba(22,22,36,0.98); border:1px solid rgba(255,255,255,0.10); border-radius:12px; padding:8px; box-shadow:0 10px 30px rgba(0,0,0,.4)}
        .xps-menu h5{margin:6px 6px 8px; font-size:12px; opacity:.8}
        .xps-menu .xps-row{display:flex; flex-wrap:wrap; gap:6px}
        .xps-menu .xps-btn{white-space:nowrap}

        /* maximized view */
        .xps-maxwrap{flex:1; display:flex; flex-direction:column; padding:12px}
        .xps-max{flex:1; border:1px solid rgba(255,255,255,0.10); border-radius:12px; overflow:hidden; background:rgba(255,255,255,0.04)}
        .xps-max .xps-thead{background:linear-gradient(180deg, rgba(0,229,255,0.14), rgba(0,229,255,0.02))}
      `}</style>

      <div className="xps-overlay" role="dialog" aria-label="Xenya Productivity Suite">
        <div className={`xps-card ${stable.fullscreen ? 'full' : ''}`}>
          <div className="xps-head">
            <div className="xps-title">Xenya • Productivity Suite</div>
            <div className="xps-actions">
              <div className="xps-layouts">
                <button className="xps-btn" onClick={()=>setShowLayouts(v=>!v)} disabled={nTiles === 0}>Layouts ▾</button>
                {showLayouts && (
                  <div className="xps-menu" onMouseLeave={()=>setShowLayouts(false)}>
                    <h5>Presets for {nTiles || 0} tile{nTiles===1?'':'s'}</h5>
                    <div className="xps-row">
                      {layoutOptions.map(opt=>(
                        <button key={opt.id} className="xps-btn" onClick={()=>{ applyPattern(opt.pattern); setShowLayouts(false); }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="xps-switch">
                <label><input type="checkbox" checked={isLocked} onChange={e => setField("locked", e.target.checked)} /> Lock layout</label>
              </div>
              <button className="xps-btn" onClick={toggleFullscreen}>{stable.fullscreen ? "Windowed" : "Full screen"}</button>
              <button className="xps-btn" onClick={resetLayout} title="Reset layout">Reset</button>
              <button className="xps-btn primary" onClick={onClose}>Close</button>
            </div>
          </div>

          {!isMax && (
            <div className="xps-body">
              {/* Palette: add hidden tools */}
              {hiddenList.length > 0 && (
                <div className="xps-palette" style={{marginBottom:10}}>
                  {hiddenList.map(id => {
                    const t = ToolRegistry[id];
                    return (
                      <div key={id} className="xps-pcard">
                        <h4 style={{color:"#EDEDED"}}>{t.title}</h4>
                        <div style={{opacity:.8, fontSize:12, marginBottom:8}}>Add this tool to the workspace.</div>
                        <button className="xps-btn primary" onClick={()=>show(id)}>Add</button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Grid */}
              <div className="xps-grid">
                {visibleOrdered.map(tool => {
                  const id = tool.id;
                  const wide = wideSet.has(id);
                  const tall = tallSet.has(id);
                  const beingDragged = dragging.current.id === id;
                  return (
                    <div
                      key={id}
                      className={`xps-tile ${wide ? "wide" : ""} ${tall ? "tall" : ""} ${beingDragged ? "dragging" : ""}`}
                      onDragOver={(e)=>onDragOver(e)}
                      onDrop={()=>onDrop(id)}
                    >
                      <div
                        className="xps-thead"
                        draggable={!isLocked}
                        onDragStart={()=>onDragStart(id)}
                        onDragEnd={onDragEnd}
                        role="toolbar"
                        aria-label={`${tool.title} controls`}
                      >
                        <div className="xps-tname">
                          <span className="xps-handle" title={isLocked ? "Unlock to drag" : "Drag to move"}>⋮⋮</span>
                          {tool.title}
                        </div>
                        <div className="xps-tcontrols">
                          <button className="xps-icon" title={wide ? "Shrink width (1 col)" : "Widen (2 cols)"} onClick={()=>toggleWide(id)}>{wide ? "↔︎" : "⤢"}</button>
                          <button className="xps-icon" title={tall ? "Reduce height (1 row)" : "Taller (2 rows)"} onClick={()=>toggleTall(id)}>{tall ? "↕︎" : "⇵"}</button>
                          <button className="xps-icon" title="Minimize to dock" onClick={()=>minimize(id)}>–</button>
                          <button className="xps-icon" title="Maximize" onClick={()=>maximize(id)}>▣</button>
                          <button className="xps-icon" title="Remove from workspace" onClick={()=>hide(id)}>✕</button>
                        </div>
                      </div>
                      <div className="xps-tbody">
                        <Suspense fallback={<div className="xps-empty">Loading {tool.title}…</div>}>
                          <tool.Comp {...(tool.defaultProps || {})} />
                        </Suspense>
                      </div>
                    </div>
                  );
                })}

                {visibleOrdered.length === 0 && (
                  <div className="xps-empty" style={{gridColumn:"1 / -1"}}>
                    No tools on the canvas. Use the cards above to add Kanban, Calendar, Timer, etc.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Maximized view */}
          {isMax && (() => {
            const tool = ToolRegistry[stable.maximizedId];
            if (!tool) return <div className="xps-empty">Missing tool.</div>;
            return (
              <div className="xps-maxwrap">
                <div className="xps-thead" style={{marginBottom:8}}>
                  <div className="xps-tname">{tool.title}</div>
                  <div className="xps-tcontrols">
                    <button className="xps-icon" title="Exit full view" onClick={unmaximize}>⤢</button>
                    <button className="xps-icon" onClick={onClose}>✕</button>
                  </div>
                </div>
                <div className="xps-max">
                  <div className="xps-tbody" style={{height:"100%"}}>
                    <Suspense fallback={<div className="xps-empty">Loading {tool.title}…</div>}>
                      <tool.Comp {...(tool.defaultProps || {})} />
                    </Suspense>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Dock with actions */}
          <div className="xps-dock">
            {minimizedList.length === 0 && <div className="xps-empty" style={{padding:0}}>Dock is empty.</div>}
            {minimizedList.map(id => (
              <Chip
                key={id}
                title="Click Restore • Use buttons to Max/Remove"
                onClick={()=>restore(id)}
                right={
                  <span style={{display:'inline-flex', gap:6}}>
                    <button className="xps-chip-btn" title="Maximize" onClick={(e)=>{ e.stopPropagation(); maximize(id); }}>▣</button>
                    <button className="xps-chip-btn" title="Restore"  onClick={(e)=>{ e.stopPropagation(); restore(id); }}>↺</button>
                    <button className="xps-chip-btn" title="Remove"   onClick={(e)=>{ e.stopPropagation(); hide(id); }}>✕</button>
                  </span>
                }
              >
                {ToolRegistry[id]?.title || id}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
