// client/src/App.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import './theme.css'
import Notes from './components/Notes.jsx'
import MarkdownMessage from './components/MarkdownMessage.jsx'
import { chat, research, summarizeUrl, rss, listModels, selectModel, refreshModels } from './lib/api'
import TTSControls from './components/TTSControls.jsx'
import { speak } from './lib/tts/speak'
import Logo from './components/Logo.jsx'
import ChatBox from './components/ChatBox.jsx'   // compact composer (Talk + Send)

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

  const endRef = useRef(null)
  const logoRef = useRef(null)

  const activeChat = useMemo(
    () => chats.find(c=>c.id===activeId) || { id:activeId, title:'New chat', messages:[], role: roleText },
    [chats, activeId]
  )

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

      // Stop Talk visualization as soon as reply is printed
      setUiStatus('idle')

      const replyText = String(aMsg.content || '')
      setLastReply(replyText)
      if (autoSpeak && replyText) {
        try { await speak(replyText, 'en_GB-jenny_dioco-medium.onnx') } catch {}
      }
    } catch (e) {
      const errMsg = { role:'assistant', content: 'Error: ' + e.message }
      setChats(prev=>{
        const next = prev.map(c => c.id===activeId ? { ...c, messages:[...c.messages, errMsg] } : c)
        saveChats(next)
        return next
      })
      setUiStatus('idle')
    } finally {
      setBusy(false); setJustDone(true)
      setTimeout(()=>setJustDone(false), 350)
    }
  }

  const send = async () => { if (!input.trim()) return; await sendFromText(input) }


  // Mic transcript + status
  const handleTranscript = async (text) => {
    const t = (text || '').trim()
    if (!t) { setUiStatus('idle'); return }
    if (autoSendFromMic) {
      setInput(t)
      // show transcribing clearly before we swap to thinking
      setUiStatus('transcribing')
      await new Promise(r => setTimeout(r, 350))  // give the dots time to be seen
      setUiStatus('thinking')
      await sendFromText(t)
    } else {
      setInput(t)
    }
  }


  const handleMicStatus = (s) => {
    const norm = normalizeMicStatus(s)
    if (norm === 'listening' || norm === 'transcribing' || norm === 'thinking' || norm === 'idle') {
      setUiStatus(norm)
    }
    // do not force idle here; sendFromText will set idle once reply is printed
  }

  // model handlers
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
      <Notes/>

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

        {/* Loader line when busy */}
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
