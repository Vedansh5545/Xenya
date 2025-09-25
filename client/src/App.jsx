import { useEffect, useMemo, useRef, useState } from 'react'
import './theme.css'
import Notes from './components/Notes.jsx'
import MarkdownMessage from './components/MarkdownMessage.jsx'
import { chat, research, summarizeUrl, rss, listModels, selectModel, refreshModels } from './lib/api'
import TTSControls from './components/TTSControls.jsx'
import { speak } from './lib/tts/speak'
import Logo from './components/Logo.jsx'
import ChatBox from './components/ChatBox.jsx'   // compact composer (Talk + Send)
import XenyaProductivitySuite from "./components/XenyaProductivitySuite.jsx";
import { addKanbanTask, moveKanbanTaskByTitle } from './components/MiniKanban.jsx'  // Kanban helper APIs

/* ---------- Tone & Microcopy ---------- */
const TONE = {
  motto: "Consider it sorted.",
  error: (hint) => `Didn't catch that${hint ? ` — ${hint}` : ""}. One more go?`,
  done: "All set."
}
const COPY = {
  emptyChat: `${TONE.motto} Start with a link, /research <topic>, or just ask.`,
  loading: "Thinking…"
}

/* ---------- Helpers ---------- */
const LS_KEY = 'xenya.chats.v1'
const loadChats = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || [] } catch { return [] } }
const saveChats = (d) => localStorage.setItem(LS_KEY, JSON.stringify(d))

const isUrl = (s) => /^https?:\/\/\S+$/i.test(s.trim())
const wantsNews = (s) => {
  const t = s.trim()
  if (isUrl(t)) return false
  return /^\s*\/news\s*$/i.test(t)
      || /\b(today'?s|latest)\b.*\bnews\b/i.test(t)
      || /\bnews\b(?:\s+(?:today|now|please))?\s*$/i.test(t)
}

// Strong, collision-resistant ids
const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 8))

const makeId = (taken = new Set()) => {
  let id = uid()
  while (taken.has(id)) id = uid()
  return id
}

/* ---------- Query cleaner + citation filter for /research ---------- */
const STOP = new Set([
  "a","an","the","and","or","but","if","then","so","to","for","of","in","on","with",
  "how","what","why","when","where","who","whom","which","can","could","should",
  "is","are","was","were","be","being","been","do","does","did","have","has","had",
  "there","any","about","tell","me","please","i","you","we","they"
])

const cleanQuery = (q) =>
  q.toLowerCase()
   .replace(/[^\p{L}\p{N}\s-]/gu," ")
   .split(/\s+/)
   .filter(w => w && !STOP.has(w))
   .slice(0, 12)
   .join(" ")

const BAD_DOMAIN = /(merriam|dictionary|vocabulary|collinsdictionary|urbandictionary)\./i
function filterCitations(cites = []) {
  const seen = new Set()
  const good = []
  for (const c of cites) {
    try {
      const u = new URL(c.url)
      const host = u.hostname.replace(/^www\./, "")
      if (BAD_DOMAIN.test(host)) continue
      if (seen.has(host)) continue
      seen.add(host)
      good.push({ title: c.title || host, url: c.url })
    } catch {}
  }
  return good
}

/* ---------- Mic status normalizer ---------- */
function normalizeMicStatus(s) {
  const v = String(s || '')
    .toLowerCase()
    .replace(/[.…]/g, '')
    .trim()
  if (v.startsWith('listen') || v.startsWith('record')) return 'listening'
  if (v.startsWith('transcrib') || v.includes('stt') || v.includes('speech to text')) return 'transcribing'
  if (v.startsWith('think') || v.startsWith('process') || v === 'loading') return 'thinking'
  if (v.startsWith('speak') || v.startsWith('talk')) return 'speaking'
  if (v === 'ready' || v === 'idle' || v.startsWith('stop')) return 'idle'
  return 'idle'
}

/* ================== Calendar helpers (frontend) ================== */
const LOCAL_CAL_KEY = 'xenya_local_events_v1'
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || 'http://localhost:3000').replace(/\/$/, '')
const tzGuess = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const readLocalEvents = () => {
  try { return JSON.parse(localStorage.getItem(LOCAL_CAL_KEY)) || [] } catch { return [] }
}
const writeLocalEvents = (items) => {
  localStorage.setItem(LOCAL_CAL_KEY, JSON.stringify(items || []))
  // ping the UI (same tab) that data changed
  window.dispatchEvent(new CustomEvent('calendar:changed'))
}

const addLocalEvent = ({ title, start, end, tz, location, notes }) => {
  const items = readLocalEvents()
  const ev = {
    id: 'loc_' + uid(),
    title: String(title || 'Untitled'),
    start: new Date(start).toISOString(),
    end:   new Date(end).toISOString(),
    tz: tz || tzGuess(),
    location: location || '',
    notes: notes || '',
    source: 'local'
  }
  writeLocalEvents([ev, ...items])
  return ev
}
const patchLocalEvent = (id, patch) => {
  const items = readLocalEvents()
  const idx = items.findIndex(e => e.id === id)
  if (idx === -1) return false
  items[idx] = { ...items[idx], ...patch }
  writeLocalEvents(items)
  return true
}
const deleteLocalEvent = (id) => {
  const items = readLocalEvents().filter(e => e.id !== id)
  writeLocalEvents(items)
  return true
}

const fmt = (d) => {
  try {
    const dd = new Date(d)
    return dd.toLocaleString([], { dateStyle:'medium', timeStyle:'short' })
  } catch { return d }
}
const fmtRange = (s,e) => `${fmt(s)} → ${fmt(e)}`
const clampDayStart = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
const clampDayEnd = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x }

