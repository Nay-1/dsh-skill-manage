/**
 * dsh-skill-manage — host half.
 *
 * Serves a small JSON API under `/dsh-skill-manage` for the browser half:
 *   GET  /skills?root=…          — skills of one scope (user level, or a project)
 *   GET  /workspaces             — registered workspaces usable as project roots
 *   POST /install {source,…}     — copy a local skill folder into the scope's dir
 *   POST /install-upload {files} — stage browser-picked files, then install them
 *   POST /remove  {name,…}       — delete an installed skill directory
 *   POST /toggle  {name,…}       — rewrite invocability flags in frontmatter
 *
 * Without `root` every operation targets the user skills dir (`$DSH_HOME/skills`,
 * default `~/.dsh/skills`). With `root`, the project root is the nearest ancestor
 * holding `.git` (mirroring the official provider); skills are scanned from
 * `.dsh/skills` and `.agents/skills` there, installs land in `.dsh/skills`.
 */

import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Required services: the route registry and the workspace registry. */
export const inject = ['webServer', 'workspaceRegistry']

/** Raised to fit /install-upload payloads (10 MiB content ≈ 14 MiB base64+JSON). */
const MAX_BODY_BYTES = 16 << 20
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const GIT_WALK_LIMIT = 16

function userSkillsDir(): string {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'skills')
}

interface WorkspaceLike {
  readonly path?: unknown
  readonly title?: unknown
}

/** One management scope: where to scan and where installs land. */
interface Scope {
  kind: 'user' | 'project'
  /** Directories scanned, in rank order — later entries lose to earlier ones. */
  dirs: string[]
  installDir: string
  /** Absolute dir shown in the UI so the user knows what they are editing. */
  label: string
}

function userScope(): Scope {
  const dir = userSkillsDir()
  return { kind: 'user', dirs: [dir], installDir: dir, label: dir }
}

/** Nearest ancestor containing `.git`; the given dir itself when none is found. */
function projectRootOf(root: string): string {
  let dir = path.resolve(root)
  for (let i = 0; i < GIT_WALK_LIMIT; i++) {
    if (existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(root)
    dir = parent
  }
  return path.resolve(root)
}

async function projectScope(rawRoot: string): Promise<Scope> {
  const root = path.resolve(rawRoot)
  const rootStat = await stat(root).catch(() => null)
  if (rootStat === null || !rootStat.isDirectory()) {
    throw new ApiError(400, `项目路径不存在或不是文件夹：${root}`)
  }
  const projRoot = projectRootOf(root)
  const dsh = path.join(projRoot, '.dsh', 'skills')
  const agents = path.join(projRoot, '.agents', 'skills')
  // Rank order: .dsh/skills outranks .agents/skills.
  return { kind: 'project', dirs: [dsh, agents], installDir: dsh, label: projRoot }
}

async function scopeOf(body: Record<string, unknown>): Promise<Scope> {
  const root = body.root
  if (root === undefined || root === null || root === '') return userScope()
  if (typeof root !== 'string') throw new ApiError(400, 'root 必须是字符串路径')
  return projectScope(root)
}

/** Parse a SKILL.md frontmatter block into a flat key/value map. */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const out: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    const value = kv[2].trim().replace(/^["']|["']$/g, '')
    if (value !== '') out[kv[1]] = value
  }
  return out
}

/** Split content into frontmatter lines and the remainder below the block. */
function splitFrontmatter(content: string): { lines: string[], body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return null
  return { lines: match[1].split(/\r?\n/), body: content.slice(match[0].length) }
}

function joinFrontmatter(lines: string[], body: string): string {
  return `---\n${lines.join('\n')}\n---\n${body}`
}

/** Set (or replace) one key inside frontmatter lines, preserving everything else. */
function setFrontmatterKey(lines: string[], key: string, value: string): string[] {
  const next = [...lines]
  const entry = `${key}: ${value}`
  const index = next.findIndex(line => new RegExp(`^${key}:`).test(line))
  if (index >= 0) next[index] = entry
  else next.push(entry)
  return next
}

export interface SkillEntry {
  name: string
  description: string
  dirName: string
  scope: 'user' | 'project'
  modelInvocable: boolean
  userInvocable: boolean
}

async function scanSkillsDir(scope: Scope, dir: string, into: Map<string, SkillEntry>): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    let content: string
    try {
      content = await readFile(path.join(dir, entry.name, 'SKILL.md'), 'utf8')
    } catch {
      continue
    }
    const meta = parseFrontmatter(content)
    const name = meta.name ?? entry.name
    // Earlier dirs in scope.dirs win duplicates; never overwrite an existing winner.
    if (into.has(name)) continue
    into.set(name, {
      name,
      description: meta.description ?? '',
      dirName: entry.name,
      scope: scope.kind,
      modelInvocable: meta['disable-model-invocation'] !== 'true',
      userInvocable: meta['user-invocable'] !== 'false',
    })
  }
}

