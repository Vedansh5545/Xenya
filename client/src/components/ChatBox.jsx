// client/src/components/ChatBox.jsx
import { useEffect, useRef } from 'react'
import Mic from './Mic.jsx'

export default function ChatBox({
  value = '',
  onChange = () => {},
  onSend = () => {},
  busy = false,
  status = 'idle',
  onTranscript,
  onMicStatus,
  autoFocus = false
}) {
  const trySend = () => {
    const t = value.trim()
    if (!t || busy) return
    onSend(t)
  }

  // robust stage detection
  const s = String(status || '').toLowerCase()
  const isListening    = s.includes('listen') || s.includes('record') || s.includes('start') || s === 'listening'
  const isTranscribing = s.includes('transcrib') || s.includes('stt') || s === 'transcribing'
  const isThinking     = (s === 'thinking' || s === 'loading') && !isListening && !isTranscribing
  const phaseClass     = isListening ? 'listening' : isTranscribing ? 'transcribing' : isThinking ? 'thinking' : 'idle'

  return (
    <div className="chatbox-wrap" style={{position:'sticky', bottom:18, zIndex:5, display:'flex', justifyContent:'center', padding:'0 18px'}}>
      <div
        className={`chatbox ${busy ? 'is-busy' : ''} ${phaseClass}`}
        style={{
          position:'relative',
          overflow:'hidden',
          isolation:'isolate',
          width:'min(1100px, 92vw)',
          display:'grid',
          gridTemplateColumns:'1fr auto',
          alignItems:'center',
          gap:12,
          padding:'14px 14px 14px 18px',
          borderRadius:26,
          background:'linear-gradient(180deg, rgba(12,14,26,.92), rgba(10,12,22,.88))',
          border:'1px solid rgba(157,117,255,.28)',
          boxShadow:'0 0 0 1px rgba(132,98,255,.08) inset, 0 16px 40px rgba(98,66,255,.14)'
        }}
      >
        {/* Same ribbon for both, only color changes */}
        {isListening && <WaveRibbon variant="listening" />}
        {isTranscribing && <WaveRibbon variant="transcribing" />}

        {isThinking && <PulseBorder />}

        <input
          className="chatbox-input"
          placeholder="Message Xenya…"
          value={value}
          onChange={(e)=>onChange(e.target.value)}
          onKeyDown={(e)=>{ if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); trySend() }}}
          autoFocus={autoFocus}
          disabled={busy && isThinking}
          style={{position:'relative', zIndex:2, height:46, border:0, outline:0, width:'100%', background:'transparent', color:'#dfe6ff', fontSize:16}}
        />

        <div className="chatbox-actions" style={{display:'flex', gap:10, alignItems:'center', position:'relative', zIndex:2}}>
          {/* Start listening visual immediately on press */}
          <div onMouseDown={() => { try { onMicStatus && onMicStatus('listening') } catch {} }}>
            <Mic onTranscript={onTranscript} onStatusChange={onMicStatus} />
          </div>
          <button
            className="cb-btn"
            onClick={trySend}
            disabled={busy || !value.trim()}
            title="Send"
            style={{border:0, outline:0, cursor:'pointer', height:42, padding:'0 18px', borderRadius:24, color:'#efeaff',
              background:'linear-gradient(180deg,#7d51ff,#6a3dff 70%)',
              boxShadow:'0 10px 24px rgba(122,72,255,.28), 0 0 0 1px rgba(150,100,255,.18) inset'}}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