/** parse date range words or "YYYY-MM-DD..YYYY-MM-DD" */
function parseRange(arg){
  const now = new Date()
  const word = (arg || '').toLowerCase().trim()
  if (!arg || word === 'week') {
    const day = now.getDay() // 0..6 (Sun..Sat)
    const mondayOffset = (day + 6) % 7
    const start = clampDayStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset))
    const end = clampDayEnd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))
    return { label:'week', start, end }
  }
  if (word === 'today') {
    const start = clampDayStart(now); const end = clampDayEnd(now)
    return { label:'today', start, end }
  }
  if (word === 'month') {
    const start = clampDayStart(new Date(now.getFullYear(), now.getMonth(), 1))
    const end = clampDayEnd(new Date(now.getFullYear(), now.getMonth()+1, 0))
    return { label:'month', start, end }
  }
  // ISO range
  const m = String(arg).match(/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/)
  if (m) {
    const start = clampDayStart(new Date(m[1]))
    const end   = clampDayEnd(new Date(m[2]))
    return { label:`${m[1]}..${m[2]}`, start, end }
  }
  // Fallback: treat as week
  const start = clampDayStart(now); const end = clampDayEnd(new Date(now.getTime()+6*864e5))
  return { label:'week', start, end }
}

async function outlookStatus(){
  try{
    const r = await fetch(`${API_ORIGIN}/calendar/status`, { credentials:'include' })
    if(!r.ok) return { connected:false }
    return await r.json()
  }catch{ return { connected:false } }
}
async function outlookUpcoming(fromISO, toISO, tz = tzGuess()){
  try{
    const qs = new URLSearchParams({ from: fromISO, to: toISO, tz }).toString()
    const r = await fetch(`${API_ORIGIN}/calendar/upcoming?${qs}`, { credentials:'include' })
    if(!r.ok) return []
    const data = await r.json()
    // map to unified shape
    const arr = Array.isArray(data) ? data : (data.value || [])
    return arr.map(ev => ({
      id: ev.id,
      title: ev.subject || '(no title)',
      start: ev.start?.dateTime,
      end: ev.end?.dateTime,
      location: ev.location?.displayName || '',
      notes: ev.bodyPreview || '',
      webLink: ev.webLink || '',
      source: 'outlook'
    }))
  }catch{ return [] }
}

function renderEventsMarkdown(events, title='Events'){
  if(!events.length) return `**${title}**\n\n(no events)`
  const lines = events
    .sort((a,b)=>new Date(a.start)-new Date(b.start))
    .map(ev=>{
      const tag = ev.source === 'outlook' ? 'O' : 'L'
      const line = `- [${tag}] ${fmtRange(ev.start, ev.end)} — **${ev.title}**${ev.location ? ` · _${ev.location}_` : ''}${ev.source==='outlook' && ev.webLink ? ` · [open](${ev.webLink})` : ''}\n  \`id:${ev.id}\``
      return line
    })
  return `**${title}**\n\n${lines.join('\n')}`
}

function parseKVFlags(s){
  // parses loc:"Room A" notes:"something" (both optional)
  const res = {}
  const rx = /\b(loc|location|notes|tz):"([^"]*)"/gi
  let m; while((m = rx.exec(s))) {
    const k = m[1].toLowerCase()
    const v = m[2]
    if (k === 'location' || k === 'loc') res.location = v
    else if (k === 'notes') res.notes = v
    else if (k === 'tz') res.tz = v
  }
  return res
}

/* ---------- Router ---------- */
async function routeMessage(content, model, history, rolePrompt){
  const t = content.trim()

  if (t.startsWith('/research ')) {
    const raw = t.slice(10).trim()
    const q0  = cleanQuery(raw) || raw
    const r   = await research(q0, model)
    const summary   = r?.answer || r?.summary || '(no answer)'
    const citations = filterCitations(r?.citations || r?.sources || r?.links || [])
    return {
      role:'assistant',
      type:'report',
      reportTitle:`Research Summary: ${raw}`,
      content: summary,
      citations,
      error: r?.error || null
    }
  }

  if (isUrl(t)) {
    try {
      const r = await summarizeUrl(t, model)
      const summary = r?.summary || r?.bullets?.map(b=>`• ${b}`).join('\n') || '(no summary)'
      let host = ''
      try { host = new URL(t).hostname } catch {}
      const cit = [{ url: t, title: r?.title || host }]
      return { role:'assistant', type:'report', reportTitle:`URL Summary: ${host || 'Link'}`, content: summary, citations: cit }
    } catch (e) {
      return { role:'assistant', content: `Couldn’t summarize that page (${e.message}). Want me to research it instead? Try: /research ${t}` }
    }
  }

  if (wantsNews(t)) {
    const r = await rss()
    const items = (r.feeds||[]).flatMap(f =>
      (f.items||[]).slice(0,8).map(i => ({ title:i.title, url:i.link, source:f.title||f.id||'news', ago:i.ago||'' }))
    )
    const txt = items.map(i => `- [${i.title}](${i.url})`).join('\n') || '(no headlines)'
    return { role:'assistant', type:'dispatch', content: `**Today’s headlines**\n\n${txt}`, items }
  }

  const resp = await chat({ messages:[...history, {role:'user',content:t}], system: rolePrompt, model })
  return { role:'assistant', content: resp.reply ?? resp?.message?.content ?? '(no reply)' }
}

/* ---------- Inline cards ---------- */
function ReportCard({ title, body, cites=[], err }){
  const [open, setOpen] = useState(false)
  const shown = open ? cites : (cites || []).slice(0, 6)
  const more  = Math.max(0, (cites || []).length - shown.length)
  return (
    <div className="report-card materialize">
      <div className="report-head">🔷 {title}</div>
      {err && <div className="small" style={{marginTop:4, color:"var(--muted)"}}>
        Online sources were flaky; provided a concise synthesis{cites.length ? ' with citations.' : '.'}
      </div>}
      <div className="report-body">
        {typeof body === 'string' ? <MarkdownMessage text={body}/> : body}
      </div>
      {!!shown.length && (
        <div className="cites">
          {shown.map((c,i)=>{
            let href = c?.url || '#'
            let label = c?.title
            try{ if (!label) label = new URL(href).hostname }catch{}
            const ico = (()=>{ try{ return `${new URL(href).origin}/favicon.ico` }catch{ return '' } })()
            return (
              <a key={i} className="pill" href={href} target="_blank" rel="noreferrer noopener">
                {ico && <img alt="" src={ico} />}
                <span className="pill-text">{label || 'source'}</span>
              </a>
            )
          })}
          {more > 0 && (
            <button className="pill" onClick={()=>setOpen(true)} title="Show more sources">+{more} more</button>
          )}
        </div>
      )}
    </div>
  )
}

