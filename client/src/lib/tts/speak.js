export async function speak(text, voice='en_GB-jenny_dioco-medium.onnx'){
  if(!text?.trim()) return
  const res = await fetch('/api/tts', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ text: text.trim(), voice })
  })
  if(!res.ok) throw new Error('TTS failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  await audio.play().catch(()=>{})
}
