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
  runNotesAiAndSave,
  runNotesAiCustomAndSave,
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
  const [aiOpen, setAiOpen] = useState(true)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiModels, setAiModels] = useState([])

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

  // Load AI models when popup opens (or when first time)
  useEffect(() => {
    if (!open) return
    ;(async () => {
      try {
        const r = await fetchAiModels()
        setAiModels(r.models || [])
        setAiModel(r.active || (r.models?.[0]?.name || ''))
      } catch {
        // ignore; panel will still show
      }
    })()
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
     WORD-LIKE TOOLBAR ACTIONS
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
     AI ACTIONS (uses notesai.js)
     ========================= */

  const runAiKind = async (kind) => {
    if (!activeNotebook || !activeChapter) return
    if (!aiModel) { alert('No model selected.'); return }

    setAiBusy(true)
    try {
      const next = await runNotesAiAndSave({
        notebookId: activeNotebook.id,
        baseChapterTitle: activeChapter.title,
        kind,
        notesText: activeChapter.content || '',
        model: aiModel,
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
      const next = await runNotesAiCustomAndSave({
        notebookId: activeNotebook.id,
        baseChapterTitle: activeChapter.title,
        userRequest: q,
        notesText: activeChapter.content || '',
        model: aiModel,
      })
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

  if (!open) return null

  return (
    <>
      <style>{`
        .np-backdrop{
          position:fixed; inset:0; z-index:10060;
          background:rgba(0,0,0,.45);
          backdrop-filter: blur(8px);
        }
        .np-panel{
          position:fixed; right:16px; top:72px; bottom:16px;
          width:min(980px, calc(100vw - 32px));
          z-index:10070;
          border:1px solid rgba(255,255,255,.12);
          border-radius:18px;
          background:rgba(10,10,16,.92);
          box-shadow: 0 18px 60px rgba(0,0,0,.55);
          overflow:hidden;
          display:flex; flex-direction:column;
        }
        .np-collapsed{ width: 360px; }
        .np-head{
          display:flex; align-items:center; justify-content:space-between;
          padding:12px 14px;
          border-bottom:1px solid rgba(255,255,255,.10);
          background: linear-gradient(180deg, rgba(122,62,255,.22), rgba(0,0,0,0));
        }
        .np-title{display:flex; gap:10px; align-items:center; font-weight:700}
        .np-pill{
          font-size:12px; opacity:.85;
          padding:4px 10px; border-radius:999px;
          border:1px solid rgba(255,255,255,.14);
          background:rgba(255,255,255,.06);
        }
        .np-actions{display:flex; gap:8px; align-items:center}
        .np-btn{
          padding:8px 10px; border-radius:12px;
          border:1px solid rgba(255,255,255,.14);
          background:rgba(255,255,255,.06);
          color:#eee; cursor:pointer;
        }
        .np-btn:hover{background:rgba(255,255,255,.10)}
        .np-btn.primary{
          border-color: rgba(122,62,255,.5);
          background: rgba(122,62,255,.25);
        }
        .np-body{
          flex:1;
          display:grid;
          grid-template-columns: 300px 1fr;
          min-height:0;
        }
        .np-collapsed .np-body{ grid-template-columns: 1fr; }
        .np-left{
          border-right:1px solid rgba(255,255,255,.10);
          display:flex; flex-direction:column;
          min-height:0;
        }
        .np-search{
          padding:10px;
          border-bottom:1px solid rgba(255,255,255,.10);
        }
        .np-search input{
          width:100%;
          padding:10px 12px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,.14);
          background:rgba(0,0,0,.35);
          color:#eee;
          outline:none;
        }
        .np-tree{ padding:10px; overflow:auto; }
        .nb{
          border:1px solid rgba(255,255,255,.10);
          background: rgba(255,255,255,.04);
          border-radius:14px;
          margin-bottom:10px;
          overflow:hidden;
        }
        .nb-head{
          display:flex; align-items:center; justify-content:space-between;
          padding:10px 10px;
          gap:8px;
          background: rgba(255,255,255,.04);
          border-bottom:1px solid rgba(255,255,255,.08);
        }
        .nb-head .name{
          font-weight:700;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .nb-head .mini{ display:flex; gap:6px; }
        .mini button{
          font-size:12px;
          padding:6px 8px;
          border-radius:10px;
          border:1px solid rgba(255,255,255,.12);
          background:rgba(0,0,0,.18);
          color:#eee;
          cursor:pointer;
        }
        .mini button:hover{background:rgba(255,255,255,.08)}
        .chap{
          padding:8px 10px;
          display:flex; align-items:center; justify-content:space-between;
          gap:10px;
          cursor:pointer;
        }
        .chap:hover{background:rgba(255,255,255,.06)}
        .chap.active{
          background: rgba(122,62,255,.20);
          border-left: 3px solid rgba(122,62,255,.85);
        }
        .chap .ttl{
          font-size:14px;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .chap .meta{font-size:12px; opacity:.7}

        .np-right{
          min-height:0;
          display:flex; flex-direction:column;
        }
        .editor-top{
          display:flex; align-items:center; justify-content:space-between;
          padding:10px 12px;
          border-bottom:1px solid rgba(255,255,255,.10);
        }
        .editor-top .path{
          font-weight:700;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .tabs{display:flex; gap:8px}
        .tab{
          padding:8px 10px; border-radius:12px;
          border:1px solid rgba(255,255,255,.14);
          background:rgba(255,255,255,.06);
          cursor:pointer; color:#eee;
          font-weight:600; font-size:13px;
        }
        .tab.active{
          border-color: rgba(122,62,255,.5);
          background: rgba(122,62,255,.25);
        }

        /* Toolbar */
        .toolbar{
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          padding:10px 12px;
          border-bottom:1px solid rgba(255,255,255,.10);
          background: rgba(0,0,0,.18);
        }
        .toolbtn{
          padding:7px 9px;
          border-radius:12px;
          border:1px solid rgba(255,255,255,.14);
          background:rgba(255,255,255,.06);
          color:#eee;
          cursor:pointer;
          font-weight:700;
          font-size:13px;
          user-select:none;
        }
        .toolbtn:hover{background:rgba(255,255,255,.10)}
        .toolsep{
          width:1px;
          background:rgba(255,255,255,.10);
          margin:0 2px;
        }
        .toolhint{
          font-size:12px;
          opacity:.75;
          margin-left:auto;
          display:flex;
          align-items:center;
          gap:10px;
        }
        .kbd{
          border:1px solid rgba(255,255,255,.14);
          border-bottom-color: rgba(255,255,255,.20);
          background:rgba(255,255,255,.06);
          padding:3px 7px;
          border-radius:8px;
          font-size:12px;
        }

        /* AI panel */
        .ai-panel{
          padding:10px 12px;
          border-bottom:1px solid rgba(255,255,255,.10);
          background: rgba(0,0,0,.12);
        }
        .ai-head{
          display:flex; align-items:center; justify-content:space-between; gap:10px;
          font-weight:800;
        }
        .ai-row{display:flex; gap:8px; flex-wrap:wrap; margin-top:10px}
        .ai-row select{
          height:36px;
        }
        .ai-prompt{
          margin-top:10px;
          width:100%;
          min-height:70px;
          resize:vertical;
        }

        .editor{ flex:1; min-height:0; display:grid; grid-template-columns: 1fr; }
        textarea.np-text{
          width:100%; height:100%;
          padding:14px;
          border:0;
          outline:none;
          background: rgba(0,0,0,.25);
          color:#eee;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size:14px;
          line-height:1.5;
          resize:none;
        }
        .preview{
          padding:14px;
          overflow:auto;
          background: rgba(0,0,0,.18);
        }
        .hint{ font-size:12px; opacity:.75; }
      `}</style>

      <div className="np-backdrop" onClick={onClose} />
      <div className={`np-panel ${collapsed ? 'np-collapsed' : ''}`} onClick={(e)=>e.stopPropagation()}>
        <div className="np-head">
          <div className="np-title">
            <span>🗂️ Course Notes</span>
            <span className="np-pill">
              {saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}
            </span>
          </div>

          <div className="np-actions">
            <button className="np-btn" onClick={onImport} title="Import backup">Import</button>
            <button className="np-btn" onClick={onExport} title="Export backup">Export</button>
            <button className="np-btn primary" onClick={onNewNotebook}>+ Course</button>
            <button className="np-btn" onClick={() => setCollapsed(v => !v)} title="Collapse/Expand">
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
            <button className="np-btn" onClick={onClose} title="Close">Close</button>
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
                {filteredNotebooks.length === 0 && (
                  <div className="hint">No notebooks yet. Create one with “+ Course”.</div>
                )}

                {filteredNotebooks.map(nb => (
                  <div className="nb" key={nb.id}>
                    <div className="nb-head">
                      <div className="name" title={nb.title}>{nb.title}</div>
                      <div className="mini">
                        <button onClick={() => onNewChapter(nb)} title="New chapter">+ Ch</button>
                        <button onClick={() => onRenameNotebook(nb)} title="Rename">Rename</button>
                        <button onClick={() => onDeleteNotebook(nb)} title="Delete">Del</button>
                      </div>
                    </div>

                    {(nb.chapters || []).length === 0 ? (
                      <div className="chap" onClick={() => onNewChapter(nb)}>
                        <div className="ttl">+ Create first chapter</div>
                        <div className="meta">file</div>
                      </div>
                    ) : (
                      (nb.chapters || []).map(ch => {
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
                              <button onClick={() => onRenameChapter(nb, ch)} title="Rename file">Ren</button>
                              <button onClick={() => onDeleteChapter(nb, ch)} title="Delete file">Del</button>
                            </div>
                          </div>
                        )
                      })
                    )}
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

            {/* Toolbar only when writing & chapter selected */}
            {activeNotebook && activeChapter && editMode === 'write' && (
              <div className="toolbar">
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('bold')} title="Bold">B</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('italic')} title="Italic"><em>I</em></button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('underline')} title="Underline (HTML)">U</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('strike')} title="Strikethrough">S</button>

                <div className="toolsep" />

                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('h1')} title="Heading 1">H1</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('h2')} title="Heading 2">H2</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('h3')} title="Heading 3">H3</button>

                <div className="toolsep" />

                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('ul')} title="Bulleted list">• List</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('ol')} title="Numbered list">1. List</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('quote')} title="Quote">&gt;</button>

                <div className="toolsep" />

                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('code')} title="Inline code">{'{ }'}</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('codeblock')} title="Code block">```</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('link')} title="Insert link">🔗</button>
                <button className="toolbtn" onMouseDown={(e) => e.preventDefault()} onClick={() => onToolbar('hr')} title="Horizontal line">—</button>

                <div className="toolhint">
                  Tip: select text first
                  <span className="kbd">Ctrl</span>+<span className="kbd">A</span> to apply on whole doc
                </div>
              </div>
            )}

            {/* AI Panel only when writing & chapter selected */}
            {activeNotebook && activeChapter && editMode === 'write' && (
              <div className="ai-panel">
                <div className="ai-head">
                  <div>✨ AI Tools</div>
                  <button className="np-btn" onClick={() => setAiOpen(v => !v)}>{aiOpen ? 'Hide' : 'Show'}</button>
                </div>

                {aiOpen && (
                  <>
                    <div className="ai-row">
                      <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('summarize')}>Summarize</button>
                      <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('cheatsheet')}>Cheatsheet</button>
                      <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('flashcards')}>Flashcards</button>
                      <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('quiz')}>Quiz</button>
                      <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('rewrite')}>Rewrite</button>
                      <button className="toolbtn" disabled={aiBusy} onClick={() => runAiKind('explain')}>Explain</button>
                    </div>

                    <div className="ai-row" style={{ alignItems: 'center' }}>
                      <select
                        className="select"
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        disabled={aiBusy}
                        style={{ height: 36 }}
                      >
                        {aiModels.map(m => (
                          <option key={m.name} value={m.name}>{m.name}</option>
                        ))}
                      </select>

                      <button className="np-btn primary" disabled={aiBusy} onClick={runAiCustom}>
                        {aiBusy ? 'Thinking…' : 'Run'}
                      </button>

                      <span className="hint" style={{ marginLeft: 'auto' }}>
                        Output → new chapter
                      </span>
                    </div>

                    <textarea
                      className="select ai-prompt"
                      placeholder='Ask: “Make 10 exam questions from this chapter”'
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      disabled={aiBusy}
                    />
                  </>
                )}
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
                  placeholder={`# ${activeChapter.title}\n\nUse the toolbar above like Word 🙂\n\n- Bold/Italic/Headings/Lists\n- Links, code blocks, quotes\n\n`}
                />
              </div>
            ) : (
              <div className="preview">
                <MarkdownMessage text={activeChapter.content || '_Empty chapter._'} />
              </div>
            )}

            <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,.10)' }}>
              <div className="hint">
                Toolbar applies Markdown automatically. AI outputs are saved as new chapters.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
