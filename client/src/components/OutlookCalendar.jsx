// components/OutlookCalendar.jsx
import { useEffect, useMemo, useState } from "react";

function isoLocal(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}-${m}-${day}T${hh}:${mm}`;
}
function startOfDay(d = new Date()) { const t = new Date(d); t.setHours(0,0,0,0); return t; }
function addDays(d, n) { const t = new Date(d); t.setDate(t.getDate()+n); return t; }
function toIsoWithTZ(d) { return new Date(d).toISOString(); }

export default function OutlookCalendar({ embed = true }) {
  const [connected, setConnected] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [events, setEvents]   = useState([]);

  const [title, setTitle]       = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes]       = useState("");
  const [start, setStart]       = useState(() => isoLocal(addDays(startOfDay(), 0)));
  const [end, setEnd]           = useState(() => isoLocal(addDays(startOfDay(), 0)));
  const [rangeDays, setRangeDays] = useState(7);

  async function fetchAgenda() {
    setLoading(true); setError("");
    try {
      const from = startOfDay(); const to = addDays(from, Number(rangeDays) || 7);
      const res  = await fetch(`/calendar/upcoming?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
      if (res.status === 401 || res.status === 403) { setConnected(false); setEvents([]); return; }
      if (!res.ok) throw new Error(`Agenda fetch failed (${res.status})`);
      const data = await res.json();
      setEvents(Array.isArray(data) ? data : (data.items || []));
      setConnected(true);
    } catch (e) { setError(e.message || "Agenda error"); }
    finally { setLoading(false); }
  }

  async function createEvent() {
    const t = title.trim();
    if (!t) { alert("Title is required"); return; }
    const s = new Date(start), e = new Date(end);
    if (e <= s) { alert("End must be after start"); return; }

    setLoading(true); setError("");
    try {
      const payload = { title: t, start: toIsoWithTZ(s), end: toIsoWithTZ(e), location: location.trim(), notes: notes.trim() };
      const res = await fetch("/calendar/upsert", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      if (res.status === 401 || res.status === 403) { setConnected(false); throw new Error("Not connected to Outlook"); }
      if (!res.ok) throw new Error(`Create failed (${res.status})`);
      setTitle(""); setLocation(""); setNotes("");
      await fetchAgenda();
    } catch (e) { setError(e.message || "Create error"); }
    finally { setLoading(false); }
  }

  async function deleteEvent(id) {
    if (!id) return;
    if (!confirm("Delete this event from Outlook?")) return;
    setLoading(true); setError("");
    try {
      const res = await fetch(`/calendar/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.status === 401 || res.status === 403) { setConnected(false); throw new Error("Not connected to Outlook"); }
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      await fetchAgenda();
    } catch (e) { setError(e.message || "Delete error"); }
    finally { setLoading(false); }
  }

  const groups = useMemo(() => {
    const map = new Map();
    for (const ev of (events || [])) {
      const d  = new Date(ev.start || ev.startTime || ev.startDateTime);
      const k  = startOfDay(d).toDateString();
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(ev);
    }
    for (const [k, list] of map) list.sort((a,b)=> new Date(a.start) - new Date(b.start));
    return Array.from(map.entries()).sort((a,b)=> new Date(a[0]) - new Date(b[0]));
  }, [events]);

  useEffect(()=>{ fetchAgenda(); },[]);

  return (
    <>
      <style>{`
        .cal-wrap{display:flex; flex-direction:column; gap:10px; padding:12px}
        .cal-row{display:flex; gap:8px; align-items:center; flex-wrap:wrap}
        .cal-input,.cal-select,.cal-textarea{background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#eee; border-radius:10px; padding:8px}
        .cal-input{min-width:220px}
        .cal-textarea{width:100%; min-height:64px; resize:vertical}
        .cal-btn{background:rgba(0,229,255,0.18); border:1px solid rgba(0,229,255,0.5); color:#e6feff; border-radius:10px; padding:8px 12px; cursor:pointer; font-weight:600}
        .cal-btn.secondary{background:rgba(122,62,255,0.2); border-color:rgba(122,62,255,0.6); color:#eee}
        .cal-status{display:flex; align-items:center; gap:8px; padding:6px 0; opacity:.9}
        .cal-badge{font-size:12px; padding:2px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.2)}
        .cal-badge.ok{background:rgba(0,229,255,.12); border-color:rgba(0,229,255,.45); color:#c9fbff}
        .cal-badge.err{background:rgba(255,64,64,.12); border-color:rgba(255,64,64,.45); color:#ffd6de}
        .cal-sep{height:1px; background:rgba(255,255,255,0.08); margin:4px 0}
        .cal-day{background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:12px}
        .cal-day h4{margin:0; padding:8px 12px; font-size:13px; letter-spacing:.08em; opacity:.85; display:flex; justify-content:space-between}
        .cal-list{display:flex; flex-direction:column; gap:6px; padding:8px 12px}
        .cal-item{display:flex; gap:10px; align-items:flex-start; justify-content:space-between; background:rgba(255,255,255,0.05);
          border:1.6px solid rgba(255,255,255,0.1); border-radius:10px; padding:8px}
        .cal-item .meta{font-size:12px; opacity:.9}
        .cal-link{color:#9fdcff; text-decoration:none}
        .cal-actions{display:flex; gap:6px}
        .cal-icon{font-size:12px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); padding:4px 6px; border-radius:8px; color:#eee; cursor:pointer}
        .cal-empty{opacity:.7; font-style:italic; padding:6px 12px}
      `}</style>

      <div className="cal-wrap">
        <div className="cal-row cal-status">
          <span className={`cal-badge ${connected ? 'ok' : 'err'}`}>{connected ? "Outlook: Connected" : "Outlook: Not connected"}</span>
          {loading && <span className="cal-badge">Loading…</span>}
          {error && <span className="cal-badge err" title={error}>Error</span>}
          <button className="cal-btn secondary" onClick={fetchAgenda}>Refresh</button>
          {!connected && (<button className="cal-btn" onClick={()=>{ window.location.href = "/calendar/connect"; }}>Connect Outlook</button>)}
        </div>

        <div className="cal-row">
          <input className="cal-input" placeholder="Title (required)" value={title} onChange={e=>setTitle(e.target.value)} />
          <input className="cal-input" type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} />
          <input className="cal-input" type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} />
          <input className="cal-input" placeholder="Location (optional)" value={location} onChange={e=>setLocation(e.target.value)} />
          <button className="cal-btn" onClick={createEvent} disabled={!connected || loading}>Create</button>
        </div>
        <textarea className="cal-textarea" placeholder="Notes (optional)" value={notes} onChange={e=>setNotes(e.target.value)} />

        <div className="cal-sep" />

        <div className="cal-row">
          <label>Show next&nbsp;
            <select className="cal-select" value={rangeDays} onChange={e=>setRangeDays(e.target.value)}>
              {[1,3,7,14,30].map(n => <option key={n} value={n}>{n} day{n>1?'s':''}</option>)}
            </select>
          </label>
          <button className="cal-btn secondary" onClick={fetchAgenda}>Update</button>
        </div>

        {groups.length === 0 && !loading && connected && <div className="cal-empty">No upcoming events in this range.</div>}

        {groups.map(([day, list])=>(
          <div key={day} className="cal-day">
            <h4><span>{day}</span><span>{list.length}</span></h4>
            <div className="cal-list">
              {list.map(ev=>{
                const s = new Date(ev.start); const e = new Date(ev.end);
                const time = `${s.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} – ${e.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
                return (
                  <div key={ev.id} className="cal-item">
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600}}>{ev.subject || ev.title || "(untitled)"}</div>
                      <div className="meta">{time}{ev.location ? ` • ${ev.location}` : ""}</div>
                      {ev.webLink && <a className="cal-link" href={ev.webLink} target="_blank" rel="noreferrer">Open in Outlook</a>}
                    </div>
                    <div className="cal-actions">
                      <button className="cal-icon" title="Delete" onClick={()=>deleteEvent(ev.id)}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
