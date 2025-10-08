// server/research2.js (ESM)
import Parser from 'rss-parser'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import * as cheerio from 'cheerio'
import * as chrono from 'chrono-node'
import pLimit from 'p-limit'
import sanitizeHtml from 'sanitize-html'
import { fetchHTMLwithMCP } from './mcp.js'

const rss = new Parser()
const limit = pLimit(6)

/* -----------------------------------------------
   Intent detection
------------------------------------------------ */
const RECENT_HINTS = [
  'today','yesterday','this week','latest','recent','breaking','live',
  'score','vs','match','result','fixture','final','election','price','launch','release'
]
const SPORTS_HINTS = ['vs','match','score','fixture','cricket','t20','odi','ipl','world cup']

// programming tokens & patterns
const CODE_TOKENS = [
  'c\\+\\+','cpp','c#','csharp','java','javascript','typescript','python','rust',
  'go','golang','node\\.js','\\.net','loop','for loop','while loop','best practices','style guide'
]

// builder/architecture hints
const BUILDER_HINTS = [
  'how can i create','how do i build','design a','architecture','best way to build',
  'make a','implement a','roadmap','blueprint','plan','mvp'
]

function wantsRecent(q){
  const lc = q.toLowerCase()
  return RECENT_HINTS.some(h => lc.includes(h))
}
function isSportsQuery(q){
  const lc = q.toLowerCase()
  return SPORTS_HINTS.some(h => lc.includes(h))
}
function isProgrammingQuery(q){
  const rx = new RegExp(`\\b(${CODE_TOKENS.join('|')})\\b`, 'i')
  return rx.test(q)
}
function isBuilderQuery(q){
  const lc = q.toLowerCase()
  return BUILDER_HINTS.some(h => lc.includes(h))
}
function daysAgo(n){ return Date.now() - n*24*3600*1000 }

/* -----------------------------------------------
   Helpers
------------------------------------------------ */
const GOOD_IMG_KEYS = ['og:image','twitter:image','og:image:secure_url']

function pickOgImage($){
  const meta = {}
  $('meta').each((_,el)=>{
    const p = $(el).attr('property') || $(el).attr('name') || ''
    const c = $(el).attr('content')
    if (p && c) meta[p.toLowerCase()] = c
  })
  for (const k of GOOD_IMG_KEYS){
    if (meta[k]) return meta[k]
  }
  const first = $('img[src]').attr('src')
  return first || null
}
function parsePublished($){
  const metaDate = $('meta[property="article:published_time"],meta[name="date"],meta[name="pubdate"],meta[property="og:updated_time"]').attr('content')
  const time = metaDate || $('time[datetime]').attr('datetime') || ''
  const guess = chrono.parseDate(time) || chrono.parseDate($('*:contains("Published")').first().text()) || chrono.parseDate($('time').first().text())
  return guess ? new Date(guess) : null
}
function hostname(u){
  try { return new URL(u).hostname.replace(/^www\./,'') } catch { return '' }
}

