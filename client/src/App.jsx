import { useEffect, useMemo, useRef, useState } from 'react'
import './theme.css'
import Notes from './components/Notes.jsx'
import MarkdownMessage from './components/MarkdownMessage.jsx'
import { chat, research, summarizeUrl, rss, listModels, selectModel, refreshModels } from './lib/api'

// ---------- Helpers ----------
const uid = () => Math.random().toString(36).slice(2,9)
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

// Router: /research → research, URL → summary, news → rss, else → chat
async function routeMessage(content, model, history, rolePrompt){
  const t = content.trim()

  if (t.startsWith('/research ')) {
    const q0 = t.slice(10).trim()
    const r = await research(q0, model)
    return { role:'assistant', content: r.answer || '(no answer)' }
  }

  if (isUrl(t)) {
    try {
      const r = await summarizeUrl(t, model)
      return { role:'assistant', content: r.summary || '(no summary)' }
    } catch (e) {
      return { role:'assistant', content: `Couldn’t summarize that page (${e.message}). Want me to research it instead? Try: /research ${t}` }
    }
  }

  if (wantsNews(t)) {
    const r = await rss()
    const items = (r.feeds||[]).flatMap(f =>
      (f.items||[]).slice(0,8).map(i => `- [${i.title}](${i.link})`)
    )
    const txt = items.join('\n') || '(no headlines)'
    return { role:'assistant', content: `**Today’s headlines**\n\n${txt}` }
  }

  const resp = await chat({ messages:[...history, {role:'user',content:t}], system: rolePrompt, model })
  return { role:'assistant', content: resp.reply ?? resp?.message?.content ?? '(no reply)' }
}

