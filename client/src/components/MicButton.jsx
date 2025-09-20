import { useEffect, useRef, useState } from 'react'
import { startMic, stopMic } from '../lib/stt/mic'
import { UX } from '../personality/xenya-voice'

export default function MicButton({ onFinalTranscript }) {
  const [state, setState] = useState('idle') // idle|listening|processing|done|error
  const session = useRef(null)
  const worker = useRef(null)

  useEffect(()=>{
    worker.current = new Worker(new URL('../lib/stt/voskWorker.js', import.meta.url), { type:'module' })
    worker.current.onmessage = (e)=>{
      const { type, text } = e.data || {}
      if(type==='ready') setState('idle')
      if((type==='partial' || type==='final') && text){
        if(type==='final'){ onFinalTranscript?.(text); setState('processing') }
      }
    }
    worker.current.postMessage({ type:'init' })
    return ()=> worker.current?.terminate()
  }, [onFinalTranscript])

  async function toggle(){
    if(state==='idle' || state==='done' || state==='error'){
      session.current = await startMic()
      setState('listening')
      session.current.proc.onaudioprocess = (e)=>{
        const buf = e.inputBuffer.getChannelData(0).slice(0)
        worker.current?.postMessage({ type:'audio', payload: buf }, [buf.buffer])
      }
    } else if(state==='listening'){
      stopMic(session.current); worker.current?.postMessage({ type:'end' })
    }
  }

  const classMap = {
    idle:'mic mic--idle', listening:'mic mic--listening',
    processing:'mic mic--processing', done:'mic mic--done', error:'mic mic--error'
  }

  const label = state==='idle'?UX.idle:
               state==='listening'?UX.listening:
               state==='processing'?UX.processing:
               state==='done'?UX.done:UX.error

  return <button className={classMap[state]} onClick={toggle} aria-pressed={state==='listening'}>{label}</button>
}
