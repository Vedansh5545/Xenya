// client/src/lib/stt/sendBlob.js
export async function sttFromBlob(webmBlob){
  const fd = new FormData()
  fd.append('audio', webmBlob, 'clip.webm')
  const res = await fetch('/api/stt', { method:'POST', body: fd })
  if(!res.ok) throw new Error('STT failed')
  return res.json() // { text }
}
