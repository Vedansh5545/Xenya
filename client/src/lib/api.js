const parse = async (res) => {
  if (!res.ok) {
    try { const j = await res.json(); throw new Error(j?.error || `HTTP ${res.status}: ${res.statusText}`) }
    catch { throw new Error(`HTTP ${res.status}: ${res.statusText}`) }
  }
  return res.json()
}
export async function api(path, { method='GET', body, headers } = {}) {
  const init = { method, headers: { 'Content-Type': 'application/json', ...(headers||{}) } }
  if (body) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  const res = await fetch(path, init)
  return parse(res)
}
export const chat = ({ messages, system = '', model } = {}) =>
  api('/api/chat', { method:'POST', body:{ messages, system, model } })
export const summarizeUrl = (url, model) =>
  api('/api/summary?url='+encodeURIComponent(url)+(model?`&model=${encodeURIComponent(model)}`:''))

export const research = (q, model) =>
  api('/api/research?q='+encodeURIComponent(q)+(model?`&model=${encodeURIComponent(model)}`:''))

export const rss = () => api('/api/rss')

// Model manager
export const listModels = () => api('/api/models')
export const selectModel = (name) => api('/api/models/select', { method:'POST', body:{ name } })
export const refreshModels = () => api('/api/models/refresh', { method:'POST' })
