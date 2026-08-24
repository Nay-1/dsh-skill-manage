/**
 * dsh-skill-manage — host half.
 *
 * Serves a small JSON API under `/dsh-skill-manage` for the browser half:
 *   GET  /skills?root=…          — skills of one scope (user level, or a project)
 *   GET  /workspaces             — registered workspaces usable as project roots
 *   POST /install {source,…}     — copy a local skill folder into the scope's dir
 *   POST /search-skills {q,…}    — proxy the skills.sh search, return slim hits
 *   POST /install-github {url}   — tree/github URL install: single skill, or a
 *                                  plan (API-scanned, zero clone) that the
 *                                  client confirms with {batch:[…]}
 *   POST /install-upload {files} — stage browser-picked files, then install them
 *   POST /remove  {name,…}       — delete an installed skill directory
 *   POST /toggle  {name,…}       — rewrite invocability flags in frontmatter
 *
 * Without `root` every operation targets the user skills dir (`$DSH_HOME/skills`,
 * default `~/.dsh/skills`). With `root`, the project root is the nearest ancestor
 * holding `.git` (mirroring the official provider); skills are scanned from
 * `.dsh/skills` and `.agents/skills` there, installs land in `.dsh/skills`.
 */

import { spawn } from 'node:child_process'
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
    if (!force) throw new ApiError(409, `技能 "${name}" 已存在`, { exists: true })
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

const GITHUB_CLONE_TIMEOUT_MS = 60_000

/** Mirrors tried when a direct clone fails and `mirror` is requested (order = preference). */
const GITHUB_MIRRORS = ['https://ghfast.top/', 'https://gh-proxy.com/']

/** skills.sh search endpoint (no public docs; keep the constant easy to swap). */
const SKILLS_SH_SEARCH_URL = 'https://www.skills.sh/api/search'
const SKILLS_SH_TIMEOUT_MS = 10_000

interface SkillsShHit {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
}

/** Proxy `GET skills.sh/api/search`; returns slim, validated hits. */
async function handleSearchSkills(body: Record<string, unknown>): Promise<{ hits: SkillsShHit[], count: number }> {
  const q = typeof body.q === 'string' ? body.q.trim() : ''
  if (q === '') throw new ApiError(400, '缺少搜索关键词')
  if (q.length > 100) throw new ApiError(400, '搜索关键词过长（最多 100 字符）')
  const limit = Math.min(Math.max(Number.isFinite(Number(body.limit)) ? Math.floor(Number(body.limit)) : 12, 1), 50)
  const url = `${SKILLS_SH_SEARCH_URL}?${new URLSearchParams({ q, limit: String(limit) })}`
  let json: unknown
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'dsh-skill-manage' },
      signal: AbortSignal.timeout(SKILLS_SH_TIMEOUT_MS),
    })
    json = await res.json()
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new ApiError(502, 'skills.sh 响应超时，请稍后重试')
    }
    throw new ApiError(502, `无法连接 skills.sh：${errText(error)}`)
  }
  if (typeof json !== 'object' || json === null || !('skills' in json) || !('count' in json)) {
    throw new ApiError(502, 'skills.sh 返回格式异常')
  }
  const { skills, count } = json as { skills: unknown, count: unknown }
  if (!Array.isArray(skills) || typeof count !== 'number') {
    throw new ApiError(502, 'skills.sh 返回格式异常')
  }
  const hits: SkillsShHit[] = []
  for (const item of skills.slice(0, limit)) {
    if (typeof item !== 'object' || item === null) continue
    const s = item as Record<string, unknown>
    if (typeof s.id !== 'string' || typeof s.skillId !== 'string' || typeof s.name !== 'string' || typeof s.source !== 'string') continue
    hits.push({ id: s.id, skillId: s.skillId, name: s.name, installs: Number.isFinite(Number(s.installs)) ? Number(s.installs) : 0, source: s.source })
  }
  return { hits, count }
}

