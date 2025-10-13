// components/todo/TodoDock.jsx
import React, { useEffect, useMemo, useState } from "react";
import TodoList from "./TodoList.jsx";
import GoalsTab from "./GoalsTab.jsx";

const ico = (d) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
       xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IChecklist = () => ico("M9 7h11M9 12h11M9 17h11M4 7l2 2 3-3M4 12l2 2 3-3M4 17l2 2 3-3");
const INews      = () => ico("M4 5h16v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zm4 4h8M8 12h8M8 15h5");
const IBrain     = () => ico("M8 6a3 3 0 0 1 6 0v.5A2.5 2.5 0 0 1 17 9v3a2 2 0 0 1-2 2h-1v2M8 6v.5A2.5 2.5 0 0 0 7 9v3a2 2 0 0 0 2 2h1v2");
const IClose     = () => ico("M6 6l12 12M18 6l-12 12");

export default function TodoDock({
  initialOpen = false,
  initialTab  = "list",
  position    = "right",
  hotkey      = "T",
  storageKey  = "xenya.todoDock.v1",
}) {
  const [open, setOpen]   = useState(() => { try { return JSON.parse(localStorage.getItem(storageKey))?.open ?? initialOpen } catch { return initialOpen }});
  const [active, setActive] = useState(() => { try { return JSON.parse(localStorage.getItem(storageKey))?.active ?? initialTab } catch { return initialTab }});


  useEffect(()=>{ localStorage.setItem(storageKey, JSON.stringify({ open, active })) }, [open, active]);

  // expose window.todoDock API + hotkey
  useEffect(() => {
    const api = { open:(tab)=>{ if(tab) setActive(tab); setOpen(true) }, close:()=>setOpen(false), toggle:()=>setOpen(v=>!v), setTab:setActive };
    window.todoDock = api;
    const onOpenEvt = (e)=>{ if(e?.detail) setActive(e.detail); setOpen(true) };
    const onKey     = (e)=>{ if((e.ctrlKey||e.metaKey) && String(e.key).toUpperCase()===String(hotkey).toUpperCase()){ e.preventDefault(); api.toggle() } };
    window.addEventListener("todo:open", onOpenEvt);
    window.addEventListener("keydown", onKey);
    return ()=>{ window.removeEventListener("todo:open", onOpenEvt); window.removeEventListener("keydown", onKey) };
  }, [hotkey]);

  const panelPos = position==="right"
    ? "right:16px; bottom:96px; width:min(92vw, 980px); height:72vh;"
    : "left:50%; transform:translateX(-50%); bottom:96px; width:min(96vw, 1100px); height:70vh;";

  return open ? (
    <>
      <style>{`
        .td-root { --bg: rgba(14,14,18,0.75); --card: rgba(255,255,255,0.06);
                   --border: rgba(255,255,255,0.12); --text:#fff; --rail: rgba(255,255,255,0.08);
                   --railActive: #22d3ee; --railHover: rgba(255,255,255,0.12); }
        .td-panel{ position:fixed; ${panelPos} z-index:10060; backdrop-filter: blur(16px) saturate(120%);
                   background: var(--bg); border:1px solid var(--border); border-radius:18px;
                   box-shadow: 0 18px 40px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
                   overflow:hidden; animation: td-pop .18s ease-out; }
        @keyframes td-pop { from{ opacity:0; transform:translateY(6px) scale(.985);} to{ opacity:1; transform:translateY(0) scale(1);} }
        .td-head{ height:48px; display:flex; align-items:center; justify-content:space-between;
                  padding:0 10px 0 12px; background:linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03));
                  border-bottom:1px solid var(--border); color:var(--text);}
        .td-title{ display:flex; align-items:center; gap:10px; font-weight:650; letter-spacing:.2px; }
        .td-chip{ width:28px; height:28px; border-radius:10px; display:grid; place-items:center;
                  background:linear-gradient(180deg, rgba(34,211,238,.25), rgba(59,130,246,.20)); color:#e6fbff; }
        .td-close{ width:34px; height:34px; display:grid; place-items:center; border-radius:10px; color:#e8e6ff; background:transparent; border:1px solid transparent; }
        .td-close:hover{ background:var(--card); border-color:var(--border); }

        .td-body{ height: calc(100% - 48px); display:grid; grid-template-columns: 64px 1fr; }
        .td-rail{ background: var(--rail); border-right:1px solid var(--border); display:flex; flex-direction:column;
                  align-items:center; padding:10px 8px; gap:10px; }
        .td-tab{ width:44px; height:44px; display:grid; place-items:center; border-radius:14px; color:#e4f9ff;
                 background: var(--card); border:1px solid var(--border); transition: all .16s ease; }
        .td-tab:hover{ background: var(--railHover); }
        .td-tab.active{ background: linear-gradient(180deg, #22d3ee, #06b6d4); color:#00242c;
                        border-color: rgba(255,255,255,0.22); box-shadow: 0 6px 18px rgba(34,211,238,.35); transform: translateY(-1px); }

        .td-content{ padding:12px; overflow:auto; color:var(--text); }
        .td-empty{ font-size:14px; color:#e6f7ff; opacity:.85; background:var(--card); border:1px dashed var(--border); border-radius:14px; padding:14px; }
      `}</style>

      <div className="td-root td-panel" role="dialog" aria-modal="true" aria-label="To-Do Dock">
        <div className="td-head">
          <div className="td-title"><span className="td-chip"><IChecklist/></span><span>To-Do</span></div>
          <button className="td-close" onClick={()=>setOpen(false)} aria-label="Close To-Do Dock"><IClose/></button>
        </div>

        <div className="td-body">
          {/* Rail */}
          <div className="td-rail">
            <button className={"td-tab"+(active==="list"?" active":"")} title="To-Do List" onClick={()=>setActive("list")}><IChecklist/></button>
            <button className={"td-tab"+(active==="brief"?" active":"")} title="Brief"      onClick={()=>setActive("brief")}><INews/></button>
            <button className={"td-tab"+(active==="goals"?" active":"")} title="Focus & Goals" onClick={()=>setActive("goals")}><IBrain/></button>
          </div>

          {/* Content */}
          <div className="td-content">
            {active==="list"  && <TodoList />}
            {active==="brief" && <div className="td-empty">Brief coming next.</div>}
            {active==="goals" && <GoalsTab />}
          </div>
        </div>
      </div>
    </>
  ) : null;
}
