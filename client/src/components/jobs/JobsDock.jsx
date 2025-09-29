// components/jobs/JobsDock.jsx
import React, { useEffect, useMemo, useState } from "react";

/* ---------- Tiny SVG icons (fixed size) ---------- */
const ico = (d) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
       xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d={d} stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const IBriefcase = () => ico("M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1M5 6h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Zm5 6h4");
const IList      = () => ico("M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01");
const IWand      = () => ico("M4 20l8-8M15 4l0 .01M7 7l0 .01M7 17l0 .01M17 7l0 .01M11 3l0 .01");
const IMail      = () => ico("M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm0 0 8 6 8-6");
const IChat      = () => ico("M7 17H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-4l-4 4v-4");
const IUserCog   = () => ico("M16.5 21a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 0v-2M6 9a5 5 0 1 0 10 0 5 5 0 0 0-10 0ZM2 20a7 7 0 0 1 11-5.746");
const IClose     = () => ico("M6 6l12 12M18 6l-12 12");

/* ---------- Component ---------- */
export default function JobsDock({
  tabs = [],
  initialOpen = false,
  initialTab,
  position = "right",     // "right" | "center"
  hotkey = "J",
  storageKey = "xenya.jobsDock.v2",
  showButton = false,     // keep false since you already have a “Jobs” pill
  buttonLabel = "Jobs"
}) {
  const firstTabId = useMemo(() => initialTab || tabs[0]?.id || "inbox", [initialTab, tabs]);
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey))?.open ?? initialOpen } catch { return initialOpen }
  });
  const [active, setActive] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey))?.active ?? firstTabId } catch { return firstTabId }
  });

  // persist + API + hotkey
  useEffect(()=>{ localStorage.setItem(storageKey, JSON.stringify({open, active})) }, [open, active, storageKey]);
  useEffect(() => {
    const api = { open:(tab)=>{ if(tab) setActive(tab); setOpen(true) }, close:()=>setOpen(false), toggle:()=>setOpen(v=>!v), setTab:setActive };
    window.jobsDock = api;
    const onOpenEvt = (e)=>{ if(e?.detail) setActive(e.detail); setOpen(true) };
    const onKey = (e)=>{ if((e.ctrlKey||e.metaKey) && String(e.key).toUpperCase()===String(hotkey).toUpperCase()){ e.preventDefault(); api.toggle() } };
    window.addEventListener("jobs:open", onOpenEvt);
    window.addEventListener("keydown", onKey);
    return ()=>{ window.removeEventListener("jobs:open", onOpenEvt); window.removeEventListener("keydown", onKey) };
  }, [hotkey]);

  const defaults = [
    { id:"inbox",     label:"Inbox",     icon:<IBriefcase/>, node:null },
    { id:"tracker",   label:"Tracker",   icon:<IList/>,      node:null },
    { id:"tailor",    label:"Tailor",    icon:<IWand/>,      node:null },
    { id:"outreach",  label:"Outreach",  icon:<IMail/>,      node:null },
    { id:"interview", label:"Interview", icon:<IChat/>,      node:null },
    { id:"profile",   label:"Profile",   icon:<IUserCog/>,   node:null },
  ];
  const tabList = tabs.length ? tabs : defaults;
  const current = tabList.find(t=>t.id===active) || tabList[0];

  const panelPos = position==="right"
    ? "right:16px; bottom:96px; width:min(92vw, 980px); height:72vh;"
    : "left:50%; transform:translateX(-50%); bottom:96px; width:min(96vw, 1100px); height:70vh;";

  return (
    <>
      <style>{`
        /* ---- Jobs Dock scoped styles ---- */
        .jd-root { --jd-bg: rgba(14,14,18,0.75); --jd-card: rgba(255,255,255,0.06);
                   --jd-border: rgba(255,255,255,0.12); --jd-text: #fff; --jd-muted: #c9c5ff;
                   --jd-rail: rgba(255,255,255,0.08); --jd-railActive: #8b5cf6; --jd-railHover: rgba(255,255,255,0.12);}
        .jd-panel{ position:fixed; ${panelPos} z-index:10060; backdrop-filter: blur(16px) saturate(120%);
                   background: var(--jd-bg); border:1px solid var(--jd-border); border-radius:18px;
                   box-shadow: 0 18px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06);
                   overflow:hidden; animation: jd-pop .18s ease-out; }
        @keyframes jd-pop { from{ opacity:0; transform:translateY(6px) scale(.985);} to{ opacity:1; transform:translateY(0) scale(1);} }
        .jd-head{ height:48px; display:flex; align-items:center; justify-content:space-between;
                  padding:0 10px 0 12px; background:linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
                  border-bottom:1px solid var(--jd-border); color:var(--jd-text); }
        .jd-title{ display:flex; align-items:center; gap:10px; font-weight:650; letter-spacing:.2px; }
        .jd-badge{ font-size:12px; opacity:.75; color:var(--jd-muted); }
        .jd-chip{ width:28px; height:28px; border-radius:10px; display:grid; place-items:center;
                  background:linear-gradient(180deg, rgba(139,92,246,.25), rgba(168,85,247,.18)); color:#e9ddff; }
        .jd-close{ width:34px; height:34px; display:grid; place-items:center; border-radius:10px; color:#e8e6ff; background:transparent; border:1px solid transparent; }
        .jd-close:hover{ background:var(--jd-card); border-color:var(--jd-border); }

        .jd-body{ height: calc(100% - 48px); display:grid; grid-template-columns: 64px 1fr; }
        .jd-rail{ background: var(--jd-rail); border-right:1px solid var(--jd-border); display:flex; flex-direction:column;
                  align-items:center; padding:10px 8px; gap:10px; }
        .jd-tab{ width:44px; height:44px; display:grid; place-items:center; border-radius:14px; color:#e4e0ff;
                 background: var(--jd-card); border:1px solid var(--jd-border); transition: all .16s ease; }
        .jd-tab:hover{ background: var(--jd-railHover); }
        .jd-tab.active{ background: linear-gradient(180deg, #8b5cf6, #a855f7); color:#fff;
                        border-color: rgba(255,255,255,0.22); box-shadow: 0 6px 18px rgba(139,92,246,.45); transform: translateY(-1px); }

        .jd-content{ padding:12px; overflow:auto; color:var(--jd-text); }
        .jd-empty{ font-size:14px; color:#d8d6ff; opacity:.8; background:var(--jd-card);
                   border:1px dashed var(--jd-border); border-radius:14px; padding:14px; }
        /* optional floating trigger (kept off by default) */
        .jd-fab{ position:fixed; right:16px; bottom:16px; z-index:10040; display:inline-flex; align-items:center; gap:8px;
                 padding:10px 14px; border-radius:999px; border:1px solid rgba(122,62,255,0.65);
                 background:linear-gradient(180deg, rgba(122,62,255,0.95), rgba(90,43,214,0.95));
                 color:#fff; font-weight:600; box-shadow:0 10px 18px rgba(122,62,255,0.35); }
        .jd-fab:hover{ transform:translateY(-1px); box-shadow:0 14px 22px rgba(122,62,255,0.42) }
        .jd-fab .ico{ width:18px; height:18px; display:grid; place-items:center; background:rgba(255,255,255,.12); border-radius:999px }
      `}</style>

      {showButton && (
        <button className="jd-fab" onClick={()=>setOpen(v=>!v)} title={`Jobs Dock (Ctrl/Cmd+${hotkey.toUpperCase()})`}>
          <span className="ico"><IBriefcase/></span>{buttonLabel}
        </button>
      )}

      {open && (
        <div className="jd-root jd-panel" role="dialog" aria-modal="true" aria-label="Jobs Dock">
          {/* Header */}
          <div className="jd-head">
            <div className="jd-title">
              <span className="jd-chip"><IBriefcase/></span>
              <span>Jobs Dock</span>
              <span className="jd-badge">• {current?.label || "Tab"}</span>
            </div>
            <button className="jd-close" onClick={()=>setOpen(false)} aria-label="Close Jobs Dock"><IClose/></button>
          </div>

          {/* Body */}
          <div className="jd-body">
            {/* Rail */}
            <div className="jd-rail">
              {tabList.map(t => (
                <button key={t.id}
                        className={"jd-tab"+(t.id===active?" active":"")}
                        title={t.label}
                        onClick={()=>setActive(t.id)}
                        aria-label={`Open ${t.label}`}>
                  {t.icon || <span style={{fontWeight:700}}>{String(t.label||"?").slice(0,1)}</span>}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="jd-content">
              {current?.node ? current.node : (
                <div className="jd-empty">
                  Provide a node for tab <strong>{current?.label || "Tab"}</strong>.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