/** Normalize a user-supplied repo reference to a clone URL plus an optional path inside it. */
function parseRepoInput(raw: string): { url: string, subPath?: string, branch?: string, owner?: string, repo?: string } {
  const input = raw.trim()
  if (input === '') throw new ApiError(400, '缺少 URL')

  let rest = input
  let subPath: string | undefined
  const pathHash = input.indexOf('#path:')
  if (pathHash >= 0) {
    subPath = input.slice(pathHash + '#path:'.length).trim().replace(/^\/+/, '').replace(/\/+$/, '')
    rest = input.slice(0, pathHash).trim()
    if (subPath === '') throw new ApiError(400, '#path: 后缺少子目录路径')
  }

  let url: string
  let owner: string | undefined
  let repo: string | undefined
  let branch: string | undefined
  const tree = rest.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/tree\/([^/?#]+)(?:\/(.+))?$/)
  if (tree !== null) {
    owner = tree[1]
    repo = tree[2]
    branch = tree[3]
    url = `https://github.com/${tree[1]}/${tree[2]}.git`
    if (subPath !== undefined) throw new ApiError(400, 'tree 链接自带子目录，不需要再写 #path:')
    subPath = (tree[4] ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
    if (subPath === '') subPath = undefined
  } else {
    const short = rest.match(/^github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/)
    const bare = rest.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/)
    if (short !== null) {
      url = `https://github.com/${short[1]}.git`
      const [o, r] = short[1].split('/')
      owner = o
      repo = r
    } else if (bare !== null) {
      url = `https://github.com/${bare[1]}.git`
      const [o, r] = bare[1].split('/')
      owner = o
      repo = r
    } else if (rest.startsWith('https://')) {
      url = rest
      const plain = url.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?\/?$/)
      if (plain !== null) {
        owner = plain[1]
        repo = plain[2]
      }
      if (!/^https:\/\/github\.com\//.test(url)) throw new ApiError(400, '仅支持 GitHub HTTPS URL')
    } else {
      throw new ApiError(400, `无法识别的仓库地址：${rest}（支持 github:owner/repo、owner/repo 或 https://github.com/…)`)
    }
  }
  return { url: url.replace(/\/+$/, ''), subPath, branch, owner, repo }
}

/**
 * cloneRepo runs `git clone --depth 1` into cloneDir; resolves or rejects with
 * a descriptive message. Uses spawn with a detached process group so the whole
 * git tree (git-remote-https children included) dies on timeout.
 */
function cloneRepo(url: string, cloneDir: string, timeoutMs: number = GITHUB_CLONE_TIMEOUT_MS, branch?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['clone', '--depth', '1']
    if (branch !== undefined) args.push('--branch', branch)
    args.push(url, cloneDir)
    const child = spawn('git', args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { process.kill(-child.pid!, 'SIGTERM') } catch { /* already gone */ }
      reject(new ApiError(400, `克隆超时（${timeoutMs / 1000}s）：${url}`))
    }, timeoutMs)
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new ApiError(400, `启动 git 失败：${errText(error)}`))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }
      const detail = stderr.split('\n').map(s => s.trim()).filter(Boolean).slice(-4).join('\n')
      reject(new ApiError(400, `${url}\n${detail !== '' ? detail : `git clone 退出码 ${String(code)}`}`))
    })
  })
}

interface PlanSkill {
  key: string
  exists: boolean
}

interface Plan {
  total: number
  skills: PlanSkill[]
  source: { url: string, branch?: string, subPath?: string }
}

type GithubResult =
  | { kind: 'installed', skills: SkillEntry[], failed: Array<{ key: string, error: string }> }
  | { kind: 'plan', plan: Plan }

/** Clone with optional branch; fall back over mirrors when `mirror` is set. */
async function cloneWithMirror(url: string, cloneDir: string, mirror: boolean, branch?: string): Promise<void> {
  try {
    await cloneRepo(url, cloneDir, GITHUB_CLONE_TIMEOUT_MS, branch)
    return
  } catch (directError) {
    const noProxy = Object.keys(process.env).filter(k => k.toLowerCase().includes('proxy')).length === 0
    if (!mirror) {
      throw new ApiError(400, `${errText(directError)}${noProxy ? '\n检测到当前 dsh 进程没有代理环境变量；若网络需要代理，请在终端里启动 dsh，或勾选「直连失败时改用镜像」重试。' : ''}`)
    }
    let mirrorError: unknown = directError
    for (const prefix of GITHUB_MIRRORS) {
      await rm(cloneDir, { recursive: true, force: true }).catch(() => {})
      try {
        // Mirror anchors work as https://<prefix>https://github.com/...
        await cloneRepo(`${prefix}${url}`, cloneDir, 45_000, branch)
        mirrorError = null
        break
      } catch (error) {
        mirrorError = error
      }
    }
    if (mirrorError !== null) {
      throw new ApiError(400, `直连与镜像均失败（已尝试 ${GITHUB_MIRRORS.length} 个镜像）：\n${errText(mirrorError)}`)
    }
  }
}

