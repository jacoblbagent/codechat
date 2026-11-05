/**
 * Build the default workspace: the Moto Pass project's source, as one static
 * JSON file under `public/starter/`.
 *
 * Why JSON and not `?raw` imports like `demo/flowboard`: Moto Pass is ~200
 * files and well over a megabyte, and it lives in its own repository. Copying it
 * in would fork it and go stale within a day, and importing it here would put
 * the whole tree in the IDE's own bundle. One generated JSON file keeps the
 * bundle small, works on the static deploy, and can be rebuilt on demand with
 * `npm run starter`.
 *
 * Usage: `node scripts/build-starter.mjs [sourceDir] [--out path]`
 *   sourceDir defaults to $MOTOPASS_ROOT or ../moto-pass
 */

import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { join, relative, extname, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('..', import.meta.url))

const args = process.argv.slice(2)
let sourceDir = process.env.MOTOPASS_ROOT ?? join(here, '..', 'moto-pass')
let outFile = join(here, 'public', 'starter', 'moto-pass.json')
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outFile = args[++i]
  else sourceDir = args[i]
}

/** Directories that are never source. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.vite', '.turbo',
  '__pycache__', '.cache', '.hermes', 'public',
])

/** Extensions the editor can show. `public/` is skipped wholesale because it is
 *  generated art and venue photographs, not code worth reading. */
const EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.json', '.scss', '.css',
  '.html', '.md', '.prisma', '.sql', '.sh', '.yml', '.yaml', '.txt', '.svg',
])

const MAX_BYTES = 300 * 1024

async function walk(dir, root, out) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(full, root, out)
      continue
    }
    if (!entry.isFile()) continue
    if (entry.name.endsWith('.lock') || entry.name.startsWith('package-lock')) continue
    // dotfiles that carry settings rather than code are dropped; `.env.example`
    // is the one worth reading.
    if (entry.name.startsWith('.') && entry.name !== '.env.example' && entry.name !== '.gitignore') continue
    if (!EXTS.has(extname(entry.name)) && !entry.name.endsWith('.env.example')) continue
    const info = await stat(full)
    if (info.size > MAX_BYTES) continue
    const content = await readFile(full, 'utf8')
    if (content.includes('\u0000')) continue
    out.push({ path: relative(root, full).split('\\').join('/'), content })
  }
}

const files = []
await walk(sourceDir, sourceDir, files)
files.sort((a, b) => a.path.localeCompare(b.path))

const name = basename(sourceDir) || 'moto-pass'
const payload = { name, generatedFrom: sourceDir, files }

await mkdir(dirname(outFile), { recursive: true })
await writeFile(outFile, JSON.stringify(payload))

const bytes = Buffer.byteLength(JSON.stringify(payload))
console.log(`${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB -> ${relative(here, outFile)}`)
