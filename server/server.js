// Xenya — Phase 1 backend (chat + research + summary + RSS + memory + TTS + STT)
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import * as cheerio from 'cheerio'
import Parser from 'rss-parser'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { calendarRouter } from './calendar.js'

// STT deps
import multer from 'multer'
import os from 'os'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { spawn } from 'node:child_process'
ffmpeg.setFfmpegPath(ffmpegStatic)

// TTS
import { synthesizeWithPiper } from './tts.js'

// --- resolve __dirname in ESM and load .env next to this file ---
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '.env') })
console.log('[env] MS_CLIENT_ID present:', !!process.env.MS_CLIENT_ID)

const app = express()

app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }))
app.use(express.json({ limit: '1mb' }))

// Outlook Calendar (OAuth + Graph) router
app.use(calendarRouter())

// --- Config
const PORT = process.env.PORT || 3000
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const MEMORY_PATH = path.join(__dirname, 'memory.json')
const UA_HEADERS = { 'User-Agent': 'Mozilla/5.0 (XenyaBot; +local)' }

// ---------- Memory ----------
function readMemory() {
  try { return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8')) }
  catch { return { users:{}, notes:[], config:{} } }
}
function writeMemory(obj) {
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(obj, null, 2), 'utf8')
}

// ---------- Utils ----------
function trimText(s, max=8000){ return s ? (s.length>max ? s.slice(0,max)+'\n…[truncated]' : s) : '' }
function uniqBy(arr, keyFn){ const seen=new Set(); return arr.filter(x=>{const k=keyFn(x); if(seen.has(k)) return false; seen.add(k); return true}) }
function isHttpUrl(u=''){ try{ const x=new URL(u); return x.protocol==='http:'||x.protocol==='https:' }catch{ return false } }
function decodeUddg(href){ try{ const u=new URL(href,'https://duckduckgo.com'); const v=u.searchParams.get('uddg'); return v?decodeURIComponent(v):href }catch{ return href } }
async function fetchWithTimeout(url, init={}, ms=12000){ const c=new AbortController(); const id=setTimeout(()=>c.abort(),ms); try{ return await fetch(url,{...init,signal:c.signal}) } finally{ clearTimeout(id) } }

// ---------- Model Manager ----------
const boot = readMemory()
let ACTIVE_MODEL = process.env.OLLAMA_MODEL || boot?.config?.activeModel || 'llama3.1:8b'
let MODEL_CACHE = { list:[], lastSync:0 }

async function syncModels(force=false){
  const now=Date.now()
  if(!force && MODEL_CACHE.list.length && (now-MODEL_CACHE.lastSync<60_000)) return MODEL_CACHE.list
  try{
    const r=await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, { headers: UA_HEADERS }, 10000)
    const data=await r.json().catch(()=>({}))
    const list=(data?.models||[]).map(m=>({ name:m.name, family:m.details?.family||m.details?.families?.[0]||'', size:m.size, modified_at:m.modified_at }))
    MODEL_CACHE={ list, lastSync:now }; return list
  }catch{ return MODEL_CACHE.list }
}
function choosePreferredModel(installed, prefer){
  const names=new Set(installed.map(m=>m.name))
  const candidates=[ prefer, 'llama3.1:8b','qwen2.5:14b-instruct','gemma:7b-instruct','mistral:7b-instruct','llama3.2:latest' ].filter(Boolean)
  for(const c of candidates) if(names.has(c)) return c
  return installed[0]?.name
}
async function pickAvailableModel(){
  const list=await syncModels(true); const picked=choosePreferredModel(list, ACTIVE_MODEL)
  if(picked && picked!==ACTIVE_MODEL){ ACTIVE_MODEL=picked; const mem=readMemory(); mem.config ||= {}; mem.config.activeModel=ACTIVE_MODEL; writeMemory(mem) }
}
pickAvailableModel()

async function ollamaChat({ system, messages, model=ACTIVE_MODEL, temperature=0.2 }){
  const names=new Set((await syncModels()).map(m=>m.name))
  if(!names.has(model)){ await pickAvailableModel(); model=ACTIVE_MODEL }
  const res=await fetchWithTimeout(`${OLLAMA_URL}/api/chat`,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ model, messages:[ system?{role:'system',content:system}:null, ...(messages||[]) ].filter(Boolean), stream:false, options:{ temperature } })
  },60000)
  if(!res.ok){ const txt=await res.text().catch(()=> ''); throw new Error(`Ollama responded ${res.status}. Is "${model}" installed and ${OLLAMA_URL} running? ${txt}`.trim()) }
  const data=await res.json(); return data?.message?.content || data?.reply || ''
}

