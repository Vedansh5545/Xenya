const j = (res) => {
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  return res.json()
}

export async function api(path, { method = 'GET', body, headers } = {}) {
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) }
  }
  if (body) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  const res = await fetch(path, init)
  return j(res)
}

// Phase 1 endpoints
export const chat = ({ messages, system = '', model } = {}) =>
  api('/api/chat', { method: 'POST', body: { messages, system, model } })

export const research = (q) =>
  api('/api/research?q=' + encodeURIComponent(q))

export const search = (q, n = 5) =>
  api('/api/search?q=' + encodeURIComponent(q) + '&n=' + n)

export const rss = (feedsCsv) =>
  api('/api/rss' + (feedsCsv ? `?feeds=${encodeURIComponent(feedsCsv)}` : ''))

export const summarizeUrl = (url) =>
  api('/api/summary?url=' + encodeURIComponent(url))

// memory helpers (optional UI)
export const memorySet = (userId, key, value) =>
  api('/api/memory', { method: 'POST', body: { userId, action: 'set', key, value } })
export const memoryGet = (userId, key) =>
  api('/api/memory', { method: 'POST', body: { userId, action: 'get', key } })
