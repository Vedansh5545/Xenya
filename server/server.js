// server.js — Xenya backend (Jobs + Profile + Chat + Research + TTS/STT)
// ESM required ("type":"module" in package.json)

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import * as cheerio from 'cheerio'
import Parser from 'rss-parser'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

// STT deps
import multer from 'multer'
import os from 'os'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { spawn } from 'node:child_process'

// TTS
import { synthesizeWithPiper } from './tts.js'

// Optional: Outlook Calendar router (comment these two lines if you don't use it)
import { calendarRouter } from './calendar.js'

ffmpeg.setFfmpegPath(ffmpegStatic)

// --- resolve __dirname in ESM and load .env next to this file ---
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '.env') })

/* ------------------------------------------------------------------ */
/* App / Config                                                       */
/* ------------------------------------------------------------------ */
const app = express()
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }))
app.use(express.json({ limit: '1mb' }))

// Calendar (if available)
try { app.use(calendarRouter()) } catch { console.log('[calendar] router not loaded (optional)') }

const PORT = process.env.PORT || 3000
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const UA_HEADERS = { 'User-Agent': 'Mozilla/5.0 (XenyaBot; +local)' }

/* ------------------------------------------------------------------ */
/* Storage helpers (profile + tracker)                                */
/* ------------------------------------------------------------------ */
const PROFILE_PATH = path.join(__dirname, 'profile.json')
const TRACKER_PATH = path.join(__dirname, 'tracker.json')

const DEFAULT_PROFILE = {
  identity: {
    full_name: "Vedansh",
    emails: { primary: "", alt: "" },
    phone: "",
    links: { linkedin: "", github: "", portfolio: "" }
  },
  location: {
    current: "",
    preferred: ["San Francisco Bay Area, CA", "Seattle, WA", "New York, NY", "Remote"],
    remote_ok: true,
    relocate: "yes"
  },
  seniority: "junior",
  work_auth: {
    status: "F-1",
    cpt: { eligible: true, type: "full-time", window: { start: "", end: "" } },
    opt: { eligible: true, window: { start: "", end: "" }, stem_eligible: true },
    sponsorship_now: "no",
    sponsorship_future: "yes",
    e_verify: "preferred"
  },
  education: [],
  preferences: {
    roles: ["AI/ML Engineer", "Machine Learning Engineer", "Data Engineer"],
    industries: ["Tech", "AI/ML", "Robotics"],
    locations: ["Remote", "San Francisco Bay Area, CA", "Seattle, WA", "New York, NY"],
    salary: { min: "", max: "", currency: "USD" },
    start_date: "",
    remote: true,
    onsite: true
  },
  skills: [
    "python","pytorch","tensorflow","computer vision","opencv","pose estimation",
    "transformers","gnn","scikit-learn","pandas","numpy","sql",
    "docker","kubernetes","aws","gcp","linux","git","react","node","express","ros"
  ],
  projects: [
    { name:"ASL Gesture Recognition", tags:["computer-vision","cnn","tensorflow","opencv"] },
    { name:"Human Pose Estimation", tags:["pose-estimation","keypoints","pytorch","coco","gnn"] },
    { name:"Robotics Control with ROS", tags:["ros","robotics","slam","docker"] }
  ],
  qa_bank:{},
  meta:{ last_updated: new Date().toISOString() }
}

const readFileJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p,'utf8')) } catch { return fallback } }
const writeFileJson = (p, obj) => { fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); return obj }

const readProfile  = () => readFileJson(PROFILE_PATH, DEFAULT_PROFILE)
const writeProfile = (profile) => {
  profile.meta = { ...(profile.meta||{}), last_updated: new Date().toISOString() }
  return writeFileJson(PROFILE_PATH, profile)
}
const readTracker  = () => readFileJson(TRACKER_PATH, { jobs: [] })
const writeTracker = (db) => writeFileJson(TRACKER_PATH, db)

/* ------------------------------------------------------------------ */
/* Utils                                                              */
/* ------------------------------------------------------------------ */
const trimText = (s, max=8000) => (s ? (s.length>max ? s.slice(0,max)+'\n…[truncated]' : s) : '')
const uniqBy = (arr, keyFn) => { const seen=new Set(); return arr.filter(x=>{const k=keyFn(x); if(seen.has(k)) return false; seen.add(k); return true}) }
const isHttpUrl = (u='') => { try{ const x=new URL(u); return x.protocol==='http:'||x.protocol==='https:' }catch{ return false } }
const decodeUddg = (href)=>{ try{ const u=new URL(href,'https://duckduckgo.com'); const v=u.searchParams.get('uddg'); return v?decodeURIComponent(v):href }catch{ return href } }
const fetchWithTimeout = async (url, init={}, ms=12000)=>{ const c=new AbortController(); const id=setTimeout(()=>c.abort(),ms); try{ return await fetch(url,{...init,signal:c.signal}) } finally{ clearTimeout(id) } }

