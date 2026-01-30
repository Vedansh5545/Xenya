// src/components/MarkdownMessage.jsx
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'

/**
 * Normalize markdown while PRESERVING fenced code blocks.
 * Goals:
 *  - Fix spaced bold: "** hello **" -> "**hello**"
 *  - Convert leading "• " to proper "- "
 *  - Insert a line break before a NEW list only in the "(... ) - **Heading**" pattern
 *    (do NOT trigger on ":" or other punctuation)
 *  - Flatten accidental shallow sublists (1–2 space indents) to top-level
 *  - Keep code blocks intact
 *
 * Fixes for your current issues:
 *  - Normalize Windows/Mac line endings to "\n" so headings/lists don't collapse
 *  - Ensure headings start on their own line if "##" appears mid-line
 *  - Ensure list markers start on their own line if "- " or "1. " appears mid-line
 *  - Fix glued marker after bold/italic/link/code: "**x**- item" -> "**x**\n- item"
 */
function normalizeMdPreserveCode(input) {
  const blocks = []
  const token = (m) => {
    blocks.push(m)
    return `@@BLOCK${blocks.length - 1}@@`
  }

  let s = String(input || '')

  // ✅ CRITICAL: normalize line endings FIRST
  // Converts "\r\n" and "\r" into "\n"
  s = s.replace(/\r\n?/g, '\n')

  // Protect fenced code blocks: ``` ... ```
  s = s.replace(/```[\s\S]*?```/g, token)

  // 1) Fix spaced bold: "** hello **" -> "**hello**"
  s = s.replace(/\*\*\s+([^*][^*]*?)\s+\*\*/g, '**$1**')

  // 2) Convert leading bullet dots "• " to markdown dashes
  s = s.replace(/^\s*•\s+/gm, '- ')

  // 3) Insert newline before a REAL new list only for ") - **Heading**"
  s = s.replace(/\)\s*-\s+(?=\*\*|[A-Z])/g, ')\n- ')

  // 4) Flatten shallow accidental sublists (1–2 spaces)
  s = s.replace(/^\s{1,2}-\s+/gm, '- ')

  // 5) Trim stray spaces before newlines
  s = s.replace(/[ \t]+\n/g, '\n')

  /* =========================
     NEW: heading robustness
     ========================= */

  // If a heading marker appears mid-line, move it to a new line.
  // Example: "Title ### Sub" -> "Title\n### Sub"
  s = s.replace(/([^\n])\s*(#{1,6}\s+)/g, '$1\n$2')

  /* =========================
     NEW: list robustness
     ========================= */

  // A) If "- " appears mid-line, start a new list item on a new line
  s = s.replace(/([^\n])\s+(-\s+)/g, '$1\n$2')

  // B) If "1. " appears mid-line, start it on a new line
  s = s.replace(/([^\n])\s+(\d+\.\s+)/g, '$1\n$2')

  // C) If a list marker is glued to a closing emphasis/link/code token, break it
  // Examples:
  //   "**bold**- next" -> "**bold**\n- next"
  //   "*ital*- next"   -> "*ital*\n- next"
  //   "`x`- next"      -> "`x`\n- next"
  //   "[t](u)- next"   -> "[t](u)\n- next"
  s = s.replace(
    /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^\)\n]+\))\s*-\s+/g,
    '$1\n- '
  )

  // Restore fenced code blocks
  s = s.replace(/@@BLOCK(\d+)@@/g, (_, i) => blocks[i])

  return s
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {}
}

export default function MarkdownMessage({ text = '' }) {
  const md = normalizeMdPreserveCode(text)

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      // ✅ allows <u>underline</u> safely (sanitize prevents dangerous HTML)
      rehypePlugins={[rehypeRaw, rehypeSanitize]}
      components={{
        a({ href, children, ...props }) {
          const url = String(href || '')
          return (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={url}
              {...props}
            >
              {children}
            </a>
          )
        },

        code({ inline, className, children, ...props }) {
          const code = String(children || '').replace(/\n$/, '')
          if (inline) {
            return (
              <code className="md-inline-code" {...props}>
                {code}
              </code>
            )
          }

          return (
            <div className="code-block">
              <button className="copy-btn" onClick={() => copy(code)}>
                Copy
              </button>
              <pre>
                <code className={className} {...props}>
                  {code}
                </code>
              </pre>
            </div>
          )
        },

        h1({ children }) { return <h1 className="md-h1">{children}</h1> },
        h2({ children }) { return <h2 className="md-h2">{children}</h2> },
        h3({ children }) { return <h3 className="md-h3">{children}</h3> },
        ul({ children }) { return <ul className="md-ul">{children}</ul> },
        ol({ children }) { return <ol className="md-ol">{children}</ol> },
        p({ children }) { return <p className="md-p">{children}</p> },
      }}
    >
      {md}
    </ReactMarkdown>
  )
}
