import { useEffect, useRef, useState } from 'react'

const LS_OPEN = 'xenya.notes.open'
const LS_POS  = 'xenya.notes.pos'

export default function Notes(){
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_OPEN)) ?? false } catch { return false }
  })
  const [pos, setPos] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_POS)) ?? { x: window.innerWidth - 360, y: 80 } }
    catch { return { x: window.innerWidth - 360, y: 80 } }
  })
  const drag = useRef({ active:false, dx:0, dy:0 })

  useEffect(() => localStorage.setItem(LS_OPEN, JSON.stringify(open)), [open])
  useEffect(() => localStorage.setItem(LS_POS, JSON.stringify(pos)), [pos])

  const onStart = (x,y) => { drag.current.active = true; drag.current.dx = x - pos.x; drag.current.dy = y - pos.y; document.body.style.userSelect = 'none' }
  const onMove = (x,y) => {
    if (!drag.current.active) return
    const w=340,h=380
    setPos({ x: Math.min(Math.max(8, x-drag.current.dx), innerWidth-w-8), y: Math.min(Math.max(8, y-drag.current.dy), innerHeight-h-8) })
  }
  const onEnd = () => { drag.current.active = false; document.body.style.userSelect = '' }

  useEffect(() => {
    const mm=e=>onMove(e.clientX,e.clientY), mu=()=>onEnd()
    const tm=e=>{ const t=e.touches[0]; onMove(t.clientX,t.clientY) }, tu=()=>onEnd()
    window.addEventListener('mousemove',mm); window.addEventListener('mouseup',mu)
    window.addEventListener('touchmove',tm,{passive:false}); window.addEventListener('touchend',tu)
    return ()=>{ window.removeEventListener('mousemove',mm); window.removeEventListener('mouseup',mu); window.removeEventListener('touchmove',tm); window.removeEventListener('touchend',tu) }
  },[pos])

  if (!open) return <button className="notes-pill" onClick={()=>setOpen(true)} title="Open Notes">✦ Notes</button>

  return (
    <div className="notes-window" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Xenya Notes">
      <div className="notes-header" onMouseDown={e=>onStart(e.clientX,e.clientY)} onTouchStart={e=>{const t=e.touches[0]; onStart(t.clientX,t.clientY)}}>
        <div className="notes-title"><span className="notes-eye" /> <strong>Notes</strong> <span className="notes-sub">How to use Xenya</span></div>
        <div className="notes-actions"><button className="notes-btn" onClick={()=>setOpen(false)} title="Minimize">—</button></div>
      </div>

      <div className="notes-body">
        <section><h4>Chat</h4><ul>
          <li><kbd>Enter</kbd> to send • <kbd>Shift</kbd>+<kbd>Enter</kbd> for newline.</li>
          <li>Replies are brisk, clear, and precise.</li>
        </ul></section>

        <section><h4>Routing</h4><ul>
          <li><strong>URL → Summary</strong> (priority). Paste any <code>http(s)://…</code> and get bullets + a takeaway.</li>
          <li><strong>/research &lt;query&gt;</strong> → searches + synthesizes with citations.</li>
          <li><strong>News</strong> → “today’s news” or <code>/news</code> for headlines.</li>
        </ul></section>

        <section><h4>Model & Role</h4><ul>
          <li>Pick an Ollama model in the sidebar (persisted). ↻ to refresh installed models.</li>
          <li>Per-chat <strong>Role</strong> sets tone/behaviour for that conversation.</li>
        </ul></section>

        <section><h4>Copy</h4><ul>
          <li>Copy whole chat from the header.</li>
          <li>Copy any message via its button.</li>
          <li>Copy code blocks via their “Copy” button.</li>
        </ul></section>

        <section><h4>Privacy</h4><ul>
          <li>All LLM calls are local to your Ollama server.</li>
          <li>Memory persists in <code>server/memory.json</code>.</li>
        </ul></section>
      </div>
    </div>
  )
}