/* ------------------------------------------------------------------ */
/* Ollama model manager + chat                                        */
/* ------------------------------------------------------------------ */
let ACTIVE_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b'
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
const choosePreferredModel=(installed, prefer)=>{
  const names=new Set(installed.map(m=>m.name))
  const candidates=[ prefer, 'llama3.1:8b','qwen2.5:14b-instruct','gemma:7b-instruct','mistral:7b-instruct','llama3.2:latest' ].filter(Boolean)
  for(const c of candidates) if(names.has(c)) return c
  return installed[0]?.name
}
async function pickAvailableModel(){
  const list=await syncModels(true); const picked=choosePreferredModel(list, ACTIVE_MODEL)
  if(picked && picked!==ACTIVE_MODEL){ ACTIVE_MODEL=picked }
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

/* ------------------------------------------------------------------ */
/* Extraction + Search + Wikipedia                                    */
/* ------------------------------------------------------------------ */
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
  $('a.result__a').each((_,a)=>{ const title=$(a).text().trim(); let href=$(a).attr('href'); if(!href) return; href=decodeUddg(href); try{ new URL(href) }catch{ return } items.push({title,url:href}) })
  return items.slice(0,count)
}
async function bingHtmlSearch(q,count=5){
  const url=`https://www.bing.com/search?q=${encodeURIComponent(q)}`
  const html=await (await fetchWithTimeout(url,{headers:UA_HEADERS},12000)).text()
  const $=cheerio.load(html); const items=[]
  $('li.b_algo h2 a').each((_,a)=>{ const title=$(a).text().trim(); const href=$(a).attr('href'); try{ new URL(href) }catch{ return } items.push({title,url:href}) })
  return items.slice(0,count)
}
async function resilientSearch(q,count=5){
  let hits=[]; try{ hits=await ddgHtmlSearch(q,count) }catch{}
  if(hits.length<Math.min(3,count)){ try{ hits=uniqBy([...hits, ...(await bingHtmlSearch(q,count))], x=>x.url) }catch{} }
  return hits.slice(0,count)
}

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

/* ------------------------------------------------------------------ */
/* TTS                                                                */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* STT (offline via Python Vosk)                                      */
/* ------------------------------------------------------------------ */
const UPLOADS_DIR = path.join(__dirname, 'uploads')
fs.existsSync(UPLOADS_DIR) || fs.mkdirSync(UPLOADS_DIR, { recursive: true })
const upload = multer({ dest: UPLOADS_DIR })