/* ======================= Ribbon (used for both listening & transcribing) ======================= */
function WaveRibbon({ variant = 'listening' }){
  const wrapRef = useRef(null)
  const ref = useRef(null)
  const raf = useRef(0)
  const ro = useRef(null)
  const dpr = Math.max(1, window.devicePixelRatio || 1)

  useEffect(() => {
    injectOnce(`
      .x-ribbon-wrap{ position:absolute; inset:4px; border-radius:999px; overflow:hidden; pointer-events:none; z-index:1; }
      .x-ribbon-wrap::before{
        content:""; position:absolute; inset:-10%;
        background:
          radial-gradient(120% 100% at 12% 50%, rgba(0,229,255,.07), transparent 60%),
          radial-gradient(120% 100% at 88% 50%, rgba(139,92,255,.07), transparent 60%);
        filter:saturate(1.04);
      }
      .x-ribbon{ display:block; width:100%; height:100%; mix-blend-mode:screen; }
    `)
  }, [])

  useEffect(() => {
    const el = wrapRef.current
    const canvas = ref.current
    if (!el || !canvas) return
    const ctx = canvas.getContext('2d', { alpha:true, desynchronized:true })

    const resize = () => {
      const w = Math.max(10, el.clientWidth)
      const h = Math.max(10, el.clientHeight)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      ctx.setTransform(dpr,0,0,dpr,0,0)
    }
    ro.current = new ResizeObserver(resize)
    ro.current.observe(el)
    resize()

    let last = performance.now()
    let phase = 0

    const draw = (now) => {
      const dt = Math.min(50, now - last)/1000; last = now
      const w = el.clientWidth, h = el.clientHeight
      const mid = h*0.52
      phase += dt * 1.2

      const amp = h * (0.28 + 0.08*Math.sin(now/800)) // same for both
      const freq = (Math.PI * 2) / Math.max(240, w)
      const step = Math.max(4, Math.floor(w/120))

      const tube = (x) => {
        const t = freq*x + phase*3
        const yCore = Math.sin(t)
        const yH1 = 0.55*Math.sin(2*t - 0.7)
        const yH2 = 0.25*Math.sin(0.7*t + 1.4)
        return (yCore + yH1 + yH2) * amp * 0.45
      }

      ctx.clearRect(0,0,w,h)

      // subtle sheen behind
      const bg = ctx.createLinearGradient(0,0,w,0)
      bg.addColorStop(0,'rgba(122,62,255,0.08)')
      bg.addColorStop(0.5,'rgba(0,229,255,0.10)')
      bg.addColorStop(1,'rgba(122,62,255,0.08)')
      ctx.fillStyle = bg
      ctx.fillRect(0,0,w,h)

      // gradient only differs by variant
      const grad = ctx.createLinearGradient(0,0,w,0)
      if (variant === 'transcribing') {
        // more purple/magenta
        grad.addColorStop(0, 'rgba(139,92,255,0.92)')
        grad.addColorStop(0.5,'rgba(255,83,212,0.95)')
        grad.addColorStop(1, 'rgba(139,92,255,0.92)')
        ctx.shadowColor = 'rgba(139,92,255,0.35)'
      } else {
        // listening: cyan→purple
        grad.addColorStop(0, 'rgba(0,229,255,0.85)')
        grad.addColorStop(0.5,'rgba(139,92,255,0.95)')
        grad.addColorStop(1, 'rgba(0,229,255,0.85)')
        ctx.shadowColor = 'rgba(0,229,255,0.35)'
      }

      ctx.shadowBlur = 16

      // filled ribbon (top curve then mirrored bottom)
      ctx.beginPath()
      ctx.moveTo(0, mid + tube(0))
      for (let x=step; x<=w; x+=step) ctx.lineTo(x, mid + tube(x))
      for (let x=w; x>=0; x-=step)   ctx.lineTo(x, mid - tube(x))
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()

      // subtle inner edge
      ctx.shadowBlur = 0
      ctx.lineWidth = 2
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.stroke()

      raf.current = requestAnimationFrame(draw)
    }
    raf.current = requestAnimationFrame(draw)

    return () => { cancelAnimationFrame(raf.current); ro.current?.disconnect() }
  }, [variant])

  return (
    <div ref={wrapRef} className="x-ribbon-wrap" aria-hidden>
      <canvas ref={ref} className="x-ribbon"/>
    </div>
  )
}

/* ======================= THINKING: Soft Pulse Border ======================= */
function PulseBorder(){
  useEffect(() => {
    injectOnce(`
      @keyframes x-pulse-soft {
        0%, 100% {
          box-shadow:
            0 0 0 1px rgba(139,92,255,.75) inset,
            0 0 8px 0 rgba(139,92,255,.25),
            0 0 22px 0 rgba(0,229,255,.18);
          opacity:.95;
        }
        50% {
          box-shadow:
            0 0 0 1px rgba(0,229,255,.95) inset,
            0 0 16px 2px rgba(139,92,255,.35),
            0 0 36px 6px rgba(0,229,255,.28);
          opacity:1;
        }
      }
      .x-pulse-border{
        position:absolute; inset:0; border-radius:26px; pointer-events:none; background:transparent;
        animation:x-pulse-soft 2.8s ease-in-out infinite; z-index:1;
      }
    `)
  }, [])
  return <div className="x-pulse-border" aria-hidden />
}

/* -------- utils -------- */
function injectOnce(css){
  const id = 'x-dyn-css-'+hash(css)
  if (document.getElementById(id)) return
  const s = document.createElement('style')
  s.id = id
  s.textContent = css
  document.head.appendChild(s)
}
function hash(s){
  let h = 9; for (let i=0;i<s.length;i++) h = Math.imul(h^s.charCodeAt(i), 9**7); return (h>>>0).toString(36)
}
