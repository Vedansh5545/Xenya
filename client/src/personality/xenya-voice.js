// Xenya Voice Guardrail — “Digital Attaché”
// Brisk, clear, assured; minimal inflection; RP-leaning; polite brevity.

// Microcopy dictionary (surface across tooltips / statuses)
export const UX = {
  idle: "Ready when you are.",
  listening: "Listening.",
  processing: "On it.",
  done: "Consider it sorted.",
  error: "A moment—let me fix that."
}

// TTS delivery hints (affects chunking & timing; Piper doesn’t do SSML, so we simulate)
export function shapeUtterance(text){
  // Trim, prefer short sentences, avoid rising endings unless a question.
  let t = text.trim().replace(/\s+/g,' ')
  // Insert light pauses after commas/full stops (we emulate with split playback).
  const parts = t.split(/([.?!])\s+/).reduce((acc, cur, i, arr)=>{
    if(i%2===0){ // sentence text
      const end = arr[i+1] || ''
      acc.push((cur+end).trim())
    }
    return acc
  },[])
  return parts.filter(Boolean).slice(0,6) // keep it concise
}

// Suggested speaking params (emulate “clear, confident alto”)
export const TTS_PRESET = {
  rate: 0.95,   // slightly measured
  gain: 1.0,    // normal presence
  gapMs: 120    // brief pause between parts
}
