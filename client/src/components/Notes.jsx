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

        {/* ===== New: Mini Kanban (MVP) ===== */}
        <section>
          <h4>Productivity • Mini Kanban (MVP)</h4>
          <ul>
            <li><strong>Open</strong>: Click <em>⚡ Productivity</em> in the Action Dock (top-right). The dock hides while Kanban is open so it never overlaps the editor. <em>Esc</em> closes.</li>
            <li><strong>Columns</strong>: <code>INBOX</code> → <code>DOING</code> → <code>DONE</code>. Drag cards between columns.</li>
            <li><strong>Create</strong> (top row):
              <ul>
                <li>Type title → press <kbd>Enter</kbd> or click <em>Add</em>.</li>
                <li>Pick up to <strong>two colors</strong> from 7 presets (Red, Orange, Yellow, Green, Blue, Purple, Gray). Two colors give a 50/50 split border.</li>
                <li>Fast flags: <strong>P1</strong> (adds Red) and <strong>P2</strong> (adds Orange). You can also add custom flags (e.g., <code>ml</code>, <code>school</code>) — press <kbd>Enter</kbd> or <kbd>,</kbd> to commit.</li>
              </ul>
            </li>
            <li><strong>Edit/Delete</strong>: Use the buttons on a card. Editing lets you change title, flags, and colors.</li>
            <li><strong>Priority mapping</strong>:
              <ul>
                <li><span style={{border:'1px solid #ff4d4f', padding:'0 6px', borderRadius:6}}>Red</span> ⇒ <code>p1</code> (Priority 1).</li>
                <li><span style={{border:'1px solid #ff9800', padding:'0 6px', borderRadius:6}}>Orange</span> ⇒ <code>p2</code> (Priority 2).</li>
                <li>Choosing Red/Orange auto-adds the corresponding flag; flags can be edited later.</li>
              </ul>
            </li>
            <li><strong>Filter & Sort</strong> (toolbar under Add):
              <ul>
                <li>Filter by <em>Flag</em> (P1/P2 or any custom flag) and/or by <em>Color</em>.</li>
                <li>Sort by <em>Flag</em> (P1 → P2 → others) or by <em>Color order</em>.</li>
              </ul>
            </li>
            <li><strong>Chat shortcuts</strong>:
              <ul>
                <li><code>/task "Title"</code> → add to Inbox.</li>
                <li><code>/move "Title" inbox|doing|done</code> → move between columns.</li>
                <li><code>/kanban</code> → open the Kanban popup.</li>
                <li>(For flags/colors, use the popup for now.)</li>
              </ul>
            </li>
            <li><strong>Data</strong>: Stored locally under <code>localStorage["xenya.kanban.v1"]</code>. Legacy single <code>color</code>/<code>flag</code> values are auto-migrated.</li>
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
            <li><code>server/models/vosk/vosk-model-small-en-us-0.15/</code>: Offline STT model data.</li>
            <li><code>server/piper/voices/*.onnx</code>: Offline TTS voices.</li>
            <li><code>client/src/components/Mic.jsx</code>: Mic recorder → uploads FormData to <code>/api/stt</code>.</li>
            <li><code>client/src/lib/tts/speak.js</code>: Fetches <code>/api/tts</code> and plays wav.</li>
            <li><code>client/src/components/MiniKanban.jsx</code>: Kanban popup, filters, color/flag logic.</li>
            <li><code>client/src/App.jsx</code>: Routing logic, chat UI, model picker, TTS auto-speak, mic integration, Action Dock.</li>
          </ul>
        </section>

        <section>
          <h4>Paths & Ports</h4>
          <ul>
            <li>Server: <code>http://localhost:3000</code> (configurable via <code>PORT</code> env).</li>
            <li>Client dev: <code>http://localhost:5173</code>, proxied <code>/api</code> → <code>:3000</code>.</li>
            <li>Ollama: <code>http://localhost:11434</code> (ensure model is pulled).</li>
          </ul>
        </section>

        <section>
          <h4>Troubleshooting</h4>
          <ul>
            <li><strong>Kanban buttons overlap</strong>: The Action Dock auto-hides while Kanban is open; if it doesn’t, check the element id <code>#x-dock</code>.</li>
            <li><strong>Two-color border not showing</strong>: Ensure the task has exactly two selected colors; border uses a linear-gradient split (50/50).</li>
            <li><strong>Socket hang up / ECONNREFUSED</strong>: Start server first; verify <code>/api/health</code>.</li>
            <li><strong>TTS fails</strong>: Check Piper voice files; server logs print <code>[TTS]</code> errors.</li>
            <li><strong>Mic empty</strong>: Ensure browser mic permission; server logs show <code>[STT]</code> if conversion/transcription fails.</li>
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
