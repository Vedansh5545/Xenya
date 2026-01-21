// src/components/notesai.js
import { chat, listModels } from '../lib/api'
import {
  createChapter,
  updateChapterContent,
  setActive,
  loadNotesState,
} from './notes/notesStore.js'

/** Load available models for the AI panel */
export async function fetchAiModels() {
  const r = await listModels()
  return {
    models: r?.models || [],
    active: r?.active || '',
  }
}

function safeTitle(s) {
  const t = String(s || '').trim()
  if (!t) return 'AI Output'
  return t.length > 50 ? t.slice(0, 50) + '…' : t
}

/** Build a prompt based on action kind */
export function buildAiPrompt(kind, notesText, chapterTitle) {
  const text = (notesText || '').trim() || '(empty notes)'
  const ch = chapterTitle || 'Chapter'

  switch (kind) {
    case 'summarize':
      return `Summarize these notes into concise study bullets. Add a short "Key terms" section.\n\nCHAPTER: ${ch}\n\nNOTES:\n${text}`
    case 'cheatsheet':
      return `Create a compact exam cheatsheet from these notes. Use headings, formulas, pitfalls, and quick examples. Keep it dense but readable.\n\nCHAPTER: ${ch}\n\nNOTES:\n${text}`
    case 'flashcards':
      return `Convert these notes into flashcards in Q/A format. Make 15–25 cards. Use markdown.\n\nCHAPTER: ${ch}\n\nNOTES:\n${text}`
    case 'quiz':
      return `Create a quiz from these notes: 10 questions (mix of short answer + multiple choice). Provide an answer key at the end.\n\nCHAPTER: ${ch}\n\nNOTES:\n${text}`
    case 'rewrite':
      return `Rewrite these notes to be cleaner, structured, and easier to revise. Keep meaning; improve clarity. Use markdown headings.\n\nCHAPTER: ${ch}\n\nNOTES:\n${text}`
    case 'explain':
      return `Explain these notes intuitively with simple examples. Then add 5 quick checkpoints at the end.\n\nCHAPTER: ${ch}\n\nNOTES:\n${text}`
    default:
      return `Help me with these notes.\n\nCHAPTER: ${ch}\n\nNOTES:\n${text}`
  }
}

/**
 * Run an AI action and save output as a NEW chapter.
 * Returns the updated notes state.
 */
export async function runNotesAiAndSave({
  notebookId,
  baseChapterTitle,
  kind,
  notesText,
  model,
  system = "You are Xenya Notes AI. Be structured, accurate, and helpful. Use markdown.",
}) {
  if (!notebookId) throw new Error('Missing notebookId.')
  const prompt = buildAiPrompt(kind, notesText, baseChapterTitle)

  const resp = await chat({
    system,
    model,
    messages: [{ role: 'user', content: prompt }],
  })

  const out = resp?.reply ?? resp?.message?.content ?? '(no reply)'

  const title = safeTitle(`AI – ${String(kind || 'output').toUpperCase()} – ${baseChapterTitle || 'Chapter'}`)
  const ch = createChapter(notebookId, title)
  if (!ch?.id) throw new Error('Failed to create AI chapter.')

  updateChapterContent(notebookId, ch.id, out)
  setActive(notebookId, ch.id)

  return loadNotesState()
}

/**
 * Run a custom AI request and save output as a NEW chapter.
 * Returns the updated notes state.
 */
export async function runNotesAiCustomAndSave({
  notebookId,
  baseChapterTitle,
  userRequest,
  notesText,
  model,
  system = "You are Xenya Notes AI. Use markdown. If asked for study content, keep it structured.",
}) {
  if (!notebookId) throw new Error('Missing notebookId.')
  const q = String(userRequest || '').trim()
  if (!q) throw new Error('Empty request.')

  const text = (notesText || '').trim() || '(empty notes)'
  const ch = baseChapterTitle || 'Chapter'

  const prompt = `USER REQUEST:\n${q}\n\nCHAPTER: ${ch}\n\nNOTES:\n${text}`

  const resp = await chat({
    system,
    model,
    messages: [{ role: 'user', content: prompt }],
  })

  const out = resp?.reply ?? resp?.message?.content ?? '(no reply)'

  const title = safeTitle(`AI – ${q} – ${ch}`)
  const newCh = createChapter(notebookId, title)
  if (!newCh?.id) throw new Error('Failed to create AI chapter.')

  updateChapterContent(notebookId, newCh.id, out)
  setActive(notebookId, newCh.id)

  return loadNotesState()
}
