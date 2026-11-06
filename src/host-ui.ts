/**
 * Markup for the dev-only "Open Folder on Host" picker.
 *
 * It is deliberately absent from index.html and injected at boot instead: a
 * static build has to contain no trace of the host bridge, so the published
 * page has no dialog, no menu entry and no command for it. Vite folds
 * `import.meta.env.DEV` to false in a build, which drops this module and its
 * strings from the bundle entirely (asserted by scripts/assert-static-clean.mjs).
 */

/** File → Open Host Folder…, inserted after the plain Open Folder entry. */
const MENU_ITEM =
  '<button class="menu-item" role="menuitem" data-command="open-host-folder" id="menu-open-host">' +
  'Open Host Folder…<kbd>Ctrl+Alt+H</kbd></button>'

/** The picker overlay, inserted just before the toast stack. */
const PICKER = `
    <div class="overlay is-hidden" id="host-open">
      <div class="palette host-picker" role="dialog" aria-modal="true" aria-label="Open folder on host">
        <div class="host-head">
          <span class="host-title">Open Folder on Host</span>
          <button class="mini-btn" id="host-up" type="button" title="Parent folder">Up</button>
        </div>
        <input id="host-path" class="palette-input" spellcheck="false" autocomplete="off"
               placeholder="/home/user/Code/project" aria-label="Folder path" />
        <div class="palette-list host-list" id="host-list" role="listbox" aria-label="Folders"></div>
        <div class="host-foot">
          <span class="host-hint" id="host-hint"></span>
          <span class="host-actions">
            <button class="mini-btn" id="host-cancel" type="button">Cancel</button>
            <button class="mini-btn is-primary" id="host-confirm" type="button">Open</button>
          </span>
        </div>
      </div>
    </div>
`

/** Picker styling, kept here for the same reason as the markup — nothing in a
 *  static build should even mention the dialog. Uses the app's CSS variables. */
const PICKER_STYLES = `
.host-picker { height: min(56vh, 460px); }
.host-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--border-soft);
}
.host-title { font-size: 12px; color: var(--fg-bright); }
.host-list { flex: 1; min-height: 0; }
.host-row {
  display: flex; align-items: center; gap: 7px;
  padding: 4px 12px; cursor: pointer; font-size: 13px;
}
.host-row:hover { background: var(--hover-overlay); }
.host-row.is-sel { background: var(--bg-selected); color: var(--on-selected); }
.host-row .host-row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host-empty { padding: 8px 12px; font-size: 12px; }
.host-foot {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px 6px 12px; border-top: 1px solid var(--border-soft);
}
.host-hint {
  flex: 1; min-width: 0; font-size: 11px; color: var(--fg-dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.host-actions { display: flex; gap: 6px; }
.host-actions .is-primary { color: var(--blue); border-color: var(--border-strong); }
`

/**
 * Add the picker to the page. Call before anything looks the elements up, so
 * the usual `els.*` handles resolve exactly as they would from static markup.
 */
export function installHostUi(): void {
  const openFolder = document.querySelector<HTMLElement>('.menu-item[data-command="open-folder"]')
  openFolder?.insertAdjacentHTML('afterend', MENU_ITEM)
  document.getElementById('toasts')?.insertAdjacentHTML('beforebegin', PICKER)
  const style = document.createElement('style')
  style.id = 'host-picker-styles'
  style.textContent = PICKER_STYLES
  document.head.appendChild(style)
}