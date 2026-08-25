# dsh-skill-manage

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的技能管理插件：在 Web UI 的设置页里提供一个「技能管理」面板，图形化管理用户级与项目级技能——无需手动编辑 SKILL.md 或敲命令。

## 功能

- **范围切换**：顶部双段开关切换「用户级（~/.dsh/skills）」与「项目级（.dsh/skills）」；项目级通过可搜索下拉选择已登记工作区，路径栏实时显示当前目标目录并支持一键复制
- **安装**（三种来源）：
  - 本地文件夹：填写路径安装
  - 浏览上传：浏览器目录选择器，选中即上传安装（无需暴露绝对路径）
  - GitHub：粘贴 `github:owner/repo`、`owner/repo`、完整 HTTPS URL，或网页 `…/tree/<分支>/<目录>` 链接
    - 单技能目录直装；**父目录 → 安装清单**：经 GitHub Trees API 扫描（约 0.5s、零克隆，失败自动回退克隆扫描），逐项勾选后确认安装（>15 个会先提示数量），冲突项标「已存在」默认不勾、勾上即覆盖
    - 直连失败自动改用镜像（`ghfast.top` / `gh-proxy.com`）重试，默认开启
  - 搜索（skills.sh）：输入关键词在线搜索技能商店，结果展示技能名/仓库/安装数，点「安装」即按技能名引导仓库内 BFS 定位后一键安装
  - 安装校验 `SKILL.md` frontmatter（kebab-case 名称、description）；同名冲突无预置勾选——出现时内联提醒「覆盖安装 / 取消」，用户按需选择
- **卸载**：两步确认删除，操作限定在受管技能目录内
- **启停**：每个技能的「启用 / 禁用」一键同时改写 `disable-model-invocation` 与 `user-invocable` 两个 frontmatter 键
- **列表**：按名称搜索、刷新；每行显示首字母彩色图标、状态圆点（绿=启用/灰=停用）、「已启用/已禁用」胶囊

## 管理范围

| 范围 | 目录 | 说明 |
|---|---|---|
| 用户级（默认） | `~/.dsh/skills`（rank 400，即 `$DSH_HOME/skills`） | 所有会话可见；同名时优先于 `.agents` |
| 用户级 `.agents` | `~/.agents/skills`（rank 500，即 `$DSH_AGENTS_HOME/skills`） | 共享 agent 根，同样识别展示（带 `.agents` 徽标），可启停/卸载 |
| 项目级 | `<项目根>/.dsh/skills`（rank 100） | 从 `ctx.workspaceRegistry`（Web UI 工作区切换器）选择项目 |

项目根按官方 provider 语义解析为最近的 `.git` 祖先目录；扫描 `<根>/.dsh/skills` 与 `<根>/.agents/skills`，同名时 `.dsh` 优先，安装固定落入 `.dsh/skills`。技能格式支持目录 bundle（`<name>/SKILL.md`）与平铺单文件（`<name>.md`）；本地安装入口填写文件路径即可安装平铺技能。

## 安装

```sh
# 从 GitHub 安装（pnpm 会运行 prepare 构建脚本，首次需在 profile 的 pnpm-workspace.yaml 里授权）
dsh plugin --profile web add github:Nay-1/dsh-skill-manage
```

若 pnpm 供应链策略拦截构建，按提示把包键加入 profile 的授权清单：

```yaml
# ~/.dsh/profiles/web/pnpm-workspace.yaml
allowBuilds:
  dsh-skill-manage: true
```

也可以从本地路径安装：

```sh
git clone https://github.com/Nay-1/dsh-skill-manage.git
cd dsh-skill-manage && pnpm install && pnpm build
dsh plugin --profile web add /path/to/dsh-skill-manage
```

安装完成后重启 `dsh web`，打开 **设置 → 技能管理** 即可使用。

## 使用提示

- **GitHub 安装示例**（安装卡片切到 GitHub Tab 后直接粘贴）：

  | 输入 | 说明 |
  |---|---|
  | `github:JimmyLv/bibigpt-skill` | 单技能仓库，自动定位 |
  | `https://github.com/github/awesome-copilot/tree/main/skills/acquire-codebase-knowledge` | 网页 tree 链接，**单个**技能直装 |
  | `https://github.com/github/awesome-copilot/tree/main/skills` | 父目录 → **出安装清单**（API 扫描约 0.5s），勾选后批量安装（>15 个先提示数量） |
  | `https://github.com/anthropics/skills#path:skills/docx` | `#path:` 精确子目录（备用形式） |

  格式：`github:owner/repo` / `owner/repo` / 完整 HTTPS URL / `…/tree/分支/目录` 网页链接，均可配合 `#path:子目录`（tree 链接自带目录，不可叠加）。裸仓库含多个技能目录时自动弹出安装清单供选择。
- **冲突提醒**：同名技能出现时不预置「覆盖勾选」，而是内联弹出「技能 x 已存在」+〔覆盖安装〕〔取消〕按钮——本地、GitHub、搜索、上传四个入口统一。
- **搜索安装（skills.sh）**：安装卡片切到「🔍 搜索」Tab，输入关键词回车；结果按技能名匹配仓库内 BFS 定位（无需知道仓库内真实路径），点「安装」即装。商店接口为 `https://www.skills.sh/api/search`（公开，无需鉴权）。
- **镜像回退**：GitHub 直连失败时自动改经 `ghfast.top` / `gh-proxy.com` 浅克隆（默认勾选，可在 GitHub Tab 关闭），无代理环境也可安装
- **代理环境**：GitHub 克隆由 dsh 进程执行，若网络需代理，请在带代理环境的终端里启动 dsh（`http_proxy` 等会继承），否则会直连超时（可改用镜像回退）
- 改动即时生效，新会话可见；运行时同名技能项目级优先于用户级（官方 rank 语义）

## 架构

```
src/index.ts          宿主半侧：webServer 挂载 /dsh-skill-manage JSON 路由
                      （GET /skills、GET /workspaces；
                       POST /search-skills、/install、/install-upload、
                       /install-github、/remove、/toggle）
src/client/           浏览器半侧：注册 settings.section 槽位渲染 React 页面
build.mjs             esbuild 构建：宿主 ESM lib/index.js +
                      浏览器 lazy-CJS factory lib/client.js（复刻官方 clientBundle 契约）
cordis.patch.yml      bundle patch：向组合层插入本插件行
```

技能数据直接扫描文件系统（镜像官方 `dsh-skill-filesystem` provider 的目录与 rank 规则），因为宿主上下文的 `ctx.skills` 只能看到全局层，看不到用户/项目级技能。GitHub/上传安装均由后端克隆或暂存到临时目录后复用同一套 `handleInstall` 校验逻辑。GitHub 批量安装先走 `api.github.com/git/trees` 扫描出清单（零克隆，失败自动回退克隆扫描），用户确认后克隆一次并逐个安装（被点名即视为授权覆盖冲突）。浏览器 bundle 经包内 `dsh.client` 清单元被宿主自动发现并经 `/plugins` 路由分发加载。

## 开发

```sh
pnpm install
pnpm build       # 产出 lib/
pnpm typecheck   # tsc --noEmit
```

本地迭代流程：改代码 → `pnpm build` → 重启 `dsh web`。

## License

MIT
