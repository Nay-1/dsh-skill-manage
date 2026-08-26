# Contributing

Thanks for taking an interest in `dsh-skill-manage`. This file is for maintainers and contributors; end users should read the [README](/README.md).

## Environment

- Node ≥ 20 (developed on v24 via [nvm](https://github.com/nvm-sh/nvm))
- [pnpm](https://pnpm.io) (`corepack enable` or `npm i -g pnpm`)

## Commands

```sh
pnpm install     # dependencies
pnpm build       # esbuild → lib/index.js + lib/client.js (also runs via "prepare" on install)
pnpm typecheck   # tsc --noEmit
```

Local iteration loop: edit `src/` → `pnpm build` → restart `dsh web`.

## Architecture notes

- **Two halves**: the host half (`src/index.ts`, ESM bundle) registers JSON routes under `/dsh-skill-manage` via `webServer`; the browser half (`src/client/`, lazy-CJS factory bundle) registers the `settings.section` slot.
- **Client bundle ID** (`build.mjs` → `CLIENT_MODULE_ID`) is deliberately fixed to `dsh-skill-manage` and **must match the `name` in `cordis.patch.yml`** — dsh resolves the registry loader entry by that ID, not by the npm package name. If the patch name changes, update both.
- Route dispatch, GitHub API scan fallbacks and install validation all live in `src/index.ts`.

## Testing checklist (manual, against `dsh web`)

1. `pnpm typecheck && pnpm build`
2. Single tree link install (`…/tree/main/skills/<name>`) then re-install → inline conflict prompt → Overwrite works
3. Parent-directory link (`…/tree/main/skills`) → plan appears from GitHub Trees API (~0.5 s), confirm a subset → batch install summary
4. Bare multi-skill repo → plan instead of the old error
5. `#path:` exact subdirectory, `github:owner/repo`, skills.sh search install
6. `~/.agents/skills`: directory bundle and flat `<name>.md` show up with `.agents` badge; toggle/uninstall affect those files
7. Name shadowing: same name in `.dsh` and `.agents` roots — only `.dsh` version listed
8. Local flat install (`source` = a `.md` file) → lands as `<name>.md`; re-install → conflict prompt

## Release checklist

```sh
pnpm typecheck && pnpm build
git commit          # all changes in
npm version patch   # commits + tags vX.Y.Z
git push && git push origin vX.Y.Z
npm publish --registry=https://registry.npmjs.org
```

Scoped-package specifics:

- `publishConfig.access: "public"` must stay in `package.json` — scoped packages default to restricted (private, paid); publishing without it returns `402 Payment Required`.
- npm requires **2FA on the account** (or a granular access token with bypass-2FA) for direct publishing — plain password logins return `403 Forbidden`. Log in with 2FA enabled:
  ```sh
  npm login --registry=https://registry.npmjs.org
  ```
- Keep the npm registry flag explicit if your global registry is a mirror (npmmirror is read-only for publish): `npm publish --registry=https://registry.npmjs.org`.

## License

By contributing you agree to license your work under the project's [MIT](/LICENSE) license.
