// Xenya — Phase 1 backend (minimal, single file)
// Endpoints:
//  POST /api/chat         → local LLM via Ollama
//  POST /api/memory       → set/get/delete simple user facts
//  GET  /api/search       → resilient search (DDG HTML → Bing HTML)
//  GET  /api/summary?url= → Readability extract + LLM summary
//  GET  /api/rss          → headlines (BBC + Reuters by default)
//  GET  /api/research?q=  → search + wiki → synthesized answer w/ citations

import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as cheerio from 'cheerio'

import Parser from 'rss-parser'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// --- Config
const PORT = process.env.PORT || 3000
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3.1'
const MEMORY_PATH = path.join(__dirname, 'memory.json')

const UA_HEADERS = { 'User-Agent': 'Mozilla/5.0 (XenyaBot; +local)' }

// --- Utility
function trimText(s, max = 8000) {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '\n…[truncated]' : s
}
function uniqBy(arr, keyFn) {
  const seen = new Set()
  return arr.filter((x) => {
    const k = keyFn(x)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
function isHttpUrl(u = '') {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:' } catch { return false }
}
function decodeUddg(href) {
  // DDG sometimes wraps results like /l/?kh=1&uddg=https%3A%2F%2Fexample.com
  try {
    const u = new URL(href, 'https://duckduckgo.com')
    const uddg = u.searchParams.get('uddg')
    if (uddg) return decodeURIComponent(uddg)
    return href
  } catch {
    return href
  }
}
async function fetchWithTimeout(url, init = {}, ms = 12000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    return res
  } finally {
    clearTimeout(id)
  }
}

// --- Memory (very simple JSON file)
function readMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8')) }
  catch { return { users: {}, notes: [] } }
}
function writeMemory(obj) {
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(obj, null, 2), 'utf8')
}

// --- Ollama chat
async function ollamaChat({ system, messages, model = DEFAULT_MODEL, temperature = 0.2 }) {
  const res = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        system ? { role: 'system', content: system } : null,
        ...(messages || [])
      ].filter(Boolean),
      stream: false, // ensure single JSON response
      options: { temperature }
    })
  }, 60000)
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Ollama error ${res.status}: ${txt || res.statusText}`)
  }
  const data = await res.json()
  return data?.message?.content || data?.reply || ''
}

// --- HTML extraction for summaries
async function extractReadable(url) {
  const html = await (await fetchWithTimeout(url, { headers: UA_HEADERS }, 15000)).text()
  const dom = new JSDOM(html, { url })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()
  if (article?.textContent?.trim()) {
    return {
      title: article.title || dom.window.document.title || url,
      textContent: article.textContent.replace(/\s+/g, ' ').trim()
    }
  }
  // fallback: grab first few paragraphs
  const $ = cheerio.load(html)
  const title = $('title').first().text().trim() || url
  const paras = $('p').slice(0, 10).map((_, el) => $(el).text()).get().join(' ')
  return { title, textContent: paras.replace(/\s+/g, ' ').trim() }
}

// --- Resilient search (DDG HTML → Bing HTML)
async function ddgHtmlSearch(q, count = 5) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`
  const html = await (await fetchWithTimeout(url, { headers: UA_HEADERS }, 12000)).text()
  const $ = cheerio.load(html)
  const items = []
  $('a.result__a').each((_, a) => {
    const title = $(a).text().trim()
    let href = $(a).attr('href')
    if (!href) return
    href = decodeUddg(href)
    if (title && isHttpUrl(href)) items.push({ title, url: href })
  })
  return items.slice(0, count)
}
async function bingHtmlSearch(q, count = 5) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}`
  const html = await (await fetchWithTimeout(url, { headers: UA_HEADERS }, 12000)).text()
  const $ = cheerio.load(html)
  const items = []
  $('li.b_algo h2 a').each((_, a) => {
    const title = $(a).text().trim()
    const href = $(a).attr('href')
    if (title && isHttpUrl(href)) items.push({ title, url: href })
  })
  return items.slice(0, count)
}
async function resilientSearch(q, count = 5) {
  let hits = []
  try { hits = await ddgHtmlSearch(q, count) } catch {}
  if (hits.length < Math.min(3, count)) {
    try {
      const more = await bingHtmlSearch(q, count)
      hits = uniqBy([...hits, ...more], x => x.url)
    } catch {}
  }
  return hits.slice(0, count)
}

// --- Wikipedia summary (no key)
async function wikipediaSummary(query) {
  const sUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1`
  const sRes = await fetchWithTimeout(sUrl, { headers: UA_HEADERS }, 12000)
  const sData = await sRes.json().catch(() => null)
  const pageTitle = sData?.query?.search?.[0]?.title
  if (!pageTitle) return null
  const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`
  const res = await fetchWithTimeout(sumUrl, { headers: UA_HEADERS }, 12000)
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  return data ? {
    title: data.title,
    extract: data.extract,
    url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`
  } : null
}

// ================= Routes =================

