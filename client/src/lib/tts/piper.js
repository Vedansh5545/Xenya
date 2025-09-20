import { Piper } from '@mintplex-labs/piper-tts-web'
import { shapeUtterance, TTS_PRESET } from '../../personality/xenya-voice'

let engine
export async function initPiper(voice='/tts/en-gb_voice.onnx', wasmPaths={}){
  if(!engine){
    engine = new Piper({ voicePath: voice, wasmPaths })
    await engine.initialize()
  }
  return engine
}

// Simple rate control via playbackRate; gap between sentences via timeout
export async function speak(text, voice){
  const p = await initPiper(voice)
  const parts = shapeUtterance(text)
  for(const s of parts){
    const wav = await p.synthesize(s)
    const url = URL.createObjectURL(new Blob([wav],{type:'audio/wav'}))
    const audio = new Audio(url)
    audio.playbackRate = TTS_PRESET.rate
    await audio.play().catch(()=>{})
    await new Promise(r=> audio.onended = ()=> setTimeout(r, TTS_PRESET.gapMs))
  }
}
