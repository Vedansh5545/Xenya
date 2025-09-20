import { useState } from 'react'
import { speak } from '../lib/tts/speak'

export default function TTSControls({ lastReply, onToggleAutoSpeak }){
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [voice, setVoice] = useState('en_GB-jenny_dioco-medium.onnx')

  function toggle(e){
    setAutoSpeak(e.target.checked)
    onToggleAutoSpeak?.(e.target.checked)
  }

  return (
    <div className="card" style={{padding:'.5rem',display:'flex',gap:'.5rem',alignItems:'center'}}>
      <label><input type="checkbox" checked={autoSpeak} onChange={toggle}/> Speak replies</label>
      <select value={voice} onChange={e=>setVoice(e.target.value)}>
        <option value="en_GB-jenny_dioco-medium.onnx">EN-GB (Jenny)</option>
        <option value="en_GB-cori-high.onnx">EN-GB (Cori)</option>
      </select>
      <button onClick={()=> lastReply && speak(lastReply, voice)}>▶ Speak last</button>
    </div>
  )
}
