# Xenya — The Digital Attaché (Local, Voice-Ready)

Xenya is a **local, privacy-first assistant** that runs against your **Ollama** LLMs, can **summarize URLs, research topics with light web scraping**, and supports **text-to-speech (TTS)** and **speech-to-text (STT)** for hands-free conversations.

* **Backend:** Node.js + Express (talks to Ollama; scrapes/summarizes pages; TTS via Piper; STT via Vosk in Python).
* **Frontend:** Vite + React (chat UI, model picker, role prompt editor, TTS controls, microphone capture).

---

## Table of Contents

1. [Features](#features)
2. [Quickstart](#quickstart)
3. [Project Structure](#project-structure)
4. [File-by-File: Server](#file-by-file-server)
5. [File-by-File: Client](#file-by-file-client)
6. [Environment & Voices/Models](#environment--voicesmodels)
7. [How to Use the App](#how-to-use-the-app)
8. [API Endpoints](#api-endpoints)
9. [Troubleshooting](#troubleshooting)
10. [Next Steps & Notes](#next-steps--notes)

---

## Features

* Chat locally with any **Ollama** model (e.g., `qwen2.5:14b-instruct`, `llama3.1:8b`).
* Paste a **URL** to get a concise summary (Readability + fallback meta).
* Type `/research <topic>` for **quick research** with citations (DuckDuckGo/Bing HTML).
* **TTS** via Piper voices (e.g., `en_GB-jenny_dioco-medium.onnx`) — play replies automatically.
* **STT** via Vosk small English model — use mic to speak queries, auto-send transcript.
* Lightweight **memory** (JSON file) for config/user data.

---

## Quickstart

### 0) Prerequisites

* **Node.js 18+ (recommended 20.x)**
* **Python 3.9+** (we use a venv for `piper-tts` and `vosk`)
* **Ollama** installed and running: [https://ollama.com](https://ollama.com)
* macOS: Homebrew recommended. (Linux works, Windows WSL may need extra steps.)

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

> The **frontend and server** are independent from this venv, but the backend calls this Python to perform STT and also uses the `piper` Python wheel if needed.

### 3) Piper Voices & Vosk Model

Put voices under `server/piper/voices/` (you already have two):

```
server/piper/voices/
  en_GB-jenny_dioco-medium.onnx
  en_GB-jenny_dioco-medium.onnx.json
  en_GB-cori-high.onnx
  en_GB-cori-high.onnx.json
```

Put a Vosk English model here:

```
server/models/vosk/vosk-model-small-en-us-0.15/
  (am, conf, graph, ivector, README)
```

*(Folder name should match exactly; contents should look like your `ls` output.)*

### 4) Install Node deps (server & client)

```bash
# in Xenya-2/server
cd server
npm install

# in Xenya-2/client
cd ../client
npm install
```

> The server avoids `vosk` Node bindings (which pull `ffi-napi`) and instead uses the **Python** Vosk — so the usual node-gyp headaches shouldn’t appear.

### 5) Make sure Ollama has your model

```bash
ollama pull qwen2.5:14b-instruct
# or llama3.1:8b / mistral:7b-instruct / gemma:7b-instruct, etc.
```

### 6) Run backend

```bash
# back to Xenya-2/server
cd ../server
VENV_PY="$(cd .. && pwd)/.venv/bin/python" node server.js
# You should see: ✅ Xenya server listening on http://localhost:3000
```

### 7) Run frontend

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
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx                 ← Main React app
│       ├── theme.css               ← Styling
│       ├── components/
│       │   ├── Notes.jsx
│       │   ├── MarkdownMessage.jsx
│       │   ├── TTSControls.jsx
│       │   ├── Mic.jsx
│       │   └── ErrorBoundary.jsx   (optional, if present)
│       └── lib/
│           ├── api.js              ← Calls backend API
│           └── tts/
│               └── speak.js        ← Fetches WAV from server and plays it
└── server/
    ├── server.js                   ← Express backend (Ollama, summary, research, RSS, memory, TTS, STT)
    ├── tts.js                      ← Piper invocation wrapper
    ├── stt_py.py                   ← Vosk (Python) STT; reads WAV from stdin and prints JSON
    ├── memory.json                 ← Lightweight storage (autocreated)
    ├── piper/
    │   ├── piper/                  ← Piper runtime dir (espeak data, libs; may exist if unpacked)
    │   └── voices/                 ← .onnx voice models (+ .json configs)
    └── models/
        └── vosk/
            └── vosk-model-small-en-us-0.15/   ← Vosk STT model folder
```

---

## File-by-File: Server

### `server/server.js`

**The main Express server.** Responsibilities:

* **Model management**

  * `/api/models` — list installed Ollama models (via `OLLAMA_URL/api/tags`).
  * `/api/models/select` — set `ACTIVE_MODEL` (stored in `memory.json`).
  * `/api/models/refresh` — re-sync list from Ollama.
  * `/api/health` — ping Ollama and report status.

* **Chat**

  * `/api/chat` — forwards messages to Ollama `/api/chat` with optional system prompt.

* **Memory**

  * `/api/memory` — simple JSON KV per user (get/set/delete).

* **Search & Research**

  * `/api/search` — DuckDuckGo/Bing HTML scraping (server-side) returning top links.
  * `/api/summary?url=` — fetch URL, extract **Readability** text (fallback to meta), summarize with Ollama.
  * `/api/rss` — fetch RSS (BBC + Reuters by default).
  * `/api/research?q=` — expand acronyms / enhance topic; merge top links; pull Wikipedia summary; ask Ollama to synthesize an answer with inline citations `[S1]`… and a link list.

* **TTS**

  * `/api/tts` — accepts `{ text, voice }`, invokes `synthesizeWithPiper` (from `tts.js`), returns a **WAV** buffer.

* **STT**

  * `/api/stt` (POST `multipart/form-data` with `audio` as a `webm` blob)

    * Converts **webm → wav (16k mono)** with `ffmpeg-static` (via `fluent-ffmpeg`)
    * Spawns Python (`VENV_PY` or `../.venv/bin/python`) to run `stt_py.py`
    * Pipes WAV to Python’s stdin and returns `{ text }` from its stdout JSON.

* **Helpers**

  * Fetch with timeout, Readability extraction, DuckDuckGo/Bing HTML parsers, Wikipedia lookup, model picker logic, `memory.json` read/write.

**Env vars:**

* `PORT` (default `3000`)
* `OLLAMA_URL` (default `http://localhost:11434`)
* `OLLAMA_MODEL` (preferred model name; otherwise chosen from installed)
* `VENV_PY` (path to Python binary to run `stt_py.py`)

---

### `server/tts.js`

**Piper TTS wrapper** used by `/api/tts`. It:

* Accepts `{ text, voice }`.
* Spawns **piper** (prefer the Python `piper` from venv, which ships a CLI via the wheel) **OR** calls the local binary if configured.
* Writes WAV to **stdout** and collects it into a Node `Buffer` returned to the route.

> You’re already using `piper-tts` wheel in `.venv`, which gives a `piper` CLI. The code streams synthesized audio to Node and back to the browser.

---

### `server/stt_py.py`

**Python STT bridge with Vosk.**

* Reads whole **WAV** (16 kHz mono) from `stdin`.
* Uses `vosk.Model` from `server/models/vosk/...`.
* Runs recognition and prints a single JSON object: `{"text": "recognized text"}`.
* Cleans up temp files.

---

### `server/memory.json`

Autocreated JSON file storing:

* `config.activeModel` — last selected model
* `users` — key/value store (if you use memory route)
* `notes` — currently unused placeholder

---

### `server/piper/voices/*.onnx[.json]`

Your Piper voices. Examples:

* `en_GB-jenny_dioco-medium.onnx`
* `en_GB-cori-high.onnx`

The `.json` file contains voice config (sample rate, etc). The server simply passes the path to Piper.

---

## File-by-File: Client

### `client/src/App.jsx`

**Main UI.** Handles:

* **State:** chats (saved in `localStorage`), selected model, role prompt, input box.
* **Routing:** decides between `/research`, URL summary, news (RSS), or plain chat.
* **TTS:** after an assistant reply, optionally calls `speak(text, voice)` to play audio.
* **STT:** embeds `<Mic onTranscript={handleTranscript} />` to record from the browser and POST to `/api/stt`.
* **De-duping chat IDs:** robust `uid`/`makeId` logic avoids duplicate React keys.
* **Model controls:** select/refresh models and persist choice on server.

### `client/src/components/Notes.jsx`

A small notes panel (scratchpad) you can extend to store to server memory, or keep as local helpers.

### `client/src/components/MarkdownMessage.jsx`

Renders assistant/user messages with Markdown (headings, lists, code blocks). Keeps the “Copy” button functional.

### `client/src/components/TTSControls.jsx`

UI toggle to auto-speak replies and a “Speak last” button. It calls the exported `speak()` util with `lastReply` and a selected voice (you can surface voice choice here; the prop currently wires a fixed voice in `App.jsx`).

### `client/src/components/Mic.jsx`

Captures microphone audio via **MediaRecorder** (`audio/webm`), sends it as `multipart/form-data` to `/api/stt`, receives `{ text }`, and calls the provided `onTranscript(text)` callback. The `App` then **auto-sends** the transcript if that toggle is on.

### `client/src/lib/api.js`

Thin fetch wrappers for:

* `/api/chat`
* `/api/summary?url=`
* `/api/research?q=`
* `/api/rss`
* `/api/models`, `/api/models/select`, `/api/models/refresh`

This keeps the UI clean and makes it easy to stub/mock later.

### `client/src/lib/tts/speak.js`

Fetches `/api/tts` with `{text, voice}` and plays the returned **WAV** via `AudioContext`/`AudioBufferSourceNode` or `<audio>` fallback. Handles small errors quietly so UI doesn’t crash if TTS is unavailable.

### `client/src/theme.css`

All of the app’s look & feel: layout grid (sidebar/main), message bubbles, buttons, inputs, dark theme colors, small toast animations, etc.

---

## Environment & Voices/Models

* **Ollama** must be running. `OLLAMA_URL` is configurable (defaults to `http://localhost:11434`).

* **Model choice**:

  * The server auto-picks from installed models if your preferred one isn’t available.
  * In the UI, use the dropdown to select a model; it POSTs to `/api/models/select`.

* **Piper voices** (server side):

  * Place `.onnx` + `.onnx.json` under `server/piper/voices/`.
  * In `App.jsx`, we pass `'en_GB-jenny_dioco-medium.onnx'` to `speak()`; change to whichever you prefer.

* **Vosk model**:

  * Default expect path: `server/models/vosk/vosk-model-small-en-us-0.15/`.
  * You can use a different language/model: change the path in `stt_py.py` or make it read an env var.

---

## How to Use the App

1. **Pick a model** in the left sidebar (after the list loads).

2. **(Optional) Adjust the role prompt** (the system instruction for style/tone) — it auto-saves on blur.

3. **Type** a message and hit **Send**, or:

   * Paste a **URL** → you’ll get a summary.
   * Type `/research your topic` → quick web research with citations.
   * Type `news` or “latest news” → top BBC/Reuters headlines.

4. **Speak**: Click the **Mic** button, talk, stop — the transcript will appear and (by default) auto-send.

5. **Hear**: Xenya will **speak** replies using your chosen Piper voice (toggle in “Speech” box).

---

## API Endpoints

* `GET /api/health` → `{ok, ollama, active}`

* `GET /api/models` → `{active, models:[{name, family, size, modified_at}]}`

* `POST /api/models/select` → body `{name}`

* `POST /api/models/refresh` → resync

* `POST /api/chat` → `{messages:[{role,content}], system, model}` → `{reply}`

* `GET /api/summary?url=&model=` → `{title, url, summary}`

* `GET /api/research?q=&model=` → `{answer, sources:[{label,title,url}], model}`

* `GET /api/rss` → `{feeds:[{feed,items:[{title,link,pubDate}]}]}`

* `POST /api/tts` → body `{text, voice}` → **audio/wav** bytes

* `POST /api/stt` → multipart with `audio: File(webm)` → `{text}`

* `POST /api/memory` → `{userId, action:'get'|'set'|'delete', key?, value?}`

---

## Troubleshooting

### “Something went wrong in the UI” / ErrorBoundary shows `saveRole` or `onRefreshModels is not defined`

You’re on an older `App.jsx`. Use the version above — it **defines** `saveRole`, `onSelectModel`, and `onRefreshModels` before rendering.

### Page is blank / black

Open DevTools → Console. Any reference error (undefined function/variable) in React will fail the render. The provided `App.jsx` addresses earlier crashes and dedupes chat IDs so keys are stable.

### TTS fails (`piper` not found / WAV not produced)

* Confirm the Python venv and `piper-tts` are installed, and `VENV_PY` points to your venv Python when starting the server:

  ```bash
  VENV_PY="$(cd .. && pwd)/.venv/bin/python" node server.js
  ```
* Ensure voices exist under `server/piper/voices/` and your **voice name** in `App.jsx` matches a real file.

### STT fails (`vosk` / ffmpeg)

* `ffmpeg` is bundled via `ffmpeg-static` in Node, but make sure the webm → wav step works (the server logs errors).
* Python side needs: `vosk`, `soundfile`, `numpy`, and the **model folder** in `server/models/vosk/vosk-model-small-en-us-0.15/`.

### Ollama not reachable

* `ollama serve` should be running.
* Use `OLLAMA_URL` if not on default port / remote host.
* Pull at least one instruct model: `ollama pull qwen2.5:14b-instruct`.

### macOS “quarantine” / exec perms for native Piper binaries

You’re using the Python wheel which avoids binary dylib pain. If you later switch to a native Piper binary, you may need:

```bash
chmod -R a+x server/piper
xattr -dr com.apple.quarantine server/piper
```

For x86\_64 binaries on Apple Silicon, install **Rosetta** and use `arch -x86_64` — but prefer the Python wheel to avoid this.

---

## Next Steps & Notes

* **Voice picker in UI**: surface available `*.onnx` from server and let the user pick the current voice.
* **Streaming TTS**: stream WAV chunks for lower latency.
* **Streaming chat**: support streaming tokens from Ollama.
* **Memory UX**: add a small “Save to memory” panel wired to `/api/memory`.
* **More languages**: drop in other Vosk models and voices.

---

### One-liner run (after first setup)

```bash
# Terminal A
# from your current prompt in .../Xenya-3/client
cd server
npm i express-session nanoid

# (optional) create the Python venv at project root if you haven’t already
[ -d ../.venv ] || python3 -m venv ../.venv
source ../.venv/bin/activate
pip install -U pip vosk soundfile piper-tts

# quick sanity checks (these files/dirs must exist)
ls -1 stt_py.py
ls -1 models/vosk/vosk-model-small-en-us-0.15/am

# run the server and tell it which Python to use for STT
VENV_PY="$(cd .. && pwd)/.venv/bin/python" node server.js


# Terminal B
cd client
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — pick a model, talk to Xenya, and enjoy the voice loop.
