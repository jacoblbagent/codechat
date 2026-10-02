/**
 * Settings catalogue.
 *
 * Two scopes, rendered as two sections of the settings page:
 *
 *  - `vscode` — the core settings a VS Code user expects, under `editor.*`,
 *    `workbench.*` and `files.*`. Every id matches the real VS Code setting
 *    name, and every `monaco` path is a real option in the Monaco editor
 *    options interface (0.52.x), not a guess.
 *  - `app` — settings this project invented, kept in their own section.
 *
 * Defaults are the values this IDE actually ships with, so a fresh install
 * looks exactly like it did before the settings page existed. Where that
 * differs from VS Code's factory default (this app ships a 2-space indent, a
 * ligature-friendly font stack and lineHeight 1.55), the app's value wins —
 * the page shows the configuration, not the upstream default.
 */

export type Scope = 'vscode' | 'app'

export interface SelectOption {
  value: string
  label: string
}

export interface SettingDef {
  /** Dotted id, matching the VS Code setting name where one exists. */
  id: string
  label: string
  description: string
  type: 'boolean' | 'number' | 'select' | 'text' | 'password' | 'info'
  default: string | number | boolean
  options?: SelectOption[]
  min?: number
  max?: number
  step?: number
  placeholder?: string
  /** Dot path into the Monaco editor options, e.g. `minimap.enabled`. */
  monaco?: string
  /** Shell-owned rather than Monaco-owned. */
  ui?: 'theme' | 'sidebarWidth' | 'chatWidth'
  /** A select that also accepts a free-form value (model ids). */
  allowCustom?: boolean
  /**
   * A select whose options come from a live source rather than `options`.
   * The settings page renders whatever the host mounts for this key (see
   * `SettingsUiDeps.liveSelect`); without one the row degrades to a text field.
   */
  optionsSource?: 'openrouter-models'
  /**
   * A read-only row that reports something rather than setting it. The host
   * mounts whatever it wants for this key (see `SettingsUiDeps.liveInfo`); the
   * row gets no reset arrow and is never "modified".
   */
  infoSource?: 'openrouter-credits'
  /** Password fields get a Clear button. */
  clearable?: boolean
  /** Long single-line values (a font stack) get a wider field. */
  wide?: boolean
}

export interface SettingGroup {
  id: string
  label: string
  scope: Scope
  settings: SettingDef[]
}

export const FONT_STACK =
  "'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace"

const s = (
  id: string,
  label: string,
  description: string,
  type: SettingDef['type'],
  def: string | number | boolean,
  extra: Partial<SettingDef> = {},
): SettingDef => ({ id, label, description, type, default: def, ...extra })

const sel = (
  id: string,
  label: string,
  description: string,
  def: string,
  options: [string, string][],
  extra: Partial<SettingDef> = {},
): SettingDef =>
  s(id, label, description, 'select', def, {
    options: options.map(([value, l]) => ({ value, label: l })),
    ...extra,
  })

const num = (
  id: string,
  label: string,
  description: string,
  def: number,
  min: number,
  max: number,
  extra: Partial<SettingDef> = {},
): SettingDef => s(id, label, description, 'number', def, { min, max, step: 1, ...extra })

const bool = (
  id: string,
  label: string,
  description: string,
  def: boolean,
  extra: Partial<SettingDef> = {},
): SettingDef => s(id, label, description, 'boolean', def, extra)

const edit = (id: string, label: string, description: string, type: SettingDef['type'],
  def: string | number | boolean, monaco: string, extra: Partial<SettingDef> = {}): SettingDef =>
  s(id, label, description, type, def, { monaco, ...extra })

const editSel = (id: string, label: string, description: string, def: string,
  options: [string, string][], monaco: string, extra: Partial<SettingDef> = {}): SettingDef =>
  sel(id, label, description, def, options, { monaco, ...extra })

const editNum = (id: string, label: string, description: string, def: number,
  min: number, max: number, monaco: string, extra: Partial<SettingDef> = {}): SettingDef =>
  num(id, label, description, def, min, max, { monaco, ...extra })

const editBool = (id: string, label: string, description: string, def: boolean,
  monaco: string, extra: Partial<SettingDef> = {}): SettingDef =>
  bool(id, label, description, def, { monaco, ...extra })

