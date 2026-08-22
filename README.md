# dsh-skill-manage

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的技能管理插件：在 Web UI 的设置页里提供一个「技能管理」面板，让你以图形界面管理用户级与项目级技能——无需手动编辑 SKILL.md 或敲命令。

## 功能

- **列表**：分组展示「项目级」与「用户级」技能，含描述、来源目录与调用策略徽章；选中项目时用户级常驻显示
- **安装**：从本地文件夹安装（校验 `SKILL.md` frontmatter、kebab-case 名称查重），支持覆盖同名
- **卸载**：两步确认删除，路径越界防护
- **启停**：改写 frontmatter 的 `disable-model-invocation` / `user-invocable`，控制模型/用户能否调用该技能，正文完整保留

管理范围支持三种来源：

| 范围 | 目录 |
|---|---|
| 用户级（默认） | `~/.dsh/skills`（即 `$DSH_HOME/skills`） |
| 已登记工作区 | 自动读取 `ctx.workspaceRegistry`，即 Web UI 工作区切换器里的项目，支持按名称/路径搜索 |

项目根按官方 provider 语义解析为最近的 `.git` 祖先目录；扫描 `<根>/.dsh/skills` 与 `<根>/.agents/skills`，同名时 `.dsh` 优先，安装固定落入 `.dsh/skills`。

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

## 使用说明

- **启停**：「已启用 / 已停用」一键同时控制模型调用（frontmatter `disable-model-invocation`）与用户斜杠触发（`user-invocable`）；任一开启即显示已启用
- 默认启用；改动即时生效，新会话可见
- 运行时同名技能项目级优先于用户级（官方 rank 语义）

## 架构

```
src/index.ts          宿主半侧：webServer 挂载 /dsh-skill-manage JSON 路由
                      （GET /skills、GET /workspaces、POST /install /remove /toggle）
src/client/           浏览器半侧：注册 settings.section 槽位渲染 React 页面
build.mjs             esbuild 构建：宿主 ESM lib/index.js +
                      浏览器 lazy-CJS factory lib/client.js（复刻官方 clientBundle 契约）
cordis.patch.yml      bundle patch：向组合层插入本插件行
```

技能数据直接扫描文件系统（镜像官方 `dsh-skill-filesystem` provider 的目录与 rank 规则），因为宿主上下文的 `ctx.skills` 只能看到全局层，看不到用户/项目级技能。浏览器 bundle 经包内 `dsh.client` 清明被宿主自动发现并经 `/plugins` 路由分发加载。

## 开发

```sh
pnpm install
pnpm build       # 产出 lib/
pnpm typecheck   # tsc --noEmit
```

本地迭代流程：改代码 → `pnpm build` → 重启 `dsh web`。

## License

MIT
