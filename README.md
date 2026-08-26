# dsh-skill-manage

[![npm version](https://img.shields.io/npm/v/@nay-1/dsh-skill-manage?label=npm)](https://www.npmjs.com/package/@nay-1/dsh-skill-manage)
[![license](https://img.shields.io/badge/license-MIT-blue)](#license)
[![stars](https://img.shields.io/github/stars/Nay-1/dsh-skill-manage?style=flat)](https://github.com/Nay-1/dsh-skill-manage)

> A graphical skill manager for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).
> Install, search, enable, disable and remove skills from your Web UI — no `SKILL.md` editing, no shell commands.

**English** · [中文](/README.zh.md)

## Features

- **Zero-file management** — enable/disable, overwrite and uninstall skills through a Web UI panel; frontmatter flags (`disable-model-invocation`, `user-invocable`) are rewritten for you.
- **Four install channels** — a local folder, a browser folder picker, a GitHub URL, or an online search over [skills.sh](https://www.skills.sh).
- **Smart batch installs** — paste a `…/tree/<branch>/<dir>` link; a parent directory yields a plan from the GitHub Trees API (~0.5 s, zero clone; falls back to a local clone scan automatically). Tick what you want and install in one shot.
- **Conflict-first UX** — same-name skills never die by default; an inline prompt offers **Overwrite / Cancel**, identically across every install channel.
- **Network resilience** — a direct GitHub clone that fails transparently retries through `ghfast.top` / `gh-proxy.com` mirrors (on by default).
- **Official rank alignment** — scans `~/.dsh/skills` + `~/.agents/skills` in the exact order the official `dsh-skill-filesystem` provider uses, including same-name shadowing.

## Screenshots

**User scope** — manage every skill registered for all sessions:

![user scope](https://raw.githubusercontent.com/Nay-1/dsh-skill-manage/main/docs/user-scope.png)

**Project scope** — pick a workspace from the Web UI switcher and manage its `.dsh/skills`:

![project scope](https://raw.githubusercontent.com/Nay-1/dsh-skill-manage/main/docs/project-scope.png)

## Installation

**From npm (recommended):**

```sh
dsh plugin --profile web add @nay-1/dsh-skill-manage
```

If the pnpm supply chain policy blocks the build script, grant approval in your profile:

```yaml
# ~/.dsh/profiles/web/pnpm-workspace.yaml
allowBuilds:
  '@nay-1/dsh-skill-manage': true
```

**From GitHub:**

```sh
dsh plugin --profile web add github:Nay-1/dsh-skill-manage
```

**From a local path:**

```sh
git clone https://github.com/Nay-1/dsh-skill-manage.git
cd dsh-skill-manage && pnpm install && pnpm build
dsh plugin --profile web add /path/to/dsh-skill-manage
```

Restart `dsh web`, then open **Settings → Skill Management**.

## Usage

### Management scopes & priority

| Scope | Directory | Rank | Notes |
|---|---|---|---|
| Project (`.dsh`) | `<projectRoot>/.dsh/skills` | 100 | Highest priority |
| Project (`.agents`) | `<projectRoot>/.agents/skills` | 200 | Shown with a `.agents` badge |
| User (`.dsh`) | `~/.dsh/skills` (`$DSH_HOME/skills`) | 400 | Default view |
| User (`.agents`) | `~/.agents/skills` (`$DSH_AGENTS_HOME/skills`) | 500 | Shown with a `.agents` badge |

The project root is resolved to the nearest ancestor containing `.git` (official provider semantics). Same-name skills are shadowed by the higher-rank root; installs always land in the top root of their scope. **Every skill from a non-top rank root (`.agents`) gets a `.agents` badge in the list — user and project scopes alike.**

Skill formats: directory bundles (`<name>/SKILL.md`) **and** flat single-file skills (`<name>.md`) are both discovered and manageable.

### Installing skills

| Tab | What you paste / do | Result |
|---|---|---|
| Local folder | a filesystem path (or a `.md` file path for a flat skill) | installs after frontmatter validation |
| Browse | browser folder picker | uploads without exposing absolute paths |
| GitHub | `github:owner/repo`, `owner/repo`, complete HTTPS URL, or a web `…/tree/<branch>/<dir>` link | a skill dir installs directly; a parent dir opens an install plan |
| Search | a keyword → skills.sh results (name / repo / install count) | click **Install** — the skill is located in-repo by name (BFS, no need to know the exact path) |

**Install plan** (parent-directory links, bare multi-skill repos):

1. The repo tree is scanned via the GitHub Trees API — about 0.5 s, **no clone** (falls back to a clone scan when the API errors, rate-limits, or truncates).
2. A checklist appears; rows already present are marked **Already installed** and unchecked by default — checking one means overwrite.
3. With more than 15 skills a confirmation bar asks first: *"N skills — continue?"*.
4. Confirm → one shallow clone → each checked skill is validated and installed.

**GitHub examples:**

| Input | Behavior |
|---|---|
| `github:JimmyLv/bibigpt-skill` | single-skill repo, auto-located |
| `https://github.com/github/awesome-copilot/tree/main/skills/acquire-codebase-knowledge` | tree link, **one** skill, direct |
| `https://github.com/github/awesome-copilot/tree/main/skills` | parent dir → **install plan** |
| `https://github.com/anthropics/skills#path:skills/docx` | `#path:` for exact subdirectories (alternative) |

### Conflicts

Every channel behaves the same: if the name exists, an inline **"skill x already exists"** prompt offers **Overwrite / Cancel**. Nothing is overwritten by accident.

### Managing the list

- **Search / refresh** by skill name.
- Each row shows a colored letter icon, a status dot (green = enabled, grey = disabled) and an **Enabled / Disabled** pill.
- **Enable / Disable** flips both `disable-model-invocation` and `user-invocable` in one click.
- **Uninstall** is a two-click confirm, confined to managed skill directories.

## Performance & limits

- GitHub Trees API without authentication: 60 requests/hour — one scan uses one; on failure / rate limit / truncated payload the plugin silently falls back to a clone scan.
- Batch installs have no hard cap, but >15 skills require explicit confirmation.
- Private repositories are not supported (no credentials).
- `skills.sh` search has a 10-second timeout with a friendly error; the site is a public, undocumented endpoint.

## FAQ

**GitHub installs hang or time out — is a VPN required?**
The clone runs inside the `dsh` process, so it needs either a reachable network or the mirror fallback (on by default). To use a system proxy, launch dsh in a shell that exports `http_proxy`/`https_proxy`; git inherits them. If the process has no proxy variables and the mirror cannot reach GitHub either, the error message tells you so.

**Do I need a VPN at all?**
Usually not: `ghfast.top` and `gh-proxy.com` mirrors are reachable without a proxy. Keep **use mirror on direct failure** checked (default).

**Skills.sh search says "response timed out".**
The endpoint is a third-party site; wait and retry. Direct connectivity to skills.sh is generally fine from China.

**A skill I searched for cannot be installed.**
The repository must contain a `SKILL.md` with a valid `name` (kebab-case) and `description`. Skills.sh sometimes lists renamed or removed skills — pick the newest hit or use the repo directly.

**Where does a skill come from?**
Skills in the `.agents` home root carry a small `.agents` badge in the list, so you always know which root you are editing or deleting.

**Why does my npm install fail with "Two-step verification required"?**
That is an npm-side publishing policy, unrelated to this plugin — [add 2FA to your npm account](https://www.npmjs.com/settings/your-account/security) or use a granular access token with bypass-2FA enabled.

## Architecture

| Part | File(s) | Role |
|---|---|---|
| Host half | `src/index.ts` | registers JSON routes under `/dsh-skill-manage` (host ESM bundle) |
| Browser half | `src/client/` | registers the `settings.section` slot and renders the React page |
| Build | `build.mjs` | esbuild: host ESM `lib/index.js` + browser lazy-CJS factory `lib/client.js` |
| Composition | `cordis.patch.yml` | bundle patch inserting the plugin row into the composition |

**Routes:** `GET /skills`, `GET /workspaces` · `POST /search-skills`, `/install`, `/install-upload`, `/install-github`, `/remove`, `/toggle`.

Skills are discovered by scanning the filesystem directly (mirroring the official provider's directory and rank semantics), because `ctx.skills` in the host context only exposes the global layer. GitHub and upload installs clone or stage into temp dirs and reuse one `handleInstall` validation path. The client bundle is the **stable module ID `dsh-skill-manage`** (fixed, not the npm package name — see `build.mjs`) so registry loading works with any package name.

## Development

```sh
pnpm install
pnpm build       # emits lib/
pnpm typecheck   # tsc --noEmit
```

Local loop: edit → `pnpm build` → restart `dsh web`.

See [CONTRIBUTING.md](/CONTRIBUTING.md) for build, lint and release guidelines (maintainers).

## License

MIT