function Dispatch({ items=[] }){
  return (
    <div className="dispatch materialize">
      <h4>Dispatch</h4>
      {items.map((it,i)=>(
        <div key={i} className="item">
          <span className="src">{it.source || 'news'}</span>
          <a className="ttl" href={it.url} target="_blank" rel="noreferrer noopener">{it.title}</a>
          <span className="ago">{it.ago || ''}</span>
        </div>
      ))}
    </div>
  )
}

/* --- Action Dock (Notes + Productivity) --- */
function ActionDock({ onOpenNotes, onOpenProd }) {
  const [hidden, setHidden] = useState(false);

  return (
    <>
      <style>{`
        .dock{position:fixed; right:16px; top:72px; z-index:10050; display:flex; flex-direction:column; align-items:flex-end; gap:10px;}
        .dock-items{display:flex; flex-direction:column; gap:10px; transition:transform .28s ease, opacity .28s ease;}
        .dock-hidden .dock-items{transform:translateX(16px) scale(.98); opacity:0; pointer-events:none;}
        .fab{display:inline-flex; align-items:center; gap:8px; padding:10px 14px; border-radius:999px;
             border:1px solid rgba(122,62,255,0.65); background:linear-gradient(180deg, rgba(122,62,255,0.95), rgba(90,43,214,0.95));
             color:#fff; box-shadow:0 10px 18px rgba(122,62,255,0.35); cursor:pointer; font-weight:600}
        .fab:hover{transform:translateY(-1px); box-shadow:0 14px 22px rgba(122,62,255,0.42)}
        .fab .ico{width:18px; height:18px; display:inline-grid; place-items:center; background:rgba(255,255,255,.12); border-radius:999px}
        .secret{width:26px; height:26px; border-radius:999px; border:1px solid rgba(255,255,255,0.18); background:rgba(255,255,255,0.06);
                backdrop-filter:blur(6px); color:#ddd; cursor:pointer; position:relative; overflow:hidden;}
        .secret::after{content:''; position:absolute; inset:-60%; background:conic-gradient(from 0deg, transparent 0 80%, rgba(122,62,255,.45) 82% 100%);
                       transform:rotate(0deg); animation:spin 4.5s linear infinite; opacity:.25}
      `}</style>

      <div id="x-dock" className={`dock ${hidden ? 'dock-hidden' : ''}`}>
        <div className="dock-items">
          <button className="fab" data-xdock="notes" onClick={onOpenNotes} aria-label="Open Notes">
            <span className="ico">＋</span> Notes
          </button>
          <button className="fab" onClick={onOpenProd} aria-label="Open Productivity">
            <span className="ico">⚡</span> Productivity
          </button>
        </div>
        <button className="secret" title={hidden ? 'Show quick actions' : 'Hide quick actions'} onClick={()=>setHidden(v=>!v)} />
      </div>
    </>
  );
}


