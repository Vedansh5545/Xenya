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
 * NEW: Run AI and APPLY result to an existing chapter (linear editing).
 *
 * target:
 *  - 'replace': overwrite current chapter content
 *  - 'append' : append AI output at the end (with divider)
 *  - 'new'    : create a new chapter (delegates to save helpers)
 *
 * Returns the updated notes state.
 */
export async function runNotesAiAndApply({
  notebookId,
  chapterId,
  chapterTitle,
  kind, // optional: if you want a preset prompt style
  userRequest, // optional: custom instruction
  notesText,
  model,
  target = 'replace',
  system = "You are Xenya Notes AI. Modify notes carefully. Preserve intent. Use clean markdown.",
}) {
  if (!notebookId) throw new Error('Missing notebookId.')
  if (!chapterId && target !== 'new') throw new Error('Missing chapterId.')

  const current = (notesText || '').trim() || '(empty notes)'
  const chTitle = chapterTitle || 'Chapter'

  // Decide prompt:
  // - If a kind is provided, use buildAiPrompt for structured actions
  // - If a custom request is provided, use that
  // - Otherwise fallback to a generic helpful instruction
  let prompt = ''
  if (target === 'new') {
    // For 'new', we want the output as new chapter, not "only updated notes"
    if (userRequest && String(userRequest).trim()) {
      // use custom save path (below)
      return await runNotesAiCustomAndSave({
        notebookId,
        baseChapterTitle: chTitle,
        userRequest,
        notesText: current,
        model,
        system,
      })
    }
    return await runNotesAiAndSave({
      notebookId,
      baseChapterTitle: chTitle,
      kind: kind || 'rewrite',
      notesText: current,
      model,
      system,
    })
  }

  if (kind) {
    // Force "edit mode" rules on top of kind prompt
    const base = buildAiPrompt(kind, current, chTitle)
    prompt = [
      `You are editing the user's CURRENT notes in-place.`,
      `Return ONLY the updated notes (no commentary, no change log).`,
      `Keep markdown clean; preserve meaning; improve as requested.`,
      ``,
      base,
    ].join('\n')
  } else {
    const q = String(userRequest || '').trim()
    prompt = [
      `USER REQUEST:`,
      q || 'Improve these notes while preserving meaning.',
      ``,
      `RULES:`,
      `- Return ONLY the UPDATED notes (no explanations, no change log).`,
      `- Keep markdown clean and consistent.`,
      `- Preserve intent; do not invent facts.`,
      ``,
      `CHAPTER: ${chTitle}`,
      ``,
      `CURRENT NOTES:`,
      current,
    ].join('\n')
  }

  const resp = await chat({
    system,
    model,
    messages: [{ role: 'user', content: prompt }],
  })

  const out = resp?.reply ?? resp?.message?.content ?? current

  if (target === 'replace') {
    updateChapterContent(notebookId, chapterId, out)
  } else if (target === 'append') {
    const divider = `\n\n---\n\n`
    updateChapterContent(notebookId, chapterId, (notesText || '') + divider + out)
  } else {
    // safety fallback
    updateChapterContent(notebookId, chapterId, out)
  }

  setActive(notebookId, chapterId)
  return loadNotesState()
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

  const title = safeTitle(
    `AI – ${String(kind || 'output').toUpperCase()} – ${baseChapterTitle || 'Chapter'}`
  )
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
