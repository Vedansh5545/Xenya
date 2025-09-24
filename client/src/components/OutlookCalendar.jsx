// client/src/components/OutlookCalendar.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'

// ---------- tiny utils ----------
const pad = (n) => String(n).padStart(2, '0')
const toIso = (d) => new Date(d).toISOString()
const startOfDay = (d) => { const x=new Date(d); x.setHours(0,0,0,0); return x }
const endOfDay   = (d) => { const x=new Date(d); x.setHours(23,59,59,999); return x }
const addDays    = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x }
const addMonths  = (d,n) => { const x=new Date(d); x.setMonth(x.getMonth()+n); return x }
const startOfWeekSun = (d) => { const x = startOfDay(d); return addDays(x, -x.getDay()) }
const sameDay = (a,b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate()
const fmtDate = (d, opts={ month:'short', day:'numeric' }) => d.toLocaleDateString(undefined, opts)
const fmtDateTime = (d) => d.toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' })
const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const API = {
  status: '/calendar/status',
  list:   (from,to) => `/calendar/upcoming?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  upsert: '/calendar/upsert',
  del:    (id) => `/calendar/${encodeURIComponent(id)}`,
  connect:'/calendar/connect',
}
const LOCAL_KEY = 'xenya_local_events_v1'
const VIEW_KEY  = 'xenya_cal_view'

// ---- safe location → string ----
function locToText(loc){
  if (!loc) return ''
  if (typeof loc === 'string') return loc
  if (Array.isArray(loc)) {
    return loc.map(x => x?.displayName || x?.address?.street || x?.address?.text || '')
              .filter(Boolean).join(', ')
  }
  if (typeof loc === 'object') {
    return (loc.displayName ||
           [loc.address?.street, loc.address?.city, loc.address?.state].filter(Boolean).join(', ')) || ''
  }
  return ''
}

// normalize events
function normalize(e, source='outlook'){
  const start = new Date(e.start?.dateTime || e.start)
  const end   = new Date(e.end?.dateTime || e.end || start)
  return {
    id: e.id || `local-${Math.random().toString(36).slice(2)}`,
    title: e.subject || e.title || '(untitled)',
    location: locToText(e.location) || locToText(e.locations) || e.locationDisplayName || '',
    start, end, webLink: e.webLink, source
  }
}
function loadLocal(){ try { return JSON.parse(localStorage.getItem(LOCAL_KEY)||'[]').map(x=>normalize(x,'local')) } catch { return [] } }
function saveLocal(list){
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list.map(e=>({
    id:e.id, title:e.title, location:e.location, start:e.start, end:e.end, webLink:e.webLink
  }))))
}
function groupByDay(events){
  const map = new Map()
  for(const e of events){
    const key = `${e.start.getFullYear()}-${pad(e.start.getMonth()+1)}-${pad(e.start.getDate())}`
    if(!map.has(key)) map.set(key,[])
    map.get(key).push(e)
  }
  for(const v of map.values()) v.sort((a,b)=>a.start-b.start)
  return map
}

export default function OutlookCalendar(){
  const [connected, setConnected] = useState(null)
  const [showOutlook, setShowOutlook] = useState(true)
  const [showLocal, setShowLocal] = useState(true)
  const [view, setView] = useState(()=> localStorage.getItem(VIEW_KEY) || 'list') // 'list' | 'week' | 'month'
  const [cursor, setCursor] = useState(new Date())

  const [outlookEvents, setOutlookEvents] = useState([])
  const [localEvents, setLocalEvents] = useState(loadLocal())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // quick add local
  const [draftTitle, setDraftTitle] = useState('')
  const [draftStart, setDraftStart] = useState(() => new Date().toISOString().slice(0,16))
  const [draftEnd,   setDraftEnd]   = useState(() => new Date(Date.now()+60*60*1000).toISOString().slice(0,16))

  const popupRef = useRef(null)

  // visible range
  const range = useMemo(()=>{
    if(view==='list'){
      const from = startOfDay(cursor)
      const to   = endOfDay(addDays(cursor, 6))
      return { from, to }
    }
    if(view==='week'){
      const from = startOfWeekSun(cursor)
      const to   = endOfDay(addDays(from, 6))
      return { from, to }
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const gridStart = startOfWeekSun(first)
    const to = endOfDay(addDays(gridStart, 41))
    return { from: gridStart, to }
  }, [cursor, view])

  const headerLabel = useMemo(()=>{
    if(view==='month') return cursor.toLocaleDateString(undefined,{month:'long',year:'numeric'})
    if(view==='week'){
      const {from,to}=range
      const sameMonth = from.getMonth()===to.getMonth()
      const m1 = from.toLocaleDateString(undefined,{month: sameMonth?'long':'short'})
      const m2 = to.toLocaleDateString(undefined,{month:'long'})
      return `${m1} ${from.getDate()} – ${m2} ${to.getDate()}, ${to.getFullYear()}`
    }
    const {from,to}=range
    return `${fmtDate(from)} – ${fmtDate(to,{month:'short',day:'numeric',year:'numeric'})}`
  }, [range, view, cursor])

  // status
  useEffect(()=>{
    let cancelled=false
    ;(async()=>{
      try{
        const r = await fetch(API.status, { credentials:'include' })
        const data = await r.json().catch(()=>null)
        if(!cancelled) setConnected(!!data?.connected)
      }catch{ if(!cancelled) setConnected(false) }
    })()
    return ()=>{ cancelled=true }
  }, [])

  // fetch outlook
  async function refreshOutlook(){
    if(!connected || !showOutlook) return
    try{
      setLoading(true); setError('')
      const r = await fetch(API.list(toIso(range.from), toIso(range.to)), { credentials:'include' })
      if(!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setOutlookEvents((Array.isArray(data)?data:[]).map(e=>normalize(e,'outlook')))
    }catch(e){
      setError('Network error while fetching Outlook events.')
      setOutlookEvents([])
    }finally{ setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{ refreshOutlook() }, [connected, showOutlook, view, cursor])

  // connect popup
  function openConnect(){
    const w = 520, h = 680
    const y = window.top.outerHeight/2 + window.top.screenY - (h/2)
    const x = window.top.outerWidth/2  + window.top.screenX - (w/2)
    popupRef.current = window.open(API.connect, 'xenya-ms-login', `width=${w},height=${h},left=${x},top=${y}`)
  }
  useEffect(()=>{
    function onMsg(ev){
      if(ev?.data==='outlook:connected'){
        setConnected(true)
        refreshOutlook()
        try{ popupRef.current && popupRef.current.close() }catch{}
      }
    }
    window.addEventListener('message', onMsg)
    return ()=> window.removeEventListener('message', onMsg)
  }, [])

  // filtered
  const events = useMemo(()=>{
    const parts = []
    if(showOutlook) parts.push(outlookEvents)
    if(showLocal)   parts.push(localEvents.filter(e=> e.start>=range.from && e.start<=range.to))
    return parts.flat().sort((a,b)=>a.start-b.start)
  }, [outlookEvents, localEvents, showOutlook, showLocal, range])

  // actions
  function goToday(){ setCursor(new Date()) }
  function goPrev(){ setCursor(view==='month' ? addMonths(cursor,-1) : addDays(cursor,-7)) }
  function goNext(){ setCursor(view==='month' ? addMonths(cursor, 1) : addDays(cursor, 7)) }

  async function pushLocalToOutlook(ev){
    try{
      const r = await fetch(API.upsert, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        credentials:'include',
        body: JSON.stringify({ task:{ title:ev.title, start:ev.start, end:ev.end, notes: ev.location || '' } })
      })
      if(!r.ok) throw new Error()
      refreshOutlook()
      alert('Pushed to Outlook.')
    }catch{ alert('Failed to push to Outlook.') }
  }
  function addLocal(){
    if(!draftTitle.trim()) return
    const start = new Date(draftStart), end = new Date(draftEnd)
    const item = normalize({ id:`local-${Date.now()}`, title:draftTitle.trim(), start, end }, 'local')
    const next = [item, ...localEvents]
    setLocalEvents(next); saveLocal(next)
    setDraftTitle(''); setDraftStart(new Date().toISOString().slice(0,16)); setDraftEnd(new Date(Date.now()+60*60*1000).toISOString().slice(0,16))
  }
  function deleteLocal(id){ const next = localEvents.filter(e=>e.id!==id); setLocalEvents(next); saveLocal(next) }

  useEffect(()=>{ localStorage.setItem(VIEW_KEY, view) }, [view])

  // ---------- Views ----------
  function ViewList(){
    const groups = groupByDay(events)
    const orderedKeys = Array.from(groups.keys()).sort()
    if(!orderedKeys.length) return <div className="muted pad">No entries in this range.</div>
    return (
      <div className="col gap">
        {orderedKeys.map(k=>{
          const [y,m,d]=k.split('-').map(Number)
          const day = new Date(y,m-1,d)
          const items = groups.get(k)
          return (
            <div key={k} className="card">
              <div className="card-head">
                {day.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric', year:'numeric' })}
              </div>
              <ul className="list-col">
                {items.map(ev=>(
                  <li key={ev.id} className="row item">
                    <span className="time">{fmtTime(ev.start)} – {fmtTime(ev.end)}</span>
                    <span className="title">{ev.title}</span>
                    {ev.location && typeof ev.location === 'string' ? (
                      <span className="loc">· {ev.location}</span>
                    ) : null}
                    <span className="src">{ev.source}</span>
                    {ev.source==='local' && connected && <button className="btn ghost" onClick={()=>pushLocalToOutlook(ev)}>Push</button>}
                    {ev.source==='local' && <button className="btn ghost" onClick={()=>deleteLocal(ev.id)} title="Delete">✕</button>}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    )
  }

  function WeekContent(){
    const from = range.from
    const days = Array.from({length:7}, (_,i)=> addDays(from, i))
    const dayMap = groupByDay(events)
    const hours = Array.from({length:13}, (_,r)=> r+8) // 8am..8pm
    const rowH = 'clamp(40px, 6vh, 56px)'

    return (
      <div className="weekgrid"
           style={{gridTemplateColumns:'60px repeat(7, minmax(0, 1fr))', gridAutoRows: rowH}}>
        <div className="hdrcell">Time</div>
        {days.map((d,i)=>(
          <div key={i} className="hdrcell">{d.toLocaleDateString(undefined,{weekday:'short'})} {d.getDate()}</div>
        ))}
        {hours.map((hr)=>(
          <React.Fragment key={hr}>
            <div className="timecell">
              {hr%12===0?12:hr%12}:00 {hr<12?'AM':'PM'}
            </div>
            {days.map((d,ci)=>{
              const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
              const items = (dayMap.get(key)||[]).filter(e=> e.start.getHours()===hr || (e.start.getHours()<hr && e.end.getHours()>=hr))
              return (
                <div key={ci} className="slot">
                  {items.slice(0,2).map(ev=>(
                    <div key={ev.id} className={`pill ${ev.source==='local' ? 'local' : 'outlook'}`}
                         title={`${ev.title}\n${fmtDateTime(ev.start)} – ${fmtDateTime(ev.end)}`}>
                      <b>{ev.title}</b>
                    </div>
                  ))}
                  {(dayMap.get(key)||[]).length>2 && hr===8 && (
                    <div className="more">+{(dayMap.get(key)||[]).length-2}</div>
                  )}
                </div>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    )
  }

  function MonthContent(){
    const cells = Array.from({length:42}, (_,i)=> addDays(range.from, i))
    const dayMap = groupByDay(events)
    const month = cursor.getMonth()
    const dayBoxH = 'clamp(96px, 16vw, 140px)'

    return (
      <div className="col gap">
        <div className="weekdays">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((w,i)=>(
            <div key={i} className="wklabel">{w}</div>
          ))}
        </div>
        <div className="monthgrid"
             style={{gridTemplateRows:`repeat(6, ${dayBoxH})`}}>
          {cells.map((d,idx)=>{
            const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
            const items = (dayMap.get(key)||[])
            const isOtherMonth = d.getMonth()!==month
            const isToday = sameDay(d,new Date())
            return (
              <div key={idx} className={`daybox ${isOtherMonth?'muteday':''} ${isToday?'today':''}`}>
                <div className="dayhead">
                  <div className="daynum">{d.getDate()}</div>
                  {items.length>3 && <div className="more small">+{items.length-3}</div>}
                </div>
                <div className="col gap4">
                  {items.slice(0,3).map(ev=>(
                    <div key={ev.id}
                         className={`pill ${ev.source==='local' ? 'local' : 'outlook'}`}
                         title={`${ev.title}\n${fmtDateTime(ev.start)} – ${fmtDateTime(ev.end)}`}>
                      <b>{ev.title}</b> <span className="muted">{fmtTime(ev.start)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="x-cal card-root">
      {/* scoped theme */}
      <style>{`
        .x-cal{
          --panel:#151723;
          --panel-2:#0f1118;
          --line:#2b2f3a;
          --muted:#9aa0aa;
          --text:#e7e9ee;
          --accent:#7aa2ff;
          --accent-2:#8cf5b3;
          --chip-local:rgba(0,150,255,.18);
          --chip-out:rgba(120,200,120,.18);
        }
        .x-cal *{ box-sizing:border-box; }
        .x-cal .muted{ color:var(--muted); }
        .x-cal .small{ font-size:11px; }
        .x-cal .gap{ display:flex; flex-direction:column; gap:12px; }
        .x-cal .gap4{ display:flex; flex-direction:column; gap:4px; }
        .x-cal .col{ display:flex; flex-direction:column; }
        .x-cal .row{ display:flex; align-items:center; gap:8px; }
        .x-cal .card-root{ border:1px solid var(--line); border-radius:12px; padding:12px; height:100%; display:flex; flex-direction:column; min-width:0; background:linear-gradient(180deg, var(--panel), var(--panel-2)); color:var(--text); }
        .x-cal .toolbar{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
        .x-cal .titlebar{ font-weight:700; margin-bottom:8px; }
        .x-cal .btn{ background:transparent; color:var(--text); border:1px solid var(--line); padding:6px 10px; height:30px; border-radius:8px; cursor:pointer }
        .x-cal .btn:hover{ background:rgba(255,255,255,.06) }
        .x-cal .btn.prim{ background:rgba(122,162,255,.1); border-color:rgba(122,162,255,.35) }
        .x-cal .btn.ghost{ opacity:.9 }
        .x-cal .seg{ display:inline-flex; border:1px solid var(--line); border-radius:8px; overflow:hidden }
        .x-cal .seg button{ border:none; padding:6px 10px; color:var(--text); background:transparent; border-right:1px solid var(--line); cursor:pointer; height:30px }
        .x-cal .seg button.active{ background:rgba(255,255,255,.08) }
        .x-cal .seg button:last-child{ border-right:none }
        .x-cal input[type="text"], .x-cal input[type="datetime-local"]{
          color-scheme: dark; background:rgba(255,255,255,.04); color:var(--text);
          border:1px solid var(--line); border-radius:8px; padding:6px 8px; height:30px;
        }
        .x-cal input[type="checkbox"]{ accent-color: var(--accent); }
        .x-cal .pad{ padding:12px; }
        .x-cal .list-col{ list-style:none; margin:0; padding:12px; display:flex; flex-direction:column; gap:8px }
        .x-cal .card{ border:1px solid var(--line); border-radius:8px; background:rgba(255,255,255,.02) }
        .x-cal .card-head{ padding:8px 12px; font-weight:600; background:rgba(255,255,255,.04); border-bottom:1px solid var(--line) }
        .x-cal .item .time{ min-width:110px; opacity:.9 }
        .x-cal .item .title{ font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
        .x-cal .item .loc{ opacity:.8; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
        .x-cal .item .src{ margin-left:auto; opacity:.6; font-size:12px }

        /* Week */
        .x-cal .weekgrid{ display:grid; border-top:1px solid var(--line); border-left:1px solid var(--line); border-radius:8px; overflow:hidden; min-width:0 }
        .x-cal .hdrcell{ background:rgba(255,255,255,.06); padding:6px 8px; border-right:1px solid var(--line); font-weight:600; min-width:0 }
        .x-cal .timecell{ border-right:1px solid var(--line); border-bottom:1px solid var(--line); padding:4px 6px; font-size:12px; opacity:.8 }
        .x-cal .slot{ border-right:1px solid var(--line); border-bottom:1px solid var(--line); padding:4px 6px; position:relative; min-width:0 }
        .x-cal .pill{ padding:4px 6px; margin-bottom:4px; border-radius:6px; border:1px solid rgba(255,255,255,.12); font-size:12px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis }
        .x-cal .pill.local{ background:var(--chip-local) }
        .x-cal .pill.outlook{ background:var(--chip-out) }
        .x-cal .more{ position:absolute; top:4px; right:6px; font-size:11px; opacity:.6 }

        /* Month */
        .x-cal .weekdays{ display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:6px }
        .x-cal .wklabel{ text-align:center; font-weight:600; opacity:.9; min-width:0 }
        .x-cal .monthgrid{ display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:6px; min-width:0 }
        .x-cal .daybox{ border:1px solid var(--line); border-radius:8px; padding:6px; min-width:0; background:transparent; display:flex; flex-direction:column }
        .x-cal .daybox.today{ background:rgba(0,160,255,.08) }
        .x-cal .daybox.muteday{ background:rgba(255,255,255,.02) }
        .x-cal .dayhead{ display:flex; justify-content:space-between; align-items:center; margin-bottom:4px }
        .x-cal .daynum{ font-weight:600 }
        .x-cal .muteday .daynum{ opacity:.6 }

        /* viewport */
        .x-cal .viewport{ position:relative; flex:1; overflow:auto; border-radius:8px; min-width:0 }
        .x-cal .toolbar .title{ min-width:0; flex:0 1 260px; text-align:center; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }

        /* dark scrollbars (WebKit) */
        .x-cal .viewport::-webkit-scrollbar{ height:10px; width:10px }
        .x-cal .viewport::-webkit-scrollbar-thumb{ background:#2a2f3b; border-radius:10px }
        .x-cal .viewport::-webkit-scrollbar-track{ background:#141722 }
      `}</style>

      <div className="titlebar">Calendar</div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="row">
          <button className="btn" onClick={goToday}>Today</button>
          <button className="btn" onClick={goPrev}>◀</button>
          <div className="title">{headerLabel}</div>
          <button className="btn" onClick={goNext}>▶</button>
        </div>
        <div className="row" style={{flexWrap:'wrap'}}>
          <label className="row"><input type="checkbox" checked={showOutlook} onChange={e=>setShowOutlook(e.target.checked)} /> Outlook</label>
          <label className="row"><input type="checkbox" checked={showLocal} onChange={e=>setShowLocal(e.target.checked)} /> Local</label>
          <div className="seg">
            {['list','week','month'].map(v=>(
              <button key={v} className={view===v?'active':''} onClick={()=>setView(v)}>
                {v[0].toUpperCase()+v.slice(1)}
              </button>
            ))}
          </div>
          <button className="btn" onClick={refreshOutlook}>Refresh</button>
          {connected!==true && <button className="btn prim" onClick={openConnect}>Connect</button>}
        </div>
      </div>

      {/* Quick Add (Local) */}
      <div className="row" style={{gap:8, margin:'8px 0', minWidth:0}}>
        <input
          type="text"
          placeholder="Add local item…"
          value={draftTitle}
          onChange={e=>setDraftTitle(e.target.value)}
          style={{flex:1, minWidth:0}}
        />
        <input type="datetime-local" value={draftStart} onChange={e=>setDraftStart(e.target.value)} />
        <input type="datetime-local" value={draftEnd}   onChange={e=>setDraftEnd(e.target.value)} />
        <button className="btn prim" onClick={addLocal}>+ Local</button>
      </div>

      {error && <div className="muted" style={{color:'#ff6b6b', marginBottom:8}}>{error}</div>}
      {loading && <div className="muted" style={{marginBottom:8}}>Loading…</div>}

      {/* Responsive viewport */}
      <div className="viewport">
        {view==='list'  && <ViewList/>}
        {view==='week'  && <WeekContent/>}
        {view==='month' && <MonthContent/>}
      </div>
    </div>
  )
}
