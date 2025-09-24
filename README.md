# Xenya — The Digital Attaché (Local, Voice-Ready)

Xenya is a **local, privacy-first assistant** that runs against your **Ollama** LLMs, can **summarize URLs, research topics with light web scraping**, does **text-to-speech (TTS)** and **speech-to-text (STT)**, and now includes a **Calendar** with **local events** (stored on-device) plus optional **Outlook** integration via Microsoft Graph (OAuth PKCE).

* **Backend:** Node.js + Express (Ollama relay; summaries/research; TTS via Piper; STT via Vosk in Python; Outlook Calendar).
* **Frontend:** Vite + React (chat UI, model picker, role prompt, TTS controls, microphone, **Calendar tile**, **chat slash-commands**).

---

## Table of Contents

1. [Features](#features)
2. [Quickstart](#quickstart)
3. [Project Structure](#project-structure)
4. [File-by-File: Server](#file-by-file-server)
5. [File-by-File: Client](#file-by-file-client)
6. [Environment & Voices/Models](#environment--voicesmodels)
7. [How to Use the App](#how-to-use-the-app)
8. [Calendar Setup (Outlook + Local)](#calendar-setup-outlook--local)
9. [Calendar • Control from Chat](#calendar--control-from-chat)
10. [API Endpoints](#api-endpoints)
11. [Troubleshooting](#troubleshooting)
12. [Next Steps & Notes](#next-steps--notes)

---

## Features

* Chat locally with any **Ollama** model (e.g., `qwen2.5:14b-instruct`, `llama3.1:8b`).
* Paste a **URL** to get a concise summary.
* `/research <topic>` for **quick research** with citations.
* **TTS** via Piper voices; **STT** via Vosk.
* **Calendar**

  * **Local events**: saved in `localStorage` (instant UI).
  * **Outlook**: OAuth (PKCE) + Microsoft Graph; list & push from UI.
  * **From chat**: list date ranges, add/rename/move/delete **local** items with slash-commands.

---

## Quickstart

### 0) Prerequisites

* **Node.js 18+** (20.x recommended)
* **Python 3.9+** (`venv` for TTS/STT)
* **Ollama** running locally
* Optional: Microsoft Entra ID (Azure) app registration for Outlook calendar

### 1) Clone

```bash
git clone https://github.com/<you>/Xenya-2.git
cd Xenya-2
```

### 2) Python virtualenv for TTS/STT

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install piper-tts vosk soundfile numpy
```

### 3) Assets: Piper Voices & Vosk Model

```
server/piper/voices/
  en_GB-jenny_dioco-medium.onnx
  en_GB-jenny_dioco-medium.onnx.json
  (… any others)

server/models/vosk/vosk-model-small-en-us-0.15/
  am/ conf/ graph/ ivector/ …
```

### 4) Install Node deps (server & client)

```bash
# in server
cd server
npm install

# in client
cd ../client
npm install
```

### 5) Ollama model

```bash
ollama pull qwen2.5:14b-instruct
# or llama3.1:8b / mistral / gemma, etc.
```

### 6) **Calendar env (server/.env)**

Create `server/.env` (values shown are typical for local dev):

```
# app + dev origins
BASE_URL=http://localhost:3000
CLIENT_ORIGIN=http://localhost:5173
SESSION_SECRET=xenya-dev

# Outlook / Microsoft Graph
MS_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MS_CLIENT_SECRET=                            # optional (confidential client)
MS_TENANT_ID=common                          # or your tenant id
MS_REDIRECT_PATH=/oauth/callback
DEFAULT_TZ=America/Chicago

# (optional) extra scopes, whitespace/comma separated
# MS_EXTRA_SCOPES=
```

> **Entra ID (Azure) app registration**
>
> * App type: “Web”.
> * Redirect URI (Web): `http://localhost:3000/oauth/callback`
> * Allow `Accounts in any organizational directory` if you use `MS_TENANT_ID=common`.
> * API permissions: **Microsoft Graph** → **offline\_access**, **openid**, **profile**, **email**, **Calendars.ReadWrite**.

### 6.1) **Client env (client/.env)**

```
VITE_API_ORIGIN=http://localhost:3000
```

### 6.2) **Vite proxy (client/vite.config.js)**

Make sure both API **and calendar** endpoints proxy to the server in dev:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/calendar': 'http://localhost:3000',
      '/oauth': 'http://localhost:3000',
    }
  }
})
```

> If you **don’t** use the proxy, always call absolute server URLs (`VITE_API_ORIGIN`) from the client, and open Outlook connect at `http://localhost:3000/calendar/connect` (server origin), not `:5173`.

### 7) Run backend

```bash
cd ../server
VENV_PY="$(cd .. && pwd)/.venv/bin/python" node server.js
# ✅ Xenya server listening on http://localhost:3000
```

### 8) Run frontend

```bash
cd ../client
npm run dev
# Open http://localhost:5173
```

---

## Project Structure

```
Xenya-2/
├── client/
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx                         ← Chat + slash commands (calendar /events, /cal …)
│       ├── components/
│       │   ├── XenyaProductivitySuite.jsx  ← Includes Calendar tile (reads local+Outlook)
│       │   └── OutlookCalendar.jsx         ← UI for connect/list/push
│       └── lib/
│           ├── api.js
│           └── tts/speak.js
└── server/
    ├── server.js                           ← Mounts calendarRouter()
    ├── calendar.js                         ← Outlook OAuth (PKCE) + Graph calendar routes
    ├── tts.js
    ├── stt_py.py
    ├── piper/voices/
    └── models/vosk/vosk-model-small-en-us-0.15/
```

---

## File-by-File: Server

### `server/server.js`

* Existing endpoints (Ollama chat, research, summary, RSS, TTS, STT).
* **Calendar**: imports and mounts `calendarRouter()` from `calendar.js`.
  Routes (mounted at root):
  `GET /calendar/status` · `GET /calendar/upcoming` · `POST /calendar/upsert` · `DELETE /calendar/:eventId` · `GET /calendar/connect` · `GET /oauth/callback` · `POST /auth/logout`.

### `server/calendar.js`

* Outlook OAuth (PKCE) using `express-session`.
* Reads **MS\_CLIENT\_ID**, **MS\_TENANT\_ID**, **BASE\_URL**, **CLIENT\_ORIGIN**, **MS\_REDIRECT\_PATH**, **DEFAULT\_TZ**.
* Talks to **Microsoft Graph** (`/me/calendarView`, `/me/events`) for listing and creating/deleting events.

(Other server files unchanged.)

---

## File-by-File: Client

Key bits are unchanged **plus**:

* **Calendar tile** (in Productivity Suite) shows **Local** + **Outlook** (if connected).
  Local events are at `localStorage["xenya_local_events_v1"]`.
* **Chat slash-commands** (see next sections).

---

## Environment & Voices/Models

*(same as before)*

---

## How to Use the App

1. Pick a model.
2. Adjust the role prompt if you like (autosaves).
3. **Calendar**

   * **Local events** just work (stored on-device).
   * **Connect Outlook**: open the Calendar tile and click **Connect**, or visit
     `http://localhost:3000/calendar/connect`. A window opens, sign in, it will say *“Connected”* and you can close it.
4. Use slash-commands in chat (next section).

---

## Calendar Setup (Outlook + Local)

* Local events are instant and stored at `localStorage["xenya_local_events_v1"]`.
* Outlook is session-based (cookie). For cross-origin (`5173`↔`3000`), the server sets `SameSite=None` and may need HTTPS in some browsers. Prefer using the **Vite proxy** above for fewer cookie headaches.

**Manual check**

* Status: `GET http://localhost:3000/calendar/status`
* Connect: `GET http://localhost:3000/calendar/connect`
* Upcoming: `GET http://localhost:3000/calendar/upcoming?from=ISO&to=ISO&tz=America/Chicago`

---

## Calendar • Control from Chat

You can manage calendar items directly in chat.
**Local** items are editable; **Outlook** items are read-only from chat (but you can push local→Outlook from the Calendar UI).

### List events — `/events`

```
/events                # current week, Local + Outlook (if connected)
/events today
/events week
/events month
/events 2025-09-20..2025-09-27
```

Add a source filter: `local` or `outlook`

```
/events today local
/events week outlook
```

The reply shows `[L]` for local and `[O]` for Outlook, with each item’s `id` (useful for edits).

### Add / Edit / Rename / Delete (Local) — `/cal ...`

```
/cal add "Title" 2025-09-24T15:00..2025-09-24T16:00 loc:"HQ" notes:"Standup"
# optional flags: loc:"…" | notes:"…" | tz:"America/Chicago"

# rename by id (from /events list)
 /cal rename <id> "New title"

# move/update times
 /cal move <id> 2025-09-24T17:00..2025-09-24T18:00
# (alias: /cal edit <id> ...)

# delete
 /cal delete <id>
```

Every local change dispatches a `window` event `calendar:changed` so the Calendar tile updates instantly.

---

## API Endpoints

*(unchanged ones omitted for brevity)*

**Calendar (server):**

* `GET /calendar/status` → `{ connected:boolean, me?:object }`
* `GET /calendar/upcoming?from&to&tz` → array of Outlook events
* `POST /calendar/upsert` → `{ eventId, webLink }` (creates Outlook event from a local task)
* `DELETE /calendar/:eventId` → `{ ok:true }`
* `GET /calendar/connect` → starts OAuth
* `GET /oauth/callback` → finishes OAuth, stores session
* `POST /auth/logout` → clears session

---

## Troubleshooting

### Calendar

**“Set MS\_CLIENT\_ID in env”**
You hit `/calendar/connect` but `server/.env` is missing `MS_CLIENT_ID`. Add it and restart the server.

**“Cannot GET /calendar/connect”**
You opened `http://localhost:5173/calendar/connect` (client). Open the **server** origin: `http://localhost:3000/calendar/connect`, or configure the Vite **proxy** as shown.

**`/calendar/status` 404 from `:5173`**
Add the proxy for `/calendar` and `/oauth` in `vite.config.js` or call absolute server URLs (`VITE_API_ORIGIN`).

**OAuth state/cookies not sticking**
Cross-origin cookies may be blocked if not Secure. Use the **proxy** during dev. If you must stay cross-origin, run the server under HTTPS so `SameSite=None; Secure` cookies are accepted.

**401 unauthorized listing Outlook**
Session expired. Hit **Connect** again or `POST /auth/logout`, then re-connect.

### General

**TTS / STT issues**
See original sections; confirm venv Python path via `VENV_PY=... node server.js`.

**Favicon 404**
Optional. Add `client/public/favicon.ico` or ignore.

---

## Next Steps & Notes

* Voice picker in UI, streaming TTS, streaming chat.
* More calendar sources (Google, iCal).
* Server memory UX.

---

### One-liner run after setup

```bash
# Terminal A — server
cd server
VENV_PY="$(cd .. && pwd)/.venv/bin/python" node server.js

# Terminal B — client
cd ../client
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) → Calendar tile → **Connect** (or browse to [http://localhost:3000/calendar/connect](http://localhost:3000/calendar/connect)).
