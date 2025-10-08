// server/mcp.js (ESM)
// A thin wrapper that tries an MCP fetch endpoint if configured,
// otherwise falls back to native fetch(). Always returns a string ('' on failure).

const MCP_ENDPOINT = process.env.MCP_FETCH_ENDPOINT || '' // e.g., http://localhost:3005/fetch

export async function fetchHTMLwithMCP(url, timeoutMs = 15000) {
  // 1) Try MCP endpoint if provided
  if (MCP_ENDPOINT) {
    try {
      const ac = new AbortController()
      const to = setTimeout(() => ac.abort(), timeoutMs)
      const res = await fetch(MCP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: ac.signal
      })
      clearTimeout(to)
      if (res.ok) {
        // Accept either { html } or raw text
        const ct = res.headers.get('content-type') || ''
        if (ct.includes('application/json')) {
          const data = await res.json().catch(() => ({}))
          if (typeof data.html === 'string') return data.html
        }
        const text = await res.text()
        if (text) return text
      }
    } catch { /* ignore and fall through */ }
  }

  // 2) Fallback to native fetch (with redirect follow)
  try {
    const ac = new AbortController()
    const to = setTimeout(() => ac.abort(), timeoutMs)
    const r = await fetch(url, { redirect: 'follow', signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (XenyaBot; +local)' } })
    clearTimeout(to)
    return await r.text()
  } catch {
    return ''
  }
}