// ---------- Extraction & Search ----------
function collectMeta($){
  const by = (sel) => ($(sel).attr('content')||'').trim()
  const title = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || '').trim()
  const desc =
    by('meta[property="og:description"]') ||
    by('meta[name="twitter:description"]') ||
    by('meta[name="description"]') || ''
  return { title, desc }
}

async function extractReadable(url){
  const html = await (await fetchWithTimeout(url,{headers:UA_HEADERS},15000)).text()
  const dom = new JSDOM(html, { url })
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  if(article?.textContent?.trim()){
    return {
      title: (article.title || dom.window.document.title || url).trim(),
      textContent: article.textContent.replace(/\s+/g,' ').trim()
    }
  }

  const $ = cheerio.load(html)
  const { title: mTitle, desc } = collectMeta($)
  const paras = $('p').slice(0,6).map((_,el)=>$(el).text()).get().join(' ')
  const text = [desc, paras].filter(Boolean).join(' ').replace(/\s+/g,' ').trim()

  return {
    title: (mTitle || $('title').first().text() || url).trim(),
    textContent: text
  }
}

async function ddgHtmlSearch(q,count=5){
  const url=`https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`
  const html=await (await fetchWithTimeout(url,{headers:UA_HEADERS},12000)).text()
  const $=cheerio.load(html); const items=[]
  $('a.result__a').each((_,a)=>{ const title=$(a).text().trim(); let href=$(a).attr('href'); if(!href) return; href=decodeUddg(href); if(title&&isHttpUrl(href)) items.push({title,url:href}) })
  return items.slice(0,count)
}
async function bingHtmlSearch(q,count=5){
  const url=`https://www.bing.com/search?q=${encodeURIComponent(q)}`
  const html=await (await fetchWithTimeout(url,{headers:UA_HEADERS},12000)).text()
  const $=cheerio.load(html); const items=[]
  $('li.b_algo h2 a').each((_,a)=>{ const title=$(a).text().trim(); const href=$(a).attr('href'); if(title&&isHttpUrl(href)) items.push({title,url:href}) })
  return items.slice(0,count)
}
async function resilientSearch(q,count=5){
  let hits=[]; try{ hits=await ddgHtmlSearch(q,count) }catch{}
  if(hits.length<Math.min(3,count)){ try{ hits=uniqBy([...hits, ...(await bingHtmlSearch(q,count))], x=>x.url) }catch{} }
  return hits.slice(0,count)
}

// Wikipedia
async function wikipediaSummary(query){
  const sUrl=`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1`
  const sRes=await fetchWithTimeout(sUrl,{headers:UA_HEADERS},12000)
  const sData=await sRes.json().catch(()=>null)
  const pageTitle=sData?.query?.search?.[0]?.title; if(!pageTitle) return null
  const sumUrl=`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`
  const res=await fetchWithTimeout(sumUrl,{headers:UA_HEADERS},12000); if(!res.ok) return null
  const data=await res.json().catch(()=>null)
  return data?{ title:data.title, extract:data.extract, url:data.content_urls?.desktop?.page||`https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}` }:null
}

// ---------- Query helpers for /research ----------
function expandAcronyms(q){
  let t=q
  t = t.replace(/\bgnn\b/ig, 'graph neural networks')
  t = t.replace(/\bpose detection\b/ig, 'pose estimation')
  t = t.replace(/\bkeypoint(s)?\b/ig, 'keypoints')
  return t
}
function enrichTopic(q){
  if (/pose\s+(estimation|detection)/i.test(q)) q += ' human pose keypoints skeleton COCO MPII'
  return q
}
async function deriveTopicFromUrl(u){
  try{
    const { title, textContent } = await extractReadable(u)
    const host = new URL(u).hostname.replace(/^www\./,'')
    const topic = (title || textContent.slice(0,120) || u).trim()
    return { topic, host, preview: textContent.slice(0,300) }
  }catch{
    const host = new URL(u).hostname.replace(/^www\./,'')
    return { topic: host, host, preview: '' }
  }
}

// ===================== TTS =====================
app.post('/api/tts', express.json(), async (req, res) => {
  try {
    const { text, voice } = req.body || {}
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text' })
    const wav = await synthesizeWithPiper({ text: text.trim(), voice })
    res.setHeader('Content-Type', 'audio/wav')
    res.send(wav)
  } catch (e) {
    console.error('[TTS]', e)
    res.status(500).json({ error: 'TTS failed' })
  }
})

// ===================== STT (offline via Python Vosk) =====================
const UPLOADS_DIR = path.join(__dirname, 'uploads')
fs.existsSync(UPLOADS_DIR) || fs.mkdirSync(UPLOADS_DIR, { recursive: true })
const upload = multer({ dest: UPLOADS_DIR })

