/**
 * Host filesystem bridge for the dev server.
 *
 * The IDE opens folders with the File System Access picker, which browses the
 * machine the *browser* runs on. When CodeChat is reached from another computer
 * (Tailscale, another laptop) or from a browser that has no picker, that machine
 * is not this one — so nothing under ~/Code is reachable. This middleware
 * exposes this host's tree under `/api/host/*` instead.
 *
 * It is a dev-server plugin only (`apply: 'serve'`): a static build has no
 * server and falls back to the picker. Every path is resolved and confined to
 * `$HOME` (override with `CODECHAT_ROOT`), so `..` and symlinks cannot walk out
 * of it, and symlinked directories are not descended into.
 */

import { promises as fsp, realpathSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const MAX_FILE = 512 * 1024
const MAX_TOTAL = 24 * 1024 * 1024
const MAX_FILES = 6000

/** Folders that are never worth walking — the same list the client uses. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.venv', 'venv',
  '__pycache__', '.cache', 'coverage', '.turbo', '.gradle', 'target',
])

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tiff',
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'mp4', 'mov', 'webm', 'mkv', 'avi',
  'zip', 'gz', 'tar', 'rar', '7z', 'bz2', 'xz', 'pdf', 'woff', 'woff2',
  'ttf', 'otf', 'eot', 'exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'class',
  'jar', 'db', 'sqlite', 'sqlite3', 'lock', 'pyc',
])

interface TreeFile {
  path: string
  content: string
}

function rootDir(): string {
  const configured = process.env.CODECHAT_ROOT
  const base = configured ? path.resolve(configured) : os.homedir()
  try {
    return realpathSync(base)
  } catch {
    return base
  }
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep)
}

/**
 * Resolve a client-supplied path against the root and refuse anything that
 * lands outside it. A path that does not exist yet (a new file or folder) is
 * judged by its nearest existing parent, which is also where a symlink would
 * have to be for the escape to work.
 */
function confine(root: string, input: string): string {
  const target = path.resolve(root, input || '.')
  let real: string
  try {
    real = realpathSync(target)
  } catch {
    try {
      real = path.join(realpathSync(path.dirname(target)), path.basename(target))
    } catch {
      throw Object.assign(new Error('No such folder'), { status: 404 })
    }
  }
  if (!within(root, real)) {
    throw Object.assign(new Error('That path is outside the shared root'), { status: 403 })
  }
  return real
}

function isBinaryName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot >= 0 && BINARY_EXT.has(name.slice(dot + 1).toLowerCase())
}

function looksBinary(text: string): boolean {
  return text.includes('\u0000')
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_TOTAL) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(Object.assign(new Error('Body must be JSON'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(payload)
}

/** Walk a folder on this host, skipping what the editor could not use anyway. */
async function readTree(root: string, dir: string): Promise<{ files: TreeFile[]; skipped: number }> {
  const files: TreeFile[] = []
  let skipped = 0
  let total = 0

  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      skipped++
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES || total >= MAX_TOTAL) {
        skipped++
        continue
      }
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        skipped++
        continue
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          skipped++
          continue
        }
        await walk(path.join(current, entry.name), rel)
        continue
      }
      if (!entry.isFile() || isBinaryName(entry.name)) {
        skipped++
        continue
      }
      const full = path.join(current, entry.name)
      try {
        const info = await fsp.stat(full)
        if (info.size > MAX_FILE) {
          skipped++
          continue
        }
        const content = await fsp.readFile(full, 'utf8')
        if (looksBinary(content)) {
          skipped++
          continue
        }
        total += content.length
        files.push({ path: rel, content })
      } catch {
        skipped++
      }
    }
  }

  await walk(dir, '')
  return { files, skipped }
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  action: string,
): Promise<boolean> {
  const root = rootDir()

  switch (action) {
    case 'info': {
      send(res, 200, { root, name: path.basename(root) || root, home: root })
      return true
    }

    case 'list': {
      const dir = confine(root, url.searchParams.get('path') || '')
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      const dirs = entries
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => ({ name: entry.name, path: path.join(dir, entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      send(res, 200, { path: dir, parent: within(root, dir) && dir !== root ? path.dirname(dir) : null, entries: dirs })
      return true
    }

    case 'tree': {
      const dir = confine(root, url.searchParams.get('path') || '')
      const { files, skipped } = await readTree(root, dir)
      send(res, 200, { root: dir, name: path.basename(dir) || dir, files, skipped })
      return true
    }

    case 'read': {
      const file = confine(root, url.searchParams.get('path') || '')
      const info = await fsp.stat(file)
      if (!info.isFile()) throw Object.assign(new Error('Not a file'), { status: 400 })
      if (info.size > MAX_FILE) throw Object.assign(new Error('File is too large to open'), { status: 413 })
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(await fsp.readFile(file, 'utf8'))
      return true
    }

    case 'write': {
      if (req.method !== 'POST') throw Object.assign(new Error('POST required'), { status: 405 })
      const body = await readBody(req)
      const file = confine(root, String(body.path ?? ''))
      if (typeof body.content !== 'string') throw Object.assign(new Error('content must be a string'), { status: 400 })
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await fsp.writeFile(file, body.content, 'utf8')
      send(res, 200, { path: file, bytes: Buffer.byteLength(body.content) })
      return true
    }

    case 'mkdir': {
      if (req.method !== 'POST') throw Object.assign(new Error('POST required'), { status: 405 })
      const body = await readBody(req)
      const dir = confine(root, String(body.path ?? ''))
      await fsp.mkdir(dir, { recursive: true })
      send(res, 200, { path: dir })
      return true
    }

    // Deleting a file only. A folder goes through the browser's own handle when
    // one exists; a recursive rm from here would be too easy to aim badly.
    case 'delete': {
      if (req.method !== 'POST') throw Object.assign(new Error('POST required'), { status: 405 })
      const body = await readBody(req)
      const file = confine(root, String(body.path ?? ''))
      if (file === root) throw Object.assign(new Error('Refusing to delete the root'), { status: 400 })
      const info = await fsp.stat(file)
      if (info.isDirectory()) throw Object.assign(new Error('Only files can be deleted'), { status: 400 })
      await fsp.unlink(file)
      send(res, 200, { path: file })
      return true
    }

    default:
      return false
  }
}

export function hostFs(): Plugin {
  return {
    name: 'codechat-host-fs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url ?? ''
        const base = server.config.base || '/'
        const pathname = new URL(raw, 'http://localhost').pathname
        const prefixes = [`${base.replace(/\/$/, '')}/api/host/`, '/api/host/']
        const hit = prefixes.find((prefix) => pathname.startsWith(prefix))
        if (!hit) return next()

        const action = pathname.slice(hit.length).replace(/\/$/, '')
        const url = new URL(raw, 'http://localhost')
        void route(req, res, url, action).then(
          (handled) => {
            if (!handled) send(res, 404, { error: `Unknown host action: ${action}` })
          },
          (err: any) => {
            const status = typeof err?.status === 'number' ? err.status : 500
            send(res, status, { error: err?.message ?? 'Host filesystem error' })
          },
        )
      })
    },
  }
}
