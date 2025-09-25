// components/QuickCapture.jsx
import { useEffect, useRef, useState } from "react";
import { addKanbanTask } from "./MiniKanban.jsx";

// ---- history store ----
const LS = "xenya.captures.v1";
function readHist(){ try { return JSON.parse(localStorage.getItem(LS)) || []; } catch { return []; } }
function writeHist(list){ try { localStorage.setItem(LS, JSON.stringify(list||[])); } catch {} window.dispatchEvent(new CustomEvent("captures:changed")); }
function uid(){ return (typeof crypto!=="undefined" && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2))).slice(0,8); }
const isUrl = (s) => /^https?:\/\/\S+$/i.test((s||"").trim());

export default function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("tasks"); // tasks | notes | readlater
  const [text, setText] = useState("");
  const [tags, setTags] = useState([]);
  const txtRef = useRef(null);

  // hotkey + programmatic open
  useEffect(() => {
    const onKey = (e) => {
      const mac = navigator.platform.toLowerCase().includes("mac");
      const mod = mac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); setOpen(true); setTimeout(()=>txtRef.current?.focus(),0); }
      if (open && e.key === "Escape") setOpen(false);
      if (open && mod && e.key === "Enter") { e.preventDefault(); doSave(); }
    };
    const onOpen = () => { setOpen(true); setTimeout(()=>txtRef.current?.focus(),0); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("capture:open", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("capture:open", onOpen); };
  }, [open]); // eslint-disable-line

  // parse prefixes + #tags
  useEffect(() => {
    const raw = text || "";
    const m = raw.match(/^\s*([tnr]):\s*/i);
    if (m) setTarget(m[1].toLowerCase()==="t"?"tasks":m[1].toLowerCase()==="n"?"notes":"readlater");
    setTags(Array.from(raw.matchAll(/#([A-Za-z0-9_\-]+)/g)).map(x=>x[1]).slice(0,16));
  }, [text]);

  function stripPrefix(s){ return String(s||"").replace(/^\s*[tnr]:\s*/i,"").trim(); }
  function toast(msg){
    const t=document.createElement("div");
    Object.assign(t.style,{position:"fixed",left:"50%",bottom:"24px",transform:"translateX(-50%)",background:"rgba(0,0,0,.7)",color:"#fff",padding:"8px 12px",borderRadius:"10px",border:"1px solid rgba(255,255,255,.2)",zIndex:2e4,opacity:0,transition:"opacity .2s"});
    t.textContent=msg; document.body.appendChild(t); requestAnimationFrame(()=>t.style.opacity=1); setTimeout(()=>{t.style.opacity=0; setTimeout(()=>t.remove(),200);},1200);
  }

  function doSave(){
    const body = stripPrefix(text);
    if(!body){ toast("Nothing to capture."); return; }

    const flagsFromTags = Array.from(new Set((tags||[]).map(s=>s.toLowerCase())));
    const targetFlag = target==="tasks" ? [] : [target==="notes"?"note":"readlater"];
    const flags = Array.from(new Set([...flagsFromTags, ...targetFlag]));
    const colors = [];

    // 1) Always create a Kanban Inbox task
    addKanbanTask(body, "inbox", colors, flags);

    // 2) Also log to history so the tile can show/search/filter later
    const entry = {
      id: uid(),
      text: body,
      target,
      tags,
      url: isUrl(body) ? body : null,
      created: Date.now()
    };
    writeHist([entry, ...readHist()]);

    // notify listeners a capture happened
    window.dispatchEvent(new CustomEvent("capture:added", { detail:{ capture: entry }}));

    toast(`Saved to Inbox${flags.length ? " • " + flags.join(", ") : ""}.`);
    setText(""); setTarget("tasks"); setOpen(false);
  }

  if(!open) return null;

  return (
    <>
      <style>{`
        .qc-overlay{position:fixed; inset:0; z-index:10060; background:rgba(10,12,26,0.55); backdrop-filter:blur(6px) saturate(130%); display:flex; align-items:center; justify-content:center}
        .qc-card{width:min(760px,92vw); background:rgba(15,16,28,0.96); border:1px solid rgba(255,255,255,0.12); border-radius:14px; overflow:hidden; box-shadow:0 12px 48px rgba(0,0,0,.45)}
        .qc-head{display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; background:linear-gradient(180deg, rgba(122,62,255,0.14), rgba(122,62,255,0.04))}
        .qc-title{font-weight:700; color:#EDEAFF}
        .qc-close{border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.06); color:#EEE; border-radius:10px; padding:6px 9px; cursor:pointer}
        .qc-body{padding:12px}
        .qc-text{width:100%; min-height:120px; resize:vertical; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); color:#F6F5FF; border-radius:10px; padding:10px; outline:none}
        .qc-row{display:flex; align-items:center; justify-content:space-between; margin-top:10px; gap:10px; flex-wrap:wrap}
        .qc-chips{display:flex; gap:8px; flex-wrap:wrap}
        .qc-chip{display:inline-flex; gap:8px; align-items:center; padding:6px 10px; border-radius:999px; border:1px solid rgba(255,255,255,0.14); cursor:pointer; background:rgba(255,255,255,0.07); color:#EEE}
        .qc-chip.active{background:rgba(0,229,255,0.18); border-color:rgba(0,229,255,0.5); color:#e6feff}
        .qc-actions{display:flex; gap:8px}
        .qc-btn{padding:8px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.08); color:#EEE; cursor:pointer; font-weight:600}
        .qc-btn.primary{background:linear-gradient(180deg, rgba(0,229,255,0.20), rgba(0,229,255,0.10)); border-color:rgba(0,229,255,0.65); color:#eaffff}
        .qc-hint{font-size:12px; opacity:.75}
      `}</style>

      <div className="qc-overlay" onClick={()=>setOpen(false)}>
        <div className="qc-card" onClick={e=>e.stopPropagation()}>
          <div className="qc-head">
            <div className="qc-title">Quick Capture → Kanban Inbox</div>
            <button className="qc-close" onClick={()=>setOpen(false)} title="Esc">✕</button>
          </div>
          <div className="qc-body">
            <textarea
              ref={txtRef}
              className="qc-text"
              placeholder='t: Ship PR for Xenya #p2 #backend  •  n: idea… #research  •  r: https://… #reading'
              value={text}
              onChange={e=>setText(e.target.value)}
              onKeyDown={(e)=>{ const mac = navigator.platform.toLowerCase().includes("mac"); if ((mac?e.metaKey:e.ctrlKey) && e.key === "Enter") { e.preventDefault(); doSave(); } }}
            />
            <div className="qc-row">
              <div className="qc-chips">
                <button className={"qc-chip "+(target==='tasks'?'active':'')} onClick={()=>setTarget('tasks')}>Tasks</button>
                <button className={"qc-chip "+(target==='notes'?'active':'')} onClick={()=>setTarget('notes')}>Notes</button>
                <button className={"qc-chip "+(target==='readlater'?'active':'')} onClick={()=>setTarget('readlater')}>Read-Later</button>
              </div>
              <div className="qc-actions">
                <span className="qc-hint">⌘/Ctrl+Enter to save • Esc to close</span>
                <button className="qc-btn" onClick={()=>setText("")}>Clear</button>
                <button className="qc-btn primary" onClick={doSave}>Save to Inbox</button>
              </div>
            </div>
            {!!tags.length && <div className="qc-hint" style={{marginTop:8}}>Flags: {tags.map(t=>'#'+t).join(' ')}{target!=='tasks' ? `  +  ${target==='notes'?'note':'readlater'}` : ''}</div>}
          </div>
        </div>
      </div>
    </>
  );
}
