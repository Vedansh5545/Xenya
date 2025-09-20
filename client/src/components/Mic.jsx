// client/src/components/Mic.jsx
import { useEffect, useRef, useState } from 'react'

export default function Mic({ onTranscript }) {
  const [state, setState] = useState('idle') // idle | recording | sending | error
  const [error, setError] = useState('')
  const mediaRef = useRef(null)
  const chunksRef = useRef([])

  // feature guards so we never crash
  const canUseMic =
    typeof window !== 'undefined' &&
    navigator?.mediaDevices?.getUserMedia &&
    window?.MediaRecorder &&
    (window.isSecureContext || location.hostname === 'localhost')

  useEffect(()=>() => {
    // cleanup stream if still open
    const s = mediaRef.current
    if (s) for (const tr of s.getTracks?.() || []) tr.stop()
    mediaRef.current = null
  },[])

  async function start() {
    try {
      if (!canUseMic) {
        setError('Microphone not available (use https or localhost).')
        setState('error')
        return
      }
      setError('')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaRef.current = stream
      chunksRef.current = []

      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      rec.ondataavailable = (ev) => { if (ev.data?.size) chunksRef.current.push(ev.data) }
      rec.onstop = async () => { await send() }
      rec.start(250) // gather small chunks
      setState('recording')
    } catch (e) {
      setError(e?.message || 'Mic error')
      setState('error')
    }
  }

  function stop() {
    try {
      const s = mediaRef.current
      if (s) for (const tr of s.getTracks?.() || []) tr.stop()
      mediaRef.current = null
    } catch {}
  }

  async function send() {
    try {
      setState('sending')
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      chunksRef.current = []
      const fd = new FormData()
      fd.append('audio', blob, 'clip.webm')
      const res = await fetch('/api/stt', { method:'POST', body: fd })
      const json = await res.json().catch(()=>({}))
      const text = (json?.text || '').trim()
      if (text && typeof onTranscript === 'function') onTranscript(text)
      setState('idle')
    } catch (e) {
      setError(e?.message || 'Send failed')
      setState('error')
    }
  }

  return (
    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
      <button
        className="button"
        onClick={state==='recording' ? stop : start}
        title={state==='recording' ? 'Stop' : 'Start microphone'}
      >
        {state==='recording' ? '⏹ Stop' : '🎤 Talk'}
      </button>
      <span className="small" style={{ opacity:.8 }}>
        {state==='idle' && 'Ready'}
        {state==='recording' && 'Listening…'}
        {state==='sending' && 'Transcribing…'}
        {state==='error' && (error || 'Mic unavailable')}
      </span>
    </div>
  )
}