/* -----------------------------------------------
   Fetching (redirect-aware first, MCP fallback)
------------------------------------------------ */
async function fetchFollowHtml(url, timeoutMs = 15000){
  const ac = new AbortController()
  const to = setTimeout(()=>ac.abort(), timeoutMs)
  try{
    const res = await fetch(url, { redirect: 'follow', signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (XenyaBot; +local)' } })
    const html = await res.text()
    return { finalUrl: res.url || url, html }
  } finally { clearTimeout(to) }
}

/** Resolve Google News wrapper → real publisher page */
async function resolveGoogleNews(url){
  try{
    const { finalUrl, html } = await fetchFollowHtml(url)
    const finalHost = hostname(finalUrl)
    if (finalHost && finalHost !== 'news.google.com' && !/(\.|^)google\./.test(finalHost)) {
      return { url: finalUrl, html }
    }
    const $ = cheerio.load(html || '')
    const candidates = $('a[href^="http"]').map((_,a)=>$(a).attr('href')).get()
    const picked = candidates.find(h=>{
      try{
        const host = hostname(h)
        return host && host !== 'news.google.com' && !/(\.|^)google\./.test(host)
      }catch{ return false }
    })
    if (picked) {
      const next = await fetchFollowHtml(picked).catch(()=>({ finalUrl: picked, html: null }))
      return { url: next.finalUrl || picked, html: next.html }
    }
  } catch {}
  return { url, html: null }
}

async function fetchAndRead(rawUrl){
  try{
    let target = rawUrl
    let htmlText = null

    if (/news\.google\.com/.test(rawUrl)) {
      const resolved = await resolveGoogleNews(rawUrl)
      target = resolved.url
      htmlText = resolved.html
    }
    if (!htmlText) {
      try {
        const r = await fetchFollowHtml(target)
        target = r.finalUrl || target
        htmlText = r.html
      } catch {}
    }
    if (!htmlText) {
      htmlText = await fetchHTMLwithMCP(target)
    }
    if (!htmlText) return null

    const dom = new JSDOM(htmlText, { url: target })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    const $ = cheerio.load(htmlText)

    return {
      url: target,
      title: (article?.title || $('title').first().text() || hostname(target)).trim(),
      content: (article?.textContent || '').trim(),
      html: article?.content || '',
      published: parsePublished($),
      image: pickOgImage($)
    }
  } catch { return null }
}

/* -----------------------------------------------
   Sources (news + docs)
------------------------------------------------ */
// Google News RSS
async function googleNewsFeed(q, max=12){
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
  try {
    const feed = await rss.parseURL(url)
    return (feed.items || []).slice(0, max).map(i => ({
      title: i.title, url: i.link, published: i.isoDate || i.pubDate
    }))
  } catch { return [] }
}

// Wikipedia REST
async function wikiSummary(q){
  const api = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`
  try {
    const res = await fetch(api, { headers: { 'User-Agent': 'Mozilla/5.0 (XenyaBot; +local)' } })
    const data = await res.json()
    const img = data?.thumbnail?.source || data?.originalimage?.source || null
    return {
      title: data?.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(data?.title||q)}`,
      extract: data?.extract || '', image: img
    }
  } catch { return null }
}