async function webmToWavMono16k(inPath){
  const outPath = path.join(os.tmpdir(), `xenya_${Date.now()}.wav`)
  await new Promise((resolve, reject)=>{
    ffmpeg(inPath).audioChannels(1).audioFrequency(16000).format('wav').output(outPath)
      .on('end', resolve).on('error', reject).run()
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

/* ------------------------------------------------------------------ */
/* Models / Chat / Health                                             */
/* ------------------------------------------------------------------ */
app.get('/api/models', async (_req,res)=>{ res.json({ ok:true, active:ACTIVE_MODEL, models: await syncModels() }) })
app.post('/api/models/select', async (req,res)=>{
  const name=String(req.body?.name||'').trim(); if(!name) return res.status(400).json({ok:false,error:'name required'})
  const names=new Set((await syncModels(true)).map(m=>m.name))
  if(!names.has(name)) return res.status(404).json({ok:false,error:`Model "${name}" not installed. Use: ollama pull ${name}`})
  ACTIVE_MODEL=name; res.json({ ok:true, active:ACTIVE_MODEL })
})
app.post('/api/models/refresh', async (_req,res)=>{ await syncModels(true); res.json({ ok:true, active:ACTIVE_MODEL, count:MODEL_CACHE.list.length }) })
app.get('/api/health', async (_req,res)=>{ try{ const r=await fetch(`${OLLAMA_URL}/api/tags`); res.json({ ok:r.ok, ollama:r.ok?'up':'down', active:ACTIVE_MODEL }) }catch(e){ res.json({ ok:false, ollama:'down', active:ACTIVE_MODEL, error:String(e) }) } })

app.post('/api/chat', async (req,res)=>{ try{
  const { messages=[], model=ACTIVE_MODEL, system } = req.body || {}
  const reply = await ollamaChat({ system, messages, model })
  res.json({ ok:true, reply, model })
}catch(err){ res.status(500).json({ ok:false, error:String(err) }) } })

/* ------------------------------------------------------------------ */
/* Search / Summary / RSS / Research                                  */
/* ------------------------------------------------------------------ */
app.get('/api/search', async (req,res)=>{ try{
  const q=String(req.query.q||'').slice(0,200); if(!q) return res.status(400).json({ok:false,error:'q required'})
  const n=Math.min(10, Math.max(1, Number(req.query.n||5))); const hits=await resilientSearch(q,n)
  res.json({ ok:true, hits })
}catch(err){ res.status(500).json({ ok:false, error:String(err) }) } })

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

const DEFAULT_FEEDS=['http://feeds.bbci.co.uk/news/rss.xml','https://feeds.reuters.com/reuters/topNews']
app.get('/api/rss', async (_req,res)=>{ try{
  const list=DEFAULT_FEEDS.slice(0,8)
  const parser=new Parser({ headers: UA_HEADERS })
  const results=await Promise.all(list.map(async feedUrl=>{ try{
    const feed=await parser.parseURL(feedUrl)
    const items=(feed.items||[]).slice(0,10).map(i=>({title:i.title,link:i.link,pubDate:i.pubDate||i.isoDate}))
    return { feed: feed.title||feedUrl, items }
  }catch{ return { feed: feedUrl, items: [] } }}))
  res.json({ ok:true, feeds:results })
}catch(err){ res.status(500).json({ ok:false, error:String(err) }) } })

function expandAcronyms(q){ let t=q; t=t.replace(/\bgnn\b/ig,'graph neural networks'); t=t.replace(/\bpose detection\b/ig,'pose estimation'); t=t.replace(/\bkeypoint(s)?\b/ig,'keypoints'); return t }
function enrichTopic(q){ if(/pose\s+(estimation|detection)/i.test(q)) q+=' human pose keypoints skeleton COCO MPII'; return q }
async function deriveTopicFromUrl(u){
  try{ const { title, textContent } = await extractReadable(u); const host=new URL(u).hostname.replace(/^www\./,''); const topic=(title||textContent.slice(0,120)||u).trim(); return { topic, host, preview: textContent.slice(0,300) } }
  catch{ const host=new URL(u).hostname.replace(/^www\./,''); return { topic: host, host, preview:'' } }
}
app.get('/api/research', async (req,res)=>{ try{
  let q=String(req.query.q||'').slice(0,400); const model=String(req.query.model||'')||ACTIVE_MODEL
  if(!q) return res.status(400).json({ ok:false, error:'q required' })

  let fromUrl = null
  if (isHttpUrl(q)) { fromUrl = await deriveTopicFromUrl(q); q = fromUrl.topic }
  q = enrichTopic(expandAcronyms(q))

  const queries = uniqBy([ q, q.replace(/\s+/g,' ').trim(), `${q} review overview`, /pose\s+(estimation|detection)/i.test(q) ? `${q} keypoints skeleton` : null ].filter(Boolean), x=>x)
  let hits=[]
  for(const qq of queries){ const h=await resilientSearch(qq,5); hits = uniqBy([...hits, ...h], x=>x.url); if(hits.length>=7) break }
  hits = hits.slice(0,7)

  const wiki = await wikipediaSummary(q)
  const snippets = await Promise.all(hits.map(async h=>{ try{
    const html=await (await fetchWithTimeout(h.url,{headers:UA_HEADERS},10000)).text()
    const $=cheerio.load(html); const meta=$('meta[name="description"]').attr('content') || $('p').first().text().trim()
    return { ...h, snippet: trimText(meta, 320) }
  }catch{ return { ...h, snippet:'' } }}))

  const urlSource = fromUrl ? `S0: Original link — ${fromUrl.topic} (source: https://${fromUrl.host})` : null
  const context = [ urlSource, wiki ? `WIKIPEDIA: ${wiki.title} — ${wiki.extract} (source: ${wiki.url})` : null,
    ...snippets.map((s,i)=>`S${i+1}: ${s.title} — ${s.snippet} (source: ${s.url})`) ].filter(Boolean).join('\n\n')

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

/* ------------------------------------------------------------------ */
/* Profile API                                                        */
/* ------------------------------------------------------------------ */

/* ---------- deep merge helper ---------- */
function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) {
    // prefer patch if provided, else base
    return (patch !== undefined) ? patch : base;
  }
  if (typeof base === 'object' && base && typeof patch === 'object' && patch) {
    const out = { ...base };
    for (const k of Object.keys(patch)) {
      out[k] = deepMerge(base[k], patch[k]);
    }
    return out;
  }
  return (patch !== undefined) ? patch : base;
}

/* ---------- Profile API (normalized) ---------- */
app.get('/api/profile', (_req, res) => {
  const raw = readProfile();              // might be partial/older shape
  const normalized = deepMerge(DEFAULT_PROFILE, raw || {});
  // write back the normalized version so next reads are consistent
  writeProfile(normalized);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, profile: normalized });
});

app.post('/api/profile', (req, res) => {
  const body = req.body || {};
  const current = readProfile();
  let target;

  if (body.profile && typeof body.profile === 'object') {
    target = deepMerge(current, body.profile);
  } else if (body.patch && typeof body.patch === 'object') {
    target = deepMerge(current, body.patch);
  } else if (body.path && 'value' in body) {
    // path set (dot notation)
    const seg = String(body.path).split('.');
    const draft = JSON.parse(JSON.stringify(current));
    let obj = draft;
    for (let i = 0; i < seg.length - 1; i++) {
      const k = seg[i];
      obj[k] = (typeof obj[k] === 'object' && obj[k] !== null) ? obj[k] : {};
      obj = obj[k];
    }
    obj[seg.at(-1)] = body.value;
    target = draft;
  } else {
    return res.status(400).json({ ok: false, error: 'Provide {profile} or {patch} or {path,value}' });
  }

  // ensure final shape is normalized against defaults
  const normalized = deepMerge(DEFAULT_PROFILE, target);
  const saved = writeProfile(normalized);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, profile: saved });
});

