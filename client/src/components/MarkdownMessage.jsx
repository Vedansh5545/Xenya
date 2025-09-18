import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Normalize markdown while PRESERVING fenced code blocks.
 * Goals:
 *  - Fix spaced bold: "** hello **" -> "**hello**"
 *  - Convert leading "• " to proper "- "
 *  - Insert a line break before a NEW list only in the "(... ) - **Heading**" pattern
 *    (do NOT trigger on ":" or other punctuation)
 *  - Flatten accidental shallow sublists (1–2 space indents) to top-level
 *  - Keep code blocks intact
 */
function normalizeMdPreserveCode(input){
  const blocks = []
  const token = (m)=>{ blocks.push(m); return `@@BLOCK${blocks.length-1}@@` }
  let s = String(input || '')

  // Protect fenced code blocks: ``` ... ```
  s = s.replace(/```[\s\S]*?```/g, token)

  // 1) Fix spaced bold: "** hello **" -> "**hello**"
  s = s.replace(/\*\*\s+([^*][^*]*?)\s+\*\*/g, '**$1**')

  // 2) Convert leading bullet dots "• " to markdown dashes
  s = s.replace(/^\s*•\s+/gm, '- ')

  // 3) Insert newline before a REAL new list only for the pattern ") - **Heading**"
  //    (prevents breaking "Category:- Item", "EVs: - Tesla ..." etc.)
  s = s.replace(/\)\s*-\s+(?=\*\*|[A-Z])/g, ')\n- ')

  // 4) Flatten shallow accidental sublists: 1–2 leading spaces before "-"
  //    Many models emit "  - item" unintentionally; treat as top-level.
  s = s.replace(/^\s{1,2}-\s+/gm, '- ')

  // 5) Trim stray spaces before newlines
  s = s.replace(/[ \t]+\n/g, '\n')

  // Restore fenced code blocks
  s = s.replace(/@@BLOCK(\d+)@@/g, (_,i)=>blocks[i])

  return s
}

async function copy(text){
  try { await navigator.clipboard.writeText(text) } catch {}
}

export default function MarkdownMessage({ text = '' }){
  const md = normalizeMdPreserveCode(text)

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ href, children, ...props }){
          const url = String(href || '')
          return (
            <a href={url} target="_blank" rel="noopener noreferrer" title={url} {...props}>
              {children}
            </a>
          )
        },
        code({inline, className, children, ...props}){
          const code = String(children || '').replace(/\n$/, '')
          if (inline) return <code className="md-inline-code" {...props}>{code}</code>
          return (
            <div className="code-block">
              <button className="copy-btn" onClick={()=>copy(code)}>Copy</button>
              <pre><code className={className} {...props}>{code}</code></pre>
            </div>
          )
        },
        h1({children}){ return <h1 className="md-h1">{children}</h1> },
        h2({children}){ return <h2 className="md-h2">{children}</h2> },
        h3({children}){ return <h3 className="md-h3">{children}</h3> },
        ul({children}){ return <ul className="md-ul">{children}</ul> },
        ol({children}){ return <ol className="md-ol">{children}</ol> },
        p({children}){ return <p className="md-p">{children}</p> }
      }}
    >
      {md}
    </ReactMarkdown>
  )
}