async function webmToWavMono16k(inPath){
  const outPath = path.join(os.tmpdir(), `xenya_${Date.now()}.wav`)
  await new Promise((resolve, reject)=>{
    ffmpeg(inPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .format('wav')
      .output(outPath)
      .on('end', resolve)
      .on('error', reject)
      .run()
  })
  return outPath
}

app.post('/api/stt', upload.single('audio'), async (req, res) => {
  const f = req.file
  if (!f) return res.status(400).json({ error: 'No audio' })
  try {
    const wavPath = await webmToWavMono16k(f.path)
    const pyPath = path.join(__dirname, 'stt_py.py')
    const pyBin = process.env.VENV_PY || path.join(process.cwd(), '..', '.venv', 'bin', 'python')

    const py = spawn(pyBin, [pyPath])
    const chunks = []
    fs.createReadStream(wavPath).pipe(py.stdin)
    py.stdout.on('data', d => chunks.push(d))
    py.on('close', () => {
      let out = {}
      try { out = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch {}
      res.json({ text: (out.text || '').trim() })
      fs.promises.unlink(wavPath).catch(()=>{})
      fs.promises.unlink(f.path).catch(()=>{})
    })
  } catch (e) {
    console.error('[STT]', e)
    res.status(500).json({ error: 'STT failed' })
  }
})
// ================= End STT =====================

// ================= Routes =================

// Model manager / health
app.get('/api/models', async (_req,res)=>{ res.json({ ok:true, active:ACTIVE_MODEL, models: await syncModels() }) })
app.post('/api/models/select', async (req,res)=>{
  const name=String(req.body?.name||'').trim(); if(!name) return res.status(400).json({ok:false,error:'name required'})
  const names=new Set((await syncModels(true)).map(m=>m.name))
  if(!names.has(name)) return res.status(404).json({ok:false,error:`Model "${name}" not installed. Use: ollama pull ${name}`})
  ACTIVE_MODEL=name; const mem=readMemory(); mem.config ||= {}; mem.config.activeModel=ACTIVE_MODEL; writeMemory(mem)
  res.json({ ok:true, active:ACTIVE_MODEL })
})
app.post('/api/models/refresh', async (_req,res)=>{ await syncModels(true); res.json({ ok:true, active:ACTIVE_MODEL, count:MODEL_CACHE.list.length }) })
app.get('/api/health', async (_req,res)=>{ try{ const r=await fetch(`${OLLAMA_URL}/api/tags`); res.json({ ok:r.ok, ollama:r.ok?'up':'down', active:ACTIVE_MODEL }) }catch(e){ res.json({ ok:false, ollama:'down', active:ACTIVE_MODEL, error:String(e) }) } })

// Chat
app.post('/api/chat', async (req,res)=>{ try{
  const { messages=[], model=ACTIVE_MODEL, system } = req.body || {}
  const reply = await ollamaChat({ system, messages, model })
  res.json({ ok:true, reply, model })
}catch(err){ res.status(500).json({ ok:false, error:String(err) }) } })

// Memory
app.post('/api/memory', (req,res)=>{
  const { userId='default', action, key, value } = req.body || {}
  const store = readMemory(); store.users[userId] ||= {}
  if (action==='set' && key){ store.users[userId][key]=value; writeMemory(store); return res.json({ok:true}) }
  if (action==='get'){ if(key) return res.json({ok:true, value:store.users[userId][key]}); return res.json({ok:true, value:store.users[userId]}) }
  if (action==='delete' && key){ delete store.users[userId][key]; writeMemory(store); return res.json({ok:true}) }
  res.status(400).json({ ok:false, error:'Invalid action' })
})

// Search
app.get('/api/search', async (req,res)=>{ try{
  const q=String(req.query.q||'').slice(0,200); if(!q) return res.status(400).json({ok:false,error:'q required'})
  const n=Math.min(10, Math.max(1, Number(req.query.n||5))); const hits=await resilientSearch(q,n)
  res.json({ ok:true, hits })
}catch(err){ res.status(500).json({ ok:false, error:String(err) }) } })

// Summary
app.get('/api/summary', async (req,res)=>{ try{
  const url=String(req.query.url||''); const model=String(req.query.model||'')||ACTIVE_MODEL
  if(!isHttpUrl(url)) return res.status(400).json({ ok:false, error:'Valid http(s) url required' })
  const { title, textContent } = await extractReadable(url)
  const body = (textContent && textContent.length>0) ? textContent : 'No article body detected. Use metadata (title/description) to summarize at a high level.'
  const prompt = `Summarize with concise bullet points and a one-line takeaway.
TITLE: ${title}
SOURCE: ${url}
TEXT: ${trimText(body, 10000)}`
  const summary = await ollamaChat({ system:'You are Xenya, a concise analyst. Output tight bullets and a short takeaway.', messages:[{role:'user',content:prompt}], model })
  res.json({ ok:true, title, url, summary, model })
}catch(err){ res.status(500).json({ ok:false, error:String(err) }) } })

// RSS
const DEFAULT_FEEDS=['http://feeds.bbci.co.uk/news/rss.xml','https://feeds.reuters.com/reuters/topNews']
app.get('/api/rss', async (req,res)=>{ try{
  const list=(req.query.feeds?String(req.query.feeds).split(','):DEFAULT_FEEDS).slice(0,8)
  const parser=new Parser({ headers: UA_HEADERS })
  const results=await Promise.all(list.map(async feedUrl=>{ try{
    const feed=await parser.parseURL(feedUrl)
    const items=(feed.items||[]).slice(0,10).map(i=>({title:i.title,link:i.link,pubDate:i.pubDate||i.isoDate}))
    return { feed: feed.title||feedUrl, items }
  }catch{ return { feed: feedUrl, items: [] } }}))
  res.json({ ok:true, feeds:results })
}catch(err){ res.status(500).json({ ok:false, error:String(err) }) } })

// Research
app.get('/api/research', async (req,res)=>{ try{
  let q=String(req.query.q||'').slice(0,400); const model=String(req.query.model||'')||ACTIVE_MODEL
  if(!q) return res.status(400).json({ ok:false, error:'q required' })

  let fromUrl = null
  if (isHttpUrl(q)) {
    fromUrl = await deriveTopicFromUrl(q)
    q = fromUrl.topic
  }

  q = enrichTopic(expandAcronyms(q))

  const queries = uniqBy([
    q,
    q.replace(/\s+/g,' ').trim(),
    `${q} review overview`,
    /pose\s+(estimation|detection)/i.test(q) ? `${q} keypoints skeleton` : null
  ].filter(Boolean), x=>x)

  let hits=[]
  for(const qq of queries){
    const h=await resilientSearch(qq,5)
    hits = uniqBy([...hits, ...h], x=>x.url)
    if(hits.length>=7) break
  }
  hits = hits.slice(0,7)

  const wiki = await wikipediaSummary(q)

  const snippets = await Promise.all(hits.map(async h=>{ try{
    const html=await (await fetchWithTimeout(h.url,{headers:UA_HEADERS},10000)).text()
    const $=cheerio.load(html)
    const meta=$('meta[name="description"]').attr('content') || $('p').first().text().trim()
    return { ...h, snippet: trimText(meta, 320) }
  }catch{ return { ...h, snippet:'' } }}))

  const urlSource = fromUrl ? `S0: Original link — ${fromUrl.topic} (source: https://${fromUrl.host})` : null
  const context = [
    urlSource,
    wiki ? `WIKIPEDIA: ${wiki.title} — ${wiki.extract} (source: ${wiki.url})` : null,
    ...snippets.map((s,i)=>`S${i+1}: ${s.title} — ${s.snippet} (source: ${s.url})`)
  ].filter(Boolean).join('\n\n')

  const prompt = `Research question: ${q}

Use the sources below to produce a concise, well-structured answer.
- Be neutral and specific.
- If facts conflict, note it briefly.
- End with a short list of citations [S1], [S2], ... mapping to the sources.

SOURCES:
${trimText(context, 12000)}`
  const answer = await ollamaChat({
    system:'You are Xenya, a pragmatic research assistant. Cite as [S1], [S2], ... and list URLs at the end.',
    messages:[{role:'user',content:prompt}],
    temperature:0.1,
    model
  })

  const sourceList = [
    fromUrl ? { label:'S0', title: fromUrl.topic, url: q } : null,
    wiki ? { label:'WIKI', title: wiki.title, url: wiki.url } : null,
    ...snippets.map((s,i)=>({ label:`S${i+1}`, title:s.title, url:s.url }))
  ].filter(Boolean)

  res.json({ ok:true, answer, sources: sourceList, model })
}catch(err){ res.status(500).json({ ok:false, error:String(err) }) } })

// Root
app.get('/', (_req,res)=>{ res.type('text/plain').send(`Xenya server up
Active model: ${ACTIVE_MODEL}
Endpoints:
  /api/models, /api/models/select, /api/models/refresh, /api/health
  /api/chat, /api/memory
  /api/search, /api/summary?url=&model=, /api/rss, /api/research?q=&model=
  /api/tts (POST JSON {text, voice})
  /api/stt (POST multipart form-data: audio=<webm>)`) })

// --- Listen!
app.listen(PORT, ()=>{ 
  console.log(`✅ Xenya server listening on http://localhost:${PORT}`) 
  console.log(`↪  Ollama at ${OLLAMA_URL} (active: ${ACTIVE_MODEL})`) 
})