/**
 * Scan a repo tree over the GitHub API (1 request, no clone) for SKILL.md
 * directories under `subPath`. Returns null on any failure (network, rate
 * limit, truncated tree) — callers then fall back to a local clone scan.
 */
async function scanTreeViaApi(owner: string, repo: string, branch: string, subPath: string): Promise<{ single: boolean, keys: string[] } | null> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    const res = await fetch(url, {
      headers: { 'user-agent': 'dsh-skill-manage', accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { tree?: unknown, truncated?: unknown }
    if (!Array.isArray(json.tree) || json.truncated === true) return null
    const files = (json.tree as Array<{ path?: unknown, type?: unknown }>)
      .filter(entry => entry.type === 'blob' && typeof entry.path === 'string')
      .map(entry => entry.path as string)
    const prefix = `${subPath}/`
    if (files.includes(`${prefix}SKILL.md`)) return { single: true, keys: [] }
    const keys = new Set<string>()
    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith('/SKILL.md')) continue
      const rel = file.slice(prefix.length, -'/SKILL.md'.length)
      if (rel === '' || rel.split('/').length > 3) continue
      keys.add(path.basename(rel))
    }
    if (keys.size > 0) {
      return { single: false, keys: [...keys] }
    }
    // No SKILL.md under subPath → let the clone fallback answer whether the
    // directory exists at all (that also covers truncated/branch oddities).
    return null
  } catch {
    return null
  }
}

/** Build a plan from repo-relative SKILL.md directory names. */
function buildPlan(scope: Scope, source: { url: string, branch?: string, subPath?: string }, keys: string[]): Plan {
  const skills = keys.map(key => ({ key, exists: existsSync(path.join(scope.installDir, key)) }))
    .sort((a, b) => a.key.localeCompare(b.key))
  return { total: skills.length, skills, source }
}

