// client/lib/api.js
export async function research(q, model, opts = {}){
  const r = await fetch('/api/research', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ q, model, maxAgeDays: 30, maxSources: 12, ...opts })
  })
  if (!r.ok) throw new Error('research failed')
  return await r.json()
}