export const SETTING_GROUPS: SettingGroup[] = [
  /* ══ VS Code core: Editor ═══════════════════════════════════ */
  {
    id: 'editor-font',
    label: 'Editor: Font',
    scope: 'vscode',
    settings: [
      edit('editor.fontFamily', 'Font family', 'The font family used in the editor.',
        'text', FONT_STACK, 'fontFamily', { wide: true }),
      editNum('editor.fontSize', 'Font size', 'Font size in pixels.', 13, 8, 40, 'fontSize'),
      editNum('editor.lineHeight', 'Line height',
        '0 = automatic. Values below 8 are a multiple of the font size; 8 or more are pixels.',
        1.55, 0, 60, 'lineHeight', { step: 0.05 }),
      editNum('editor.letterSpacing', 'Letter spacing', 'Extra space between characters, in pixels.',
        0, -3, 8, 'letterSpacing'),
      editBool('editor.fontLigatures', 'Font ligatures', 'Render ligatures for sequences like => and !=.',
        true, 'fontLigatures'),
      editSel('editor.fontWeight', 'Font weight', 'The editor font weight.',
        'normal', [['normal', 'normal'], ['bold', 'bold'], ['300', '300'], ['500', '500'], ['600', '600'], ['700', '700']],
        'fontWeight'),
    ],
  },
  {
    id: 'editor-cursor',
    label: 'Editor: Cursor',
    scope: 'vscode',
    settings: [
      editSel('editor.cursorStyle', 'Cursor style', 'The shape of the text cursor.',
        'line', [['line', 'line'], ['block', 'block'], ['underline', 'underline'], ['line-thin', 'line-thin'],
          ['block-outline', 'block-outline'], ['underline-thin', 'underline-thin']], 'cursorStyle'),
      editSel('editor.cursorBlinking', 'Cursor blinking', 'How the cursor animates.',
        'smooth', [['blink', 'blink'], ['smooth', 'smooth'], ['phase', 'phase'], ['expand', 'expand'], ['solid', 'solid']],
        'cursorBlinking'),
      editSel('editor.cursorSmoothCaretAnimation', 'Smooth caret animation',
        'Animate the cursor when it moves.',
        'off', [['off', 'off'], ['explicit', 'explicit'], ['on', 'on']], 'cursorSmoothCaretAnimation'),
      editNum('editor.cursorSurroundingLines', 'Cursor surrounding lines',
        'Minimum number of visible lines above and below the cursor.', 0, 0, 30, 'cursorSurroundingLines'),
      editNum('editor.cursorWidth', 'Cursor width', 'Width of the cursor when cursor style is line. 0 = default.',
        0, 0, 10, 'cursorWidth'),
    ],
  },
  {
    id: 'editor-indentation',
    label: 'Editor: Indentation',
    scope: 'vscode',
    settings: [
      editNum('editor.tabSize', 'Tab size', 'The number of spaces a tab is equal to.',
        2, 1, 16, 'tabSize'),
      editBool('editor.insertSpaces', 'Insert spaces', 'Insert spaces when pressing Tab.',
        true, 'insertSpaces'),
      editBool('editor.detectIndentation', 'Detect indentation',
        'Let the file\'s own contents decide tab size and whether to use spaces.', true, 'detectIndentation'),
      editBool('editor.trimAutoWhitespace', 'Trim auto whitespace',
        'Remove trailing auto-inserted whitespace.', true, 'trimAutoWhitespace'),
      editSel('editor.autoIndent', 'Auto indent', 'How the editor re-indents as you type.',
        'advanced', [['none', 'none'], ['keep', 'keep'], ['brackets', 'brackets'], ['advanced', 'advanced'], ['full', 'full']],
        'autoIndent'),
      editSel('editor.wordWrap', 'Word wrap', 'How lines should wrap.',
        'off', [['off', 'off'], ['on', 'on'], ['wordWrapColumn', 'wordWrapColumn'], ['bounded', 'bounded']], 'wordWrap'),
      editNum('editor.wordWrapColumn', 'Word wrap column',
        'Column at which to wrap when wordWrap is wordWrapColumn or bounded.', 80, 20, 300, 'wordWrapColumn'),
      editSel('editor.wrappingIndent', 'Wrapping indent', 'Indentation of wrapped lines.',
        'same', [['none', 'none'], ['same', 'same'], ['indent', 'indent'], ['deepIndent', 'deepIndent']], 'wrappingIndent'),
      editSel('editor.wrappingStrategy', 'Wrapping strategy',
        'advanced wraps more accurately but can be slower on large documents.',
        'simple', [['simple', 'simple'], ['advanced', 'advanced']], 'wrappingStrategy'),
    ],
  },
  {
    id: 'editor-display',
    label: 'Editor: Display',
    scope: 'vscode',
    settings: [
      editSel('editor.lineNumbers', 'Line numbers', 'Control the display of line numbers.',
        'on', [['off', 'off'], ['on', 'on'], ['relative', 'relative'], ['interval', 'interval']], 'lineNumbers'),
      editBool('editor.glyphMargin', 'Glyph margin',
        'Show the glyph margin to the left of the line numbers.', true, 'glyphMargin'),
      editSel('editor.renderLineHighlight', 'Highlight active line', 'Where the current line is highlighted.',
        'all', [['none', 'none'], ['gutter', 'gutter'], ['line', 'line'], ['all', 'all']], 'renderLineHighlight'),
      editBool('editor.renderLineHighlightOnlyWhenFocus', 'Highlight active line on focus only',
        'Only highlight the current line when the editor has focus.', false, 'renderLineHighlightOnlyWhenFocus'),
      editSel('editor.renderWhitespace', 'Render whitespace', 'When to show whitespace characters.',
        'selection', [['none', 'none'], ['boundary', 'boundary'], ['selection', 'selection'], ['trailing', 'trailing'], ['all', 'all']],
        'renderWhitespace'),
      editBool('editor.renderControlCharacters', 'Render control characters',
        'Show control characters as their Unicode pictograph.', true, 'renderControlCharacters'),
      editSel('editor.renderFinalNewline', 'Render final newline', 'Show a final newline at the end of the file.',
        'on', [['on', 'on'], ['off', 'off'], ['dimmed', 'dimmed']], 'renderFinalNewline'),
      editBool('editor.selectionHighlight', 'Selection highlight', 'Highlight occurrences of the selection.',
        true, 'selectionHighlight'),
      editSel('editor.occurrencesHighlight', 'Occurrences highlight',
        'Highlight semantic occurrences of the symbol under the cursor.',
        'singleFile', [['off', 'off'], ['singleFile', 'singleFile'], ['multiFile', 'multiFile']], 'occurrencesHighlight'),
      editBool('editor.roundedSelection', 'Rounded selection', 'Selections have rounded corners.', true, 'roundedSelection'),
      editBool('editor.links', 'Links', 'Detect links in the editor and make them clickable.', true, 'links'),
      editBool('editor.colorDecorators', 'Color decorators',
        'Show inline colour swatches for colour literals.', true, 'colorDecorators'),
      editBool('editor.codeLens', 'Code lens', 'Show code lens above declarations.', true, 'codeLens'),
      editBool('editor.folding', 'Folding', 'Enable code folding.', true, 'folding'),
      editSel('editor.showFoldingControls', 'Show folding controls',
        'When to show the folding controls in the gutter.',
        'mouseover', [['always', 'always'], ['never', 'never'], ['mouseover', 'mouseover']], 'showFoldingControls'),
      editBool('editor.guidesIndentation', 'Indentation guides',
        'Render vertical lines under the indentation of the current scope.', true, 'guides.indentation'),
      editBool('editor.guidesActiveIndentation', 'Highlight active indentation',
        'Highlight the indentation guide of the block the cursor is in.', true, 'guides.highlightActiveIndentation'),
      editBool('editor.bracketPairColorization', 'Bracket pair colourisation',
        'Colour matched brackets so they are easy to tell apart.', true, 'bracketPairColorization.enabled'),
      editBool('editor.stickyScroll', 'Sticky scroll',
        'Keep the enclosing scope pinned to the top while scrolling.', false, 'stickyScroll.enabled'),
      editNum('editor.stickyScrollMaxLineCount', 'Sticky scroll max lines',
        'Maximum number of sticky lines shown at once.', 5, 1, 20, 'stickyScroll.maxLineCount'),
      editNum('editor.paddingTop', 'Padding top', 'Top padding of the editor, in pixels.', 8, 0, 40, 'padding.top'),
      editNum('editor.paddingBottom', 'Padding bottom', 'Bottom padding of the editor, in pixels.',
        0, 0, 40, 'padding.bottom'),
    ],
  },
  {
    id: 'editor-minimap',
    label: 'Editor: Minimap',
    scope: 'vscode',
    settings: [
      editBool('editor.minimap.enabled', 'Minimap', 'Show the code overview to the side of the editor.',
        true, 'minimap.enabled'),
      editSel('editor.minimap.side', 'Minimap side', 'Which side of the editor the minimap sits on.',
        'right', [['right', 'right'], ['left', 'left']], 'minimap.side'),
      editSel('editor.minimap.size', 'Minimap size', 'How the minimap is sized relative to the editor.',
        'proportional', [['proportional', 'proportional'], ['fill', 'fill'], ['fit', 'fit']], 'minimap.size'),
      editBool('editor.minimap.renderCharacters', 'Minimap characters',
        'Render actual characters instead of blocks in the minimap.', false, 'minimap.renderCharacters'),
      editSel('editor.minimap.showSlider', 'Minimap slider', 'When to show the minimap slider.',
        'mouseover', [['always', 'always'], ['mouseover', 'mouseover']], 'minimap.showSlider'),
      editNum('editor.minimap.maxColumn', 'Minimap max column',
        'Limit the minimap width to the given number of columns.', 90, 20, 200, 'minimap.maxColumn'),
    ],
  },
  {
    id: 'editor-scrolling',
    label: 'Editor: Scrolling',
    scope: 'vscode',
    settings: [
      editBool('editor.smoothScrolling', 'Smooth scrolling',
        'Animate scrolling instead of jumping.', true, 'smoothScrolling'),
      editBool('editor.mouseWheelZoom', 'Mouse wheel zoom',
        'Zoom the editor font with Ctrl and the mouse wheel.', false, 'mouseWheelZoom'),
      editBool('editor.scrollBeyondLastLine', 'Scroll beyond last line',
        'Allow scrolling past the last line.', false, 'scrollBeyondLastLine'),
      editNum('editor.fastScrollSensitivity', 'Fast scroll sensitivity',
        'Multiplier for scrolling with Alt held.', 5, 1, 20, 'fastScrollSensitivity'),
      editNum('editor.mouseWheelScrollSensitivity', 'Mouse wheel scroll sensitivity',
        'Multiplier for mouse wheel scrolling.', 1, 0.1, 10, 'mouseWheelScrollSensitivity', { step: 0.1 }),
      editNum('editor.scrollbarVerticalSize', 'Vertical scrollbar size',
        'Width of the vertical scrollbar, in pixels.', 10, 4, 30, 'scrollbar.verticalScrollbarSize'),
      editNum('editor.scrollbarHorizontalSize', 'Horizontal scrollbar size',
        'Height of the horizontal scrollbar, in pixels.', 10, 4, 30, 'scrollbar.horizontalScrollbarSize'),
      editBool('editor.scrollbarAlwaysConsumeMouseWheel', 'Scrollbar consumes mouse wheel',
        'Consume the mouse wheel rather than scrolling the page when the scrollbar ends.',
        true, 'scrollbar.alwaysConsumeMouseWheel'),
    ],
  },
  {
    id: 'editor-suggest',
    label: 'Editor: Suggestions',
    scope: 'vscode',
    settings: [
      editBool('editor.quickSuggestions', 'Quick suggestions',
        'Suggest while typing, not only on the trigger character.', true, 'quickSuggestions'),
      editNum('editor.quickSuggestionsDelay', 'Quick suggestions delay',
        'Delay before quick suggestions appear, in milliseconds.', 10, 0, 2000, 'quickSuggestionsDelay'),
      editBool('editor.suggestOnTriggerCharacters', 'Suggest on trigger characters',
        'Suggest after typing a trigger character such as a dot.', true, 'suggestOnTriggerCharacters'),
      editSel('editor.acceptSuggestionOnEnter', 'Accept suggestion on Enter',
        'Accept a suggestion with Enter alongside inserting a new line.',
        'on', [['on', 'on'], ['smart', 'smart'], ['off', 'off']], 'acceptSuggestionOnEnter'),
      editSel('editor.tabCompletion', 'Tab completion', 'Complete with Tab.',
        'on', [['on', 'on'], ['off', 'off'], ['onlySnippets', 'onlySnippets']], 'tabCompletion'),
      editSel('editor.snippetSuggestions', 'Snippet suggestions', 'Where snippets appear among suggestions.',
        'top', [['top', 'top'], ['bottom', 'bottom'], ['inline', 'inline'], ['none', 'none']], 'snippetSuggestions'),
      editSel('editor.wordBasedSuggestions', 'Word based suggestions',
        'Suggest words from the document and from open documents.',
        'currentDocument', [['off', 'off'], ['currentDocument', 'currentDocument'],
          ['matchingDocuments', 'matchingDocuments'], ['allDocuments', 'allDocuments']], 'wordBasedSuggestions'),
      editSel('editor.suggestSelection', 'Suggest selection', 'Which suggestion is selected first.',
        'first', [['first', 'first'], ['recentlyUsed', 'recentlyUsed'], ['recentlyUsedByPrefix', 'recentlyUsedByPrefix']],
        'suggestSelection'),
      editSel('editor.inlayHints', 'Inlay hints', 'Show inline hints for types and parameter names.',
        'on', [['on', 'on'], ['off', 'off'], ['offUnlessPressed', 'offUnlessPressed'], ['onUnlessPressed', 'onUnlessPressed']],
        'inlayHints.enabled'),
      editBool('editor.parameterHints', 'Parameter hints', 'Show parameter hints while typing a call.',
        true, 'parameterHints.enabled'),
    ],
  },
  {
    id: 'editor-editing',
    label: 'Editor: Editing',
    scope: 'vscode',
    settings: [
      editBool('editor.formatOnPaste', 'Format on paste', 'Format pasted content.', false, 'formatOnPaste'),
      editBool('editor.formatOnType', 'Format on type', 'Format a line as you finish typing it.', false, 'formatOnType'),
      editSel('editor.autoClosingBrackets', 'Auto closing brackets', 'Automatically close brackets.',
        'languageDefined', [['languageDefined', 'languageDefined'], ['always', 'always'],
          ['beforeWhitespace', 'beforeWhitespace'], ['never', 'never']], 'autoClosingBrackets'),
      editSel('editor.autoClosingQuotes', 'Auto closing quotes', 'Automatically close quotes.',
        'languageDefined', [['languageDefined', 'languageDefined'], ['always', 'always'],
          ['beforeWhitespace', 'beforeWhitespace'], ['never', 'never']], 'autoClosingQuotes'),
      editSel('editor.autoClosingOvertype', 'Auto closing overtype',
        'Type over a closing bracket instead of inserting a duplicate.',
        'auto', [['always', 'always'], ['auto', 'auto'], ['never', 'never']], 'autoClosingOvertype'),
      editSel('editor.autoSurround', 'Auto surround', 'Wrap a selection when you type a quote or bracket.',
        'languageDefined', [['languageDefined', 'languageDefined'], ['quotes', 'quotes'],
          ['brackets', 'brackets'], ['never', 'never']], 'autoSurround'),
      editBool('editor.dragAndDrop', 'Drag and drop', 'Move a selection by dragging it.', false, 'dragAndDrop'),
      editBool('editor.linkedEditing', 'Linked editing',
        'Rename a tag and its matching tag together in HTML.', false, 'linkedEditing'),
      editSel('editor.matchBrackets', 'Match brackets', 'Highlight the bracket matching the one at the cursor.',
        'always', [['never', 'never'], ['near', 'near'], ['always', 'always']], 'matchBrackets'),
      editSel('editor.multiCursorModifier', 'Multi cursor modifier',
        'The modifier used to add cursors with the mouse.',
        'alt', [['alt', 'alt'], ['ctrlCmd', 'ctrlCmd']], 'multiCursorModifier'),
      editBool('editor.columnSelection', 'Column selection',
        'Select a rectangular block by dragging with the modifier held.', false, 'columnSelection'),
      editBool('editor.emptySelectionClipboard', 'Empty selection clipboard',
        'Copy or cut the whole line when nothing is selected.', true, 'emptySelectionClipboard'),
      editBool('editor.copyWithSyntaxHighlighting', 'Copy with syntax highlighting',
        'Copy text with its colours into the clipboard.', true, 'copyWithSyntaxHighlighting'),
      editBool('editor.readOnly', 'Read only', 'Prevent editing in the editor.', false, 'readOnly'),
      editBool('editor.unicodeHighlightAmbiguous', 'Highlight ambiguous characters',
        'Warn about characters that look like other characters.', false, 'unicodeHighlight.ambiguousCharacters'),
      editBool('editor.unicodeHighlightInvisible', 'Highlight invisible characters',
        'Warn about invisible Unicode characters.', true, 'unicodeHighlight.invisibleCharacters'),
      editNum('editor.maxTokenizationLineLength', 'Max tokenization line length',
        'Lines longer than this are not tokenised, for performance.', 20000, 1000, 100000,
        'maxTokenizationLineLength', { step: 1000 }),
      editBool('editor.largeFileOptimizations', 'Large file optimizations',
        'Apply memory-saving tweaks to very large files.', true, 'largeFileOptimizations'),
    ],
  },

  /* ══ VS Code core: Workbench & Files ════════════════════════ */
  {
    id: 'workbench',
    label: 'Workbench',
    scope: 'vscode',
    settings: [
      s('workbench.colorTheme', 'Colour theme', 'The colour theme for the whole workbench.',
        'select', 'dark', {
          ui: 'theme',
          options: [
            { value: 'dark', label: 'One Dark Pro' },
            { value: 'light', label: 'One Dark Pro Light' },
          ],
        }),
      num('workbench.sideBarWidth', 'Side bar width', 'Width of the explorer side bar, in pixels.',
        240, 160, 500, { ui: 'sidebarWidth' }),
      num('workbench.chatPanelWidth', 'Chat panel width', 'Width of the AI chat panel, in pixels.',
        400, 280, 760, { ui: 'chatWidth' }),
    ],
  },
  {
    id: 'files',
    label: 'Files',
    scope: 'vscode',
    settings: [
      sel('files.autoSave', 'Auto save',
        'Write changes to disk automatically. Only applies to a real folder opened from your machine; the built-in demo workspace has no files to write.',
        'off', [['off', 'off'], ['afterDelay', 'afterDelay']]),
      num('files.autoSaveDelay', 'Auto save delay',
        'Delay after typing before an auto save, in milliseconds.', 1000, 200, 10000,
        { step: 100 }),
      bool('files.trimTrailingWhitespace', 'Trim trailing whitespace',
        'Remove trailing whitespace at the end of every line when saving.', false),
      bool('files.insertFinalNewline', 'Insert final newline',
        'Ensure the file ends with exactly one newline when saving.', false),
      bool('files.trimFinalNewlines', 'Trim final newlines',
        'Remove every newline at the end of the file when saving.', false),
    ],
  },

  /* ══ CodeChat ═══════════════════════════════════════════════ */
  {
    id: 'codechat',
    label: 'CodeChat',
    scope: 'app',
    settings: [
      s('codechat.apiKey', 'OpenRouter API key',
        'Kept in this browser only — never bundled or committed.',
        'password', '', { placeholder: 'sk-or-v1-…', clearable: true }),
      s('codechat.credits', 'Credits',
        'What your OpenRouter account has left, read with the key above.',
        'info', '', { infoSource: 'openrouter-credits' }),
      sel('codechat.model', 'Model',
        'The model the chat panel talks to. The list is every model OpenRouter currently offers.',
        'deepseek/deepseek-v4.1-flash', [],
        { optionsSource: 'openrouter-models', allowCustom: true, placeholder: 'vendor/model-id' }),
      sel('codechat.reasoning', 'Thinking level',
        'How much reasoning the model does before answering. Off sends no reasoning fields at all.',
        'off', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]),
      num('codechat.maxContextChars', 'Max context characters',
        'Cap on the whole-file context block sent with a message.', 24000, 2000, 200000,
        { step: 1000 }),
    ],
  },
]

