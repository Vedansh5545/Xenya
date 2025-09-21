const API = '/api'

// small helper
async function toJson(res){
  const text = await res.text()
  try { return JSON.parse(text) } catch { throw new Error(`Bad JSON (HTTP ${res.status})`) }
}

// --- Chat ---
export async function chat({ messages, system, model }){
  const r = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ messages, system, model })
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(()=> '')}`)
  return await r.json()
}

// --- Research (resilient, never throws to UI) ---
export async function research(q, model){
  const u = new URL('/api/research', window.location.origin);
  u.searchParams.set('q', q);
  if (model) u.searchParams.set('model', model);

  const attempt = async () => {
    try{
      const r = await fetch(u.toString(), { headers:{ 'Accept':'application/json' } });
      const text = await r.text();
      let data = {};
      try { data = JSON.parse(text); } catch { /* ignore parse error */ }

      if (!r.ok) {
        // Friendly fallback — never expose raw JSON
        return { query:q, answer: 'Sources are temporarily unavailable; showing a concise offline synthesis.', citations: [], mode: 'offline', error: `HTTP ${r.status}` };
      }
      return {
        query: data.query || q,
        answer: data.answer || 'No answer.',
        citations: Array.isArray(data.citations) ? data.citations : [],
        mode: data.mode || 'search'
      };
    } catch(e){
      return { query:q, answer: 'Network hiccup; here’s an offline synthesis.', citations: [], mode: 'offline', error: String(e?.message||e) };
    }
  };

  // one quick retry
  const first = await attempt();
  if (first.mode !== 'offline' || first.citations.length || first.answer !== 'No answer.') return first;
  await new Promise(r=>setTimeout(r, 400));
  return await attempt();
}


// --- URL summary ---
export async function summarizeUrl(url, model){
  const u = new URL(`${API}/summary`, window.location.origin)
  u.searchParams.set('url', url)
  if (model) u.searchParams.set('model', model)
  const r = await fetch(u.toString())
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await toJson(r)
}

// --- RSS ---
export async function rss(){
  const r = await fetch(`${API}/rss`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await toJson(r)
}

// --- Models ---
export async function listModels(){
  const r = await fetch(`${API}/models`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await toJson(r)
}
export async function selectModel(name){
  const r = await fetch(`${API}/models/select`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name })
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await toJson(r)
}
export async function refreshModels(){
  const r = await fetch(`${API}/models/refresh`, { method:'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await toJson(r)
}