/* ------------------------------------------------------------------ */
/* Jobs: parse / score / tracker                                      */
/* ------------------------------------------------------------------ */
const W = (s='') => String(s).toLowerCase().replace(/[^a-z0-9+.#/ ]+/g,' ').split(/\s+/).filter(Boolean)
const uniq = (a) => Array.from(new Set(a))
const intersect = (a,b) => { const S=new Set(b); return a.filter(x=>S.has(x)) }

const SKILLS_DICT = [
  "python","pytorch","tensorflow","keras","sklearn","scikit-learn","opencv","computer vision",
  "pose estimation","keypoints","transformers","bert","llm","sql","spark","airflow",
  "docker","kubernetes","aws","gcp","azure","linux","git","react","node","express","java","cpp","c++","go","rust",
  "mlops","pandas","numpy","pytorch lightning","fastapi","flask","ros"
]

function parseJDText(jd_text=''){
  const t = jd_text || ''
  const title = (t.match(/\b(?:Senior|Staff|Principal|Lead|Junior|Intern|Co-?op)?\s*(?:AI|ML|Data|Software|Machine Learning)\s*(?:Engineer|Scientist|Developer|Intern)\b[^\n]*/i) || [])[0] || ""
  const location = (t.match(/\b(Remote|Hybrid|On[ -]?site|[A-Z][a-zA-Z]+,\s*[A-Z]{2})\b/) || [])[0] || ""
  const visaQuote = (t.match(/(US citizen|citizenship|green card|no (?:visa )?sponsorship|unable to sponsor|H-?1B|OPT|CPT|E-?Verify)[^.]{0,120}/i) || [])[0] || ""
  const visa_status = /no\s+visa\s*sponsorship|unable\s+to\s+sponsor|us\s*citizen|citizenship|green\s*card/i.test(visaQuote)
    ? "unfriendly"
    : /(H-?1B|OPT|CPT|E-?Verify|sponsor)/i.test(visaQuote)
    ? "friendly"
    : "unclear"

  const lower = t.toLowerCase()
  const skills_must = uniq(SKILLS_DICT.filter(k => lower.includes(k)))
  const keywords = uniq([...W(title), ...skills_must])

  return {
    title: title.trim(),
    level: /intern|co-?op/i.test(title) ? "intern" : /senior|staff|principal|lead/i.test(title) ? "senior" : "junior",
    location,
    visa: visaQuote.trim(),
    visa_status,
    skills_must,
    skills_nice: [],
    responsibilities: [],
    keywords
  }
}

app.post('/api/jobs/parse', async (req,res)=>{
  const { jd_text='', url } = req.body || {}
  let text = jd_text

  if (!text && url && isHttpUrl(url)) {
    try { const { textContent } = await extractReadable(url); text = textContent || '' } catch {}
  }
  if (!text) return res.status(400).json({ ok:false, error:'Provide jd_text or url' })

  const jd_struct = parseJDText(text)
  res.json({ ok:true, jd_struct, keywords: jd_struct.keywords, must_haves: jd_struct.skills_must, nice_to_haves: jd_struct.skills_nice })
})

function scoreJob(jd, profile){
  const prof = profile || DEFAULT_PROFILE

  const profSkills = uniq(W((prof.skills || []).join(' ')))
  const jdSkills   = uniq(W((jd.skills_must || []).join(' ')))
  const overlap    = intersect(jdSkills, profSkills).length
  const skill_match = jdSkills.length ? overlap / jdSkills.length : 0.5

  const roles = (prof.preferences?.roles || []).map(r => r.toLowerCase())
  const title = String(jd.title || '').toLowerCase()
  const role_alignment = roles.some(r => title.includes(r.split(' ')[0])) ? 1 : 0.5

  const p = String(prof.seniority || 'junior')
  const j = String(jd.level || 'junior')
  const seniority_match = (p === j || (p==='junior' && j!=='senior')) ? 1 : (p==='senior' && j==='junior' ? 0.4 : 0.7)

  const loc = String(jd.location || '').toLowerCase()
  const wants = (prof.preferences?.locations || []).map(x=>x.toLowerCase())
  const location_ok = (!loc || /remote/.test(loc) || wants.some(w=>loc.includes(w.split(',')[0].toLowerCase()))) ? 1 : 0.6

  const visa_flag = jd.visa_status === 'friendly' ? 1 : jd.visa_status === 'unfriendly' ? 0 : 0.5

  const jdKeys = uniq([...(jd.keywords||[]), ...(jd.skills_must||[])].map(s=>String(s).toLowerCase()))
  const projectTags = uniq((prof.projects||[]).flatMap(p=>p.tags||[]).map(s=>String(s).toLowerCase()))
  const project_alignment = jdKeys.length ? intersect(jdKeys, projectTags).length / Math.min(jdKeys.length, 12) : 0.5

  const company_interest = 0.5

  const score =
    0.35*skill_match + 0.20*role_alignment + 0.10*seniority_match +
    0.10*location_ok + 0.10*visa_flag + 0.10*project_alignment + 0.05*company_interest

  return {
    score: Math.max(0, Math.min(1, score)),
    breakdown: { skill_match, role_alignment, seniority_match, location_ok, visa_flag, project_alignment, company_interest }
  }
}

app.post('/api/jobs/score', (req,res)=>{
  const { jd_struct } = req.body || {}
  if (!jd_struct) return res.status(400).json({ ok:false, error:'jd_struct required' })
  const out = scoreJob(jd_struct, readProfile())
  res.json({ ok:true, ...out })
})

app.post('/api/tracker', (req,res)=>{
  const job = req.body || {}
  const db = readTracker()
  const id = job.id || ('job_' + (Date.now().toString(36)) )
  const saved = { ...job, id, created_at: new Date().toISOString() }
  db.jobs.unshift(saved)
  writeTracker(db)
  res.json({ ok:true, job:saved })
})

/* ------------------------------------------------------------------ */
/* Root                                                               */
/* ------------------------------------------------------------------ */
app.get('/', (_req,res)=>{ res.type('text/plain').send(`Xenya server up
Active model: ${ACTIVE_MODEL}
Endpoints:
  /api/models, /api/models/select, /api/models/refresh, /api/health
  /api/chat
  /api/profile (GET/POST)
  /api/jobs/parse, /api/jobs/score, /api/tracker
  /api/search, /api/summary?url=&model=, /api/rss, /api/research?q=&model=
  /api/tts (POST JSON {text, voice})
  /api/stt (POST multipart: audio=<webm>)`) })

/* ------------------------------------------------------------------ */
/* Listen                                                             */
/* ------------------------------------------------------------------ */
app.listen(PORT, ()=>{
  console.log(`✅ Xenya server listening on http://localhost:${PORT}`)
  console.log(`↪  Ollama at ${OLLAMA_URL} (active: ${ACTIVE_MODEL})`)
})