/** Scan one scope's directories; earlier dirs keep their duplicate-name winners. */
async function scanScope(scope: Scope): Promise<SkillEntry[]> {
  const map = new Map<string, SkillEntry>()
  // In rank order: scanSkillsDir never overwrites an existing winner.
  for (const dir of scope.dirs) await scanSkillsDir(scope, dir, map)
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Read and parse a JSON request body with a size cap. */
function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        reject(new Error(`invalid JSON body: ${errText(error)}`))
      }
    })
    req.on('error', reject)
  })
}

function json(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function errText(error: unknown): string {
  return String((error as { message?: string } | null)?.message ?? error)
}

class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly extra?: Record<string, unknown>) {
    super(message)
  }
}

async function handleInstall(scope: Scope, body: Record<string, unknown>): Promise<SkillEntry> {
  const source = typeof body.source === 'string' ? body.source.trim() : ''
  const force = body.force === true
  if (source === '') throw new ApiError(400, '缺少 source（本地技能文件夹路径）')

  const srcDir = path.resolve(source)
  const srcStat = await stat(srcDir).catch(() => null)
  if (srcStat === null || !srcStat.isDirectory()) throw new ApiError(400, `路径不存在或不可访问：${srcDir}`)

  let skillMd: string
  try {
    skillMd = await readFile(path.join(srcDir, 'SKILL.md'), 'utf8')
  } catch {
    throw new ApiError(400, '源文件夹缺少 SKILL.md，不是有效的技能包')
  }
  const meta = parseFrontmatter(skillMd)

  const name = typeof meta.name === 'string' && meta.name !== '' ? meta.name : path.basename(srcDir)
  if (!KEBAB_CASE.test(name)) {
    throw new ApiError(400, `技能名 "${name}" 不合法：需要 kebab-case（小写字母/数字，连字符分隔）`)
  }
  if (!meta.description) throw new ApiError(400, 'SKILL.md frontmatter 缺少 description（技能目录展示需要它）')

  const destDir = path.join(scope.installDir, name)
  if (!path.resolve(destDir).startsWith(scope.installDir + path.sep)) {
    throw new ApiError(400, `目标目录越界：${destDir}`)
  }
  if (existsSync(destDir)) {
    if (!force) throw new ApiError(409, `技能 "${name}" 已存在；勾选覆盖后重试`, { exists: true })
    await rm(destDir, { recursive: true, force: true })
  }
  await mkdir(scope.installDir, { recursive: true })
  await cp(srcDir, destDir, { recursive: true })

  return {
    name,
    description: meta.description,
    dirName: name,
    scope: scope.kind,
    modelInvocable: meta['disable-model-invocation'] !== 'true',
    userInvocable: meta['user-invocable'] !== 'false',
  }
}

const MAX_UPLOAD_FILES = 500
const MAX_UPLOAD_TOTAL_BYTES = 10 << 20

/**
 * Install from browser-picked files (no absolute paths available client-side):
 * stage the uploaded tree into a temp dir, then reuse handleInstall for all
 * validation (SKILL.md, frontmatter, kebab-case, conflict checks) and copying.
 */
