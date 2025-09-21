import { useEffect, useState } from "react";
import "./app.css";
import { TONE, COPY, initShortcuts } from "./lib/ui";

function Starfield(){ return <div className="starfield" />; }
function LoaderLine(){ return <div className="loader-line" />; }

/** Compact preview; reveal detail on hover/click (minimalistic/private-facing) */
function Reveal({ preview, children }: { preview: React.ReactNode; children: React.ReactNode; }){
  const [open,setOpen]=useState(false);
  return (
    <div className="card p-3" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}>
      <div aria-label="Summary">{preview}</div>
      <div className="reveal" style={{maxHeight: open? 500:0, opacity: open?1:0, marginTop: open? 8:0}}>
        {children}
      </div>
    </div>
  );
}

/** Minimal Memory & Role editor (UI-only; uses simple file-backed endpoints) */
function SettingsPanel(){
  type Memory = Record<string,string>;
  const [mem,setMem]=useState<Memory>({});
  const [role,setRole]=useState("default");
  const [busy,setBusy]=useState(false);

  useEffect(()=>{ (async()=>{
    try{
      const mj = await (await fetch("/api/memory")).json(); setMem(mj||{});
      const rj = await (await fetch("/api/role")).json(); setRole(rj?.id||"default");
    }catch{/* ignore */}
  })(); },[]);

  const save = async ()=>{
    setBusy(true);
    try{
      await fetch("/api/memory",{method:"POST",headers:{'content-type':'application/json'},body:JSON.stringify(mem)});
      await fetch("/api/role",{method:"POST",headers:{'content-type':'application/json'},body:JSON.stringify({id:role})});
      alert(TONE.done);
    }finally{ setBusy(false); }
  };

  return (
    <div className="card p-3 fade-in" style={{display:"grid",gap:8}}>
      <strong>Role & Memory</strong>
      <select value={role} onChange={e=>setRole(e.target.value)} className="card p-2" style={{background:"transparent"}}>
        <option value="default">Default — pragmatic/concise</option>
        <option value="teacher">Explainer — step-by-step</option>
        <option value="coder">Coder — inline CLI + code</option>
      </select>
      <div style={{fontSize:12,opacity:.85}}>User facts</div>
      {Object.entries(mem).map(([k,v])=>(
        <div key={k} style={{display:"flex",gap:8}}>
          <input className="card p-2" defaultValue={k} readOnly />
          <input className="card p-2" value={v} onChange={e=>setMem(m=>({...m,[k]:e.target.value}))}/>
        </div>
      ))}
      <button className="btn" onClick={()=>setMem(m=>({...m, "new_key": ""}))}>+ Add</button>
      <button className="btn" onClick={save} disabled={busy}>{busy? "Saving…": "Save"}</button>
    </div>
  );
}

export default function App(){
  useEffect(()=>{ initShortcuts(); },[]);
  return (
    <>
      <Starfield />
      {/* Top bar with subtle loader example */}
      <div style={{position:"sticky",top:0}}><LoaderLine /></div>

      <main style={{maxWidth:880, margin:"24px auto", display:"grid", gap:12}}>
        <h1 style={{margin:"0 8px"}}>Xenya</h1>

        {/* Microcopy examples */}
        <Reveal preview={<div>🔎 Result • example.com • 2m ago</div>}>
          <div style={{fontSize:14,opacity:.9}}>
            {COPY.emptyChat}<br/>
            <em>{TONE.tip("Try /research transformers efficiency")}</em>
          </div>
        </Reveal>

        <SettingsPanel />
      </main>
    </>
  );
}
