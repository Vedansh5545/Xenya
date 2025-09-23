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

  // Allow other components to open Notes programmatically
  useEffect(()=>{
    const openNotes = () => setOpen(true)
    window.addEventListener('notes:open', openNotes)
    return () => window.removeEventListener('notes:open', openNotes)
  },[])

  const onStart = (x,y) => { drag.current.active = true; drag.current.dx = x - pos.x; drag.current.dy = y - pos.y; document.body.style.userSelect = 'none' }
  const onMove = (x,y) => {
    if (!drag.current.active) return
    const w=340,h=420
    setPos({
      x: Math.min(Math.max(8, x - drag.current.dx), innerWidth - w - 8),
      y: Math.min(Math.max(8, y - drag.current.dy), innerHeight - h - 8)
    })
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
      <div
        className="notes-header"
        onMouseDown={e=>onStart(e.clientX,e.clientY)}
        onTouchStart={e=>{const t=e.touches[0]; onStart(t.clientX,t.clientY)}}
      >
        <div className="notes-title">
          <span className="notes-eye" />
          <strong>Notes</strong>
          <span className="notes-sub">Xenya MVP • Offline Speak & Listen • Productivity</span>
        </div>
        <div className="notes-actions">
          <button className="notes-btn" onClick={()=>setOpen(false)} title="Minimize">—</button>
        </div>
      </div>

      <div className="notes-body">
        <section>
          <h4>Quick Start</h4>
          <ul>
            <li>Run <code>server/server.js</code> (uses local Ollama + Piper TTS + Python Vosk STT).</li>
            <li>Run the client (<code>npm run dev</code> in <code>client/</code>).</li>
            <li>Pick a model in the sidebar, then type or use the <strong>Mic</strong>.</li>
          </ul>
        </section>

        {/* ===== Action Dock ===== */}
        <section>
          <h4>Action Dock</h4>
          <ul>
            <li>Top-right floating controls: <em>✦ Notes</em> and <em>⚡ Productivity</em>.</li>
            <li>Use the small circle toggle to <strong>hide/show</strong> the dock. While the Productivity screen is open, the dock auto-hides to prevent overlap; it reappears on close.</li>
            <li>Open Productivity via UI or type <code>/productivity</code>, <code>/prod</code>, or <code>/kanban</code>.</li>
            <li>If the dock ever seems missing, ensure the element id is <code>#x-dock</code> and that no external CSS forces <code>display:none</code>.</li>
          </ul>
        </section>

        {/* ===== Productivity — Mini Kanban (no calendar info) ===== */}
        <section>
          <h4>Productivity • Mini Kanban</h4>
          <ul>
            <li><strong>Open</strong>: Click <em>⚡ Productivity</em> in the Dock. <em>Esc</em> closes the Productivity screen.</li>
            <li><strong>Tiles</strong>: Each tool appears as a tile. You can <strong>drag</strong> to reorder, <strong>minimize</strong> to the dock, <strong>maximize</strong> (▣), and <strong>resize</strong> (widen ⇢ 2 columns; taller ⇢ 2 rows).</li>
            <li><strong>Layouts</strong>: Use the <em>Layouts ▾</em> button to apply presets that fit the number of tiles (e.g., side-by-side for 2, 2×2 grid for 4, hero 2×2 + singles for 5).</li>
            <li><strong>Full screen</strong>: Click <em>Full screen</em> in the header to make the Productivity screen occupy the entire viewport for maximum space.</li>
            <li><strong>Kanban basics</strong>:
              <ul>
                <li>Columns: <code>INBOX</code> → <code>DOING</code> → <code>DONE</code>. Drag cards between columns.</li>
                <li>Create at the top: type title → <kbd>Enter</kbd> or <em>Add</em>. Choose up to two colors and optional flags (P1/P2 are quick picks).</li>
                <li>Filter by Flag/Color; Sort by Flag or Color order.</li>
                <li>Chat shortcuts: <code>/task "Title"</code>, <code>/move "Title" inbox|doing|done</code>, <code>/kanban</code> to open.</li>
                <li>Data: stored in <code>localStorage["xenya.kanban.v1"]</code>.</li>
              </ul>
            </li>
          </ul>
        </section>

        <section>
          <h4>Chat Basics</h4>
          <ul>
            <li><kbd>Enter</kbd> to send • <kbd>Shift</kbd>+<kbd>Enter</kbd> for newline.</li>
            <li>Replies follow Xenya’s persona (brisk, clear, RP tone).</li>
            <li>Copy any assistant message via its <em>Copy</em> button.</li>
          </ul>
        </section>

        <section>
          <h4>Smart Routing</h4>
          <ul>
            <li><strong>URL → Summary</strong>: Paste <code>http(s)://…</code> to get bullets + takeaway.</li>
            <li><strong>/research &lt;q&gt;</strong>: resilient search + concise synthesis with citations.</li>
            <li><strong>News</strong>: say “today’s news” or use <code>/news</code> for headlines.</li>
          </ul>
        </section>

        <section>
          <h4>Speech (100% Offline)</h4>
          <ul>
            <li><strong>Speak (TTS)</strong>: Piper voice <code>en_GB-jenny_dioco-medium.onnx</code> (RP alto). Toggle auto-speak in “Speech”.</li>
            <li><strong>Listen (STT)</strong>: Mic captures WebM → server converts to WAV 16k → Python Vosk transcribes.</li>
            <li>Mic auto-sends transcript by default; you can edit before sending by disabling auto-send in code.</li>
          </ul>
        </section>

        <section>
          <h4>Model & Role</h4>
          <ul>
            <li>Pick an Ollama model in the sidebar. Use ↻ to refresh installed models.</li>
            <li>Each chat has a persisted <strong>Role</strong> (tone/behavior) you can edit.</li>
          </ul>
        </section>

        <section>
          <h4>Key Files</h4>
          <ul>
            <li><code>server/server.js</code>: API for chat/search/summary/rss + <code>/api/tts</code> (Piper) + <code>/api/stt</code> (Vosk).</li>
            <li><code>server/tts.js</code>: Pipes text → Piper → WAV bytes for TTS.</li>
            <li><code>server/stt_py.py</code>: Reads WAV 16k mono from stdin and returns JSON transcript via Vosk.</li>
            <li><code>client/src/components/Mic.jsx</code>: Mic recorder → uploads FormData to <code>/api/stt</code>.</li>
            <li><code>client/src/lib/tts/speak.js</code>: Fetches <code>/api/tts</code> and plays wav.</li>
            <li><code>client/src/components/MiniKanban.jsx</code>: Kanban popup, filters, color/flag logic.</li>
            <li><code>client/src/App.jsx</code>: Routing, chat UI, model picker, TTS, mic, and the Action Dock.</li>
          </ul>
        </section>

        <section>
          <h4>Paths & Ports</h4>
          <ul>
            <li>Server: <code>http://localhost:3000</code> (configurable via <code>PORT</code> env).</li>
            <li>Client dev: <code>http://localhost:5173</code>, proxied <code>/api</code> → <code>:3000</code>.</li>
            <li>Ollama: <code>http://localhost:11434</code>.</li>
          </ul>
        </section>

        <section>
          <h4>Troubleshooting</h4>
          <ul>
            <li><strong>Dock overlaps editor</strong>: The dock auto-hides when Productivity opens; if not, verify <code>#x-dock</code> and that the suite toggles it via <code>.dock-hidden</code>.</li>
            <li><strong>Kanban border split</strong>: Ensure exactly two colors selected; the tile border uses a 50/50 gradient.</li>
            <li><strong>Socket errors</strong>: Start server first; check <code>/api/health</code>.</li>
            <li><strong>TTS</strong>/<strong>STT</strong> issues: confirm voice files and mic permissions; server logs show <code>[TTS]</code> / <code>[STT]</code>.</li>
          </ul>
        </section>

        <section>
          <h4>Privacy</h4>
          <ul>
            <li>All LLM calls are local (Ollama). No cloud APIs.</li>
            <li>Kanban + chats persist locally (Kanban key: <code>xenya.kanban.v1</code>).</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
