// src/components/notes/notesStore.js
const LS_KEY = 'xenya.notes.v2'

const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 12)
    : (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 12))

const nowISO = () => new Date().toISOString()

const defaultState = () => ({
  version: 2,
  notebooks: [],
  active: { notebookId: null, chapterId: null },
})

export function loadNotesState() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaultState()
    if (!Array.isArray(parsed.notebooks)) return defaultState()
    return { ...defaultState(), ...parsed }
  } catch {
    return defaultState()
  }
}

export function saveNotesState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent('notes:changed'))
}

export function exportNotesJSON() {
  return JSON.stringify(loadNotesState(), null, 2)
}

export function importNotesJSON(jsonString) {
  const parsed = JSON.parse(jsonString)
  if (!parsed || !Array.isArray(parsed.notebooks)) throw new Error('Invalid notes backup format.')
  saveNotesState({ ...defaultState(), ...parsed, version: 2 })
}

export function createNotebook(title) {
  const s = loadNotesState()
  const nb = {
    id: 'nb_' + uid(),
    title: String(title || 'Untitled Course'),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    chapters: [],
  }
  s.notebooks = [nb, ...s.notebooks]
  s.active = { notebookId: nb.id, chapterId: null }
  saveNotesState(s)
  return nb
}

export function renameNotebook(notebookId, title) {
  const s = loadNotesState()
  const nb = s.notebooks.find(n => n.id === notebookId)
  if (!nb) return false
  nb.title = String(title || nb.title)
  nb.updatedAt = nowISO()
  saveNotesState(s)
  return true
}

export function deleteNotebook(notebookId) {
  const s = loadNotesState()
  s.notebooks = s.notebooks.filter(n => n.id !== notebookId)
  if (s.active.notebookId === notebookId) {
    s.active = { notebookId: s.notebooks[0]?.id || null, chapterId: null }
  }
  saveNotesState(s)
  return true
}

export function createChapter(notebookId, title) {
  const s = loadNotesState()
  const nb = s.notebooks.find(n => n.id === notebookId)
  if (!nb) return null
  const ch = {
    id: 'ch_' + uid(),
    title: String(title || 'New Chapter'),
    content: '',
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }
  nb.chapters = [ch, ...(nb.chapters || [])]
  nb.updatedAt = nowISO()
  s.active = { notebookId, chapterId: ch.id }
  saveNotesState(s)
  return ch
}

export function renameChapter(notebookId, chapterId, title) {
  const s = loadNotesState()
  const nb = s.notebooks.find(n => n.id === notebookId)
  if (!nb) return false
  const ch = (nb.chapters || []).find(c => c.id === chapterId)
  if (!ch) return false
  ch.title = String(title || ch.title)
  ch.updatedAt = nowISO()
  nb.updatedAt = nowISO()
  saveNotesState(s)
  return true
}

export function deleteChapter(notebookId, chapterId) {
  const s = loadNotesState()
  const nb = s.notebooks.find(n => n.id === notebookId)
  if (!nb) return false
  nb.chapters = (nb.chapters || []).filter(c => c.id !== chapterId)
  nb.updatedAt = nowISO()
  if (s.active.chapterId === chapterId) {
    s.active.chapterId = nb.chapters[0]?.id || null
  }
  saveNotesState(s)
  return true
}

export function setActive(notebookId, chapterId) {
  const s = loadNotesState()
  s.active = { notebookId, chapterId }
  saveNotesState(s)
}

export function updateChapterContent(notebookId, chapterId, content) {
  const s = loadNotesState()
  const nb = s.notebooks.find(n => n.id === notebookId)
  if (!nb) return false
  const ch = (nb.chapters || []).find(c => c.id === chapterId)
  if (!ch) return false
  ch.content = String(content ?? '')
  ch.updatedAt = nowISO()
  nb.updatedAt = nowISO()
  saveNotesState(s)
  return true
}