export const ALL_SETTINGS: SettingDef[] = SETTING_GROUPS.flatMap((g) => g.settings)

const BY_ID = new Map(ALL_SETTINGS.map((d) => [d.id, d]))

export function settingById(id: string): SettingDef | undefined {
  return BY_ID.get(id)
}

export const CORE_SETTINGS = ALL_SETTINGS.filter((d) => !d.id.startsWith('codechat.') && !d.ui)

/** Defaults for the persisted `core` map. */
export function defaultCore(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const d of CORE_SETTINGS) out[d.id] = d.default
  return out
}

/**
 * Fold a `{ 'id': value }` map into a nested Monaco options object, using each
 * definition's `monaco` path. The result is cast to IEditorOptions at the call
 * site; the paths and value types come from this catalogue, which was written
 * against Monaco's own options interface.
 */
export function buildMonacoOptions(get: (def: SettingDef) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const def of ALL_SETTINGS) {
    if (!def.monaco) continue
    const parts = def.monaco.split('.')
    let cur: Record<string, unknown> = out
    for (let i = 0; i < parts.length - 1; i++) {
      const next = cur[parts[i]]
      if (!next || typeof next !== 'object') cur[parts[i]] = {}
      cur = cur[parts[i]] as Record<string, unknown>
    }
    cur[parts[parts.length - 1]] = get(def)
  }
  return out
}

/** Settings that need a Monaco option update, grouped so it can be done in one call. */
export const MONACO_SETTING_IDS = ALL_SETTINGS.filter((d) => d.monaco).map((d) => d.id)
