# dsh-skill-manage

[![npm version](https://img.shields.io/npm/v/@nay-1/dsh-skill-manage?label=npm)](https://www.npmjs.com/package/@nay-1/dsh-skill-manage)
[![license](https://img.shields.io/badge/license-MIT-blue)](#license)
[![stars](https://img.shields.io/github/stars/Nay-1/dsh-skill-manage?style=flat)](https://github.com/Nay-1/dsh-skill-manage)

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的图形化技能管理器：在 Web UI 设置页里就能安装、搜索、启用、停用、卸载技能——不用手改 `SKILL.md`，不用敲命令。

[English](/README.md) · **中文**

## Features

- **零文件操作**——Web UI 面板里一键启停/覆盖/卸载；`disable-model-invocation`、`user-invocable` 等 frontmatter 标记由插件代写。
- **四渠道安装**——本地文件夹、浏览器目录选择器、GitHub 链接、[skills.sh](https://www.skills.sh) 在线搜索。
- **智能批量**——粘贴 `…/tree/<分支>/<目录>` 网页链接：父目录经 GitHub Trees API 生成安装清单（约 0.5s、零克隆；失败自动回退克隆扫描），勾选后一次装齐。
- **冲突优先交互**——同名技能默认决不静默覆盖；内联弹出「覆盖安装 / 取消」，四个安装入口行为统一。
- **网络韧性**——直连 GitHub 失败自动改经 `ghfast.top` / `gh-proxy.com` 镜像重试（默认开启）。
- **官方 rank 对齐**——按官方 `dsh-skill-filesystem` provider 的目录顺序扫描 `~/.dsh/skills` 与 `~/.agents/skills`，同名遮蔽语义一致。

## Screenshots

**用户级**——管理所有会话可见的技能：

![user scope](https://raw.githubusercontent.com/Nay-1/dsh-skill-manage/main/docs/user-scope.png)

**项目级**——从 Web UI 工作区切换器选项目，管理其 `.dsh/skills`：

![project scope](https://raw.githubusercontent.com/Nay-1/dsh-skill-manage/main/docs/project-scope.png)

## 安装

**从 npm 安装（推荐）：**

```sh
dsh plugin --profile web add @nay-1/dsh-skill-manage
```

若 pnpm 供应链策略拦截构建脚本，在 profile 里授权：

```yaml
# ~/.dsh/profiles/web/pnpm-workspace.yaml
allowBuilds:
  '@nay-1/dsh-skill-manage': true
```

**从 GitHub 安装：**

```sh
dsh plugin --profile web add github:Nay-1/dsh-skill-manage
```

**从本地路径：**

```sh
git clone https://github.com/Nay-1/dsh-skill-manage.git
cd dsh-skill-manage && pnpm install && pnpm build
dsh plugin --profile web add /path/to/dsh-skill-manage
```

安装后重启 `dsh web`，打开 **设置 → 技能管理**。

## 使用指南

### 管理范围与优先级

| 范围 | 目录 | Rank | 说明 |
|---|---|---|---|
| 项目级（.dsh） | `<项目根>/.dsh/skills` | 100 | 优先级最高 |
| 项目级（.agents） | `<项目根>/.agents/skills` | 200 | |
| 用户级（.dsh） | `~/.dsh/skills`（`$DSH_HOME/skills`） | 400 | 默认视图 |
| 用户级（.agents） | `~/.agents/skills`（`$DSH_AGENTS_HOME/skills`） | 500 | 列表带 `.agents` 徽标 |

项目根按官方 provider 语义解析为最近的 `.git` 祖先目录。同名技能由高 rank 根遮蔽；安装固定落入各范围的最高 rank 根。

技能格式：目录 bundle（`<name>/SKILL.md`）与平铺单文件（`<name>.md`）均能被发现与管理。

### 安装技能

| Tab | 输入 / 操作 | 结果 |
|---|---|---|
| 本地文件夹 | 文件系统路径（平铺技能可直接填 `.md` 文件路径） | 校验 frontmatter 后安装 |
| 浏览 | 浏览器目录选择器 | 上传安装，无需暴露绝对路径 |
| GitHub | `github:owner/repo`、`owner/repo`、完整 HTTPS URL，或网页 `…/tree/<分支>/<目录>` 链接 | 技能目录直装；**父目录出安装清单** |
| 搜索 | 关键词 → skills.sh 结果（技能名 / 仓库 / 安装数） | 点「安装」——按技能名仓库内 BFS 定位，无需知道真实路径 |

**安装清单**（父目录链接、含多技能的裸仓库）：

1. 仓库树经 GitHub Trees API 扫描——约 0.5s、**零克隆**（API 报错/限流/截断时自动回退克隆扫描）。
2. 出现勾选清单；已安装的行标「已存在」且默认不勾——勾上即表示覆盖。
3. 超过 15 个技能时先弹确认条：「共 N 个技能——要继续吗？」。
4. 确认 → 一次浅克隆 → 逐个校验并安装。

**GitHub 示例：**

| 输入 | 行为 |
|---|---|
| `github:JimmyLv/bibigpt-skill` | 单技能仓库，自动定位 |
| `https://github.com/github/awesome-copilot/tree/main/skills/acquire-codebase-knowledge` | tree 链接，**单个**技能直装 |
| `https://github.com/github/awesome-copilot/tree/main/skills` | 父目录 → **安装清单** |
| `https://github.com/anthropics/skills#path:skills/docx` | `#path:` 精确子目录（备用形式） |

### 冲突处理

四个入口完全一致：出现同名时内联提示「技能 x 已存在」+〔覆盖安装〕〔取消〕——不会误覆盖任何东西。

### 列表管理

- 按技能名**搜索 / 刷新**。
- 每行：首字母彩色图标、状态圆点（绿=启用、灰=停用）、「已启用/已禁用」胶囊。
- **启用 / 禁用**一键同时改写 `disable-model-invocation` 与 `user-invocable`。
- **卸载**两步确认，仅作用于受管技能目录。

## 性能与边界

- GitHub Trees API（无鉴权）限额 60 次/小时——一次扫描用 1 次；失败/限流/截断时静默回退克隆扫描。
- 批量安装无硬上限，但超过 15 个需显式确认。
- 私有仓库不支持（无凭证）。
- skills.sh 搜索 10s 超时兜底并给出友好错误；该站点是公开但无文档接口。

## FAQ

**GitHub 安装挂起或超时——必须开 VPN 吗？**
克隆由 dsh 进程执行，要么网络可达，要么靠镜像回退（默认开启）。要用系统代理时，请在导出了 `http_proxy`/`https_proxy` 的终端里启动 dsh（git 会继承）；进程无代理变量且镜像也连不上时，错误消息会明确告诉你。

**那不开 VPN 行不行？**
通常行：`ghfast.top`、`gh-proxy.com` 镜像无代理可达。保持「直连失败时改用镜像」勾选（默认）即可。

**skills.sh 搜索提示「响应超时」。**
该接口是第三方站点；稍候重试即可。国内直连 skills.sh 一般畅通。

**搜索结果安装失败？**
仓库目录须含 `SKILL.md` 且 frontmatter 有合法的 `name`（kebab-case）与 `description`。skills.sh 偶尔会收录已改名/已删除的技能——选最新结果或直接用仓库安装。

**列表里的技能来自哪里？**
`~/.agents` 根下的技能带灰色 `.agents` 徽标，随时知道自己在编辑/删除哪个根。

**npm 安装出现“需要二步验证”？**
这是 npm 侧的发布策略，与本插件无关——[给 npm 账号开启 2FA](https://www.npmjs.com/settings/your-account/security)，或改用带 bypass-2FA 的粒度访问 token。

## 架构

| 部分 | 文件 | 职责 |
|---|---|---|
| 宿主半侧 | `src/index.ts` | 在 `/dsh-skill-manage` 挂载 JSON 路由（宿主 ESM bundle） |
| 浏览器半侧 | `src/client/` | 注册 `settings.section` 槽位并渲染 React 页面 |
| 构建 | `build.mjs` | esbuild：宿主 ESM `lib/index.js` + 浏览器 lazy-CJS factory `lib/client.js` |
| 组合层 | `cordis.patch.yml` | bundle patch：向组合层插入插件行 |

**路由：** `GET /skills`、`GET /workspaces` · `POST /search-skills`、`/install`、`/install-upload`、`/install-github`、`/remove`、`/toggle`。

技能直接扫描文件系统得到（镜像官方 provider 的目录与 rank 语义），因为宿主上下文的 `ctx.skills` 只暴露全局层。GitHub/上传安装均克隆或暂存到临时目录后复用同一套 `handleInstall` 校验。浏览器 bundle 注册使用**固定模块 ID `dsh-skill-manage`**（不随 npm 包名变化——见 `build.mjs`），任意包名下都能正常加载。

## 开发

```sh
pnpm install
pnpm build       # 产出 lib/
pnpm typecheck   # tsc --noEmit
```

本地迭代：改代码 → `pnpm build` → 重启 `dsh web`。

**发布 checklist：**

- `version` 升版（`npm version patch`）
- `publishConfig.access: "public"` 就位（scoped 包发布必需）
- `npm publish --registry=https://registry.npmjs.org`——按 npm 新规需要 2FA 或 bypass-2FA token

## License

MIT
