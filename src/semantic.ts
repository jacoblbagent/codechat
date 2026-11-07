import { monaco } from './monaco'

/* ── Call colouring for TypeScript and JavaScript ─────────────────
   Monaco's TypeScript mode has no semantic token provider, so its
   tokenizer gives every name the same `identifier` token: a call, a
   property and a local variable all come out one colour. One Dark Pro
   paints calls blue (#61afef) and everything else red, and that single
   difference is most of what makes the editor look wrong next to VS Code.

   The TypeScript worker cannot help here — monaco-typescript exposes no
   classification call — so this reads the text itself: one pass that
   tracks strings and comments (so nothing inside them is touched) and
   marks a name as a call when the next non-space character is `(`.
   Keywords, `new Foo(` and `obj.method(` are left alone: the tokenizer
   already colours those correctly.

   It also re-colours the two things Monaco's grammar gets wrong for this
   theme: built-in type keywords (`number`, `string`, …) are yellow in One
   Dark Pro but purple here, and `true`/`false`/`null` are orange, not
   purple. Everything else keeps the colour the theme's own rules give it. */

const LEGEND = ['function', 'type', 'constant', 'property'] as const

/** Built-in type keywords: One Dark Pro paints these yellow, Monaco purple. */
const PRIMITIVES = new Set([
  'number', 'string', 'boolean', 'any', 'unknown', 'never', 'void', 'object',
  'symbol', 'bigint',
])

/** Literal constants: One Dark Pro paints these orange, Monaco purple. */
const CONSTANTS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'])

/** Words that look like calls but are syntax, not names. */
const RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof',
  'in', 'of', 'do', 'else', 'try', 'finally', 'throw', 'case', 'delete',
  'void', 'yield', 'await', 'new', 'function', 'class', 'super', 'this',
  'import', 'export', 'default', 'const', 'let', 'var', 'async', 'with',
])

const IDENT = /[A-Za-z_$][\w$]*/y

/** Index of the next non-space character at or after `i`, or -1. */
function nextSignificant(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) i++
  return i < text.length ? i : -1
}

/** Index of the previous non-space character before `i`, or -1. */
function prevSignificant(text: string, i: number): number {
  let j = i - 1
  while (j >= 0 && /\s/.test(text[j])) j--
  return j
}

/** Call-site spans, as [start, length] pairs, in document order. */
function callSpans(text: string): number[] {
  const spans: number[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]

    // Comments and strings are skipped whole so their contents never match.
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end + 1
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1
      while (j < text.length) {
        if (text[j] === '\\') j += 2
        else if (text[j] === ch) break
        else j++
      }
      i = j + 1
      continue
    }

    if (/[A-Za-z_$]/.test(ch)) {
      IDENT.lastIndex = i
      const match = IDENT.exec(text)
      if (!match) {
        i++
        continue
      }
      const word = match[0]
      const end = i + word.length
      const after = nextSignificant(text, end)
      const before = prevSignificant(text, i)

      const isCall =
        after !== -1 &&
        text[after] === '(' &&
        !RESERVED.has(word) &&
        // `new Foo(` names a type, not a call.
        !/\bnew\s+$/.test(text.slice(Math.max(0, i - 8), i))
      const isProperty = before !== -1 && (text[before] === '.' || text[before] === '?')

      if (PRIMITIVES.has(word)) spans.push(i, word.length, 1)
      else if (CONSTANTS.has(word)) spans.push(i, word.length, 2)
      else if (isCall) spans.push(i, word.length, 0)
      else if (isProperty) spans.push(i, word.length, 3)
      i = end
      continue
    }

    i++
  }
  return spans
}

let installed = false

export function installSemanticColours(): void {
  if (installed) return
  installed = true

  const provider: monaco.languages.DocumentSemanticTokensProvider = {
    getLegend: () => ({ tokenTypes: [...LEGEND], tokenModifiers: [] }),

    provideDocumentSemanticTokens(model) {
      const spans = callSpans(model.getValue())
      const data: number[] = []
      let line = 0
      let column = 0
      for (let i = 0; i < spans.length; i += 3) {
        const pos = model.getPositionAt(spans[i])
        const deltaLine = pos.lineNumber - 1 - line
        const deltaStart = deltaLine === 0 ? pos.column - 1 - column : pos.column - 1
        data.push(deltaLine, deltaStart, spans[i + 1], spans[i + 2], 0)
        line = pos.lineNumber - 1
        column = pos.column - 1
      }
      return { data: new Uint32Array(data) }
    },

    releaseDocumentSemanticTokens() {
      /* nothing cached */
    },
  }

  for (const language of ['typescript', 'javascript']) {
    monaco.languages.registerDocumentSemanticTokensProvider(language, provider)
  }
}
