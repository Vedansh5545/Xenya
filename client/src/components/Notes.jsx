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
          <span className="notes-sub">
            Xenya MVP • Offline Speak &amp; Listen • Productivity • Focus Timer &amp; Pomodoro • Outlook Calendar • Quick Capture
          </span>
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

        {/* ===== NEW: Quick Capture + Capture Center ===== */}
        <section>
          <h4>Quick Capture + Capture Center</h4>
          <ul>
            <li><strong>Open Quick Capture anywhere</strong>:
              <ul>
                <li>Keyboard: <kbd>⌘/Ctrl</kbd>+<kbd>J</kbd></li>
                <li>Dock button: <em>✚ Quick Capture</em> (top-right floating dock)</li>
                <li>Programmatic: <code>window.dispatchEvent(new CustomEvent('capture:open'))</code></li>
              </ul>
            </li>
            <li><strong>Targets &amp; syntax</strong>:
              <ul>
                <li><code>t:</code> tasks &nbsp;•&nbsp; <code>n:</code> notes &nbsp;•&nbsp; <code>r:</code> read-later</li>
                <li>Use <code>#tags</code> anywhere; they become <em>flags</em> on the created task.</li>
                <li><strong>Save</strong>: <kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd> &nbsp;•&nbsp; <strong>Close</strong>: <kbd>Esc</kbd></li>
              </ul>
            </li>
            <li><strong>Where it goes</strong>: every capture creates a <em>Mini-Kanban</em> task in <code>INBOX</code>.
              <ul>
                <li><code>n:</code> adds a <code>note</code> flag; <code>r:</code> adds a <code>readlater</code> flag.</li>
                <li>URLs are auto-detected; the text is still the task title.</li>
              </ul>
            </li>
            <li><strong>Capture Center (tile)</strong> — manage your history from the dock:
              <ul>
                <li>Open the <em>Productivity Suite</em> and show the tile <strong>“Quick Capture • History”</strong>.</li>
                <li>Filter: <em>All / Tasks / Notes / Read-Later</em>, search by text or <code>#tag</code>.</li>
                <li><strong>Read-Later</strong> items with links show an <em>Open Link</em> action (opens in a new tab).</li>
                <li>Actions: <em>Copy</em>, <em>Delete item</em>, and <em>Clear All</em> history.</li>
                <li><em>New</em> button launches the overlay immediately (same as ⌘/Ctrl+J).</li>
              </ul>
            </li>
          </ul>

          <details open>
            <summary><strong>Storage (for reference)</strong></summary>
            <ul className="small mono" style={{marginTop:6}}>
              <li><code>xenya.captures.v1</code> — Quick Capture history for the Capture Center tile.</li>
              <li><code>xenya.kanban.v1</code> — Tasks created from Quick Capture (col, flags, colors, etc.).</li>
            </ul>
          </details>

          <details>
            <summary><strong>Tips</strong></summary>
            <ul>
              <li>Use tags like <code>#p1</code> / <code>#p2</code> to prioritize; filter by flag inside Mini-Kanban.</li>
              <li>For read-later, paste the URL after <code>r:</code> (e.g., <code>r: https://… #reading</code>) to get the open-in-new-tab action in the tile.</li>
            </ul>
          </details>
        </section>

        {/* ===== NEW: Focus Timer & Pomodoro ===== */}
        <section>
          <h4>Focus Timer &amp; Pomodoro</h4>
          <ul>
            <li>Open via the Dock (<em>⚡ Productivity</em>). The tile is responsive: scroll inside it if the window is compact, or maximize (▣) for a bigger canvas.</li>
            <li><strong>Modes</strong>:
              <ul>
                <li><em>Timer</em> — a simple countdown (attention-grabbing end sound).</li>
                <li><em>Pomodoro</em> — cycles of Focus/Break with presets, gentle phase sounds, optional ambience themes.</li>
              </ul>
            </li>
            <li><strong>Presets</strong>: Classic 25/5 ×4, Study 50/10, Balanced 45/15, Ultra 90/20.</li>
            <li><strong>Custom</strong>: set Focus, Short/Long break minutes and “Long every N” cycles; enable auto-cycle.</li>
            <li><strong>Sounds</strong>:
              <ul>
                <li>Timer end: choose an attention-seeking sound (<em>alarm/buzzer/bell</em>).</li>
                <li>Pomodoro phase end: gentle sounds (<em>chime/woodblock/bell</em>).</li>
                <li>Ambience (Pomodoro): <em>Café</em>, <em>Piano/Guitar</em>, <em>Beach</em>, <em>Rain</em>, <em>Fireplace</em>; toggle per phase (focus/break/both) and volume.</li>
              </ul>
            </li>
            <li><strong>Kanban link</strong>: link the session to a task from Mini Kanban (<em>Inbox</em> or <em>Doing</em>) so the title shows on the timer.</li>
          </ul>

          <details open>
            <summary><strong>Chat commands (quick)</strong></summary>
            <div className="mono small" style={{marginTop:6, lineHeight:1.6}}>
              {/* Timer */}
              <div><strong>Timer</strong></div>
              /timer start 20<br/>
              /timer pause · /timer resume · /timer stop · /timer status<br/>
              /timer sound alarm<br/>
              /timer open
              <br/><br/>
              {/* Pomodoro */}
              <div><strong>Pomodoro</strong></div>
              /pomodoro start focus<br/>
              /pomodoro break short &nbsp;|&nbsp; /pomodoro break long<br/>
              /pomodoro preset classic &nbsp;|&nbsp; study &nbsp;|&nbsp; balanced &nbsp;|&nbsp; ultra<br/>
              /pomodoro set focus=45 break=10 long=20 every=3 auto=on<br/>
              /pomodoro sound chime<br/>
              /pomodoro ambience cafe on vol=60 where=focus<br/>
              /pomodoro link "read chapter" doing<br/>
              /pomodoro stop &nbsp;|&nbsp; /pomodoro status &nbsp;|&nbsp; /pomodoro open
            </div>
          </details>

          <details>
            <summary><strong>What the commands do</strong></summary>
            <ul>
              <li><code>/timer start [m]</code> — starts a simple countdown (default = saved minutes). <code>pause/resume/stop/status</code> manage it. <code>sound &lt;alarm|buzzer|bell|none&gt;</code> sets the end sound.</li>
              <li><code>/pomodoro start</code> — begins a Focus session using your current preset. Use <code>break short|long</code> to jump to a break.</li>
              <li><code>preset</code> and <code>set</code> update cycle lengths; <code>auto</code> toggles auto-advance between phases.</li>
              <li><code>sound &lt;chime|woodblock|bell|none&gt;</code> selects a gentle phase-end sound.</li>
              <li><code>ambience</code> picks a background theme; optional <code>on|off</code>, <code>vol=0..100</code>, and <code>where=focus|break|both</code>.</li>
              <li><code>link "substring" inbox|doing</code> links the timer to the first matching Kanban task in that column.</li>
              <li><code>open</code> pops the Productivity Suite so you can see the timer immediately.</li>
            </ul>
          </details>

          <details>
            <summary><strong>Storage keys (for reference)</strong></summary>
            <ul className="small mono">
              <li><code>xenya.timer.v1</code> — running state (mode, timestamps, link, remaining).</li>
              <li><code>xenya.timer.v1.cfg</code> — preferences (sounds, durations, ambience).</li>
            </ul>
          </details>
        </section>

        {/* ===== NEW: Calendar via Chat ===== */}
        <section>
          <h4>Calendar • Control from Chat</h4>
          <p>You can manage calendar items directly in chat with slash-commands. Local items are stored in <code>localStorage["xenya_local_events_v1"]</code> and show up instantly in the Calendar tile. Outlook items are read-only in chat (you can still push local → Outlook from the Calendar UI).</p>

          <details open>
            <summary><strong>List events</strong> — <code>/events</code></summary>
            <ul>
              <li><code>/events</code> — current <em>week</em>, Local + Outlook (if connected).</li>
              <li><code>/events today</code> • <code>/events week</code> • <code>/events month</code></li>
              <li><code>/events 2025-09-20..2025-09-27</code> — custom ISO date range.</li>
              <li>Add a source filter: <code>local</code> or <code>outlook</code>.
                <div className="mono small" style={{marginTop:6}}>
                  /events today local<br/>
                  /events week outlook<br/>
                  /events 2025-09-20..2025-09-27
                </div>
              </li>
            </ul>
          </details>

          <details>
            <summary><strong>Add / Edit / Rename / Delete (Local)</strong> — <code>/cal …</code></summary>
            <ul>
              <li><strong>Add</strong>: <code>/cal add "Title" 2025-09-24T15:00..2025-09-24T16:00 loc:"HQ" notes:"Standup"</code></li>
              <li><strong>Rename</strong>: <code>/cal rename &lt;id&gt; "New title"</code></li>
              <li><strong>Move</strong>: <code>/cal move &lt;id&gt; 2025-09-24T17:00..2025-09-24T18:00</code></li>
              <li><strong>Delete</strong>: <code>/cal delete &lt;id&gt;</code></li>
            </ul>
            <p className="small" style={{opacity:.9, marginTop:6}}>
              Use <code>/events</code> to see ids. These commands change <strong>Local</strong> items; push to Outlook from the Calendar tile UI.
            </p>
          </details>

          <details>
            <summary><strong>See both in chat and UI</strong></summary>
            <ul>
              <li>After any chat change to Local events, the Calendar tile (List/Week/Month) reflects it immediately.</li>
              <li>Once you connect Outlook in the Calendar tile, <code>/events</code> includes both Local and Outlook.</li>
            </ul>
          </details>
        </section>

        {/* ===== Calendar (tile basics + backend) ===== */}
        <section>
          <h4>Calendar • Outlook + Local (Tile)</h4>
          <ul>
            <li><strong>Views</strong>: switch between <em>List</em>, <em>Week</em>, and <em>Month</em> in the Calendar header. Week/Month auto <em>fit-to-screen</em> (no inner scroll). Use <em>Full screen</em> for bigger tiles.</li>
            <li><strong>Navigate</strong>: <em>Today</em>, then ◀/▶ (jumps a week in Week/List, a month in Month).</li>
            <li><strong>Sources</strong>: tick <em>Outlook</em> to show Microsoft 365 events, <em>Local</em> to show device-only items.</li>
            <li><strong>Quick add Local</strong>: title + start + end → <em>+ Local</em>.</li>
            <li><strong>Push to Outlook</strong>: each local item has a <em>Push</em> button (after you connect).</li>
            <li><strong>Connect Outlook</strong>: click <em>Connect</em> in the Calendar header (OAuth popup). Uses PKCE + Microsoft Graph.</li>
          </ul>

          <details>
            <summary><strong>Server env (server/.env)</strong></summary>
            <pre style={{marginTop:8}}>
BASE_URL=http://localhost:3000
CLIENT_ORIGIN=http://localhost:5173
MS_CLIENT_ID=&lt;your Azure app (client) id&gt;
MS_TENANT_ID=common
MS_REDIRECT_PATH=/oauth/callback
SESSION_SECRET=change-me
DEFAULT_TZ=America/Chicago
# optional if you created a secret (confidential app)
# MS_CLIENT_SECRET=&lt;secret&gt;
            </pre>
            <div style={{marginTop:8}}>
              Start the server:
              <pre>cd server
VENV_PY="$(cd .. && pwd)/.venv/bin/python" node --env-file=.env server.js</pre>
            </div>
          </details>

          <details>
            <summary><strong>Endpoints</strong></summary>
            <ul>
              <li><code>GET /calendar/status</code> — connection check</li>
              <li><code>GET /calendar/upcoming?from=&amp;to=&amp;tz=</code> — events in range</li>
              <li><code>POST /calendar/upsert</code> — create Outlook event from local</li>
              <li><code>DELETE /calendar/:eventId</code> — delete Outlook event</li>
              <li><code>GET /calendar/connect</code> — OAuth popup</li>
              <li><code>POST /auth/logout</code> — clear session</li>
            </ul>
          </details>

          <details>
            <summary><strong>Troubleshooting</strong></summary>
            <ul>
              <li><em>“Bad state”</em>: close popups, POST <code>/auth/logout</code>, then connect again.</li>
              <li><em>Only List shows</em>: hard-reload the client; ensure you’re using the updated Calendar component.</li>
              <li><em>Fetch error</em>: backend env missing <code>MS_CLIENT_ID</code>/<code>BASE_URL</code> or server isn’t running.</li>
              <li><em>JSX in server</em>: keep React files in <code>client/src/components</code> — Node won’t parse JSX in <code>server/</code>.</li>
            </ul>
          </details>
        </section>

        {/* ===== Action Dock ===== */}
        <section>
          <h4>Action Dock</h4>
          <ul>
            <li>Top-right floating controls: <em>✚ Quick Capture</em>, <em>✦ Notes</em>, and <em>⚡ Productivity</em>.</li>
            <li>Keyboard shortcut for Quick Capture: <kbd>⌘/Ctrl</kbd>+<kbd>J</kbd>.</li>
            <li>Use the small circle toggle to <strong>hide/show</strong> the dock. While Productivity is open, the dock auto-hides to prevent overlap.</li>
            <li>Open Productivity via UI or type <code>/productivity</code>, <code>/prod</code>, or <code>/kanban</code>.</li>
          </ul>
        </section>

        {/* ===== Productivity — Mini Kanban ===== */}
        <section>
          <h4>Productivity • Mini Kanban</h4>
          <ul>
            <li><strong>Open</strong>: Click <em>⚡ Productivity</em> in the Dock. <em>Esc</em> closes the screen.</li>
            <li><strong>Tiles</strong>: drag to reorder, minimize to dock, maximize (▣), resize (wider/taller).</li>
            <li><strong>Layouts</strong>: use <em>Layouts ▾</em> presets to fit your tiles.</li>
            <li><strong>Kanban basics</strong>:
              <ul>
                <li>Columns: <code>INBOX</code> → <code>DOING</code> → <code>DONE</code>.</li>
                <li>Create: type title → <kbd>Enter</kbd> or <em>Add</em>. Color/flag options available.</li>
                <li>Filters/Sort: by Flag / Color order.</li>
                <li>Chat shortcuts: <code>/task "Title"</code>, <code>/move "Title" inbox|doing|done</code>, <code>/kanban</code> to open.</li>
                <li>Data: <code>localStorage["xenya.kanban.v1"]</code>.</li>
              </ul>
            </li>
          </ul>
        </section>

        <section>
          <h4>Chat Basics</h4>
          <ul>
            <li><kbd>Enter</kbd> to send • <kbd>Shift</kbd>+<kbd>Enter</kbd> for newline.</li>
            <li>Replies follow Xenya’s persona (brisk, clear).</li>
            <li>Copy any assistant message via its <em>Copy</em> button.</li>
          </ul>
        </section>

        <section>
          <h4>Smart Routing</h4>
          <ul>
            <li><strong>URL → Summary</strong>: paste <code>http(s)://…</code> to get a concise summary.</li>
            <li><strong>/research &lt;q&gt;</strong>: quick research with citations.</li>
            <li><strong>News</strong>: say “today’s news” or type <code>/news</code>.</li>
          </ul>
        </section>

        <section>
          <h4>Speech (100% Offline)</h4>
          <ul>
            <li><strong>Speak (TTS)</strong>: Piper voice <code>en_GB-jenny_dioco-medium.onnx</code>.</li>
            <li><strong>Listen (STT)</strong>: Mic → WebM → WAV 16k → Vosk.</li>
            <li>Auto-send transcript is on by default; you can change this in code.</li>
          </ul>
        </section>

        <section>
          <h4>Model & Role</h4>
          <ul>
            <li>Pick an Ollama model in the sidebar (↻ to refresh).</li>
            <li>Each chat has a persisted <strong>Role</strong> you can edit.</li>
          </ul>
        </section>

        <section>
          <h4>Key Files</h4>
          <ul>
            <li><code>server/server.js</code>: API for chat/search/summary/rss + <code>/api/tts</code> + <code>/api/stt</code> + mounts calendar routes.</li>
            <li><code>server/calendar.js</code>: Outlook OAuth + Graph (<code>/calendar/*</code>).</li>
            <li><code>client/src/components/OutlookCalender.jsx</code>: Calendar UI (List/Week/Month, responsive/fit-to-screen).</li>
            <li><code>client/src/components/QuickCapture.jsx</code>: Global overlay for rapid capture.</li>
            <li><code>client/src/components/CaptureCenter.jsx</code>: Dock tile for history + open-link.</li>
            <li><code>client/src/components/MiniKanban.jsx</code>: Tasks (Inbox/Doing/Done), flags/colors.</li>
            <li><code>client/src/App.jsx</code>: Chat router (includes calendar and timer/pomodoro slash-commands).</li>
            <li><code>client/src/components/Mic.jsx</code> &amp; <code>server/stt_py.py</code>: STT.</li>
            <li><code>client/src/lib/tts/speak.js</code> &amp; <code>server/tts.js</code>: TTS.</li>
          </ul>
        </section>

        <section>
          <h4>Paths & Ports</h4>
          <ul>
            <li>Server: <code>http://localhost:3000</code></li>
            <li>Client dev: <code>http://localhost:5173</code> (proxy to <code>:3000</code>)</li>
            <li>Ollama: <code>http://localhost:11434</code></li>
          </ul>
        </section>

        <section>
          <h4>Troubleshooting</h4>
          <ul>
            <li><strong>Dock overlaps editor</strong>: the dock auto-hides when Productivity opens; verify <code>#x-dock</code> if not.</li>
            <li><strong>Socket / fetch errors</strong>: start server first; check <code>/api/health</code>.</li>
            <li><strong>TTS/STT</strong>: confirm voices and mic permissions; server logs show <code>[TTS]</code>/<code>[STT]</code>.</li>
          </ul>
        </section>

        <section>
          <h4>Privacy</h4>
          <ul>
            <li>All LLM calls are local (Ollama). No cloud APIs.</li>
            <li>Kanban + chats + local calendar items persist locally.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
