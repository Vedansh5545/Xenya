/* global self */
let recognizer, ready = false

async function init(){
  // TODO: load Vosk WASM + model from /models/vosk/
  // Example (adjust to your build):
  // const { VoskModel, KaldiRecognizer } = await import('/models/vosk/vosk.js')
  // const model = new VoskModel('/models/vosk')
  // recognizer = new KaldiRecognizer(model, 16000)
  ready = true
  self.postMessage({ type: 'ready' })
}

self.onmessage = (e)=>{
  const { type, payload } = e.data || {}
  if (type === 'init') return void init()
  if (type === 'audio' && ready && recognizer){
    // Example:
    // const hasResult = recognizer.acceptWaveform(payload)
    // const r = hasResult ? recognizer.result() : recognizer.partialResult()
    // self.postMessage({ type: hasResult?'final':'partial', text: r.text })
  }
  if (type === 'end' && recognizer){
    // const r = recognizer.finalResult()
    self.postMessage({ type: 'final', text: '' })
  }
}