/* ---------- App ---------- */
export default function App(){
  // models
  const [models, setModels] = useState([])
  const [activeModel, setActiveModel] = useState('')
  const [modelBusy, setModelBusy] = useState(false)

  // chats
  const [chats, setChats] = useState(loadChats())
  const [activeId, setActiveId] = useState(() => chats[0]?.id || uid())
  const [lastCreatedId, setLastCreatedId] = useState(null)

  // input + send
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [justDone, setJustDone] = useState(false)

  // rename / delete
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  // Role prompt
  const [roleText, setRoleText] = useState(
    "You are Xenya — The Digital Attaché. Be brisk, clear, precise. " +
    "Identity: local assistant using a user-selected Ollama model. Do not claim to be OpenAI/GPT-3. " +
    "Style: answer-first; 2–6 short bullets or a tight paragraph; neutral, factual, courteous; minimal hedging. " +
    "When the user requests a plan/schedule (e.g., timetable, study plan) and details are missing, produce a concise, sensible draft with clear assumptions, then ask for 2–3 quick tweaks."
  )

  // TTS / STT
  const [lastReply, setLastReply] = useState('')
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [autoSendFromMic] = useState(true)

  // UI status for ChatBox waves
  const [uiStatus, setUiStatus] = useState('idle')

  // Productivity Suite modal
  const [kanbanOpen, setKanbanOpen] = useState(false)

  const endRef = useRef(null)
  const logoRef = useRef(null)

  const activeChat = useMemo(
    () => chats.find(c=>c.id===activeId) || { id:activeId, title:'New chat', messages:[], role: roleText },
    [chats, activeId]
  )

  // ------------- Timer/Pomodoro storage helpers (shared with FocusTimer) -------------
  const TIMER_LS_STATE = 'xenya.timer.v1'
  const TIMER_LS_CFG   = 'xenya.timer.v1.cfg'
  const KANBAN_LS      = 'xenya.kanban.v1'
  const nowMs = () => Date.now()
  const readJSON = (k, f) => { try{ const raw = localStorage.getItem(k); if(raw) return JSON.parse(raw) }catch{} return typeof f==='function'? f(): (f||{}) }
  const writeJSON = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)) }catch{} }
  const timerCfg = () => readJSON(TIMER_LS_CFG, {})
  const setTimerCfg = (patch) => { const next = { ...timerCfg(), ...patch }; writeJSON(TIMER_LS_CFG, next); return next }
  const timerState = () => readJSON(TIMER_LS_STATE, { running:false, mode:'idle', totalMs:0, remainingMs:0 })
  const setTimerState = (patch) => { const next = { ...timerState(), ...patch }; writeJSON(TIMER_LS_STATE, next); return next }
  const readKanban = () => { try{ const db = JSON.parse(localStorage.getItem(KANBAN_LS))||{tasks:[]}; return Array.isArray(db.tasks)? db.tasks:[] }catch{ return [] } }

  // “Bounce” (remount) the Productivity Suite so the FocusTimer picks up external state changes immediately
  const bounceProductivity = () => {
    if (!kanbanOpen) { setKanbanOpen(true); return }
    setKanbanOpen(false)
    setTimeout(()=>setKanbanOpen(true), 60)
  }

  // boot: fetch models
  useEffect(()=>{ (async ()=>{
    try { const r = await listModels(); setModels(r.models||[]); setActiveModel(r.active||'') } catch(e){ console.error(e) }
  })() },[])

  // one-time: de-dupe chats, ensure one exists
  useEffect(() => {
    let changed = false
    const seen = new Set()
    const fixed = (Array.isArray(chats) ? chats : []).map(c => {
      let id = String(c.id || '')
      if (!id || seen.has(id)) { id = makeId(seen); changed = true }
      seen.add(id)
      return { ...c, id }
    })

    let list = fixed
    if (fixed.length === 0) {
      const id = makeId(seen)
      list = [{ id, title:'New chat', messages:[], role: roleText }]
      changed = true
      if (activeId !== id) setActiveId(id)
    } else if (!fixed.some(c => c.id === activeId)) {
      setActiveId(fixed[0].id)
    }

    if (changed) { setChats(list); saveChats(list) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // guard
  useEffect(() => {
    if (chats.length && !chats.some(c => c.id === activeId)) setActiveId(chats[0].id)
  }, [chats, activeId])

  // load role when switching chats
  useEffect(()=>{ setRoleText(activeChat.role || roleText) },[activeId])

  // autoscroll
  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:'smooth'}) },[activeChat.messages, busy])

  // create a new chat
  const newChat = ()=>{
    const taken = new Set(chats.map(c => c.id))
    const id = makeId(taken)
    const chat = { id, title:'New chat', messages:[], role: roleText }
    setChats(prev=>{ const next=[chat, ...prev]; saveChats(next); return next })
    setActiveId(id)
    setLastCreatedId(id)
    requestAnimationFrame(()=>{
      const el = document.querySelector(`.conv[data-id="${id}"]`)
      if (el) el.classList.add('appear')
    })
  }

  const titleFromFirstUser = (chat) => {
    const first = chat?.messages?.find(m=>m.role==='user')?.content || 'New chat'
    return first.length>28 ? first.slice(0,28)+'…' : first

  }

  // toast
  function toast(txt){
    const t = document.createElement('div')
    t.className = 'toast'
    t.textContent = txt
    document.body.appendChild(t)
    setTimeout(()=>{ t.classList.add('show') }, 10)
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),300) }, 1200)
  }

  // delete / rename
  const requestDelete = (id) => { setConfirmDeleteId(id) }
  const doDelete = (id) => {
    setChats(prev=>{
      const filtered = prev.filter(x=>x.id!==id)
      let next = filtered
      let nextActive = activeId
      if (filtered.length === 0){
        const nid = makeId()
        next = [{ id:nid, title:'New chat', messages:[], role: roleText }]
        nextActive = nid
      } else if (id === activeId){
        nextActive = filtered[0].id
      }
      saveChats(next)
      setActiveId(nextActive)
      return next
    })
    setConfirmDeleteId(null)
    toast('Conversation deleted')
  }
  const startRename = (id) => {
    const c = chats.find(x=>x.id===id)
    setEditingId(id)
    setEditingText(c?.title || 'New chat')
  }
  const commitRename = () => {
    if (!editingId) return
    const val = editingText.trim() || 'New chat'
    setChats(prev=>{
      const next = prev.map(c => c.id===editingId ? { ...c, title: val } : c)
      saveChats(next)
      return next
    })
    setEditingId(null); setEditingText('')
  }
  const cancelRename = () => { setEditingId(null); setEditingText('') }

  // Save role
  const saveRole = () => {
    setChats(prev=>{
      const next = prev.map(c => c.id === activeId ? { ...c, role: roleText } : c)
      saveChats(next)
      return next
    })
  }

  // Hide the original Notes FAB so we only show the dock version
  useEffect(()=>{
    const dock = () => document.getElementById('x-dock');

    const hideOriginalNotes = ()=>{
      const d = dock();
      const nodes = Array.from(document.querySelectorAll('button, a'));
      // Match visible Notes buttons NOT inside our dock
      const notesBtns = nodes.filter(el => {
        const text = (el.textContent || '').trim();
        if (!/notes/i.test(text)) return false;
        if (d && d.contains(el)) return false;          // <- skip our dock buttons
        return true;
      });
      // Hide all original Notes triggers we find (idempotent)
        notesBtns.forEach(el => {
        if (el.dataset.xHideDone) return;
        el.dataset.xHideDone = '1';
        el.style.display = 'none';
      });
    };

    hideOriginalNotes();
    const mo = new MutationObserver(() => hideOriginalNotes());
    mo.observe(document.body, { childList:true, subtree:true });
    return ()=>mo.disconnect();
  },[]);

  // Bridge to Notes: click the existing Notes trigger if present, else fire a custom event
  const openNotesViaExisting = ()=>{
    const candidates = Array.from(document.querySelectorAll('button, a'))
    const btn = candidates.find(el => /notes/i.test((el.textContent||'').trim()))
    if (btn) { btn.click(); return; }
    window.dispatchEvent(new CustomEvent('notes:open'))
  }

  /* ======= SEND helpers ======= */
  const sendFromText = async (text) => {
    const content = (text || '').trim()
    if (!content) return
    setInput('')

    const userMsg = { role:'user', content }
    setChats(prev=>{
      const next = prev.map(c => c.id===activeId ? { ...c, messages:[...c.messages, userMsg] } : c)
      saveChats(next)
      return next
    })

    /* ---------- TIMER / POMODORO chat commands ---------- */
    if (/^\/timer\b/i.test(content) || /^\/pomodoro\b/i.test(content)) {
      const reply = (s) => {
        const aMsg = { role:'assistant', content: s }
        setChats(prev=>{
          const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
          const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
          saveChats(next); return next
        })
      }

      // ---- helpers
      const helpTimer = () => reply(
`**Timer commands**
- /timer start [minutes]
- /timer pause • /timer resume • /timer stop • /timer status
- /timer sound <alarm|buzzer|bell|none>
- /timer open`)

      const helpPom = () => reply(
`**Pomodoro commands**
- /pomodoro start [focus|break|short|long]
- /pomodoro break [short|long] • /pomodoro stop
- /pomodoro preset <classic|study|balanced|ultra>
- /pomodoro set focus=<m> break=<m> long=<m> every=<n> auto=<on|off>
- /pomodoro sound <chime|woodblock|bell|none>
- /pomodoro ambience <cafe|pianoguitar|beach|rain|fireplace> [on|off] [vol=<0-100>] [where=<focus|break|both>]
- /pomodoro link "<task substring>" [inbox|doing]
- /pomodoro open`)

      // timer primitives (writes LS; FocusTimer picks up on mount/remount)
      const startSimple = (mins) => {
        const m = Math.max(1, Math.round(mins || timerCfg().simpleM || 20))
        const startAt = nowMs()
        const total = m * 60_000
        setTimerCfg({ mode:'timer', simpleM:m })  // remember choice
        setTimerState({
          running:true, mode:'simple', totalMs: total, remainingMs: total,
          startAt, endAt: startAt + total, linked: timerState().linked || null
        })
        bounceProductivity()
        reply(`⏱️ Timer started for **${m} min**.`)
      }
      const pauseSimpleOrPom = () => {
        const s = timerState()
        if (!s.running || !s.endAt) return reply('Timer is not running.')
        const left = Math.max(0, s.endAt - nowMs())
        setTimerState({ running:false, endAt:null, remainingMs:left })
        bounceProductivity()
        reply(`⏸ Paused — **${Math.round(left/60000)} min** remaining.`)
      }
      const resumeSimpleOrPom = () => {
        const s = timerState()
        if (s.running || !s.remainingMs) return reply('Nothing to resume.')
        const endAt = nowMs() + s.remainingMs
        setTimerState({ running:true, endAt })
        bounceProductivity()
        reply(`▶︎ Resumed — **${fmt(s.remainingMs)}** left.`)
      }
      const stopAny = () => {
        setTimerState({ running:false, mode:'idle', totalMs:0, remainingMs:0, startAt:null, endAt:null })
        bounceProductivity()
        reply('■ Stopped.')
      }
      const statusAny = () => {
        const s = timerState()
        if (s.mode === 'idle' || (!s.running && !s.remainingMs)) return reply('No active timer.')
        const left = s.running ? Math.max(0, (s.endAt||0) - nowMs()) : (s.remainingMs||0)
        const label = s.mode === 'simple' ? 'Timer' : (s.mode === 'focus' ? 'Focus' : 'Break')
        reply(`${label}: **${fmt(left)}** ${s.running ? 'left' : '(paused)'}.`)
      }

      const startFocus = () => {
        const cfg = setTimerCfg({ mode:'pomodoro' })
        const mins = cfg.focusM || 25
        const startAt = nowMs()
        const total = mins * 60_000
        setTimerState({
          running:true, mode:'focus', breakType:'short',
          totalMs: total, remainingMs: total, startAt, endAt: startAt + total
        })
        bounceProductivity()
        reply(`🍅 Focus started for **${mins} min**.`)
      }
      const startBreak = (kind='short') => {
        const cfg = setTimerCfg({ mode:'pomodoro' })
        const mins = (kind==='long' ? cfg.longBreakM : cfg.shortBreakM) || (kind==='long'?15:5)
        const startAt = nowMs()
        const total = mins * 60_000
        setTimerState({
          running:true, mode:'break', breakType: kind,
          totalMs: total, remainingMs: total, startAt, endAt: startAt + total
        })
        bounceProductivity()
        reply(`🍃 ${kind==='long'?'Long ':''}Break started for **${mins} min**.`)
      }

      // ---- parse
      if (/^\/timer\b/i.test(content)) {
        const s = content.replace(/^\/timer\s*/i,'').trim()

        if (s === '' || /^help$/i.test(s)) return helpTimer()

        // open
        if (/^open$/i.test(s)) { setKanbanOpen(true); return reply('Opened Productivity Suite.'); }

        // sound
        let m = s.match(/^sound\s+(alarm|buzzer|bell|none)$/i)
        if (m) { const choice = m[1].toLowerCase(); setTimerCfg({ timerEndSound: choice })
          return reply(`🔔 Timer end sound → **${choice}**`) }

        // start [minutes]
        m = s.match(/^start(?:\s+(\d+))?$/i)
        if (m) { const mins = m[1] ? parseInt(m[1],10) : undefined; return startSimple(mins) }

        if (/^pause$/i.test(s)) return pauseSimpleOrPom()
        if (/^resume$/i.test(s)) return resumeSimpleOrPom()
        if (/^stop$/i.test(s)) return stopAny()
        if (/^status$/i.test(s)) return statusAny()

        return helpTimer()
      }

      if (/^\/pomodoro\b/i.test(content)) {
        const s = content.replace(/^\/pomodoro\s*/i,'').trim()

        if (s === '' || /^help$/i.test(s)) return helpPom()

        // open
        if (/^open$/i.test(s)) { setKanbanOpen(true); return reply('Opened Productivity Suite.'); }

        // presets
        let m = s.match(/^preset\s+(classic|study|balanced|ultra)$/i)
        if (m) {
          const p = m[1].toLowerCase()
          const presets = {
            classic:  { focusM:25, shortBreakM:5,  longBreakM:15, longEvery:4 },
            study:    { focusM:50, shortBreakM:10, longBreakM:20, longEvery:3 },
            balanced: { focusM:45, shortBreakM:15, longBreakM:20, longEvery:4 },
            ultra:    { focusM:90, shortBreakM:20, longBreakM:30, longEvery:2 }
          }
          setTimerCfg({ ...presets[p], mode:'pomodoro' })
          bounceProductivity()
          return reply(`Preset **${p}** loaded.`)
        }

        // set focus=.. break=.. long=.. every=.. auto=on|off
        m = s.match(/^set\s+(.+)$/i)
        if (m) {
          const args = m[1]
          const kv = {}
          ;(args.match(/\b(focus|break|long|every|auto)=(\S+)/gi) || []).forEach(pair=>{
            const mm = pair.match(/\b(focus|break|long|every|auto)=(\S+)/i)
            if (!mm) return
            const key = mm[1].toLowerCase(), val = mm[2]
            if (key==='auto') kv.autoCycle = /^(on|true|1)$/i.test(val)
            else if (key==='every') kv.longEvery = clampSafeInt(val, 2, 8)
            else if (key==='focus') kv.focusM = clampSafeInt(val, 1, 180)
            else if (key==='break') kv.shortBreakM = clampSafeInt(val, 1, 60)
            else if (key==='long') kv.longBreakM = clampSafeInt(val, 1, 90)
          })
          setTimerCfg({ mode:'pomodoro', ...kv })
          bounceProductivity()
          return reply(`Pomodoro settings updated.`)
        }

        // sound
        m = s.match(/^sound\s+(chime|woodblock|bell|none)$/i)
        if (m) { const choice = m[1].toLowerCase(); setTimerCfg({ pomodoroEndSound: choice })
          return reply(`🔔 Pomodoro end sound → **${choice}**`) }

        // ambience
        m = s.match(/^ambience\s+(cafe|pianoguitar|beach|rain|fireplace)(?:\s+(on|off))?(?:\s+vol=(\d{1,3}))?(?:\s+where=(focus|break|both))?$/i)
        if (m) {
          const type = m[1].toLowerCase()
          const onoff = (m[2]||'').toLowerCase()
          const volNum = m[3] ? Math.min(100, Math.max(0, parseInt(m[3],10))) : null
          const where = (m[4]||'').toLowerCase()
          const patch = { mode:'pomodoro', ambientType: type }
          if (onoff) patch.ambientEnabled = onoff === 'on'
          if (volNum !== null) patch.ambientVolume = volNum / 100
          if (where) {
            patch.ambientOnFocus = (where==='focus' || where==='both')
            patch.ambientOnBreak = (where==='break' || where==='both')
          }
          setTimerCfg(patch)
          bounceProductivity()
          return reply(`🎧 Ambience **${type}**${onoff?` (${onoff})`:''}${volNum!==null?` · vol ${volNum}%`:''}${where?` · ${where}`:''}.`)
        }

        // link "<substring>" [inbox|doing]
        m = s.match(/^link\s+["“](.+?)["”](?:\s+(inbox|doing))?$/i)
        if (m) {
          const substr = m[1].toLowerCase()
          const col = (m[2] || 'doing').toLowerCase()
          const t = readKanban().find(x => x && (x.col===col) && String(x.title||'').toLowerCase().includes(substr))
          if (t) {
            setTimerState({ linked: { id: t.id, title: t.title } })
            bounceProductivity()
            return reply(`🔗 Linked task: **${t.title}** (${col.toUpperCase()})`)
          }
          return reply(`No task matching “${m[1]}” in ${col}.`)
        }

        // start [focus|break|short|long]
        m = s.match(/^start(?:\s+(focus|break|short|long))?$/i)
        if (m) {
          const kind = (m[1]||'focus').toLowerCase()
          if (kind==='focus') return startFocus()
          if (kind==='break' || kind==='short') return startBreak('short')
          if (kind==='long') return startBreak('long')
        }

        // explicit break command
        m = s.match(/^break(?:\s+(short|long))?$/i)
        if (m) { return startBreak((m[1]||'short').toLowerCase()) }

        if (/^pause$/i.test(s)) return pauseSimpleOrPom()
        if (/^resume$/i.test(s)) return resumeSimpleOrPom()
        if (/^stop$/i.test(s)) return stopAny()
        if (/^status$/i.test(s)) return statusAny()

        return helpPom()
      }

      return
    }

    /* ---------- Calendar: /events ---------- */
    if (/^\/events\b/i.test(content)) {
      try{
        // parse: /events [today|week|month|YYYY-MM-DD..YYYY-MM-DD] [local|outlook]
        const args = content.replace(/^\/events\s*/i,'').trim()
        const parts = args.split(/\s+/).filter(Boolean)
        const rangeToken = parts[0] && !/^(local|outlook)$/i.test(parts[0]) ? parts[0] : ''
        const sourceToken = parts.find(p => /^(local|outlook)$/i.test(p)) || 'both'
        const { label, start, end } = parseRange(rangeToken)
        const tz = tzGuess()

        const wantLocal = /local/i.test(sourceToken) || sourceToken === 'both'
        const wantOutlook = /outlook/i.test(sourceToken) || sourceToken === 'both'

        let events = []
        if (wantLocal) {
          const local = readLocalEvents().filter(e=>{
            const s = new Date(e.start).getTime()
            return s >= start.getTime() && s <= end.getTime()
          })
          events = events.concat(local)
        }

        if (wantOutlook) {
          const st = await outlookStatus()
          if (st.connected) {
            const remote = await outlookUpcoming(start.toISOString(), end.toISOString(), tz)
            events = events.concat(remote)
          }
        }

        const textMd = renderEventsMarkdown(events, `Events • ${label}${sourceToken!=='both' ? ` • ${sourceToken.toLowerCase()}`:''}`)
        const aMsg = { role:'assistant', content: textMd }
        setChats(prev=>{
          const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
          const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
          saveChats(next); return next
        })
      }catch(e){
        const errMsg = { role:'assistant', content: 'Calendar error: ' + (e.message||e) }
        setChats(prev=>{
          const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
          const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, errMsg] } : c)
          saveChats(next); return next
        })
      }
      return
    }

    /* ---------- Calendar Local CRUD: /cal ... ---------- */
    if (/^\/cal\b/i.test(content)) {
      const help = () => (
        { role:'assistant', content:
`**Calendar (local)**
- /cal add "Title" 2025-09-24T15:00..2025-09-24T16:00 loc:"HQ" notes:"Standup"
- /cal rename <id> "New title"
- /cal move <id> 2025-09-24T17:00..2025-09-24T18:00
- /cal delete <id>
Tip: use /events week local to see ids.` })

      try{
        const s = content

        // ADD
        let m = s.match(/\/cal\s+add\s+(['"])(.+?)\1\s+(\S+)\.\.(\S+)(.*)$/i)
        if (m) {
          const [, , title, startStr, endStr, tail] = m
          const flags = parseKVFlags(tail||'')
          const ev = addLocalEvent({
            title,
            start: startStr,
            end: endStr,
            tz: flags.tz,
            location: flags.location,
            notes: flags.notes
          })
          const aMsg = { role:'assistant', content: `Added local event **${ev.title}**\n\n- When: ${fmtRange(ev.start, ev.end)}\n- id: \`${ev.id}\`` }
          setChats(prev=>{
            const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
            const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
            saveChats(next); return next
          })
          return
        }

        // RENAME
        m = s.match(/\/cal\s+rename\s+(\S+)\s+(['"])(.+?)\2/i)
        if (m) {
          const [, id, , newTitle] = m
          const ok = patchLocalEvent(id, { title: newTitle })
          const aMsg = { role:'assistant', content: ok ? `Renamed \`${id}\` → **${newTitle}**` : `No local event with id \`${id}\`.` }
          setChats(prev=>{
            const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
            const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
            saveChats(next); return next
          })
          return
        }

        // MOVE / EDIT TIMES
        m = s.match(/\/cal\s+(move|edit)\s+(\S+)\s+(\S+)\.\.(\S+)/i)
        if (m) {
          const [, , id, startStr, endStr] = m
          const ok = patchLocalEvent(id, { start: new Date(startStr).toISOString(), end: new Date(endStr).toISOString() })
          const aMsg = { role:'assistant', content: ok ? `Updated \`${id}\` → ${fmtRange(startStr, endStr)}` : `No local event with id \`${id}\`.` }
          setChats(prev=>{
            const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
            const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
            saveChats(next); return next
          })
          return
        }

        // DELETE
        m = s.match(/\/cal\s+delete\s+(\S+)/i)
        if (m) {
          const [, id] = m
          const ok = deleteLocalEvent(id)
          const aMsg = { role:'assistant', content: ok ? `Deleted local event \`${id}\`.` : `No local event with id \`${id}\`.` }
          setChats(prev=>{
            const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
            const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
            saveChats(next); return next
          })
          return
        }

        // HELP (fallback)
        setChats(prev=>{
          const aMsg = help()
          const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
          const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
          saveChats(next); return next
        })
      } catch (e) {
        const errMsg = { role:'assistant', content: 'Calendar error: ' + (e.message || e) }
        setChats(prev=>{
          const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
          const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, errMsg] } : c)
          saveChats(next); return next
        })
      }
      return
    }

    // Local commands for Kanban
    if (/^\/task\s+/i.test(content)) {
      const title = content.replace(/^\/task\s+/i, '').trim().replace(/["']/g,'')
      const ok = title ? addKanbanTask(title, "inbox") : false
      const aMsg = { role:'assistant', content: ok ? `Added to Inbox: **${title}**` : 'Usage: /task <title>' }
      setChats(prev=>{
        const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
        const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
        saveChats(next); return next
      })
      return
    }
    if (/^\/move\s+/i.test(content)) {
      const m = content.match(/\/move\s+"([^"]+)"\s+(inbox|doing|done)/i)
      const ok = m ? moveKanbanTaskByTitle(m[1], m[2].toLowerCase()) : false
      const aMsg = { role:'assistant', content: ok ? `Moved “${m[1]}” → **${m?.[2].toUpperCase()}**` : 'Usage: /move "title" inbox|doing|done' }
      setChats(prev=>{
        const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
        const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
        saveChats(next); return next
      })
      return
    }

    if (/^\/productivity\b/i.test(content) || /^\/prod\b/i.test(content) || /^\/kanban\b/i.test(content)) {
      setKanbanOpen(true)
      const aMsg = { role:'assistant', content: 'Opened Productivity Suite.' }
      setChats(prev=>{
        const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
        const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
        saveChats(next); return next
      })
      return
    }

    // logo flourish (no waves for typed messages)
    try { logoRef?.current?.play?.() } catch {}

    setBusy(true); setJustDone(false)
    try {
      const rolePrompt = (activeChat.role?.trim() || roleText || 'You are Xenya — brisk, clear, precise.')
      const aMsg = await routeMessage(content, activeModel, activeChat.messages, rolePrompt)

      setChats(prev=>{
        const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
        const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
        saveChats(next)
        return next
      })

      setUiStatus('idle')

      const replyText = String(aMsg.content || '')
      setLastReply(replyText)
      if (autoSpeak && replyText) {
        try { await speak(replyText, 'en_GB-jenny_dioco-medium.onnx') } catch {}
      }
    } catch (e) {
      const errMsg = { role:'assistant', content: 'Error: ' + e.message }
      setChats(prev=>{
        const current = prev.find(c => c.id === activeId)
        const newTitle = titleFromFirstUser(current)
        const next = prev.map(c =>
          c.id === activeId ? { ...c, title: newTitle, messages: [...c.messages, errMsg] } : c
        )
        saveChats(next)
        return next
      })
      setUiStatus('idle')
    } finally {
      setBusy(false); setJustDone(true)
      setTimeout(()=>setJustDone(false), 350)
    }
  }

  const clampSafeInt = (v, min, max) => {
    const n = parseInt(String(v).replace(/[^\d-]/g,''), 10)
    if (Number.isFinite(n)) return Math.max(min, Math.min(max, n))
    return min
  }

  const send = async () => { if (!input.trim()) return; await sendFromText(input) }

  // Mic transcript + status
  const handleTranscript = async (text) => {
    const t = (text || '').trim()
    if (!t) { setUiStatus('idle'); return }
    if (autoSendFromMic) {
      setInput(t)
      setUiStatus('transcribing')
      await new Promise(r => setTimeout(r, 350))
      setUiStatus('thinking')
      await sendFromText(t)
    } else {
      setInput(t)
    }
  }
  const handleMicStatus = (s) => {
    const norm = normalizeMicStatus(s)
    if (norm === 'listening' || norm === 'transcribing' || norm === 'thinking' || norm === 'idle') setUiStatus(norm)
  }

  const onSelectModel = async (name) => {
    setModelBusy(true)
    try {
      await selectModel(name)
      const r = await listModels()
      setModels(r.models || [])
      setActiveModel(r.active || name)
    } catch (e) { alert('Model switch failed: ' + e.message) } finally { setModelBusy(false) }
  }
  const onRefreshModels = async () => {
    setModelBusy(true)
    try {
      await refreshModels()
      const r = await listModels()
      setModels(r.models || [])
      setActiveModel(r.active || '')
    } catch (e) { alert('Refresh failed: ' + e.message) } finally { setModelBusy(false) }
  }

  /* -------- UI -------- */
  return (
    <div className="shell">
      {/* Notes still mounts; its original FAB is hidden by the effect above */}
      <Notes/>

      {/* Unified action dock (Notes + Productivity + secret Hide) */}
      <ActionDock
        onOpenNotes={openNotesViaExisting}
        onOpenProd={()=>setKanbanOpen(true)}
      />

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <Logo ref={logoRef} size={40} showWord />
        </div>

        <button className="newchat" onClick={newChat} title="New chat">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          <span>New chat</span>
        </button>

        <div className="modelRow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{opacity:.8}}>
            <path d="M4 7h16v10H4z" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 7V5h8v2" stroke="currentColor" strokeWidth="2"/>
          </svg>
          <select className="select" value={activeModel} onChange={e=>onSelectModel(e.target.value)} disabled={modelBusy}>
            <option value="" disabled>Select model…</option>
            {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
          <button className="button" style={{padding:'8px 12px'}} onClick={onRefreshModels} disabled={modelBusy}>↻</button>
        </div>

        <div className="small" style={{paddingLeft:2}}>Role (system prompt)</div>
        <textarea
          className="select" rows={2} style={{resize:'vertical'}}
          placeholder="e.g., Brisk, clear, RP tone…"
          value={roleText} onChange={e=>setRoleText(e.target.value)} onBlur={saveRole}
        />

        <div className="small" style={{paddingLeft:2}}>Speech</div>
        <div style={{padding:'4px 2px'}}>
          <TTSControls lastReply={lastReply} onToggleAutoSpeak={setAutoSpeak} />
        </div>

        <div className="small" style={{paddingLeft:2}}>Conversations</div>
        <div className="convlist">
          {chats.map(c=>(
            <div
              key={c.id}
              data-id={c.id}
              className={'conv '+(c.id===activeId?'active':'')+(c.id===lastCreatedId?' appear':'')}
              onClick={()=>setActiveId(c.id)}
            >
              <div className="conv-main">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M4 5h16v12H7l-3 3V5z" stroke="currentColor" strokeWidth="2"/>
                </svg>

                {editingId===c.id ? (
                  <input
                    autoFocus
                    className="select"
                    style={{height:'28px', padding:'4px 8px'}}
                    value={editingText}
                    onChange={e=>setEditingText(e.target.value)}
                    onKeyDown={e=>{
                      if(e.key==='Enter') commitRename()
                      if(e.key==='Escape') cancelRename()
                    }}
                    onClick={(e)=>e.stopPropagation()}
                    onBlur={commitRename}
                  />
                ) : (
                  <div className="title" title={c.title||'New chat'}>{c.title||'New chat'}</div>
                )}
              </div>

              <div className="conv-actions" onClick={(e)=>e.stopPropagation()}>
                <button className="icon-btn" title="Rename" onClick={()=>startRename(c.id)}>Rename</button>
                <button className="icon-btn danger" title="Delete" onClick={()=>requestDelete(c.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>

        <div className="small">Active: {activeModel||'—'}</div>
      </aside>

      {/* Main */}
      <main className="main">
        <div className="header">
          <div>
            <strong>Chat</strong>
            <span className="badge"> Phase 1 • Pragmatic Precision</span>
            {activeModel && <span className="badge" style={{marginLeft:8}}>[{activeModel}]</span>}
          </div>
        </div>

        {busy && <div className="loader-line" style={{position:'sticky', top:0, zIndex:2}} />}

        <div className="messages">
          {activeChat.messages.length===0 && (
            <div className="assistant">
              <div className="bubble materialize">
                <div className="role assistant">Xenya</div>
                {COPY.emptyChat}
              </div>
            </div>
          )}

          {activeChat.messages.map((m,i)=>(
            <div key={i} className={m.role}>
              {m.type === 'report' ? (
                <ReportCard title={m.reportTitle || 'Report'} body={m.content} cites={m.citations || m.cites || []} err={m.error} />
              ) : m.type === 'dispatch' ? (
                <Dispatch items={m.items || []} />
              ) : (
                <div className="bubble materialize">
                  {m.role==='assistant' && (
                    <div className="bubble-actions">
                      <button
                        className="ghost-btn"
                        title="Copy message"
                        onClick={async()=>{ try{ await navigator.clipboard.writeText(String(m.content||'')) }catch{} }}
                      >
                        Copy
                      </button>
                    </div>
                  )}
                  <div className={'role ' + (m.role==='user'?'user':'assistant')}>
                    {m.role==='user'?'You':'Xenya'}
                  </div>
                  <MarkdownMessage text={m.content}/>
                </div>
              )}
            </div>
          ))}

          <div ref={endRef}/>
        </div>

        {/* Compact composer */}
        <ChatBox
          value={input}
          onChange={setInput}
          busy={busy}
          status={uiStatus}
          onSend={(t)=>sendFromText(t)}
          onTranscript={handleTranscript}
          onMicStatus={handleMicStatus}
          autoFocus
        />
      </main>

      {/* Productivity Popup: Productivity Suite */}
      <XenyaProductivitySuite open={kanbanOpen} onClose={()=>setKanbanOpen(false)} />

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div className="modal-backdrop" onClick={()=>setConfirmDeleteId(null)}>
          <div className="modal-card" onClick={e=>e.stopPropagation()}>
            <div className="modal-head">Delete conversation?</div>
            <div className="modal-body">
              This will remove the conversation permanently. There’s no undo.
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={()=>setConfirmDeleteId(null)}>Cancel</button>
              <button className="btn danger" onClick={()=>doDelete(confirmDeleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