// Local LLM chat
app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [], model = DEFAULT_MODEL, system } = req.body || {}
    const reply = await ollamaChat({ system, messages, model })
    res.json({ ok: true, reply })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// Memory: { userId, action, key?, value? }
app.post('/api/memory', (req, res) => {
  const { userId = 'default', action, key, value } = req.body || {}
  const store = readMemory()
  store.users[userId] ||= {}
  if (action === 'set' && key) {
    store.users[userId][key] = value
    writeMemory(store)
    return res.json({ ok: true })
  }
  if (action === 'get') {
    if (key) return res.json({ ok: true, value: store.users[userId][key] })
    return res.json({ ok: true, value: store.users[userId] })
  }
  if (action === 'delete' && key) {
    delete store.users[userId][key]
    writeMemory(store)
    return res.json({ ok: true })
  }
  res.status(400).json({ ok: false, error: 'Invalid action' })
})

// Resilient Search
app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').slice(0, 200)
    if (!q) return res.status(400).json({ ok: false, error: 'q required' })
    const n = Math.min(10, Math.max(1, Number(req.query.n || 5)))
    const hits = await resilientSearch(q, n)
    res.json({ ok: true, hits })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// URL Extraction + Summary
app.get('/api/summary', async (req, res) => {
  try {
    const url = String(req.query.url || '')
    if (!isHttpUrl(url)) return res.status(400).json({ ok: false, error: 'Valid http(s) url required' })
    const { title, textContent } = await extractReadable(url)
    const prompt = `Summarize with concise bullet points and one-line takeaway.
TITLE: ${title}
SOURCE: ${url}
TEXT: ${trimText(textContent, 10000)}`
    const summary = await ollamaChat({
      system: 'You are Xenya, a concise analyst. Output tight bullets and a short takeaway.',
      messages: [{ role: 'user', content: prompt }]
    })
    res.json({ ok: true, title, url, summary })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// RSS Aggregator
const DEFAULT_FEEDS = [
  'http://feeds.bbci.co.uk/news/rss.xml',
  'https://feeds.reuters.com/reuters/topNews'
]
app.get('/api/rss', async (req, res) => {
  try {
    const list = (req.query.feeds ? String(req.query.feeds).split(',') : DEFAULT_FEEDS).slice(0, 8)
    const parser = new Parser({ headers: UA_HEADERS })
    const results = await Promise.all(list.map(async (feedUrl) => {
      try {
        const feed = await parser.parseURL(feedUrl)
        const items = (feed.items || []).slice(0, 10).map(i => ({
          title: i.title,
          link: i.link,
          pubDate: i.pubDate || i.isoDate
        }))
        return { feed: feed.title || feedUrl, items }
      } catch { return { feed: feedUrl, items: [] } }
    }))
    res.json({ ok: true, feeds: results })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

// Smart /research: search + wiki → synthesize with citations
app.get('/api/research', async (req, res) => {
  try {
    const q = String(req.query.q || '').slice(0, 200)
    if (!q) return res.status(400).json({ ok: false, error: 'q required' })

    const [hits, wiki] = await Promise.all([
      resilientSearch(q, 5),
      wikipediaSummary(q)
    ])

    // lightweight snippets
    const snippets = await Promise.all(hits.map(async (h) => {
      try {
        const html = await (await fetchWithTimeout(h.url, { headers: UA_HEADERS }, 10000)).text()
        const $ = cheerio.load(html)
        const meta = $('meta[name="description"]').attr('content') || $('p').first().text().trim()
        return { ...h, snippet: trimText(meta, 320) }
      } catch { return { ...h, snippet: '' } }
    }))

    const context = [
      wiki ? `WIKIPEDIA: ${wiki.title} — ${wiki.extract} (source: ${wiki.url})` : null,
      ...snippets.map((s, i) => `S${i + 1}: ${s.title} — ${s.snippet} (source: ${s.url})`)
    ].filter(Boolean).join('\n\n')

    const prompt = `Research question: ${q}

Use the sources below to produce a concise, well-structured answer.
- Be neutral and specific.
- If facts conflict, note it briefly.
- End with a short list of citations [S1], [S2], ... mapping to the sources.

SOURCES:
${trimText(context, 12000)}`
    const answer = await ollamaChat({
      system: 'You are Xenya, a pragmatic research assistant. Cite as [S1], [S2], ... and list URLs at the end.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    })

    const sourceList = [
      wiki ? { label: 'WIKI', title: wiki.title, url: wiki.url } : null,
      ...snippets.map((s, i) => ({ label: `S${i + 1}`, title: s.title, url: s.url }))
    ].filter(Boolean)

    res.json({ ok: true, answer, sources: sourceList })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

app.get('/', (_, res) => {
  res.type('text/plain').send('Xenya Phase 1 server up. Endpoints: /api/chat, /api/memory, /api/search, /api/summary?url=, /api/rss, /api/research?q=')
})

app.listen(PORT, () => {
  console.log(`✅ Xenya server listening on http://localhost:${PORT}`)
  console.log(`↪  Using Ollama at ${OLLAMA_URL} (model: ${DEFAULT_MODEL})`)
})