/** Clone once (mirror/branch aware), then install the named skills (点名即授权覆盖). */
async function executeBatchInstall(scope: Scope, source: { url: string, subPath?: string, branch?: string }, batch: string[], mirror: boolean): Promise<GithubResult> {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-skill-github-'))
  try {
    const cloneDir = path.join(tmpRoot, 'repo')
    await cloneWithMirror(source.url, cloneDir, mirror, source.branch)
    const base = source.subPath !== undefined ? path.join(cloneDir, source.subPath) : cloneDir
    const candidates = await collectSkillDirs(base)
    const skills: SkillEntry[] = []
    const failed: Array<{ key: string, error: string }> = []
    for (const key of batch) {
      const match = candidates.find(dir => path.basename(dir) === key)
      if (match === undefined) {
        failed.push({ key, error: '仓库中未找到对应技能目录' })
        continue
      }
      try {
        await rm(path.join(match, '.git'), { recursive: true, force: true }).catch(() => {})
        skills.push(await handleInstall(scope, { source: match, force: true }))
      } catch (error) {
        failed.push({ key, error: errText(error) })
      }
    }
    return { kind: 'installed', skills, failed }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

/** Install a single skill dir (no copy of .git), reusing all handleInstall validation. */
async function installSingle(scope: Scope, srcDir: string, force: boolean): Promise<SkillEntry> {
  await rm(path.join(srcDir, '.git'), { recursive: true, force: true }).catch(() => {})
  return await handleInstall(scope, { source: srcDir, force })
}

/**
 * GitHub install entry point. Dispatch by body:
 *   batch[]      → plan (source) + explicit keys; each named key may overwrite
 *   plan         → build a plan from API scan (no clone) or local clone scan
 *   otherwise    → single install (subPath exact / skill-name guided / unique)
 */
async function handleInstallGithub(scope: Scope, body: Record<string, unknown>): Promise<GithubResult> {
  const raw = typeof body.url === 'string' ? body.url : ''
  const { url, subPath, branch, owner, repo } = parseRepoInput(raw)
  const mirror = body.mirror === true
  const force = body.force === true
  const skill = typeof body.skill === 'string' && body.skill.trim() !== '' ? body.skill.trim() : undefined
  const source = { url, subPath, branch }
  const batch = Array.isArray(body.batch) ? body.batch.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : undefined

  if (batch !== undefined && batch.length > 0) {
    return await executeBatchInstall(scope, source, batch, mirror)
  }

  // Tree URL: try an API scan first — multi-skill gives a plan with zero clones.
  if (subPath !== undefined && branch !== undefined && owner !== undefined && repo !== undefined) {
    const scan = await scanTreeViaApi(owner, repo, branch, subPath)
    if (scan !== null && !scan.single) {
      return { kind: 'plan', plan: buildPlan(scope, source, scan.keys) }
    }
  }

  // Fallback for everything needing file contents: clone once, then decide.
  if (subPath !== undefined) {
    // Exact target directory.
    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-skill-github-'))
    try {
      const cloneDir = path.join(tmpRoot, 'repo')
      await cloneWithMirror(url, cloneDir, mirror, branch)
      const srcDir = path.join(cloneDir, subPath)
      if (existsSync(path.join(srcDir, 'SKILL.md'))) {
        return { kind: 'installed', skills: [await installSingle(scope, srcDir, force)], failed: [] }
      }
      if (!existsSync(srcDir)) {
        throw new ApiError(400, `#path: 指定的目录不存在：${subPath}`)
      }
      const keys = (await collectSkillDirs(srcDir)).map(dir => path.basename(dir))
      if (keys.length === 0) throw new ApiError(400, `#path: 指定的目录不存在或不含 SKILL.md：${subPath}`)
      return { kind: 'plan', plan: buildPlan(scope, source, keys) }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true })
    }
  }

  // No subPath: repo-root search (skill-name guided, unique, or a plan).
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-skill-github-'))
  try {
    const cloneDir = path.join(tmpRoot, 'repo')
    await cloneWithMirror(url, cloneDir, mirror, branch)
    const candidates = await collectSkillDirs(cloneDir)
    if (candidates.length === 0) {
      throw new ApiError(400, '仓库中没有找到含 SKILL.md 的技能目录')
    }
    if (skill !== undefined) {
      const match = candidates.find(dir => path.basename(dir) === skill)
      if (match === undefined) {
        throw new ApiError(400, `仓库中没有找到技能「${skill}」的目录`)
      }
      return { kind: 'installed', skills: [await installSingle(scope, match, force)], failed: [] }
    }
    if (candidates.length === 1) {
      return { kind: 'installed', skills: [await installSingle(scope, candidates[0], force)], failed: [] }
    }
    return { kind: 'plan', plan: buildPlan(scope, source, candidates.map(dir => path.basename(dir))) }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

/** BFS (depth ≤ 3) for all directories holding SKILL.md (prunes .git/node_modules). */
async function collectSkillDirs(root: string): Promise<string[]> {
  const unique: string[] = []
  const walk = async (dir: string, level: number): Promise<void> => {
    if (level > 3) return
    if (existsSync(path.join(dir, 'SKILL.md'))) unique.push(dir)
    if (level === 3) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue
      await walk(path.join(dir, entry.name), level + 1)
    }
  }
  await walk(root, 0)
  return [...new Set(unique)]
}

/** Locate an installed skill across the scope's dirs (earlier dirs win). */function locateSkillDir(scope: Scope, name: unknown): string {
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
          if (route === '/search-skills') {
            json(res, 200, { ok: true, ...(await handleSearchSkills(body)) })
            return
          }
          if (route === '/install-github') {
            const result = await handleInstallGithub(scope, body)
            if (result.kind === 'plan') {
              json(res, 200, { ok: false, plan: result.plan })
            } else {
              json(res, 200, { ok: true, skills: result.skills, failed: result.failed })
            }
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