async function handleInstallUpload(scope: Scope, body: Record<string, unknown>): Promise<SkillEntry> {
  const files = Array.isArray(body.files) ? body.files : null
  if (files === null || files.length === 0) throw new ApiError(400, '缺少 files（上传的文件列表）')
  if (files.length > MAX_UPLOAD_FILES) throw new ApiError(400, `文件数超过上限 ${MAX_UPLOAD_FILES}`)

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-skill-upload-'))
  try {
    let totalBytes = 0
    for (const entry of files) {
      const rec = entry as { path?: unknown, data?: unknown }
      const rel = typeof rec.path === 'string' ? rec.path : ''
      const data = typeof rec.data === 'string' ? rec.data : ''
      if (rel === '' || data === '') throw new ApiError(400, 'files 条目需要 { path, data }')
      const segments = rel.split('/')
      if (path.isAbsolute(rel) || segments.some(s => s === '' || s === '..')) {
        throw new ApiError(400, `非法文件路径：${rel}`)
      }
      const buffer = Buffer.from(data, 'base64')
      totalBytes += buffer.length
      if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) throw new ApiError(400, '上传内容总大小超过 10MB 上限')
      const dest = path.join(tmpRoot, ...segments)
      if (!dest.startsWith(tmpRoot + path.sep)) throw new ApiError(400, `目标越界：${rel}`)
      await mkdir(path.dirname(dest), { recursive: true })
      await writeFile(dest, buffer)
    }
    // The picked folder's own name is segment one; SKILL.md sits inside it.
    let srcDir = tmpRoot
    if (!existsSync(path.join(tmpRoot, 'SKILL.md'))) {
      const entries = await readdir(tmpRoot, { withFileTypes: true })
      const topDirs = entries.filter(e => e.isDirectory())
      if (topDirs.length === 1 && existsSync(path.join(tmpRoot, topDirs[0].name, 'SKILL.md'))) {
        srcDir = path.join(tmpRoot, topDirs[0].name)
      }
    }
    if (!existsSync(path.join(srcDir, 'SKILL.md'))) {
      throw new ApiError(400, '所选文件夹缺少 SKILL.md，不是有效的技能包')
    }
    return await handleInstall(scope, { source: srcDir, force: body.force === true })
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

/** Locate an installed skill across the scope's dirs (earlier dirs win). */
function locateSkillDir(scope: Scope, name: unknown): string {
  if (typeof name !== 'string' || !KEBAB_CASE.test(name)) {
    throw new ApiError(400, `技能名不合法：${String(name)}`)
  }
  for (const dir of scope.dirs) {
    const candidate = path.resolve(path.join(dir, name))
    if (!candidate.startsWith(path.resolve(dir) + path.sep)) continue
    if (existsSync(candidate)) return candidate
  }
  throw new ApiError(404, `技能 "${name}" 在当前范围未安装`)
}

async function handleRemove(scope: Scope, body: Record<string, unknown>): Promise<{ removed: string }> {
  const dir = locateSkillDir(scope, body.name)
  await rm(dir, { recursive: true, force: true })
  return { removed: String(body.name) }
}

async function handleToggle(scope: Scope, body: Record<string, unknown>): Promise<{ toggled: string }> {
  const dir = locateSkillDir(scope, body.name)
  const model = typeof body.model === 'boolean' ? body.model : null
  const user = typeof body.user === 'boolean' ? body.user : null
  if (model === null && user === null) throw new ApiError(400, '需要 model 或 user 之一（布尔值）')

  const file = path.join(dir, 'SKILL.md')
  const content = await readFile(file, 'utf8')
  // disable-model-invocation stores the inverse of model invocability;
  // user-invocable stores it directly.
  const updates: Array<[string, string]> = []
  if (model !== null) updates.push(['disable-model-invocation', String(!model)])
  if (user !== null) updates.push(['user-invocable', String(user)])

  const split = splitFrontmatter(content)
  if (split === null) {
    // No frontmatter block: prepend a minimal one carrying just these keys.
    const lines = [`name: ${String(body.name)}`, ...updates.map(([k, v]) => `${k}: ${v}`), 'description: ']
    await writeFile(file, `${joinFrontmatter(lines, '')}${content}`)
  } else {
    let lines = split.lines
    for (const [key, value] of updates) lines = setFrontmatterKey(lines, key, value)
    await writeFile(file, joinFrontmatter(lines, split.body))
  }
  return { toggled: String(body.name) }
}

interface WorkspaceRegistryApi {
  list(): readonly WorkspaceLike[]
}

/**
 * Mount the management routes.
 * @param ctx - context carrying webServer and workspaceRegistry.
 */
export function apply(ctx: {
  webServer: {
    register(route: { kind: string, path: string, handler: unknown }): unknown
  }
  workspaceRegistry?: WorkspaceRegistryApi
  effect(fn: () => unknown, label?: string): void
}): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-skill-manage',
    async handler(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
      const url = new URL(req.url ?? '/', 'http://dsh')
      const route = decodeURIComponent(url.pathname).replace(/^\/dsh-skill-manage/, '') || '/'
      try {
        if (req.method === 'GET' && route === '/skills') {
          const rootParam = url.searchParams.get('root')
          const user = userScope()
          if (rootParam === null || rootParam === '') {
            json(res, 200, {
              ok: true,
              scope: 'user',
              label: user.label,
              dirs: { user: user.label },
              skills: await scanScope(user),
            })
            return
          }
          // Project view: project entries first (they win at runtime), then the
          // always-visible user-level entries.
          const project = await projectScope(rootParam)
          const [projectSkills, userSkills] = await Promise.all([scanScope(project), scanScope(user)])
          json(res, 200, {
            ok: true,
            scope: 'mixed',
            label: project.label,
            dirs: { project: project.installDir, user: user.label },
            skills: [...projectSkills, ...userSkills],
          })
          return
        }
        if (req.method === 'GET' && route === '/workspaces') {
          const workspaces = (ctx.workspaceRegistry?.list() ?? []).map(w => ({
            path: typeof w.path === 'string' ? w.path : String(w.path ?? ''),
            title: typeof w.title === 'string' ? w.title : '',
          })).filter(w => w.path !== '')
          json(res, 200, { ok: true, workspaces })
          return
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          const scope = await scopeOf(body)
          if (route === '/install') {
            json(res, 200, { ok: true, skill: await handleInstall(scope, body) })
            return
          }
          if (route === '/install-upload') {
            json(res, 200, { ok: true, skill: await handleInstallUpload(scope, body) })
            return
          }
          if (route === '/remove') {
            json(res, 200, { ok: true, ...(await handleRemove(scope, body)) })
            return
          }
          if (route === '/toggle') {
            json(res, 200, { ok: true, ...(await handleToggle(scope, body)) })
            return
          }
        }
        json(res, 404, { ok: false, error: `unknown route ${req.method} ${route}` })
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 500
        if (!(error instanceof ApiError)) console.error('[skill-manage]', error)
        json(res, status, {
          ok: false,
          error: errText(error),
          ...(error instanceof ApiError ? error.extra : {}),
        })
      }
    },
  }), 'dsh-skill-manage: routes')
}
