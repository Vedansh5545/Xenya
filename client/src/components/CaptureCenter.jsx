// components/CaptureCenter.jsx
import { useEffect, useMemo, useState } from "react";

const LS = "xenya.captures.v1";
function readHist(){ try { return JSON.parse(localStorage.getItem(LS)) || []; } catch { return []; } }
function writeHist(list){ try { localStorage.setItem(LS, JSON.stringify(list||[])); } catch {} window.dispatchEvent(new CustomEvent("captures:changed")); }

const fmt = (ms) => { try { return new Date(ms).toLocaleString([], { dateStyle:"medium", timeStyle:"short" }); } catch { return ""; } };

export default function CaptureCenter({ embedded=true }) {
  const [items, setItems] = useState(()=>readHist());
  const [filter, setFilter] = useState("all");       // all | tasks | notes | readlater
  const [q, setQ]         = useState("");

  useEffect(()=>{
    const rerender = () => setItems(readHist());
    window.addEventListener("captures:changed", rerender);
    window.addEventListener("capture:added", rerender);
    return ()=>{ window.removeEventListener("captures:changed", rerender); window.removeEventListener("capture:added", rerender); };
  },[]);

  const list = useMemo(()=>{
    const base = (items||[]).filter(c => filter==="all" ? true : c.target===filter);
    if(!q.trim()) return base;
    const s = q.toLowerCase();
    return base.filter(c =>
      (c.text||"").toLowerCase().includes(s) ||
      (c.tags||[]).some(t => (t||"").toLowerCase().includes(s))
    );
  }, [items, filter, q]);

  function del(id){ writeHist(readHist().filter(c => c.id !== id)); setItems(readHist()); }
  function clearAll(){ if(confirm("Clear all Quick Capture history?")){ writeHist([]); setItems([]); } }
  function openLink(url){ if(!url) return; const a = document.createElement("a"); a.href = url; a.target="_blank"; a.rel="noopener noreferrer"; a.click(); }

  return (
    <>
      <style>{`
        .cc-wrap{display:flex; flex-direction:column; gap:8px; height:100%}
        .cc-head{display:flex; align-items:center; justify-content:space-between; gap:8px}
        .cc-row{display:flex; gap:6px; flex-wrap:wrap}
        .cc-btn{padding:6px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.06); color:#EEE; cursor:pointer}
        .cc-input{background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#eee; border-radius:8px; padding:6px 10px; min-width:200px}
        .cc-list{flex:1; overflow:auto; display:flex; flex-direction:column; gap:8px}
        .cc-item{border:1px solid rgba(255,255,255,0.10); border-radius:10px; padding:8px; background:rgba(255,255,255,0.04)}
        .cc-top{display:flex; justify-content:space-between; gap:8px; align-items:center}
        .cc-tag{font-size:12px; opacity:.82}
        .cc-meta{font-size:12px; opacity:.7}
        .cc-actions{display:flex; gap:6px; flex-wrap:wrap}
        .cc-empty{opacity:.7; font-style:italic; text-align:center; padding:20px}
        .linkish{color:#a0e9ff; text-decoration:underline; cursor:pointer}
      `}</style>

      <div className="cc-wrap">
        <div className="cc-head">
          <div style={{fontWeight:700, color:"#EEE"}}>Quick Capture • History</div>
          <div className="cc-row">
            <input className="cc-input" placeholder="Search text or #tag…" value={q} onChange={e=>setQ(e.target.value)} />
            <button className="cc-btn" onClick={()=>window.dispatchEvent(new CustomEvent('capture:open'))}>New (⌘/Ctrl+J)</button>
            <div className="cc-row">
              {["all","tasks","notes","readlater"].map(f => (
                <button key={f} className="cc-btn" onClick={()=>setFilter(f)} style={{opacity: filter===f ? 1 : .7}}>{f}</button>
              ))}
            </div>
            <button className="cc-btn" onClick={clearAll} title="Delete entire history">Clear All</button>
          </div>
        </div>

        <div className="cc-list">
          {list.length===0 && <div className="cc-empty">No captures yet.</div>}
          {list.map(it => (
            <div key={it.id} className="cc-item">
              <div className="cc-top">
                <div className="cc-tag">→ {it.target}</div>
                <div className="cc-meta">{fmt(it.created)}</div>
              </div>

              {/* body + url affordance */}
              <div style={{margin:"6px 0"}}>
                {it.url ? (
                  <>
                    <span className="linkish" onClick={()=>openLink(it.url)} title="Open in new tab">{it.url}</span>
                    {it.text.trim()!==it.url && <div style={{opacity:.9, marginTop:4}}>{it.text}</div>}
                  </>
                ) : (
                  <>{it.text}</>
                )}
              </div>

              {!!(it.tags||[]).length && <div className="cc-tag">Tags: {(it.tags||[]).map(t=>"#"+t).join(" ")}</div>}

              <div className="cc-actions" style={{marginTop:6}}>
                {it.url && <button className="cc-btn" onClick={()=>openLink(it.url)}>Open Link</button>}
                <button className="cc-btn" onClick={()=>{ navigator.clipboard.writeText(it.text).catch(()=>{}); }}>Copy</button>
                <button className="cc-btn" onClick={()=>del(it.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
