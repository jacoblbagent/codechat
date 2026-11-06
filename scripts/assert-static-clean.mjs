/**
 * Fail the build if anything that can reach a machine's filesystem survived into
 * dist/. CodeChat's host bridge is a dev-server feature; the published site is a
 * static bundle with no server behind it, and this check is what keeps it that
 * way if someone later imports the bridge without the `import.meta.env.DEV` gate.
 *
 *   node scripts/assert-static-clean.mjs [distDir]
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const DIST = process.argv[2] ?? 'dist'

/** Strings that only exist in host-bridge code or its UI. */
const NEEDLES = [
  'api/host',
  'host-open',
  'Open Host Folder',
  'host-picker',
  'codechat.host.v1',
  'host-fs',
]

const TEXT = /\.(js|mjs|cjs|css|html|json|map|txt|svg|webmanifest)$/i

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

let files
try {
  files = await walk(DIST)
} catch {
  console.error(`assert-static-clean: no build at ${DIST} — run vite build first`)
  process.exit(1)
}

const hits = []
for (const file of files) {
  if (!TEXT.test(file)) continue
  if ((await stat(file)).size > 8_000_000) continue
  const text = await readFile(file, 'utf8')
  for (const needle of NEEDLES) {
    const at = text.indexOf(needle)
    if (at === -1) continue
    const line = text.slice(0, at).split('\n').length
    hits.push(`${relative(DIST, file)}:${line}  contains "${needle}"`)
  }
}

if (hits.length) {
  console.error('assert-static-clean: the host filesystem bridge leaked into the build:')
  for (const hit of hits) console.error(`  ${hit}`)
  console.error('Every caller must sit behind `import.meta.env.DEV` (see src/host-fs.ts).')
  process.exit(1)
}

console.log(`assert-static-clean: ${files.length} files, no host bridge in ${DIST}/`)