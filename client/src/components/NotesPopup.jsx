// src/components/NotesPopup.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import MarkdownMessage from './MarkdownMessage.jsx'
import {
  loadNotesState,
  createNotebook, renameNotebook, deleteNotebook,
  createChapter, renameChapter, deleteChapter,
  setActive, updateChapterContent,
  exportNotesJSON, importNotesJSON,
} from './notes/notesStore.js'

import {
  fetchAiModels,
  runNotesAiCustomAndSave,
  runNotesAiAndApply,
} from './notesai.js'

export default function NotesPopup({ open, onClose }) {
  const [collapsed, setCollapsed] = useState(false)
  const [state, setState] = useState(loadNotesState())
  const [search, setSearch] = useState('')
  const [editMode, setEditMode] = useState('write') // write | preview
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const fileInputRef = useRef(null)
  const saveTimerRef = useRef(null)
  const textareaRef = useRef(null)

  // ===== AI state =====
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiModels, setAiModels] = useState([])

  // where AI writes
  const [aiTarget, setAiTarget] = useState('append') // replace | append | new

  // ✅ Floating AI window state
  const [aiFloatOpen, setAiFloatOpen] = useState(false)
  const [aiFloatMin, setAiFloatMin] = useState(false)
  const [aiPos, setAiPos] = useState({ x: 520, y: 160 })
  const dragRef = useRef({ dragging: false, dx: 0, dy: 0 })

  // sync on storage updates
  useEffect(() => {
    const onChanged = () => setState(loadNotesState())
    window.addEventListener('notes:changed', onChanged)
    return () => window.removeEventListener('notes:changed', onChanged)
  }, [])

  // close on esc
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const activeNotebook = useMemo(() => {
    return state.notebooks.find(n => n.id === state.active.notebookId) || null
  }, [state])

  const activeChapter = useMemo(() => {
    if (!activeNotebook) return null
    return (activeNotebook.chapters || []).find(c => c.id === state.active.chapterId) || null
  }, [activeNotebook, state])

  const filteredNotebooks = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return state.notebooks
    return state.notebooks
      .map(nb => {
        const nbHit = nb.title.toLowerCase().includes(q)
        const ch = (nb.chapters || []).filter(c => c.title.toLowerCase().includes(q))
        if (nbHit) return nb
        if (ch.length) return { ...nb, chapters: ch }
        return null
      })
      .filter(Boolean)
  }, [state.notebooks, search])

  // --- autosave chapter content (debounced)
  const setChapterContent = (val) => {
    if (!activeNotebook || !activeChapter) return
    setDirty(true)
    setSaving(true)

    // optimistic UI update
    setState(prev => {
      const copy = structuredClone(prev)
      const nb = copy.notebooks.find(n => n.id === activeNotebook.id)
      const ch = nb?.chapters?.find(c => c.id === activeChapter.id)
      if (ch) ch.content = val
      return copy
    })

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      updateChapterContent(activeNotebook.id, activeChapter.id, val)
      setDirty(false)
      setSaving(false)
    }, 450)
  }

  const ensureNotebook = () => {
    const s = loadNotesState()
    if (s.notebooks.length) return
    createNotebook('My Course')
  }

  useEffect(() => {
    if (open) ensureNotebook()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Load AI models when popup opens
  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const r = await fetchAiModels()
        setAiModels(r.models || [])
        setAiModel(r.active || (r.models?.[0]?.name || ''))
      } catch {
        // ignore
      }
    })()
  }, [open])

  // Reset floating AI position when opening popup (nice default)
  useEffect(() => {
    if (!open) return
    setAiFloatOpen(false)
    setAiFloatMin(false)
    setAiPos({ x: 520, y: 160 })
  }, [open])

  const onNewNotebook = () => {
    const title = prompt('Course name? (Notebook title)', 'CSCE 3600')
    if (title === null) return
    createNotebook(title.trim() || 'Untitled Course')
    setState(loadNotesState())
  }

  const onRenameNotebook = (nb) => {
    const title = prompt('Rename course', nb.title)
    if (title === null) return
    renameNotebook(nb.id, title.trim() || nb.title)
    setState(loadNotesState())
  }

  const onDeleteNotebook = (nb) => {
    if (!confirm(`Delete course "${nb.title}"? This removes all chapters.`)) return
    deleteNotebook(nb.id)
    setState(loadNotesState())
  }

  const onNewChapter = (nb) => {
    const title = prompt(`New chapter name for "${nb.title}"`, 'Chapter 1 — Intro')
    if (title === null) return
    createChapter(nb.id, title.trim() || 'New Chapter')
    setState(loadNotesState())
  }

  const onRenameChapter = (nb, ch) => {
    const title = prompt('Rename chapter', ch.title)
    if (title === null) return
    renameChapter(nb.id, ch.id, title.trim() || ch.title)
    setState(loadNotesState())
  }

  const onDeleteChapter = (nb, ch) => {
    if (!confirm(`Delete chapter "${ch.title}"?`)) return
    deleteChapter(nb.id, ch.id)
    setState(loadNotesState())
  }

  const onSelect = (nbId, chId) => {
    setActive(nbId, chId)
    setState(loadNotesState())
    setEditMode('write')
    setTimeout(() => textareaRef.current?.focus?.(), 0)
  }

  const onExport = async () => {
    const blob = new Blob([exportNotesJSON()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `xenya-notes-backup-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImport = () => fileInputRef.current?.click()

  const onImportFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const text = await f.text()
      importNotesJSON(text)
      setState(loadNotesState())
      alert('Imported notes backup successfully.')
    } catch (err) {
      alert('Import failed: ' + (err?.message || err))
    }
  }

  /* =========================
     TOOLBAR (unchanged behavior)
     ========================= */

  const getSelection = () => {
    const ta = textareaRef.current
    if (!ta) return null
    return {
      ta,
      value: ta.value,
      start: ta.selectionStart ?? 0,
      end: ta.selectionEnd ?? 0,
      selected: ta.value.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0),
    }
  }

  const replaceRange = (newValue, newStart, newEnd) => {
    setChapterContent(newValue)
    setTimeout(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(newStart, newEnd)
    }, 0)
  }

  const wrapSelection = (left, right, placeholder = '') => {
    const s = getSelection()
    if (!s) return
    const { value, start, end, selected } = s
    const inner = selected || placeholder
    const next = value.slice(0, start) + left + inner + right + value.slice(end)
    const selStart = start + left.length
    const selEnd = selStart + inner.length
    replaceRange(next, selStart, selEnd)
  }

  const applyHeading = (level = 1) => {
    const s = getSelection()
    if (!s) return
    const { value, start, end, selected } = s
    const prefix = '#'.repeat(Math.min(6, Math.max(1, level))) + ' '

    const chunk = selected || ''
    const hasSelection = end > start

    if (hasSelection && chunk.includes('\n')) {
      const lines = chunk.split('\n').map(line => (line.trim().length ? prefix + line.replace(/^#{1,6}\s+/, '') : line))
      const replaced = lines.join('\n')
      const next = value.slice(0, start) + replaced + value.slice(end)
      replaceRange(next, start, start + replaced.length)
      return
    }

    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEnd = value.indexOf('\n', end)
    const le = lineEnd === -1 ? value.length : lineEnd
    const line = value.slice(lineStart, le)
    const stripped = line.replace(/^#{1,6}\s+/, '')
    const newLine = prefix + stripped
    const next = value.slice(0, lineStart) + newLine + value.slice(le)
    const delta = newLine.length - line.length
    replaceRange(next, start + delta, end + delta)
  }

  const toggleList = (type = 'bullet') => {
    const s = getSelection()
    if (!s) return
    const { value, start, end, selected } = s
    const chunk = selected || ''
    const hasSelection = end > start

    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEnd = value.indexOf('\n', end)
    const le = lineEnd === -1 ? value.length : lineEnd

    const target = hasSelection ? chunk : value.slice(lineStart, le)
    const lines = target.split('\n')

    const bulletRx = /^\s*[-*+]\s+/
    const numRx = /^\s*\d+\.\s+/

    const isAlready = lines.every(l => {
      if (!l.trim()) return true
      return type === 'bullet' ? bulletRx.test(l) : numRx.test(l)
    })

    const nextLines = lines.map((l, idx) => {
      if (!l.trim()) return l
      if (type === 'bullet') {
        return isAlready ? l.replace(bulletRx, '') : `- ${l.replace(bulletRx, '').replace(numRx, '')}`
      } else {
        return isAlready ? l.replace(numRx, '') : `${idx + 1}. ${l.replace(bulletRx, '').replace(numRx, '')}`
      }
    })

    const replaced = nextLines.join('\n')
    if (hasSelection) {
      const next = value.slice(0, start) + replaced + value.slice(end)
      replaceRange(next, start, start + replaced.length)
    } else {
      const next = value.slice(0, lineStart) + replaced + value.slice(le)
      replaceRange(next, lineStart, lineStart + replaced.length)
    }
  }

  const toggleQuote = () => {
    const s = getSelection()
    if (!s) return
    const { value, start, end, selected } = s
    const chunk = selected || ''
    const hasSelection = end > start

    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const lineEnd = value.indexOf('\n', end)
    const le = lineEnd === -1 ? value.length : lineEnd

    const target = hasSelection ? chunk : value.slice(lineStart, le)
    const lines = target.split('\n')
    const rx = /^\s*>\s?/
    const isAlready = lines.every(l => (!l.trim() ? true : rx.test(l)))
    const replaced = lines.map(l => (!l.trim() ? l : (isAlready ? l.replace(rx, '') : `> ${l.replace(rx,'')}`))).join('\n')

    if (hasSelection) {
      const next = value.slice(0, start) + replaced + value.slice(end)
      replaceRange(next, start, start + replaced.length)
    } else {
      const next = value.slice(0, lineStart) + replaced + value.slice(le)
      replaceRange(next, lineStart, lineStart + replaced.length)
    }
  }

  const insertHorizontalRule = () => {
    const s = getSelection()
    if (!s) return
    const { value, start } = s
    const insert = `\n\n---\n\n`
    const next = value.slice(0, start) + insert + value.slice(start)
    const caret = start + insert.length
    replaceRange(next, caret, caret)
  }

  const insertLink = () => {
    const s = getSelection()
    if (!s) return
    const { selected } = s
    const text = selected || 'link text'
    const before = '['
    const mid = `](`
    const after = ')'
    wrapSelection(before, `${mid}https://example.com${after}`, text)
    setTimeout(() => {
      const ta = textareaRef.current
      if (!ta) return
      const val = ta.value
      const idx = val.lastIndexOf('](')
      if (idx >= 0) {
        const urlStart = idx + 2
        const urlEnd = val.indexOf(')', urlStart)
        if (urlEnd > urlStart) ta.setSelectionRange(urlStart, urlEnd)
      }
    }, 0)
  }

  const insertCodeBlock = () => {
    const s = getSelection()
    if (!s) return
    const { selected } = s
    const inner = selected || 'code here'
    wrapSelection('```txt\n', '\n```', inner)
  }

  const onToolbar = (action) => {
    if (editMode !== 'write') setEditMode('write')
    setTimeout(() => {
      switch (action) {
        case 'bold': return wrapSelection('**', '**', 'bold text')
        case 'italic': return wrapSelection('*', '*', 'italic text')
        case 'underline': return wrapSelection('<u>', '</u>', 'underlined')
        case 'strike': return wrapSelection('~~', '~~', 'strikethrough')
        case 'code': return wrapSelection('`', '`', 'code')
        case 'codeblock': return insertCodeBlock()
        case 'h1': return applyHeading(1)
        case 'h2': return applyHeading(2)
        case 'h3': return applyHeading(3)
        case 'ul': return toggleList('bullet')
        case 'ol': return toggleList('number')
        case 'quote': return toggleQuote()
        case 'hr': return insertHorizontalRule()
        case 'link': return insertLink()
        default: return
      }
    }, 0)
  }

  /* =========================
     AI HELPERS
     ========================= */

  const defaultTargetForKind = (kind) => {
    if (kind === 'rewrite') return 'replace'
    if (kind === 'explain') return 'append'
    return 'new'
  }

  const runAiKind = async (kind) => {
    if (!activeNotebook || !activeChapter) return
    if (!aiModel) { alert('No model selected.'); return }

    const target = defaultTargetForKind(kind)

    setAiBusy(true)
    try {
      const next = await runNotesAiAndApply({
        notebookId: activeNotebook.id,
        chapterId: activeChapter.id,
        chapterTitle: activeChapter.title,
        kind,
        notesText: activeChapter.content || '',
        model: aiModel,
        target,
      })
      setState(next)
      setEditMode('write')
      setTimeout(() => textareaRef.current?.focus?.(), 0)
    } catch (e) {
      alert('AI error: ' + (e?.message || e))
    } finally {
      setAiBusy(false)
    }
  }

  const runAiCustom = async () => {
    if (!activeNotebook || !activeChapter) return
    if (!aiModel) { alert('No model selected.'); return }
    const q = (aiPrompt || '').trim()
    if (!q) return

    setAiBusy(true)
    try {
      let next
      if (aiTarget === 'new') {
        next = await runNotesAiCustomAndSave({
          notebookId: activeNotebook.id,
          baseChapterTitle: activeChapter.title,
          userRequest: q,
          notesText: activeChapter.content || '',
          model: aiModel,
        })
      } else {
        next = await runNotesAiAndApply({
          notebookId: activeNotebook.id,
          chapterId: activeChapter.id,
          chapterTitle: activeChapter.title,
          userRequest: q,
          notesText: activeChapter.content || '',
          model: aiModel,
          target: aiTarget, // replace | append
        })
      }

      setState(next)
      setAiPrompt('')
      setEditMode('write')
      setTimeout(() => textareaRef.current?.focus?.(), 0)
    } catch (e) {
      alert('AI error: ' + (e?.message || e))
    } finally {
      setAiBusy(false)
    }
  }

  /* =========================
     FLOATING AI DRAG
     ========================= */

  const onAiDragStart = (e) => {
    // only left click
    if (e.button !== 0) return
    dragRef.current.dragging = true
    dragRef.current.dx = e.clientX - aiPos.x
    dragRef.current.dy = e.clientY - aiPos.y
    e.preventDefault()
  }

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.dragging) return
      const nx = e.clientX - dragRef.current.dx
      const ny = e.clientY - dragRef.current.dy
      // clamp a bit so it doesn't disappear fully
      setAiPos({
        x: Math.max(16, Math.min(window.innerWidth - 340, nx)),
        y: Math.max(86, Math.min(window.innerHeight - 120, ny)),
      })
    }
    const onUp = () => { dragRef.current.dragging = false }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [aiPos.x, aiPos.y])

  if (!open) return null

  return (
    <>
      <style>{`
        :root{
          --np-bg: rgba(5, 6, 10, .97);
          --np-bg2: rgba(0,0,0,.40);
          --np-card: rgba(255,255,255,.04);
          --np-card2: rgba(255,255,255,.03);
          --np-border: rgba(255,255,255,.10);
          --np-border2: rgba(255,255,255,.08);
          --np-text: rgba(255,255,255,.92);
          --np-muted: rgba(255,255,255,.68);

          /* ✅ NEW accent: teal/cyan (not purple) */
          --np-accent: rgba(0, 214, 255, 1);
          --np-accent2: rgba(0, 214, 255, .16);

          --np-shadow: 0 22px 70px rgba(0,0,0,.65);
        }

        .np-backdrop{
          position:fixed; inset:0; z-index:10060;
          background:rgba(0,0,0,.60);
          backdrop-filter: blur(10px);
        }

        /* ✅ Bigger popup */
        .np-panel{
          position:fixed;
          left:24px; right:24px;
          top:72px; bottom:18px;
          z-index:10070;
          border:1px solid var(--np-border);
          border-radius:20px;
          background: var(--np-bg);
          box-shadow: var(--np-shadow);
          overflow:hidden;
          display:flex; flex-direction:column;
          max-width: 1280px;
          margin: 0 auto;
        }

        .np-collapsed{
          max-width: 520px;
          left:auto;
          right:24px;
        }

        .np-head{
          display:flex; align-items:center; justify-content:space-between;
          padding:12px 14px;
          border-bottom:1px solid var(--np-border);
          background:
            radial-gradient(800px 140px at 18% 0%, rgba(0,214,255,.12), transparent 60%),
            linear-gradient(180deg, rgba(255,255,255,.03), transparent);
        }

        .np-title{display:flex; gap:10px; align-items:center; font-weight:900; color: var(--np-text)}
        .np-pill{
          font-size:12px; color: var(--np-muted);
          padding:4px 10px; border-radius:999px;
          border:1px solid var(--np-border2);
          background:rgba(255,255,255,.04);
        }
        .np-actions{display:flex; gap:8px; align-items:center}

        .np-btn{
          padding:8px 10px; border-radius:12px;
          border:1px solid var(--np-border2);
          background:rgba(255,255,255,.04);
          color:var(--np-text); cursor:pointer;
          font-weight:800;
        }
        .np-btn:hover{background:rgba(255,255,255,.07)}
        .np-btn.primary{
          border-color: rgba(0,214,255,.40);
          background: rgba(0,214,255,.12);
        }

        .np-body{
          flex:1;
          display:grid;
          grid-template-columns: 300px 1fr;
          min-height:0;
        }
        .np-collapsed .np-body{ grid-template-columns: 1fr; }

        .np-left{
          border-right:1px solid var(--np-border);
          display:flex; flex-direction:column;
          min-height:0;
          background: rgba(255,255,255,.01);
        }
        .np-search{
          padding:10px;
          border-bottom:1px solid var(--np-border);
        }
        .np-search input{
          width:100%;
          padding:10px 12px;
          border-radius:12px;
          border:1px solid var(--np-border2);
          background:rgba(0,0,0,.34);
          color:var(--np-text);
          outline:none;
        }

        .np-tree{ padding:10px; overflow:auto; }

        .nb{
          border:1px solid var(--np-border2);
          background: var(--np-card);
          border-radius:14px;
          margin-bottom:10px;
          overflow:hidden;
        }
        .nb-head{
          display:flex; align-items:center; justify-content:space-between;
          padding:10px;
          gap:8px;
          background: rgba(0,0,0,.18);
          border-bottom:1px solid var(--np-border2);
        }
        .nb-head .name{
          font-weight:900;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          color: var(--np-text);
        }
        .mini{ display:flex; gap:6px; }
        .mini button{
          font-size:12px;
          padding:6px 8px;
          border-radius:10px;
          border:1px solid var(--np-border2);
          background:rgba(255,255,255,.03);
          color:var(--np-text);
          cursor:pointer;
          font-weight:800;
        }
        .mini button:hover{background:rgba(255,255,255,.06)}

        .chap{
          padding:10px;
          display:flex; align-items:center; justify-content:space-between;
          gap:10px;
          cursor:pointer;
        }
        .chap:hover{background:rgba(255,255,255,.05)}
        .chap.active{
          background: rgba(0,214,255,.12);
          border-left: 3px solid rgba(0,214,255,.95);
        }
        .chap .ttl{
          font-size:14px;
          font-weight:800;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          color: var(--np-text);
        }
        .chap .meta{font-size:12px; color: var(--np-muted)}

        .np-right{
          min-height:0;
          display:flex; flex-direction:column;
        }

        .editor-top{
          display:flex; align-items:center; justify-content:space-between;
          padding:10px 12px;
          border-bottom:1px solid var(--np-border);
          background: rgba(255,255,255,.01);
        }
        .editor-top .path{
          font-weight:900;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          color: var(--np-text);
        }

        .tabs{display:flex; gap:8px}
        .tab{
          padding:8px 10px; border-radius:12px;
          border:1px solid var(--np-border2);
          background:rgba(255,255,255,.03);
          cursor:pointer; color:var(--np-text);
          font-weight:900; font-size:13px;
        }
        .tab.active{
          border-color: rgba(0,214,255,.40);
          background: rgba(0,214,255,.12);
        }

        .toolbar{
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          padding:10px 12px;
          border-bottom:1px solid var(--np-border);
          background: rgba(0,0,0,.20);
        }
        .toolbtn{
          padding:7px 10px;
          border-radius:12px;
          border:1px solid var(--np-border2);
          background:rgba(255,255,255,.03);
          color:var(--np-text);
          cursor:pointer;
          font-weight:900;
          font-size:13px;
          user-select:none;
        }
        .toolbtn:hover{background:rgba(255,255,255,.06)}
        .toolsep{ width:1px; background:var(--np-border2); margin:0 2px; }

        .editor{ flex:1; min-height:0; display:grid; grid-template-columns: 1fr; }

        /* ✅ More usable editor area */
        textarea.np-text{
          width:100%; height:100%;
          padding:16px;
          border:0;
          outline:none;
          background: rgba(0,0,0,.26);
          color:var(--np-text);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size:15px;
          line-height:1.6;
          resize:none;
        }

        .preview{
          padding:16px;
          overflow:auto;
          background: rgba(0,0,0,.18);
          color: var(--np-text);

          /* ✅ important (protect against global nowrap) */
          white-space: normal;
        }
        .hint{ font-size:12px; color: var(--np-muted); }

        /* ✅ Markdown typography inside preview (UPDATED per your selectors) */
        .preview :where(h1, h2, h3, h4, h5, h6) {
          margin: 1.5rem 0 1rem;
          line-height: 1.3;
          font-weight: 950;
          display: block;
        }
        .preview h1{ font-size: 22px; }
        .preview h2{ font-size: 18px; opacity: .98; }
        .preview h3{ font-size: 16px; opacity: .96; }

        .preview :where(p) {
          margin: 1rem 0;
          line-height: 1.65;
          display: block;
        }

        .preview :where(ul, ol) {
          margin: 1rem 0 1rem 1.5rem;
          padding-left: 1rem;
          display: block;
        }

        .preview :where(li) {
          margin: 0.5rem 0;
          display: list-item;
        }

        /* ✅ Prevent the "squashing" effect */
        .preview .md-render {
          white-space: pre-wrap;
          word-wrap: break-word;
        }

        .preview :where(strong){ font-weight: 950; }
        .preview :where(em){ opacity: .95; }

        .preview :where(blockquote){
          margin: 12px 0;
          padding: 10px 12px;
          border-left: 3px solid rgba(0,214,255,.75);
          background: rgba(255,255,255,.03);
          border-radius: 10px;
          color: rgba(255,255,255,.82);
        }

        .preview :where(hr){
          border: 0;
          border-top: 1px solid rgba(255,255,255,.10);
          margin: 14px 0;
        }

        .preview :where(code){
          padding: 2px 6px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,.10);
          background: rgba(0,0,0,.35);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: .95em;
        }
        .preview :where(pre){
          margin: 12px 0;
          padding: 12px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.10);
          background: rgba(0,0,0,.38);
          overflow:auto;
        }
        .preview :where(pre code){
          padding: 0;
          border: 0;
          background: transparent;
        }

        /* ✅ Secret AI “decor” button (low visibility) */
        .ai-secret{
          position:absolute;
          right:10px;
          bottom:10px;
          width:18px;
          height:18px;
          border-radius:999px;
          border:1px solid rgba(255,255,255,.10);
          background: rgba(0,0,0,.45);
          box-shadow: 0 10px 24px rgba(0,0,0,.45);
          cursor:pointer;
          opacity:.28;
          display:flex;
          align-items:center;
          justify-content:center;
          transition: all .15s ease;
          z-index:10090;
        }
        .ai-secret:hover{
          opacity:.85;
          border-color: rgba(0,214,255,.45);
          background: rgba(0,214,255,.10);
          transform: scale(1.05);
        }
        .ai-secret::after{
          content:'';
          width:6px; height:6px;
          border-radius:999px;
          background: rgba(0,214,255,.95);
          box-shadow: 0 0 16px rgba(0,214,255,.55);
        }

        /* ✅ Floating AI window */
        .ai-float{
          position:fixed;
          z-index:10120;
          width: 520px;
          border-radius:16px;
          border:1px solid rgba(255,255,255,.12);
          background: rgba(6, 8, 14, .96);
          box-shadow: 0 18px 60px rgba(0,0,0,.65);
          overflow:hidden;
        }
        .ai-float.min{
          width: 220px;
        }
        .ai-float-head{
          display:flex;
          align-items:center;
          justify-content:space-between;
          padding:10px 12px;
          border-bottom:1px solid rgba(255,255,255,.10);
          background:
            radial-gradient(500px 100px at 15% 0%, rgba(0,214,255,.12), transparent 60%),
            rgba(255,255,255,.02);
          cursor: grab;
          user-select:none;
        }
        .ai-float-title{
          font-weight:950;
          color: var(--np-text);
          display:flex;
          gap:8px;
          align-items:center;
        }
        .ai-float-actions{ display:flex; gap:8px; }
        .ai-mini{
          padding:6px 8px;
          border-radius:10px;
          border:1px solid rgba(255,255,255,.10);
          background: rgba(255,255,255,.03);
          color: var(--np-text);
          cursor:pointer;
          font-weight:900;
          font-size:12px;
        }
        .ai-mini:hover{ background: rgba(255,255,255,.06); }
        .ai-float-body{
          padding:10px 12px;
        }
        .ai-row{
          display:flex; gap:8px; flex-wrap:wrap; align-items:center;
          margin-bottom:10px;
        }
        .ai-row select{
          height:36px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,.10);
          background: rgba(0,0,0,.35);
          color: var(--np-text);
          padding:0 10px;
          outline:none;
        }
        .ai-prompt{
          width:100%;
          min-height:88px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,.10);
          background: rgba(0,0,0,.30);
          color: var(--np-text);
          padding:10px 12px;
          outline:none;
          resize: vertical;
        }
        .ai-kinds .toolbtn{
          font-size:12px;
          padding:7px 10px;
        }
        .ai-run{
          border-color: rgba(0,214,255,.40) !important;
          background: rgba(0,214,255,.12) !important;
        }
        .ai-run:hover{
          background: rgba(0,214,255,.16) !important;
        }
      `}</style>

      <div className="np-backdrop" onClick={onClose} />

      <div
        className={`np-panel ${collapsed ? 'np-collapsed' : ''}`}
        onClick={(e)=>e.stopPropagation()}
        style={{ position: 'fixed' }}
      >
        <div className="np-head">
          <div className="np-title">
            <span>🗂️ Notes</span>
            <span className="np-pill">{saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</span>
          </div>

          <div className="np-actions">
            <button className="np-btn" onClick={onImport}>Import</button>
            <button className="np-btn" onClick={onExport}>Export</button>
            <button className="np-btn primary" onClick={onNewNotebook}>+ Course</button>
            <button className="np-btn" onClick={() => setCollapsed(v => !v)}>
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
            <button className="np-btn" onClick={onClose}>Close</button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={onImportFile}
          />
        </div>

        <div className="np-body">
          {!collapsed && (
            <div className="np-left">
              <div className="np-search">
                <input
                  placeholder="Search courses / chapters…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="np-tree">
                {filteredNotebooks.map(nb => (
                  <div className="nb" key={nb.id}>
                    <div className="nb-head">
                      <div className="name" title={nb.title}>{nb.title}</div>
                      <div className="mini">
                        <button onClick={() => onNewChapter(nb)}>+ Ch</button>
                        <button onClick={() => onRenameNotebook(nb)}>Rename</button>
                        <button onClick={() => onDeleteNotebook(nb)}>Del</button>
                      </div>
                    </div>

                    {(nb.chapters || []).map(ch => {
                      const active = (state.active.notebookId === nb.id && state.active.chapterId === ch.id)
                      return (
                        <div
                          key={ch.id}
                          className={`chap ${active ? 'active' : ''}`}
                          onClick={() => onSelect(nb.id, ch.id)}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div className="ttl" title={ch.title}>{ch.title}</div>
                            <div className="meta">{(ch.updatedAt || ch.createdAt || '').slice(0, 10)}</div>
                          </div>
                          <div className="mini" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => onRenameChapter(nb, ch)}>Ren</button>
                            <button onClick={() => onDeleteChapter(nb, ch)}>Del</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="np-right">
            <div className="editor-top">
              <div className="path">
                {activeNotebook ? activeNotebook.title : '—'} / {activeChapter ? activeChapter.title : '—'}
              </div>

              <div className="tabs">
                <button className={`tab ${editMode === 'write' ? 'active' : ''}`} onClick={() => setEditMode('write')}>Write</button>
                <button className={`tab ${editMode === 'preview' ? 'active' : ''}`} onClick={() => setEditMode('preview')}>Preview</button>
              </div>
            </div>

            {activeNotebook && activeChapter && editMode === 'write' && (
              <div className="toolbar">
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('bold')}>B</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('italic')}><em>I</em></button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('underline')}>U</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('strike')}>S</button>
                <div className="toolsep" />
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('h1')}>H1</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('h2')}>H2</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('h3')}>H3</button>
                <div className="toolsep" />
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('ul')}>• List</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('ol')}>1. List</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('quote')}>&gt;</button>
                <div className="toolsep" />
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('code')}>{'{ }'}</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('codeblock')}>```</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('link')}>🔗</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('hr')}>—</button>
              </div>
            )}

            {!activeNotebook || !activeChapter ? (
              <div className="preview">
                <div className="hint">Select a course + chapter on the left, or create one.</div>
              </div>
            ) : editMode === 'write' ? (
              <div className="editor">
                <textarea
                  ref={textareaRef}
                  className="np-text"
                  value={activeChapter.content || ''}
                  onChange={(e) => setChapterContent(e.target.value)}
                  placeholder={`# ${activeChapter.title}\n\nWrite notes here...\n`}
                />
              </div>
            ) : (
              <div className="preview">
                <MarkdownMessage text={activeChapter.content || '_Empty chapter._'} />
              </div>
            )}
          </div>
        </div>

        {/* ✅ Secret “AI” decor button */}
        <div
          className="ai-secret"
          title="AI"
          onClick={() => {
            setAiFloatOpen(true)
            setAiFloatMin(false)
          }}
        />
      </div>

      {/* ✅ Floating AI window */}
      {aiFloatOpen && (
        <div
          className={`ai-float ${aiFloatMin ? 'min' : ''}`}
          style={{ left: aiPos.x, top: aiPos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ai-float-head" onMouseDown={onAiDragStart}>
            <div className="ai-float-title">✨ AI</div>
            <div className="ai-float-actions">
              <button className="ai-mini" onClick={() => setAiFloatMin(v => !v)}>
                {aiFloatMin ? 'Open' : 'Min'}
              </button>
              <button className="ai-mini" onClick={() => { setAiFloatOpen(false); setAiFloatMin(false) }}>
                Close
              </button>
            </div>
          </div>

          {!aiFloatMin && (
            <div className="ai-float-body">
              <div className="ai-row ai-kinds">
                <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('summarize')}>Summarize</button>
                <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('cheatsheet')}>Cheatsheet</button>
                <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('flashcards')}>Flashcards</button>
                <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('quiz')}>Quiz</button>
                <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('rewrite')}>Rewrite</button>
                <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('explain')}>Explain</button>
              </div>

              <div className="ai-row">
                <select value={aiTarget} onChange={(e) => setAiTarget(e.target.value)} disabled={aiBusy}>
                  <option value="replace">Edit current (replace)</option>
                  <option value="append">Add to current (append)</option>
                  <option value="new">New chapter</option>
                </select>

                <select value={aiModel} onChange={(e) => setAiModel(e.target.value)} disabled={aiBusy}>
                  {aiModels.map(m => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))}
                </select>

                <button className="ai-mini ai-run" disabled={aiBusy} onClick={runAiCustom}>
                  {aiBusy ? 'Thinking…' : 'Run'}
                </button>
              </div>

              <textarea
                className="ai-prompt"
                placeholder='Ask: “Fix just the last section and add an example.”'
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                disabled={aiBusy}
              />

              <div className="hint" style={{ marginTop: 8 }}>
                Output: <b style={{ color: 'rgba(0,214,255,.95)' }}>{aiTarget}</b>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
