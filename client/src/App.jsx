import { useEffect, useMemo, useRef, useState } from 'react'
import { chat, research, search, rss, summarizeUrl, memorySet, memoryGet } from './lib/api'

function useStatus() {
  const [status, setStatus] = useState('idle') // idle | processing | error
  const wrap = async (fn) => {
    setStatus('processing')
    try { const r = await fn(); setStatus('idle'); return r }
    catch (e) { console.error(e); setStatus('error'); setTimeout(()=>setStatus('idle'), 1200); throw e }
  }
  return { status, run: wrap }
}

function Copy({ text }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      className="button secondary"
      style={{ padding: '8px 12px' }}
      onClick={async () => {
        await navigator.clipboard.writeText(text || '')
        setOk(true); setTimeout(()=>setOk(false), 900)
      }}
      aria-label="Copy output"
      title="Copy"
    >
      {ok ? 'Copied' : 'Copy'}
    </button>
  )
}

export default function App() {
  const { status, run } = useStatus()
  const eyeClass = useMemo(() => {
    if (status === 'processing') return 'eye processing'
    if (status === 'error') return 'eye error'
    return 'eye'
  }, [status])

  // --- Research panel
  const [q, setQ] = useState('What is PoseFormer in 3D human pose estimation?')
  const [answer, setAnswer] = useState('')

  // --- Chat panel
  const [prompt, setPrompt] = useState('')
  const [chatLog, setChatLog] = useState([])
  const inputRef = useRef(null)

  // --- RSS panel
  const [feeds, setFeeds] = useState([])

  useEffect(() => {
    // fetch headlines on mount
    run(() => rss()).then((r) => setFeeds(r.feeds || [])).catch(()=>{})
  }, [])

  const askResearch = async () => {
    const r = await run(() => research(q))
    setAnswer(r.answer || JSON.stringify(r, null, 2))
  }

  const sendChat = async () => {
    const content = prompt.trim()
    if (!content) return
    setPrompt('')
    setChatLog((log) => [...log, { role: 'user', content }])

    try {
      const r = await run(() => chat({
        messages: [
          { role: 'system', content: 'You are Xenya: brisk, clear, precise. Keep responses concise.' },
          ...chatLog,
          { role: 'user', content }
        ]
      }))
      const reply = r.reply ?? r?.message?.content ?? '(no reply)'
      setChatLog((log) => [...log, { role: 'assistant', content: reply }])
      inputRef.current?.focus()
    } catch (e) {
      setChatLog((log) => [...log, { role: 'assistant', content: `Error: ${e.message}` }])
    }
  }

  const doSearch = async (term) => {
    const r = await run(() => search(term, 5))
    return r.hits || []
  }

  const summarize = async (url) => {
    const r = await run(() => summarizeUrl(url))
    return r.summary
  }

  // Optional: tiny memory demo (store your name)
  const [myName, setMyName] = useState('')
  const saveName = async () => { await run(()=>memorySet('default','name',myName)) }
  const loadName = async () => {
    const r = await run(()=>memoryGet('default','name'))
    setMyName(r.value || '')
  }

  return (
    <div className="container">
      <header className="header">
        <div className="brand">
          <div className={eyeClass} aria-hidden />
          <h1>Xenya</h1>
          <span className="badge">Phase 1 MVP</span>
        </div>
        <div className="row" role="group" aria-label="Shortcuts">
          <span className="kbd">/research</span>
          <span className="kbd">/chat</span>
          <span className="kbd">/rss</span>
        </div>
      </header>

      {/* Research */}
      <section className="card">
        <h2>Research</h2>
        <div className="stack">
          <input
            className="input"
            placeholder="Ask something specific…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e)=>{ if(e.key==='Enter' && (e.ctrlKey||e.metaKey)) askResearch() }}
          />
          <div className="row">
            <button className="button" onClick={askResearch} disabled={status==='processing'}>
              Run /research
            </button>
            <button
              className="button secondary"
              onClick={async () => {
                const hits = await doSearch(q)
                setAnswer([
                  `Top hits for: ${q}\n`,
                  ...hits.map((h,i)=>`${i+1}. ${h.title}\n   ${h.url}`)
                ].join('\n'))
              }}
              disabled={status==='processing'}
            >
              Quick search
            </button>
          </div>
          <div className="output">
            {answer || 'Results will appear here.'}
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>
              Tip: <span className="kbd">Ctrl/⌘ + Enter</span> to run.
            </span>
            <Copy text={answer} />
          </div>
        </div>
      </section>

      {/* Chat */}
      <section className="card">
        <h2>Chat</h2>
        <div className="stack">
          <div className="output" aria-live="polite" style={{ maxHeight: 260, overflow: 'auto' }}>
            {chatLog.length === 0 ? 'No messages yet.' : chatLog.map((m, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <strong style={{ color: m.role === 'user' ? 'var(--cyan)' : 'var(--violet)' }}>
                  {m.role === 'user' ? 'You' : 'Xenya'}
                </strong>
                <div>{m.content}</div>
              </div>
            ))}
          </div>
          <textarea
            ref={inputRef}
            rows={3}
            className="input"
            placeholder="Say something…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
          />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Press Enter to send • Shift+Enter for newline</span>
            <div className="row">
              <button className="button secondary" onClick={() => setChatLog([])}>Clear</button>
              <button className="button" onClick={sendChat} disabled={status==='processing'}>Send</button>
            </div>
          </div>
        </div>
      </section>

      {/* URL Summarizer */}
      <section className="card">
        <h2>URL Summarizer</h2>
        <UrlSummarizer onSummarize={summarize} />
      </section>

      {/* Headlines */}
      <section className="card">
        <h2>Headlines</h2>
        <ul className="list">
          {(feeds || []).flatMap((f) =>
            (f.items || []).slice(0,5).map((item, idx) => (
              <li key={`${f.feed}-${idx}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <a className="link" href={item.link} target="_blank" rel="noreferrer">{item.title}</a>
                  <span style={{ color: 'var(--muted)' }}>{(item.pubDate||'').split('T')[0]}</span>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      {/* Optional Memory demo */}
      <section className="card">
        <h2>Memory (demo)</h2>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" placeholder="Your name" value={myName} onChange={(e)=>setMyName(e.target.value)} />
          <button className="button secondary" onClick={loadName}>Load</button>
          <button className="button" onClick={saveName}>Save</button>
        </div>
      </section>
    </div>
  )
}

function UrlSummarizer({ onSummarize }) {
  const [url, setUrl] = useState('')
  const [res, setRes] = useState('')
  const [busy, setBusy] = useState(false)

  const go = async () => {
    if (!url.trim()) return
    setBusy(true); setRes('')
    try {
      const s = await onSummarize(url.trim())
      setRes(s)
    } catch (e) {
      setRes('Error: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <input className="input" placeholder="https://…" value={url}
             onChange={(e)=>setUrl(e.target.value)}
             onKeyDown={(e)=>{ if(e.key==='Enter') go() }} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--muted)' }}>Paste a news/article URL and press Enter.</span>
        <div className="row" style={{ gap: 8 }}>
          <Copy text={res} />
          <button className="button" onClick={go} disabled={busy}>Summarize</button>
        </div>
      </div>
      <div className="output">{busy ? 'Summarizing…' : (res || '—')}</div>
    </div>
  )
}
