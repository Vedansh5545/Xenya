// calendar.js (ESM)
// Outlook OAuth (PKCE) + Microsoft Graph calendar routes for Xenya
//
// ENV you can set:
//   BASE_URL=http://localhost:3000              // backend origin (used for redirect URI)
//   CLIENT_ORIGIN=http://localhost:5173          // your React dev server (for CORS)
//   MS_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
//   MS_CLIENT_SECRET=...                          // optional (confidential client); PKCE also used
//   MS_TENANT_ID=common
//   MS_REDIRECT_PATH=/oauth/callback
//   DEFAULT_TZ=America/Chicago
//
// Exposes:
//   GET    /calendar/status
//   GET    /calendar/upcoming?from=&to=&tz=
//   POST   /calendar/upsert
//   DELETE /calendar/:eventId
//   GET    /calendar/connect
//   GET    /oauth/callback
//   POST   /auth/logout

import { Router } from 'express'
import session from 'express-session'
import crypto from 'node:crypto'
import { nanoid } from 'nanoid'

// ---------- Config ----------
const AUTH_HOST     = 'https://login.microsoftonline.com'
const TENANT_ID     = process.env.MS_TENANT_ID || 'common'
const CLIENT_ID     = process.env.MS_CLIENT_ID || ''
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET || ''
const BASE_URL      = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
const REDIRECT_PATH = process.env.MS_REDIRECT_PATH || '/oauth/callback'
const REDIRECT      = `${BASE_URL}${REDIRECT_PATH}`
const DEFAULT_TZ    = process.env.DEFAULT_TZ || 'America/Chicago'
const CLIENT_ORIGIN = (process.env.CLIENT_ORIGIN || '').replace(/\/+$/, '')

const EXTRA_SCOPES = (process.env.MS_EXTRA_SCOPES || '')
  .split(/[,\s]+/).filter(Boolean)

const SCOPES = [
  'openid','profile','email','offline_access','Calendars.ReadWrite',
  ...EXTRA_SCOPES
].join(' ')

const GRAPH_BASE  = 'https://graph.microsoft.com/v1.0'

// ---------- Tiny utils ----------
const b64url = (buf) => buf.toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
const nowSec = () => Math.floor(Date.now()/1000)
const issuer = `${AUTH_HOST}/${TENANT_ID}/oauth2/v2.0`

function parseHost(u){ try { return new URL(u).host } catch { return '' } }
const isCrossSite = CLIENT_ORIGIN && (parseHost(CLIENT_ORIGIN) !== parseHost(BASE_URL))
const isHttps = BASE_URL.startsWith('https://')

if (isCrossSite && !isHttps) {
  console.warn('[calendar] Cross-origin dev detected without HTTPS.')
  console.warn('           Cookies with SameSite=None typically require Secure over HTTPS.')
  console.warn('           Prefer a dev proxy (same-origin) or open the BACKEND origin directly from the frontend.')
}

// ---------- CORS (scoped to this router) ----------
function tinyCors(req, res, next){
  if (CLIENT_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', CLIENT_ORIGIN)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
  }
  next()
}

// ---------- PKCE helpers ----------
function pkcePair(){
  const verifier  = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}
function authUrl({ state, codeChallenge }){
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT,
    response_mode: 'query',
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state
  })
  return `${issuer}/authorize?${p.toString()}`
}
async function tokenRequest(body){
  const params = new URLSearchParams({
    ...body,
    client_id: CLIENT_ID,
    ...(CLIENT_SECRET ? { client_secret: CLIENT_SECRET } : {})
  })
  const res = await fetch(`${issuer}/token`, {
    method:'POST',
    headers:{ 'content-type':'application/x-www-form-urlencoded' },
    body: params
  })
  if(!res.ok) throw new Error(`Token ${res.status}: ${await res.text()}`)
  const raw = await res.json()
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token || null,
    token_type: raw.token_type || 'Bearer',
    scope: raw.scope,
    expires_at: nowSec() + (raw.expires_in || 3600) - 60
  }
}
async function exchangeCode(code, verifier){
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    code_verifier: verifier
  })
}
async function refreshTokens(refreshToken){
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })
}
function tokenExpired(tokens){
  return !tokens?.access_token || !tokens?.expires_at || nowSec() >= tokens.expires_at
}

// ---------- Graph helpers ----------
async function graphFetch(token, url, opt={}){
  const res = await fetch(url, {
    ...opt,
    headers: { Authorization:`Bearer ${token}`, ...(opt.headers||{}), ...(opt.body?{'content-type':'application/json'}:{}) }
  })
  if(!res.ok){
    const txt = await res.text().catch(()=> '')
    const err = new Error(`Graph ${res.status}: ${txt}`)
    err.status = res.status
    throw err
  }
  return res
}
async function listCalendarView(token, startISO, endISO, tz=DEFAULT_TZ){
  const q = new URLSearchParams({
    startDateTime:startISO,
    endDateTime:endISO,
    '$orderby':'start/dateTime',
    '$top':'200',
    '$select':'id,subject,bodyPreview,start,end,location,webLink'
  })
  const res = await graphFetch(
    token,
    `${GRAPH_BASE}/me/calendarView?${q.toString()}`,
    { headers:{ Prefer:`outlook.timezone="${tz}"` } }
  )
  return res.json()
}
async function createEvent(token, ev){
  const res = await graphFetch(token, `${GRAPH_BASE}/me/events`, { method:'POST', body: JSON.stringify(ev) })
  return res.json()
}
async function deleteEvent(token, id){
  await graphFetch(token, `${GRAPH_BASE}/me/events/${encodeURIComponent(id)}`, { method:'DELETE' })
}
async function getMe(token){
  const res = await graphFetch(token, `${GRAPH_BASE}/me`)
  return res.json()
}

