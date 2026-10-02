/**
 * Minimal, dependency-free markdown → HTML renderer tuned for chat output.
 * Handles: fenced code blocks, ATX headings, lists, blockquotes, hr,
 * inline code, bold, italic, strikethrough, and links.
 */

export interface RenderedMarkdown {
  html: string
  /** Raw source of every fenced code block, indexed by data-block. */
  blocks: string[]
}

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c])
}

function inline(src: string): string {
  let s = escapeHtml(src)
  // inline code (protect first so nothing else rewrites it)
  const codes: string[] = []
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code class="inline">${codes[Number(i)]}</code>`)
  return s
}

export function renderMarkdown(md: string): RenderedMarkdown {
  const blocks: string[] = []
  const out: string[] = []

  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let i = 0

  const listStack: Array<'ul' | 'ol'> = []
  const closeLists = () => {
    while (listStack.length) out.push(`</${listStack.pop()}>`)
  }

  while (i < lines.length) {
    const line = lines[i]

    /* ── fenced code ── */
    const fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line)
    if (fence) {
      closeLists()
      const lang = fence[1] || 'text'
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // consume closing fence (or run off the end while streaming)
      const code = buf.join('\n')
      const idx = blocks.push(code) - 1
      out.push(
        `<div class="codeblock" data-block="${idx}">` +
          `<div class="codeblock-head"><span class="codeblock-lang">${escapeHtml(lang)}</span>` +
          `<span class="codeblock-actions">` +
          `<button class="cb-btn" data-act="copy">Copy</button>` +
          `<button class="cb-btn" data-act="insert">Insert</button>` +
          `<button class="cb-btn" data-act="file">New file</button>` +
          `</span></div>` +
          `<pre><code>${escapeHtml(code)}</code></pre></div>`,
      )
      continue
    }

    /* ── horizontal rule ── */
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeLists()
      out.push('<hr>')
      i++
      continue
    }

    /* ── heading ── */
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      closeLists()
      const level = Math.min(h[1].length, 3)
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      i++
      continue
    }

    /* ── blockquote ── */
    if (/^\s*>\s?/.test(line)) {
      closeLists()
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`)
      continue
    }

    /* ── table ── */
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      closeLists()
      const cells = (r: string) =>
        r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(cells(lines[i]))
        i++
      }
      out.push(
        '<table><thead><tr>' +
          head.map((c) => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table>',
      )
      continue
    }

    /* ── lists ── */
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      const kind: 'ul' | 'ol' = ol ? 'ol' : 'ul'
      if (listStack[listStack.length - 1] !== kind) {
        closeLists()
        out.push(`<${kind}>`)
        listStack.push(kind)
      }
      out.push(`<li>${inline((ul ? ul[1] : ol![2]).trim())}</li>`)
      i++
      continue
    }

    closeLists()

    /* ── blank ── */
    if (!line.trim()) {
      i++
      continue
    }

    /* ── paragraph ── */
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`)
  }

  closeLists()
  return { html: out.join(''), blocks }
}
