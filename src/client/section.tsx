import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'

export interface SkillEntry {
  name: string
  description: string
  dirName: string
  scope: 'user' | 'project'
  modelInvocable: boolean
  userInvocable: boolean
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

async function api<T>(route: string, body?: Record<string, unknown>): Promise<T & Envelope> {
  const res = await fetch(`/dsh-skill-manage${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return (await res.json()) as T & Envelope
}

const LS_KEY = 'dsh-skill-manage.customRoots'

/** Folder picking needs the non-standard webkitdirectory attribute (Chromium/Firefox). */
const supportsDirPick = typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input')

function loadCustomRoots(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const styles: Record<string, CSSProperties> = {
  wrap: { padding: '20px 24px', maxWidth: 860, fontFamily: 'inherit', fontSize: 14 },
  header: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 },
  title: { margin: 0, fontSize: 18 },
  hint: { color: '#888', fontSize: 12.5, margin: '0 0 16px' },
  scopeRow: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 },
  scopeLabel: { fontSize: 12.5, color: '#999', whiteSpace: 'nowrap' },
  select: { flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #4445', background: 'transparent', color: 'inherit', fontSize: 13 },
  smallInput: { flex: 2, minWidth: 180, padding: '6px 10px', borderRadius: 6, border: '1px solid #4445', background: 'transparent', color: 'inherit', fontSize: 13 },
  scopePath: { color: '#777', fontSize: 11.5, margin: '0 0 14px', fontFamily: 'monospace' },
  installRow: { display: 'flex', flexWrap: 'wrap', rowGap: 8, gap: 8, alignItems: 'center', padding: 12, border: '1px solid #3333', borderRadius: 8, marginBottom: 16 },
  input: { flex: 1, minWidth: 240, padding: '6px 10px', borderRadius: 6, border: '1px solid #4445', background: 'transparent', color: 'inherit', fontSize: 13 },
  button: { padding: '6px 14px', borderRadius: 6, border: '1px solid #5556', background: '#3335', color: 'inherit', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  primary: { background: '#2b62d9', borderColor: '#2b62d9', color: '#fff' },
  danger: { color: '#e05561' },
  label: { fontSize: 12.5, color: '#999', whiteSpace: 'nowrap' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: { display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', border: '1px solid #3333', borderRadius: 8 },
  rowMain: { flex: 1, minWidth: 0 },
  skillName: { fontWeight: 600, fontFamily: 'monospace', fontSize: 13.5 },
  skillDesc: { color: '#aaa', fontSize: 12.5, marginTop: 2, overflowWrap: 'anywhere' },
  badge: { fontSize: 11, borderRadius: 4, padding: '1px 6px', marginLeft: 8, verticalAlign: '1px' },
  actions: { display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, paddingTop: 2 },
  toggleOn: { opacity: 1 },
  toggleOff: { opacity: 0.45, textDecoration: 'line-through' },
  msg: { margin: '10px 0 0', fontSize: 12.5 },
  err: { color: '#e05561' },
  ok: { color: '#58a663' },
  empty: { color: '#888', textAlign: 'center', padding: '32px 0' },
  groupTitle: { margin: '18px 0 8px', fontSize: 13, fontWeight: 600, color: '#bbb' },
  groupTitleCount: { fontWeight: 400, color: '#777', marginLeft: 6 },
  groupEmpty: { color: '#888', fontSize: 12.5, textAlign: 'center', padding: '14px 0', border: '1px dashed #3333', borderRadius: 8 },
  dupHint: { margin: '0 0 10px', fontSize: 11.5, color: '#b08a3e' },
}

function Flag({ on, children }: { on: boolean, children: ReactNode }): ReactElement {
  return (
    <span style={{ ...styles.badge, background: on ? '#2b62d92b' : '#88888822', color: on ? '#7ea6f0' : '#999' }}>
      {children}
    </span>
  )
}

function ToggleButton({ on, label, disabled, onClick }: {
  on: boolean
  label: string
  disabled: boolean
  onClick(): void
}): ReactElement {
  return (
    <button type="button" style={{ ...styles.button, ...(on ? styles.toggleOn : styles.toggleOff) }} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  )
}

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
    <button type="button" style={{ ...styles.button, ...(armed ? styles.danger : {}) }} disabled={disabled} onClick={click}>
      {armed ? '确认删除？' : '卸载'}
    </button>
  )
}

/** The「技能管理」settings page: user- and project-level skill management. */
export function SkillManageSection(): React.ReactElement {
  /** '' = user level; otherwise a project root path. */
  const [root, setRoot] = useState('')
  /** Install target derived from the selection — the API's `scope` field says 'mixed' for project views. */
  const scopeKind: 'user' | 'project' = root === '' ? 'user' : 'project'
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [customRoots, setCustomRoots] = useState<string[]>(loadCustomRoots)
  const [manualPath, setManualPath] = useState('')
  const [scopeLabel, setScopeLabel] = useState('')
  const [dirs, setDirs] = useState<{ project?: string, user?: string }>({})
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState('')
  const [force, setForce] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err', text: string } | null>(null)
  const pickRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void api<{ workspaces: Workspace[] }>('/workspaces')
      .then(result => { if (result.ok) setWorkspaces(result.workspaces) })
      .catch(() => {})
  }, [])

  const addManualRoot = (): void => {
    const trimmed = manualPath.trim()
    if (trimmed === '') return
    if (!customRoots.includes(trimmed)) {
      const next = [...customRoots, trimmed]
      setCustomRoots(next)
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)) } catch {}
    }
    setRoot(trimmed)
    setManualPath('')
  }

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const query = root === '' ? '' : `?root=${encodeURIComponent(root)}`
      const result = await api<{ skills: SkillEntry[], scope?: string, label?: string, dirs?: { project?: string, user?: string } }>(`/skills${query}`)
      if (!result.ok) throw new Error(result.error ?? 'unknown')
      setSkills(result.skills)
      setScopeLabel(result.label ?? '')
      setDirs(result.dirs ?? {})
      setLoaded(true)
    } catch (error) {
      setMessage({ kind: 'err', text: `加载失败：${errText(error)}` })
    }
  }, [root])

  useEffect(() => { setLoaded(false); void refresh() }, [refresh])

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

  /** Target the row's own scope: project rows carry the selected root, user rows don't. */
  const rowBody = (skill: SkillEntry): Record<string, unknown> =>
    skill.scope === 'project' && root !== '' ? { root } : {}

  const install = (): void => {
    void act(async () => {
      if (source.trim() === '') throw new Error('请填写本地技能文件夹路径')
      const result = await api<{ skill: SkillEntry }>('/install', { source: source.trim(), force, ...scopeBody() })
      if (!result.ok) throw new Error(result.error ?? '安装失败')
      setSource('')
      setForce(false)
      return `已安装技能 ${result.skill.name}（${scopeKind === 'project' ? '项目级' : '用户级'}）`
    })
  }

  const MAX_FILES = 500
  const MAX_FILE_BYTES = 2 << 20
  const MAX_TOTAL_BYTES = 10 << 20

  /** Install from a folder picked via the browser: upload contents, no paths needed. */
  const installPicked = async (list: FileList): Promise<void> => {
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
      const result = await api<{ skill: SkillEntry }>('/install-upload', { files, force, ...scopeBody() })
      if (!result.ok) throw new Error(result.error ?? '安装失败')
      setForce(false)
      return `已安装技能 ${result.skill.name}（${scopeKind === 'project' ? '项目级' : '用户级'}）`
    })
  }

  const remove = (skill: SkillEntry): void => {
    void act(async () => {
      const result = await api('/remove', { name: skill.name, ...rowBody(skill) })
      if (!result.ok) throw new Error(result.error ?? '卸载失败')
      return `已卸载技能 ${skill.name}（${skill.scope === 'project' ? '项目级' : '用户级'}）`
    })
  }

  const toggle = (skill: SkillEntry, field: 'model' | 'user', enabled: boolean): void => {
    void act(async () => {
      const result = await api('/toggle', { name: skill.name, field, enabled, ...rowBody(skill) })
      if (!result.ok) throw new Error(result.error ?? '切换失败')
      return ''
    })
  }

  const projectSkills = skills.filter(s => s.scope === 'project')
  const userSkills = skills.filter(s => s.scope === 'user')
  const dupNames = projectSkills
    .filter(p => userSkills.some(u => u.name === p.name))
    .map(p => p.name)

  const renderRow = (skill: SkillEntry): ReactElement => (
    <div key={`${skill.dirName}@${skill.scope}`} style={styles.row}>
      <div style={styles.rowMain}>
        <div>
          <span style={styles.skillName}>{skill.name}</span>
          <Flag on={skill.modelInvocable}>模型{skill.modelInvocable ? '可调用' : '已禁用'}</Flag>
          <Flag on={skill.userInvocable}>用户{skill.userInvocable ? '可调用' : '已禁用'}</Flag>
        </div>
        <div style={styles.skillDesc}>{skill.description || '(无描述)'}</div>
      </div>
      <div style={styles.actions}>
        <ToggleButton
          on={skill.modelInvocable}
          label="模型"
          disabled={busy}
          onClick={() => toggle(skill, 'model', !skill.modelInvocable)}
        />
        <ToggleButton
          on={skill.userInvocable}
          label="用户"
          disabled={busy}
          onClick={() => toggle(skill, 'user', !skill.userInvocable)}
        />
        <RemoveButton disabled={busy} onConfirm={() => remove(skill)} />
      </div>
    </div>
  )

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <h3 style={styles.title}>技能管理</h3>
        <span style={{ color: '#888', fontSize: 12 }}>{loaded ? `${skills.length} 个` : ''}</span>
      </div>
      <p style={styles.hint}>按范围查看与管理技能。改动即时生效，新会话可见。</p>

      <div style={styles.scopeRow}>
        <span style={styles.scopeLabel}>管理范围</span>
        <select
          style={styles.select}
          value={root}
          onChange={e => setRoot(e.target.value)}
        >
          <option value="">用户级（~/.dsh/skills）</option>
          {workspaces.map(w => (
            <option key={`ws:${w.path}`} value={w.path}>
              项目：{w.title !== '' ? w.title : w.path}
            </option>
          ))}
          {customRoots.filter(p => !workspaces.some(w => w.path === p)).map(p => (
            <option key={`c:${p}`} value={p}>自定义：{p}</option>
          ))}
        </select>
        <input
          style={styles.smallInput}
          placeholder="或输入项目根路径…"
          value={manualPath}
          onChange={e => setManualPath(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addManualRoot() }}
        />
        <button type="button" style={styles.button} disabled={busy} onClick={addManualRoot}>添加</button>
      </div>
      {scopeLabel !== '' && <p style={styles.scopePath}>{scopeLabel}</p>}

      <div style={styles.installRow}>
        <span style={styles.label}>本地路径</span>
        <input
          style={styles.input}
          placeholder="/path/to/skill-folder（需含 SKILL.md）"
          value={source}
          onChange={e => setSource(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !busy) install() }}
        />
        <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
          覆盖同名
        </label>
        {supportsDirPick && (
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
            <button type="button" style={styles.button} disabled={busy} onClick={() => pickRef.current?.click()}>
              浏览…
            </button>
          </>
        )}
        <button type="button" style={{ ...styles.button, ...styles.primary }} disabled={busy} onClick={install}>
          安装到{scopeKind === 'project' ? '项目' : '用户'}
        </button>
      </div>
      <p style={styles.scopePath}>
        安装目标：{scopeKind === 'user'
          ? `${dirs.user ?? '~/.dsh/skills'}（用户级）`
          : `${dirs.project ?? `${root}/.dsh/skills`}（项目级）`}
      </p>

      {message !== null && message.text !== '' && (
        <p style={{ ...styles.msg, ...(message.kind === 'ok' ? styles.ok : styles.err) }}>{message.text}</p>
      )}

      <div style={styles.list}>
        {!loaded && <p style={styles.empty}>加载中…</p>}
        {loaded && root !== '' && (
          <>
            <div style={styles.groupTitle}>
              项目级<span style={styles.groupTitleCount}>{projectSkills.length} 个 · 安装到 .dsh/skills</span>
            </div>
            {dupNames.length > 0 && (
              <p style={styles.dupHint}>同名技能运行时项目级优先：{dupNames.join('、')}</p>
            )}
            {projectSkills.length === 0
              ? <p style={styles.groupEmpty}>该项目还没有技能</p>
              : projectSkills.map(renderRow)}
          </>
        )}
        {loaded && (
          <>
            <div style={styles.groupTitle}>
              用户级<span style={styles.groupTitleCount}>{userSkills.length} 个 · 常驻 ~/.dsh/skills</span>
            </div>
            {userSkills.length === 0
              ? <p style={styles.groupEmpty}>{root === '' ? '还没有已安装的技能，用上方输入框从本地文件夹安装一个吧' : '用户级暂无技能'}</p>
              : userSkills.map(renderRow)}
          </>
        )}
      </div>
    </div>
  )
}
