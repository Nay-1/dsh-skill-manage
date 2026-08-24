import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

export interface SkillEntry {
  name: string
  description: string
  dirName: string
  scope: 'user' | 'project'
  modelInvocable: boolean
  userInvocable: boolean
}

type SourceTab = 'local' | 'github' | 'search'

interface SearchHit {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
}

interface PlanSkill {
  key: string
  exists: boolean
}

interface InstallPlan {
  total: number
  skills: PlanSkill[]
  source: { url: string, branch?: string, subPath?: string }
}

interface GithubInstallResult extends Envelope {
  skills?: SkillEntry[]
  failed?: Array<{ key: string, error: string }>
  plan?: InstallPlan
  exists?: boolean
}

interface Workspace {
  path: string
  title: string
}

interface Envelope {
  ok: boolean
  error?: string
  exists?: boolean
}

const USER_HOME_PATH = '~/.dsh/skills'

function errText(error: unknown): string {
  return String((error as { message?: string } | null)?.message ?? error)
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

async function api<T>(route: string, body?: Record<string, unknown>): Promise<T & Envelope> {
  const res = await fetch(`/dsh-skill-manage${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return (await res.json()) as T & Envelope
}

/** Folder picking needs the non-standard webkitdirectory attribute (Chromium/Firefox). */
const supportsDirPick = typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input')

const NEUTRAL_FILL = 'rgba(127, 127, 127, 0.10)'
const NEUTRAL_FILL_STRONG = 'rgba(127, 127, 127, 0.16)'

/** Accent palette for deterministic per-name icon colors (works on light & dark). */
const ICON_PALETTE = ['#5b8def', '#58a663', '#b08a3e', '#c56bd6', '#e0823c', '#4dc3c0', '#d95f8a']

function hashIndex(input: string, length: number): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) >>> 0
  return hash % length
}

/** Icon letter: strip a leading @ and use the last path-like segment. */
function iconLetter(name: string): string {
  const cleaned = name.replace(/^@/, '').split('/').pop() ?? name
  return (cleaned.charAt(0) || '?').toUpperCase()
}

function iconColor(name: string): string {
  return ICON_PALETTE[hashIndex(name, ICON_PALETTE.length)]
}

const styles: Record<string, CSSProperties> = {
  wrap: { padding: '20px 24px', maxWidth: 860, fontFamily: 'inherit', fontSize: 14 },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 },
  title: { margin: 0, fontSize: 20, fontWeight: 700 },
  pill: { padding: '2px 10px', borderRadius: 999, background: NEUTRAL_FILL_STRONG, fontSize: 12, color: 'inherit', whiteSpace: 'nowrap' },
  hint: { color: '#888', fontSize: 13, margin: '0 0 18px' },

  scopeLabel: { fontSize: 12.5, color: '#999', margin: '0 0 8px', fontWeight: 600 },
  seg: { display: 'inline-flex', gap: 0, border: '1px solid #4445', borderRadius: 8, overflow: 'hidden', marginBottom: 10 },
  segBtn: { display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', background: 'transparent', color: '#bbb', border: 'none', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  segBtnActive: { background: 'rgba(43, 98, 217, 0.14)', color: '#6ba4ff' },
  copyBar: { display: 'flex', alignItems: 'center', gap: 8, background: NEUTRAL_FILL, border: '1px solid #3334', borderRadius: 8, padding: '8px 12px', marginBottom: 12 },
  copyPath: { flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: 12.5, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  copyBtn: { background: 'transparent', border: 'none', color: '#bbb', cursor: 'pointer', fontSize: 14, flexShrink: 0, padding: '0 4px' },
  projectPickerRow: { marginBottom: 12 },

  installCard: { display: 'flex', flexDirection: 'column', gap: 12, padding: '16px', border: '1px solid #3335', borderRadius: 10, marginBottom: 22 },
  installTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  sourceSeg: { display: 'inline-flex', gap: 0, border: '1px solid #4445', borderRadius: 8, overflow: 'hidden', alignSelf: 'flex-start' },
  installLead: { display: 'flex', alignItems: 'center', gap: 8, color: '#bbb', fontSize: 13 },
  installRow: { display: 'flex', gap: 10, alignItems: 'center' },
  hitList: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' },
  hitRow: { display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', border: '1px solid #3334', borderRadius: 8 },
  hitName: { fontWeight: 600, fontSize: 13.5 },
  hitMeta: { color: '#999', fontSize: 12, marginTop: 2 },
  hitExists: { color: '#e0a23c', fontSize: 12, marginTop: 2 },
  planPanel: { display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px', border: '1px solid #e0a23c55', borderRadius: 10, background: 'rgba(224, 162, 60, 0.05)' },
  planHeader: { display: 'flex', alignItems: 'center', gap: 10 },
  planTitle: { fontWeight: 650, fontSize: 13.5 },
  planWarn: { color: '#e0a23c', fontSize: 12.5 },
  input: { flex: 1, minWidth: 220, padding: '8px 12px', borderRadius: 8, border: '1px solid #4446', background: 'transparent', color: 'inherit', fontSize: 13 },
  button: { padding: '8px 16px', borderRadius: 8, border: '1px solid #5557', background: '#3337', color: 'inherit', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  steady: { background: '#3a3d41', border: '1px solid #6668', color: '#eee' },
  primary: { background: '#2b62d9', borderColor: '#2b62d9', color: '#fff' },
  danger: { background: 'rgba(224, 85, 97, 0.06)', border: '1px solid rgba(224, 85, 97, 0.45)', color: '#e05561' },
  dangerArmed: { background: '#e05561', borderColor: '#e05561', color: '#fff' },
  forceRow: { display: 'flex', alignItems: 'center', gap: 6, color: '#999', fontSize: 12.5 },
  helpDot: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 15, height: 15, borderRadius: '50%', border: '1px solid #7778', color: '#aaa', fontSize: 10, cursor: 'help' },

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 10px' },
  sectionTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  refresh: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, background: 'transparent', border: '1px solid #4445', borderRadius: 8, padding: '5px 12px', color: '#bbb', cursor: 'pointer', fontSize: 12.5, whiteSpace: 'nowrap' },
  searchRow: { display: 'flex', alignItems: 'center', gap: 8, background: NEUTRAL_FILL, border: '1px solid #3334', borderRadius: 8, padding: '8px 12px', marginBottom: 10 },
  searchIcon: { flexShrink: 0, fontSize: 13, opacity: 0.7 },
  searchInput: { flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'inherit', fontSize: 13 },

  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: { display: 'flex', gap: 14, alignItems: 'center', padding: '14px 16px', border: '1px solid #3334', borderRadius: 10 },
  iconWrap: { position: 'relative', flexShrink: 0, width: 40, height: 40, borderRadius: 10, background: NEUTRAL_FILL, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  iconLetterText: { fontSize: 18, fontWeight: 700 },
  statusDot: { position: 'absolute', top: -3, left: -3, width: 10, height: 10, borderRadius: '50%' },
  rowMain: { flex: 1, minWidth: 0 },
  skillName: { fontWeight: 650, fontSize: 14, fontFamily: 'inherit' },
  skillDesc: { color: '#999', fontSize: 12.5, marginTop: 3, overflowWrap: 'anywhere', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  actions: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 },
  statusPill: { padding: '3px 10px', borderRadius: 999, fontSize: 12, whiteSpace: 'nowrap' },
  statusOn: { background: 'rgba(88, 166, 99, 0.18)', color: '#58a663' },
  statusOff: { background: NEUTRAL_FILL_STRONG, color: '#999' },

  comboWrap: { position: 'relative', minWidth: 0 },
  comboInput: { width: '100%', boxSizing: 'border-box', padding: '8px 30px 8px 12px', borderRadius: 8, border: '1px solid #4446', background: 'transparent', color: 'inherit', fontSize: 13 },
  comboCaret: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#888', fontSize: 11, pointerEvents: 'none' },
  comboList: { position: 'absolute', zIndex: 20, left: 0, right: 0, top: 'calc(100% + 4px)', maxHeight: 260, overflowY: 'auto', background: '#1e1f22', border: '1px solid #4446', borderRadius: 8, boxShadow: '0 8px 24px #0007', padding: 4 },
  comboItem: { padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  comboItemActive: { background: 'rgba(43, 98, 217, 0.28)' },
  comboTitle: { fontWeight: 600 },
  comboPath: { color: '#888', fontSize: 11.5, fontFamily: 'monospace', marginTop: 1, overflowWrap: 'anywhere' },
  comboEmpty: { padding: '10px', textAlign: 'center', color: '#888', fontSize: 12.5 },

  msg: { margin: '10px 0 0', fontSize: 12.5 },
  err: { color: '#e05561' },
  ok: { color: '#58a663' },
  empty: { color: '#888', textAlign: 'center', padding: '32px 0', fontSize: 13 },
}

/** Two-step confirm delete button. */
function RemoveButton({ disabled, onConfirm }: { disabled: boolean, onConfirm(): void }): ReactElement {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const click = (): void => {
    if (!armed) {
      setArmed(true)
      timer.current = setTimeout(() => setArmed(false), 3000)
      return
    }
    clearTimeout(timer.current)
    setArmed(false)
    onConfirm()
  }
  return (
    <button
      type="button"
      style={armed
        ? { ...styles.button, ...styles.dangerArmed }
        : { ...styles.button, ...styles.danger }}
      disabled={disabled}
      onClick={click}
    >
      {armed ? '确认删除？' : '卸载'}
    </button>
  )
}

/** Searchable workspace picker; with includeUser it shows a「用户级」option first. */
function ScopePicker({ workspaces, value, onChange, includeUser = true }: {
  workspaces: Workspace[]
  value: string
  onChange(root: string): void
  includeUser?: boolean
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  const selected = workspaces.find(w => w.path === value)
  const label = value === ''
    ? (includeUser ? '用户级（~/.dsh/skills）' : '请选择项目…')
    : ((selected !== undefined && selected.title !== '') ? selected.title : value)

  const q = query.trim().toLowerCase()
  const matches = workspaces.filter(w =>
    q === '' || w.title.toLowerCase().includes(q) || w.path.toLowerCase().includes(q),
  )

  const openList = (): void => { setOpen(true); setQuery(''); setHighlight(0) }
  const pick = (path: string): void => {
    onChange(path)
    setOpen(false)
  }

  const itemOffset = includeUser ? 1 : 0

  return (
    <div ref={boxRef} style={styles.comboWrap}>
      <input
        style={styles.comboInput}
        role="combobox"
        aria-expanded={open}
        placeholder="搜索项目…"
        value={open ? query : label}
        onChange={e => {
          setQuery(e.target.value)
          setHighlight(0)
          setOpen(true)
        }}
        onFocus={openList}
        onClick={() => { if (!open) openList() }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHighlight(h => Math.min(h + 1, matches.length + itemOffset))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight(h => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && open) {
            e.preventDefault()
            pick(highlight === 0 && includeUser ? '' : matches[highlight - itemOffset].path)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      <span style={styles.comboCaret}>▼</span>
      {open && (
        <div style={styles.comboList} role="listbox">
          {includeUser && (
            <Possibility
              active={highlight === 0}
              selected={value === ''}
              title="用户级"
              path="~/.dsh/skills"
              onEnter={() => setHighlight(0)}
              onPick={() => pick('')}
            />
          )}
          {matches.map((w, i) => (
            <Possibility
              key={`opt:${w.path}`}
              active={highlight === i + itemOffset}
              selected={w.path === value}
              title={w.title !== '' ? w.title : w.path}
              path={w.path}
              onEnter={() => setHighlight(i + itemOffset)}
              onPick={() => pick(w.path)}
            />
          ))}
          {matches.length === 0 && <div style={styles.comboEmpty}>无匹配项目</div>}
        </div>
      )}
    </div>
  )
}

function Possibility({ active, selected, title, path, onEnter, onPick }: {
  active: boolean, selected: boolean, title: string, path: string, onEnter(): void, onPick(): void
}): ReactElement {
  return (
    <div
      role="option"
      aria-selected={selected}
      style={{ ...styles.comboItem, ...(active ? styles.comboItemActive : {}) }}
      onMouseEnter={onEnter}
      onMouseDown={e => e.preventDefault()}
      onClick={onPick}
    >
      <div style={styles.comboTitle}>{title}</div>
      <div style={styles.comboPath}>{path}</div>
    </div>
  )
}

/** The「技能管理」settings page. */
export function SkillManageSection(): React.ReactElement {
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [projectRoot, setProjectRoot] = useState('')
  const root = scope === 'project' ? projectRoot : ''
  const scopeKind: 'user' | 'project' = scope

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [dirs, setDirs] = useState<{ project?: string, user?: string }>({})
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState('')
  const [sourceTab, setSourceTab] = useState<SourceTab>('local')
  const [githubUrl, setGithubUrl] = useState('')
  const [mirror, setMirror] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [existsPrompt, setExistsPrompt] = useState<{ text: string, retry: () => void } | null>(null)
  const [plan, setPlan] = useState<InstallPlan | null>(null)
  const [planChecked, setPlanChecked] = useState<Set<string>>(new Set())
  const [planConfirmed, setPlanConfirmed] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err', text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState('')
  const pickRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    try { localStorage.removeItem('dsh-skill-manage.customRoots') } catch {}
    void api<{ workspaces: Workspace[] }>('/workspaces')
      .then(result => { if (result.ok) setWorkspaces(result.workspaces) })
      .catch(() => {})
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (scope === 'project' && projectRoot === '') {
      setSkills([])
      setDirs({})
      setLoaded(true)
      return
    }
    if (root === '') {
      // User scope: single query without root.
      const result = await api<{ skills: SkillEntry[], dirs?: { project?: string, user?: string } }>('/skills')
      if (!result.ok) throw new Error(result.error ?? 'unknown')
      setSkills(result.skills)
      setDirs(result.dirs ?? {})
      setLoaded(true)
      return
    }
    const result = await api<{ skills: SkillEntry[], dirs?: { project?: string, user?: string } }>(`/skills?root=${encodeURIComponent(root)}`)
    if (!result.ok) throw new Error(result.error ?? 'unknown')
    setSkills(result.skills.filter(s => s.scope === 'project'))
    setDirs(result.dirs ?? {})
    setLoaded(true)
  }, [root])

  useEffect(() => {
    setLoaded(false)
    setMessage(null)
    void refresh().catch(error => setMessage({ kind: 'err', text: `加载失败：${errText(error)}` }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  const act = useCallback(async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const text = await fn()
      await refresh()
      if (text !== '') setMessage({ kind: 'ok', text })
    } catch (error) {
      setMessage({ kind: 'err', text: errText(error) })
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const scopeBody = (): Record<string, unknown> => (root === '' ? {} : { root })
  const rowBody = (skill: SkillEntry): Record<string, unknown> =>
    skill.scope === 'project' && root !== '' ? { root } : {}

  const projectSelected = scope === 'project' && projectRoot !== ''
  const installTargetPath = root === '' ? (dirs.user ?? USER_HOME_PATH) : (dirs.project ?? root)

  const scopeKindLabel = scopeKind === 'project' ? '项目级' : '用户级'

  const summarizeInstalled = (skills: SkillEntry[], failed?: Array<{ key: string, error: string }>): string => {
    let text = skills.length === 1
      ? `已安装技能 ${skills[0].name}（${scopeKindLabel}）`
      : `已安装 ${skills.length} 个技能：${skills.map(s => s.name).join('、')}`
    if (failed !== undefined && failed.length > 0) {
      text += `；失败 ${failed.length} 个（${failed.map(f => `${f.key}: ${f.error.slice(0, 40)}`).join('；')}）`
    }
    return text
  }

  /** If the response is a conflict, show the inline reminder and wire the retry; returns true. */
  const handleExists = (result: Envelope & { exists?: boolean }, retry: () => void): boolean => {
    if (result.ok || result.exists !== true) return false
    setExistsPrompt({ text: result.error ?? '技能已存在，是否覆盖安装？', retry })
    return true
  }

  const install = (overwrite = false): void => {
    if (!projectSelected && scope === 'project') { setMessage({ kind: 'err', text: '请先选择一个项目' }); return }
    void act(async () => {
      if (source.trim() === '') throw new Error('请填写本地技能文件夹路径')
      const result = await api<Envelope & { skill?: SkillEntry }>('/install', { source: source.trim(), ...(overwrite ? { force: true } : {}), ...scopeBody() })
      if (!result.ok) {
        if (handleExists(result, () => install(true))) return ''
        throw new Error(result.error ?? '安装失败')
      }
      setSource('')
      return `已安装技能 ${result.skill!.name}（${scopeKindLabel}）`
    })
  }

  const doGithub = (url: string, overrides: Record<string, unknown> = {}): Promise<void> => (
    act(async () => {
      const result = await api<GithubInstallResult>('/install-github', { url, mirror, ...scopeBody(), ...overrides })
      if (result.ok && result.skills !== undefined) {
        return summarizeInstalled(result.skills, result.failed)
      }
      if (result.plan !== undefined) {
        setPlan(result.plan)
        setPlanChecked(new Set(result.plan.skills.filter(s => !s.exists).map(s => s.key)))
        setPlanConfirmed(false)
        return ''
      }
      if (!result.ok) {
        if (handleExists(result, () => doGithub(url, { force: true }))) return ''
        throw new Error(result.error ?? '安装失败')
      }
      throw new Error('安装失败')
    })
  )

  const installGithub = (): void => {
    if (!projectSelected && scope === 'project') { setMessage({ kind: 'err', text: '请先选择一个项目' }); return }
    if (githubUrl.trim() === '') { setMessage({ kind: 'err', text: '请填写 GitHub 仓库地址' }); return }
    void doGithub(githubUrl.trim())
  }

  const confirmBatch = (): void => {
    if (plan === null) return
    const keys = [...planChecked]
    if (keys.length === 0) { setMessage({ kind: 'err', text: '请至少勾选一个技能' }); return }
    const source = plan.source
    setPlan(null)
    void act(async () => {
      const result = await api<GithubInstallResult>('/install-github', {
        url: source.url,
        branch: source.branch,
        subPath: source.subPath,
        mirror,
        batch: keys,
        ...scopeBody(),
      })
      if (!result.ok) throw new Error(result.error ?? '安装失败')
      return summarizeInstalled(result.skills ?? [], result.failed)
    })
  }

  const searchSkills = (): void => {
    setSearching(true)
    void act(async () => {
      const q = searchQuery.trim()
      if (q === '') throw new Error('请输入技能关键词')
      const result = await api<{ hits: SearchHit[], count?: number }>('/search-skills', { q, limit: 12 })
      if (!result.ok) throw new Error(result.error ?? '搜索失败')
      setSearchHits(result.hits ?? [])
      return ''
    }).finally(() => setSearching(false))
  }

  const doHit = (hit: SearchHit, overwrite = false): Promise<void> => {
    if (!projectSelected && scope === 'project') {
      setMessage({ kind: 'err', text: '请先选择一个项目' })
      return Promise.resolve()
    }
    return act(async () => {
      const result = await api<GithubInstallResult>('/install-github', {
        url: `github:${hit.source}`,
        skill: hit.skillId,
        mirror,
        ...(overwrite ? { force: true } : {}),
        ...scopeBody(),
      })
      if (!result.ok) {
        if (handleExists(result, () => void doHit(hit, true))) return ''
        throw new Error(result.error ?? '安装失败')
      }
      if (result.skills === undefined) throw new Error('安装失败')
      return summarizeInstalled(result.skills)
    })
  }

  const installHit = (hit: SearchHit): void => {
    setInstallingId(hit.id)
    void doHit(hit).finally(() => setInstallingId(null))
  }

  const MAX_FILES = 500
  const MAX_FILE_BYTES = 2 << 20
  const MAX_TOTAL_BYTES = 10 << 20

  const installPicked = async (list: FileList, overwrite = false): Promise<void> => {
    if (!projectSelected && scope === 'project') { setMessage({ kind: 'err', text: '请先选择一个项目' }); return }
    await act(async () => {
      const files: { path: string, data: string }[] = []
      let totalBytes = 0
      for (const file of Array.from(list)) {
        const rel = file.webkitRelativePath !== '' ? file.webkitRelativePath : file.name
        if (/(^|\/)(node_modules|\.git)(\/|$)/.test(rel)) continue
        if (file.size > MAX_FILE_BYTES) throw new Error(`文件超过 2MB 上限：${rel}`)
        totalBytes += file.size
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error('技能文件夹总大小超过 10MB 上限')
        if (files.length >= MAX_FILES) throw new Error(`文件数超过 ${MAX_FILES} 上限`)
        files.push({ path: rel, data: bytesToBase64(await file.arrayBuffer()) })
      }
      if (!files.some(f => f.path.split('/').pop() === 'SKILL.md')) {
        throw new Error('所选文件夹里没有 SKILL.md，不是有效的技能包')
      }
      const result = await api<Envelope & { skill?: SkillEntry }>('/install-upload', { files, ...(overwrite ? { force: true } : {}), ...scopeBody() })
      if (!result.ok) {
        if (handleExists(result, () => void installPicked(list, true))) return ''
        throw new Error(result.error ?? '安装失败')
      }
      return `已安装技能 ${result.skill!.name}（${scopeKindLabel}）`
    })
  }

  const remove = (skill: SkillEntry): void => {
    void act(async () => {
      const result = await api('/remove', { name: skill.name, ...rowBody(skill) })
      if (!result.ok) throw new Error(result.error ?? '卸载失败')
      return `已卸载技能 ${skill.name}（${skill.scope === 'project' ? '项目级' : '用户级'}）`
    })
  }

  const toggle = (skill: SkillEntry, enabled: boolean): void => {
    void act(async () => {
      const result = await api('/toggle', { name: skill.name, model: enabled, user: enabled, ...rowBody(skill) })
      if (!result.ok) throw new Error(result.error ?? '切换失败')
      return ''
    })
  }

  const copyDir = (): void => {
    void navigator.clipboard.writeText(installTargetPath)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(() => {})
  }

  const scopeTitle = scope === 'project' ? '项目级技能' : '用户级技能'

  const s = search.trim().toLowerCase()
  const filteredSkills = s === ''
    ? skills
    : skills.filter(k => k.name.toLowerCase().includes(s))

  const renderRow = (skill: SkillEntry): ReactElement => {
    const enabled = skill.modelInvocable || skill.userInvocable
    return (
      <div key={`${skill.dirName}@${skill.scope}`} style={styles.row}>
        <div style={styles.iconWrap}>
          <span style={{ ...styles.statusDot, background: enabled ? '#58a663' : '#9aa0a6' }} aria-hidden />
          <span style={{ ...styles.iconLetterText, color: iconColor(skill.name) }}>{iconLetter(skill.name)}</span>
        </div>
        <div style={styles.rowMain}>
          <div style={styles.skillName}>{skill.name}</div>
          <div style={styles.skillDesc}>{skill.description || '(无描述)'}</div>
        </div>
        <div style={styles.actions}>
          <span style={{ ...styles.statusPill, ...(enabled ? styles.statusOn : styles.statusOff) }}>
            {enabled ? '已启用' : '已禁用'}
          </span>
          <button type="button" style={{ ...styles.button, ...styles.steady }} disabled={busy} onClick={() => toggle(skill, !enabled)}>
            {enabled ? '禁用' : '启用'}
          </button>
          <RemoveButton disabled={busy} onConfirm={() => remove(skill)} />
        </div>
      </div>
    )
  }

  const installDisabled = busy
  const installButtonLabel = scope === 'project' ? '安装到项目' : '安装到用户'

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <h3 style={styles.title}>技能管理</h3>
        <span style={styles.pill}>{loaded ? `${skills.length} 个技能` : '…'}</span>
      </div>
      <p style={styles.hint}>管理和安装 DeepSeek Harness 技能，让 AI 助手更强大。</p>

      <div style={styles.scopeLabel}>管理范围</div>
      <div style={styles.seg}>
        <button
          type="button"
          style={{ ...styles.segBtn, ...(scope === 'user' ? styles.segBtnActive : {}) }}
          onClick={() => setScope('user')}
        >
          <span aria-hidden>👤</span>用户级（~/.dsh/skills）
        </button>
        <button
          type="button"
          style={{ ...styles.segBtn, ...(scope === 'project' ? styles.segBtnActive : {}) }}
          onClick={() => setScope('project')}
        >
          <span aria-hidden>📁</span>项目级（.dsh/skills）
        </button>
      </div>

      {scope === 'project' && (
        <div style={styles.projectPickerRow}>
          <ScopePicker workspaces={workspaces} value={projectRoot} onChange={setProjectRoot} includeUser={false} />
        </div>
      )}

      <div style={styles.copyBar}>
        <span style={styles.copyPath}>{scope === 'project' && projectRoot === '' ? '（请选择项目）' : installTargetPath}</span>
        <button type="button" style={styles.copyBtn} title="复制路径" onClick={copyDir}>{copied ? '✓' : '⧉'}</button>
      </div>

      <div style={styles.installCard}>
        <h4 style={styles.installTitle}>安装技能</h4>
        <div style={styles.sourceSeg}>
          <button
            type="button"
            style={{ ...styles.segBtn, padding: '5px 14px', ...(sourceTab === 'local' ? styles.segBtnActive : {}) }}
            onClick={() => setSourceTab('local')}
          >
            本地文件夹
          </button>
          <button
            type="button"
            style={{ ...styles.segBtn, padding: '5px 14px', ...(sourceTab === 'github' ? styles.segBtnActive : {}) }}
            onClick={() => setSourceTab('github')}
          >
            GitHub
          </button>
          <button
            type="button"
            style={{ ...styles.segBtn, padding: '5px 14px', ...(sourceTab === 'search' ? styles.segBtnActive : {}) }}
            onClick={() => setSourceTab('search')}
          >
            🔍 搜索
          </button>
        </div>
        <div style={styles.installLead}><span aria-hidden>{sourceTab === 'local' ? '📁' : sourceTab === 'github' ? '🔗' : '🔍'}</span>
          {sourceTab === 'local' ? '选择包含 SKILL.md 的技能目录'
            : sourceTab === 'github' ? '粘贴仓库或 /tree/ 目录链接：单技能直装，父目录出安装清单'
              : '在 skills.sh 商店搜索技能，点结果一键安装'}
        </div>
        {sourceTab === 'search' ? (
          <>
            <div style={styles.installRow}>
              <input
                style={styles.input}
                placeholder="例如：pdf、tdd、frontend-design"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !busy && !searching) searchSkills() }}
              />
              <button type="button" style={{ ...styles.button, ...styles.primary }} disabled={busy || searching} onClick={searchSkills}>
                {searching ? '搜索中…' : '搜索'}
              </button>
            </div>
            {searchHits !== null && (
              <div style={styles.hitList}>
                {searchHits.length === 0
                  ? (
                    <div style={styles.hitRow}><span style={styles.hitMeta}>未找到相关技能，换个关键词试试</span></div>
                  )
                  : searchHits.map(hit => (
                    <div key={hit.id} style={styles.hitRow}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.hitName}>{hit.name}</div>
                        <div style={styles.hitMeta}>{hit.source} · {formatInstalls(hit.installs)} 次安装</div>
                      </div>
                      <button type="button" style={{ ...styles.button, ...styles.primary, flexShrink: 0, padding: '5px 12px' }} disabled={busy || installingId !== null} onClick={() => installHit(hit)}>
                        {installingId === hit.id ? '安装中…' : '安装'}
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </>
        ) : (
        <>
          <div style={styles.installRow}>
          {sourceTab === 'local' ? (
            <input
              style={styles.input}
              placeholder="/path/to/skill-folder"
              value={source}
              onChange={e => setSource(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !installDisabled) install() }}
            />
          ) : (
            <input
              style={styles.input}
              placeholder="github:owner/repo 或 https://github.com/owner/repo/tree/main/skills"
              value={githubUrl}
              onChange={e => setGithubUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !installDisabled) installGithub() }}
            />
          )}
          {sourceTab === 'local' && supportsDirPick && (
            <>
              <input
                type="file"
                multiple
                hidden
                ref={el => {
                  pickRef.current = el
                  if (el !== null) {
                    el.setAttribute('webkitdirectory', '')
                    el.setAttribute('directory', '')
                  }
                }}
                onChange={e => {
                  const list = e.target.files
                  if (list !== null && list.length > 0) void installPicked(list)
                  e.target.value = ''
                }}
              />
              <button type="button" style={styles.button} disabled={installDisabled} onClick={() => pickRef.current?.click()}>
                浏览…
              </button>
            </>
          )}
          <button
            type="button"
            style={{ ...styles.button, ...styles.primary }}
            disabled={installDisabled}
            onClick={() => (sourceTab === 'local' ? install() : installGithub())}
          >
            {busy ? '安装中…' : installButtonLabel}
          </button>
          </div>
          <div style={styles.forceRow}>
            {sourceTab === 'github' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                <input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} />
                直连失败时改用镜像
                <span style={styles.helpDot} title="直连 GitHub 失败时自动改经 ghfast.top / gh-proxy.com 克隆（无需代理）">?</span>
              </label>
            )}
          </div>
          {sourceTab === 'github' && plan !== null && (
            <div style={styles.planPanel}>
              <div style={styles.planHeader}>
                <span style={styles.planTitle}>找到 {plan.total} 个技能</span>
                {plan.total > 15 && !planConfirmed && (
                  <span style={styles.planWarn}>共 {plan.total} 个技能，确认要继续吗</span>
                )}
              </div>
              <div style={styles.hitList}>
                {plan.skills.map(item => (
                  <label key={item.key} style={styles.hitRow}>
                    <input
                      type="checkbox"
                      checked={planChecked.has(item.key)}
                      onChange={e => setPlanChecked(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(item.key)
                        else next.delete(item.key)
                        return next
                      })}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.hitName}>{item.key}</div>
                      {item.exists && <div style={styles.hitExists}>已存在（勾选将覆盖）</div>}
                    </div>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {plan.total > 15 && !planConfirmed
                  ? (
                    <button type="button" style={{ ...styles.button, ...styles.primary }} onClick={() => setPlanConfirmed(true)}>
                      继续安装（{plan.total} 个）
                    </button>
                  )
                  : (
                    <button type="button" style={{ ...styles.button, ...styles.primary }} disabled={busy} onClick={confirmBatch}>
                      安装所选（{planChecked.size} 个）
                    </button>
                  )}
                <button type="button" style={styles.button} disabled={busy} onClick={() => setPlan(null)}>取消</button>
              </div>
            </div>
          )}
        </>
        )}
      </div>

      {existsPrompt !== null && (
        <div style={{ ...styles.msg, ...styles.err, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>{existsPrompt.text}</span>
          <button type="button" style={{ ...styles.button, ...styles.danger, flexShrink: 0 }} onClick={() => { const { retry } = existsPrompt; setExistsPrompt(null); retry() }}>覆盖安装</button>
          <button type="button" style={{ ...styles.button, flexShrink: 0 }} onClick={() => setExistsPrompt(null)}>取消</button>
        </div>
      )}

      {message !== null && message.text !== '' && (
        <p style={{ ...styles.msg, ...(message.kind === 'ok' ? styles.ok : styles.err) }}>{message.text}</p>
      )}

      <div style={styles.sectionHeader}>
        <h4 style={styles.sectionTitle}>{scopeTitle}</h4>
        <span style={styles.pill}>{loaded ? `${skills.length} 个` : '…'}</span>
        <button type="button" style={styles.refresh} disabled={busy} onClick={() => { setMessage(null); void refresh().catch(error => setMessage({ kind: 'err', text: `加载失败：${errText(error)}` })) }}>
          <span aria-hidden>⟳</span>刷新
        </button>
      </div>

      <div style={styles.searchRow}>
        <span aria-hidden style={styles.searchIcon}>🔍</span>
        <input
          style={styles.searchInput}
          placeholder="搜索技能名称…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div style={styles.list}>
        {scope === 'project' && projectRoot === '' ? (
          <p style={styles.empty}>请选择一个项目以查看其技能。</p>
        ) : loaded && skills.length === 0 ? (
          <p style={styles.empty}>还没有已安装的技能。</p>
        ) : filteredSkills.length === 0 ? (
          <p style={styles.empty}>无匹配技能。</p>
        ) : (
          filteredSkills.map(renderRow)
        )}
      </div>
    </div>
  )
}