// DuckDuckGo HTML search (robust selectors)
function decodeUddg(href){
  try { const u = new URL(href, 'https://duckduckgo.com'); const v = u.searchParams.get('uddg'); return v? decodeURIComponent(v) : href } catch { return href }
}
async function ddgHtmlSearch(q, count=5){
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`
  const { html } = await fetchFollowHtml(url).catch(()=>({ html: '' }))
  const $ = cheerio.load(html || '')
  const items = []

  $('a.result__a, h2.result__title a').each((_,a)=>{
    const title = $(a).text().trim()
    let href = $(a).attr('href') || ''
    if (!href) return
    href = decodeUddg(href)
    try { new URL(href) } catch { return }
    items.push({ title, url: href })
  })
  return items.slice(0, count)
}

const DEV_SITES = [
  'en.cppreference.com','isocpp.org','learncpp.com','google.github.io','stackoverflow.com','cplusplus.com'
]

async function devDocsSearch(q, max=12){
  const queries = [
    `${q}`,
    ...DEV_SITES.map(s => `${q} site:${s}`)
  ]
  const bag = []
  for (const qq of queries){
    const hits = await ddgHtmlSearch(qq, 4).catch(()=>[])
    bag.push(...hits)
  }
  // de-dupe by URL host+path
  const seen = new Set()
  const uniq = []
  for (const h of bag){
    try{
      const u = new URL(h.url)
      const key = `${u.hostname}${u.pathname}`
      if (seen.has(key)) continue
      seen.add(key)
      uniq.push(h)
    }catch{}
    if (uniq.length >= max) break
  }
  return uniq
}

/** Curated fallbacks for when search is flaky/offline */
function devFallbacks(q){
  const lc = q.toLowerCase()
  const urls = []
  const hasCpp = /\b(c\+\+|cpp)\b/.test(lc)
  const aboutLoops = /\b(loop|loops|for|while|range)\b/.test(lc)
  if (hasCpp && aboutLoops) {
    urls.push(
      { title: 'C++ range-based for', url: 'https://en.cppreference.com/w/cpp/language/range-for' },
      { title: 'C++ for statement', url: 'https://en.cppreference.com/w/cpp/language/for' },
      { title: 'C++ Core Guidelines: ES.71 Prefer range-for', url: 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#es71-prefer-a-range-for-statement-to-a-for-statement-when-there-is-a-choice' },
      { title: 'Google C++ Style Guide: Loops', url: 'https://google.github.io/styleguide/cppguide.html#Loops_and_Switch_Statements' },
      { title: 'LearnCpp: range-based for loops', url: 'https://www.learncpp.com/cpp-tutorial/range-based-for-loops/' },
      { title: 'LearnCpp: for statements', url: 'https://www.learncpp.com/cpp-tutorial/for-statements/' }
    )
  }
  return urls
}

/* -----------------------------------------------
   Builder mode (blueprint-first, offline-safe)
------------------------------------------------ */
async function runBuilderResearch({ q }) {
  const blueprint = `
Goal: Build a reliable, fresh, high-signal news search for Xenya.

Key modules:
- Crawlers & Feeds: RSS (publisher lists), Bing News Search API, Event Registry / Mediastack / GDELT (optional), site: filters.
- Canonicalizer: follow redirects, resolve Google News wrappers, extract og:title/desc, Readability body.
- Deduper: URL fingerprint + near-duplicate (MinHash/SimHash) to collapse same story.
- Story Clustering: TF-IDF or embeddings + HAC; label by top entities.
- Ranking v1: BM25/RRF on title+lead; freshness boost (recency half-life); authority priors per domain; diversity (MMR).
- Safety/Quality: paywall detection, ad-farm filter, domain allow/deny list.
- Enrich: entities (NER), locations, categories (IPTC/Google News taxonomy), sentiment (optional).
- UI: time-ago badges, publisher chips, cluster tabs, timeline sparkline, image strip.
- Observability: latency SLA, source errors, “coverage by topic”, cache hit rate.
- Caching: per-source TTL, ETag/Last-Modified, query cache (q, tWindow, region).
- Config: region/lang, time window (last 24h/7d/30d), topic facets, source toggles.

MVP API:
GET /news/search?q=&since=&until=&lang=&region=&n=
GET /news/cluster?id=
GET /news/trending?region=&lang=
`.trim()

  return {
    draft: {
      synthesisPrompt: `
You are a pragmatic architect. Turn the following blueprint into a concrete build plan for an MVP in 2 weeks, with phases, tasks, and trade-offs. Include a short ranking-signal table and a risks/mitigations list.

User query:
"${q}"

Blueprint:
${blueprint}`.trim(),
      citations: [],
      images: [],
      tables: [{
        title: 'Ranking Signals (v1)',
        columns: ['Signal','Why it helps','Weight (start)'],
        rows: [
          ['Freshness (half-life 3d)','Elevate recent stories', '0.35'],
          ['Relevance (BM25/RRF)','Match query terms', '0.30'],
          ['Authority prior','Prefer reputable outlets', '0.15'],
          ['Diversity (MMR)','Avoid duplicates', '0.10'],
          ['Engagement proxy (optional)','Click/log priors', '0.10'],
        ]
      }],
      chart: null
    }
  }
}

/* -----------------------------------------------
   Main engine
------------------------------------------------ */
export async function runResearch({ q, maxAgeDays=30, maxSources=12, wantImages=true }){
  // Route builder questions to blueprint mode (never “no sources”)
  if (isBuilderQuery(q)) {
    return await runBuilderResearch({ q })
  }

  const codey = isProgrammingQuery(q)
  const recentBias = !codey && wantsRecent(q)               // never force recency for code docs
  const cutoff = recentBias ? daysAgo(maxAgeDays) : null

  // 1) Gather candidates
  let candidates = []
  if (codey) {
    const docs = await devDocsSearch(q, maxSources).catch(()=>[])
    const fallbacks = devFallbacks(q)
    // prefer curated fallbacks first (they are authoritative), then search results
    const byKey = new Map()
    for (const c of [...fallbacks, ...docs]) {
      if (!c?.url) continue
      try{
        const u = new URL(c.url)
        const key = `${u.hostname}${u.pathname}`
        if (!byKey.has(key)) byKey.set(key, c)
      }catch{}
    }
    candidates = Array.from(byKey.values())
  } else {
    const baseNews = await googleNewsFeed(q, maxSources)
    const extraSports = isSportsQuery(q) ? await googleNewsFeed(`${q} site:espncricinfo.com`, Math.max(4, Math.floor(maxSources/2))) : []
    candidates = [...baseNews, ...extraSports]
  }

  const wiki = await wikiSummary(q)
  if (wiki) {
    candidates.unshift({ title: wiki.title, url: wiki.url, published: null, image: wiki.image })
  }

  // 2) Fetch + parse in parallel
  const articles = (await Promise.all(
    candidates.map(c => limit(async () => {
      const r = await fetchAndRead(c.url)
      if (!r) return null
      r.published = r.published || (c.published ? new Date(c.published) : null)
      r.title = r.title || c.title
      return r
    }))
  )).filter(Boolean)

  // 3) Freshness filter + sort (newest first) — only if recentBias
  const pool = recentBias
    ? articles.filter(a => !cutoff || (a.published ? a.published.getTime() >= cutoff : true))
    : articles

  const fresh = pool.sort((a,b) => (b.published?.getTime()||0) - (a.published?.getTime()||0))

  // 4) Citations (de-dupe by host)
  const seen = new Set()
  const citations = []
  for (const a of fresh){
    const host = hostname(a.url)
    if (host && seen.has(host)) continue
    seen.add(host)
    citations.push({
      title: a.title || host,
      url: a.url,
      host,
      publishedAt: a.published ? a.published.toISOString() : null
    })
  }

  // 5) Images (top 6 unique)
  const images = []
  const seenImg = new Set()
  for (const a of fresh){
    const img = a.image
    if (img && !seenImg.has(img)) {
      images.push({ url: img, source: a.url, title: a.title })
      seenImg.add(img)
      if (images.length >= 6) break
    }
  }
  if (wiki?.image && !seenImg.has(wiki.image)) {
    images.unshift({ url: wiki.image, source: wiki.url, title: wiki.title })
  }

  // 6) Recency table + chart
  const byDay = {}
  for (const a of fresh){
    if (!a.published) continue
    const d = a.published.toISOString().slice(0,10)
    byDay[d] = (byDay[d]||0) + 1
  }
  const timeline = Object.keys(byDay).sort()
  const chart = {
    type: 'bar',
    labels: timeline,
    series: [{ label: 'Articles', data: timeline.map(d => byDay[d]) }]
  }

  const recencyTable = {
    title: 'Recency Snapshot',
    columns: ['Source','Article','Published'],
    rows: citations.slice(0, 10).map(c => [
      c.host,
      c.title,
      c.publishedAt ? new Date(c.publishedAt).toLocaleString() : '—'
    ])
  }

  // 7) Synthesis prompt (recency only matters for news; for docs prefer authority)
  const contextDocs = fresh.slice(0, 8).map(a => ({
    title: a.title,
    url: a.url,
    published: a.published ? a.published.toISOString() : null,
    snippet: sanitizeHtml(a.content, { allowedTags: [] }).slice(0, 2000)
  }))

  const synthesisPrompt = `
You are a meticulous, up-to-date researcher. Use ONLY the context below (with URLs and publish dates) to answer the user’s query.

If the query is NEWS/SPORTS: prefer items from the past ${recentBias ? maxAgeDays : 'N/A'} days and surface yesterday/today results first.
If the query is PROGRAMMING/BEST PRACTICES: prefer authoritative docs (cppreference, ISO C++ Core Guidelines, Google C++ Style Guide, LearnCpp). Do NOT claim "no recent sources" if solid documentation is provided.

Provide:
- A succinct summary.
- Bulleted key points (with brief code-safe guidance where relevant).
- A compact markdown table of the most relevant examples or comparisons (if applicable).
- A "What changed recently?" section only if the context is about news/recent releases.

Cite with [n] referring to the ordered sources list.

User query:
"${q}"

Context (ordered, newest first):
${contextDocs.map((d,i)=>`[${i+1}] (${d.published||'n/a'}) ${d.title} — ${d.url}
${d.snippet}`).join('\n\n')}
`.trim()

  return {
    draft: {
      synthesisPrompt,
      citations,
      images,
      tables: [recencyTable],
      chart
    }
  }
}