// ---------- Router factory ----------
export function calendarRouter(){
  const router = Router()

  // scoped CORS (so we can use credentials from a different origin)
  router.use(tinyCors)

  // If you already set session() on the app, you may remove this block.
  router.use(session({
    secret: process.env.SESSION_SECRET || 'xenya-dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: isCrossSite ? 'none' : 'lax',
      secure:   isCrossSite ? isHttps : false,
      maxAge: 1000*60*60*24*7,
    }
  }))

  async function ensureToken(req){
    if(!req.session.tokens) {
      const e = new Error('not_connected'); e.code = 401; throw e
    }
    if(tokenExpired(req.session.tokens)){
      if(!req.session.tokens.refresh_token){
        const e = new Error('expired_no_refresh'); e.code = 401; throw e
      }
      req.session.tokens = await refreshTokens(req.session.tokens.refresh_token)
    }
    return req.session.tokens.access_token
  }

  // --- Status
  router.get('/calendar/status', async (req, res) => {
    try {
      if(!req.session.tokens) return res.json({ connected:false })
      const token = await ensureToken(req)
      let me = null; try { me = await getMe(token) } catch {}
      res.json({ connected:true, me })
    } catch {
      res.json({ connected:false })
    }
  })

  // --- List events
  router.get('/calendar/upcoming', async (req, res) => {
    const { from, to, tz } = req.query
    if(!from || !to) return res.status(400).json({ error:'Missing from/to ISO params' })
    try{
      const token = await ensureToken(req)
      const data = await listCalendarView(token, from, to, tz || DEFAULT_TZ)
      res.json(data.value ?? data)
    }catch(e){
      const code = e.code || e.status || 500
      if(code===401||code===403) return res.status(code).json({ error:'unauthorized' })
      res.status(code).json({ error: e.message || 'graph_error' })
    }
  })

  // --- Create/Upsert event
  router.post('/calendar/upsert', async (req, res) => {
    const { task } = req.body || {}
    if(!task || !task.title || !task.start || !task.end){
      return res.status(400).json({ error:'task.title, task.start, task.end required' })
    }
    try{
      const token = await ensureToken(req)
      const tz = task.tz || DEFAULT_TZ
      const ev = {
        subject: task.title,
        body: { contentType:'Text', content: task.notes || '' },
        start: { dateTime: new Date(task.start).toISOString(), timeZone: tz },
        end:   { dateTime: new Date(task.end).toISOString(),   timeZone: tz },
        location: task.location ? { displayName: task.location } : undefined
      }
      const created = await createEvent(token, ev)
      res.json({ eventId: created.id, webLink: created.webLink })
    }catch(e){
      const code = e.code || e.status || 500
      if(code===401||code===403) return res.status(code).json({ error:'unauthorized' })
      res.status(code).json({ error:e.message || 'graph_error' })
    }
  })

  // --- Delete Outlook event
  router.delete('/calendar/:eventId', async (req, res) => {
    const { eventId } = req.params
    if(!eventId) return res.status(400).json({ error:'eventId required' })
    try{
      const token = await ensureToken(req)
      await deleteEvent(token, eventId)
      res.json({ ok:true })
    }catch(e){
      const code = e.code || e.status || 500
      if(code===401||code===403) return res.status(code).json({ error:'unauthorized' })
      res.status(code).json({ error:e.message || 'graph_error' })
    }
  })

  // --- Start OAuth (popup) — always points to BACKEND origin
  router.get('/calendar/connect', (req, res) => {
    if(!CLIENT_ID) return res.status(500).send('Set MS_CLIENT_ID in env')
    const { verifier, challenge } = pkcePair()
    const state = nanoid()
    req.session.pkce = { verifier, state }
    // Helpful log for debugging
    console.log(`[calendar] connect → redirect_uri ${REDIRECT}`)
    res.redirect(authUrl({ state, codeChallenge: challenge }))
  })

  // --- Finish OAuth (served on BACKEND origin)
  router.get(REDIRECT_PATH, async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query
      if (error) return res.status(400).send(`OAuth error: ${error} ${error_description||''}`)

      if(!code || !state) return res.status(400).send('Missing code/state')
      const pkce = req.session.pkce
      if(!pkce || pkce.state !== state) return res.status(400).send('Bad state')

      const tokens = await exchangeCode(code, pkce.verifier)
      req.session.tokens = tokens
      delete req.session.pkce

      res.type('html').send(`
        <p>Connected to Outlook. You can close this window.</p>
        <script>try{ window.opener && window.opener.postMessage('outlook:connected','*') }catch(e){}</script>
      `)
    } catch (e) {
      console.error('[oauth callback]', e)
      res.status(500).send('OAuth error')
    }
  })

  // --- Optional logout to clear session
  router.post('/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok:true }))
  })

  return router
}
