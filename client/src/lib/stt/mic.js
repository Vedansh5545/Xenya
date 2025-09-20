export async function startMic(){
  const stream = await navigator.mediaDevices.getUserMedia({ audio:true })
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  const audioCtx = new AudioCtx({ sampleRate: 16000 })
  const source = audioCtx.createMediaStreamSource(stream)
  const proc = audioCtx.createScriptProcessor(4096, 1, 1)
  source.connect(proc); proc.connect(audioCtx.destination)
  return { stream, audioCtx, source, proc }
}
export function stopMic(s){
  try{
    s?.proc?.disconnect(); s?.source?.disconnect()
    s?.stream?.getTracks()?.forEach(t=>t.stop())
    s?.audioCtx?.close()
  }catch{}
}