// ---------- App ----------
export default function App(){
  // models
  const [models, setModels] = useState([])
  const [activeModel, setActiveModel] = useState('')
  const [modelBusy, setModelBusy] = useState(false)

  // chats
  const [chats, setChats] = useState(loadChats())
  const [activeId, setActiveId] = useState(() => chats[0]?.id || uid())
  const [input, setInput] = useState('')

  // rename / delete modal state
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  // Role prompt (draft-first for plans)
  const [roleText, setRoleText] = useState(
    "You are Xenya — The Digital Attaché. Be brisk, clear, precise. " +
    "Identity: local assistant using a user-selected Ollama model. Do not claim to be OpenAI/GPT-3. " +
    "Style: answer-first; 2–6 short bullets or a tight paragraph; neutral, factual, courteous; minimal hedging. " +
    "When the user requests a plan/schedule (e.g., timetable, study plan) and details are missing, produce a concise, sensible draft with clear assumptions, then ask for 2–3 quick tweaks."
  )

  const endRef = useRef(null)
  const inputRef = useRef(null)

  const activeChat = useMemo(
    () => chats.find(c=>c.id===activeId) || { id:activeId, title:'New chat', messages:[], role: roleText },
    [chats, activeId]
  )

  // boot: fetch models
  useEffect(()=>{ (async ()=>{
    try { const r = await listModels(); setModels(r.models||[]); setActiveModel(r.active||'') } catch(e){ console.error(e) }
  })() },[])

  // ensure active chat exists
  useEffect(()=>{
    if (!chats.find(c=>c.id===activeId)){
      setChats(prev=>{
        const next=[...prev,{id:activeId,title:'New chat',messages:[],role:roleText}]
        saveChats(next)
        return next
      })
    }
  },[activeId])

  // load role when switching chats
  useEffect(()=>{ setRoleText(activeChat.role || roleText) },[activeId])

  // autoscroll
  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:'smooth'}) },[activeChat.messages])

  const newChat = ()=> setActiveId(uid())

  const titleFromFirstUser = (chat) => {
    const first = chat?.messages?.find(m=>m.role==='user')?.content || 'New chat'
    return first.length>28 ? first.slice(0,28)+'…' : first
  }

  // -------- small toast --------
  function toast(txt){
    const t = document.createElement('div')
    t.className = 'toast'
    t.textContent = txt
    document.body.appendChild(t)
    setTimeout(()=>{ t.classList.add('show') }, 10)
    setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(),300) }, 1200)
  }

  // -------- delete / rename handlers --------
  const requestDelete = (id) => { setConfirmDeleteId(id) }

  const doDelete = (id) => {
    setChats(prev=>{
      const filtered = prev.filter(x=>x.id!==id)
      let next = filtered
      let nextActive = activeId
      if (filtered.length === 0){
        const nid = uid()
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
    toast('Renamed')
  }
  const cancelRename = () => { setEditingId(null); setEditingText('') }

  // -------- send --------
  const send = async () => {
    const content = input.trim()
    if (!content) return
    setInput('')

    const userMsg = { role:'user', content }
    setChats(prev=>{
      const next = prev.map(c => c.id===activeId ? { ...c, messages:[...c.messages, userMsg] } : c)
      saveChats(next)
      return next
    })

    try {
      const rolePrompt = (activeChat.role?.trim() || roleText || 'You are Xenya — brisk, clear, precise.')
      const aMsg = await routeMessage(content, activeModel, activeChat.messages, rolePrompt)
      setChats(prev=>{
        const titled = titleFromFirstUser(prev.find(c=>c.id===activeId))
        const next = prev.map(c => c.id===activeId ? { ...c, title:titled, messages:[...c.messages, aMsg] } : c)
        saveChats(next)
        return next
      })
      inputRef.current?.focus()
    } catch (e) {
      const errMsg = { role:'assistant', content: 'Error: ' + e.message }
      setChats(prev=>{
        const next = prev.map(c => c.id===activeId ? { ...c, messages:[...c.messages, errMsg] } : c)
        saveChats(next)
        return next
      })
    }
  }

  const onSelectModel = async (name) => {
    setModelBusy(true)
    try { await selectModel(name); const r=await listModels(); setModels(r.models||[]); setActiveModel(r.active||name) }
    catch(e){ alert('Model switch failed: '+e.message) }
    finally{ setModelBusy(false) }
  }
  const onRefreshModels = async () => {
    setModelBusy(true)
    try { await refreshModels(); const r=await listModels(); setModels(r.models||[]); setActiveModel(r.active||'') }
    catch(e){ alert('Refresh failed: '+e.message) }
    finally{ setModelBusy(false) }
  }

  const saveRole = () => {
    setChats(prev=>{
      const next = prev.map(c => c.id===activeId ? { ...c, role: roleText } : c)
      saveChats(next)
      return next
    })
  }

  // -------- UI --------
  return (
    <div className="shell">
      <Notes/>

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand"><h1>Xenya</h1></div>

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

        <div className="small" style={{paddingLeft:2}}>Conversations</div>
        <div className="convlist">
          {chats.map(c=>(
            <div key={c.id} className={'conv '+(c.id===activeId?'active':'')} onClick={()=>setActiveId(c.id)}>
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
          <div><strong>Chat</strong> <span className="badge">Phase 1 • Pragmatic Precision</span></div>
        </div>

        <div className="messages">
          {activeChat.messages.length===0 && (
            <div className="bubble">
              <div className="role assistant">Xenya</div>
              Hi — I’m Xenya. Paste a link for a summary, type <code>/research &lt;topic&gt;</code>, or just ask.
            </div>
          )}

          {activeChat.messages.map((m,i)=>(
            <div key={i} className={m.role}>
              <div className="bubble">
                {/* per-message copy: show on assistant messages */}
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
            </div>
          ))}
          <div ref={endRef}/>
        </div>

        <div className="composerWrap">
          <div className="composer">
            <input
              ref={inputRef}
              className="input"
              placeholder="Message Xenya…"
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send() } }}
            />
            <button className="button" onClick={send} disabled={!input.trim()}>Send</button>
          </div>
        </div>
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
