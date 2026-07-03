# AGENTS.md

## Project Shape

- Electron + electron-vite + Vue 3 + TypeScript app; use `pnpm` because `pnpm-lock.yaml` and package metadata are present.
- Process boundaries matter: `src/main/index.ts` owns Electron windows, local config storage, Sub2API requests, and IPC handlers; `src/preload/index.ts` exposes the limited `window.api`; `src/renderer/src/App.vue` owns the floating-ball UI.
- Renderer imports use `@renderer/*` from `electron.vite.config.ts`; preload types are included in web typecheck through `tsconfig.web.json`.

## Commands

- Install: `pnpm install`.
- Dev app: `pnpm dev` starts the Electron app and Vite renderer server; main/preload changes usually require restarting this command.
- Focused verification: `pnpm run typecheck` runs node and web typechecks.
- Full build: `pnpm run build` runs typecheck first, then `electron-vite build`.
- Package builds: `pnpm build:win`, `pnpm build:mac`, `pnpm build:linux`; each runs the full build first.
- Lint/format exist but are separate: `pnpm run lint`, `pnpm run format`.

## App-Specific Notes

- Local user config is written by the main process to `app.getPath('userData')/config.json`; do not hardcode Sub2API URLs, admin keys, or JWTs in source.
- Sub2API usage is currently derived from `/api/v1/admin/accounts` account `extra.codex_*` fields, not per-account usage endpoints.
- Auth handling in `src/main/index.ts` intentionally supports both `admin-...` keys and browser JWTs by trying multiple headers; keep this compatibility unless the API contract is clarified.
- Do not pass Vue reactive proxies through IPC. Build plain objects before calling `window.api.saveConfig` or other IPC methods, otherwise Electron can throw `An object could not be cloned.`
- Floating-window sizing is controlled in `setPanelExpanded()` in the main process; keep renderer state and BrowserWindow size changes coordinated through IPC.

## Styling And UI

- Tailwind v4 is wired through `@tailwindcss/vite`; theme tokens and drag/no-drag window regions live in `src/renderer/src/assets/base.css`.
- shadcn-style primitives are local Vue components under `src/renderer/src/components/ui`; use `cn()` from `src/renderer/src/lib/utils.ts` for class merging.
- For frameless Electron UI, interactive controls inside draggable areas need the `no-drag` class.

## Generated/Output Paths

- `out/`, `dist/`, and `node_modules/` are generated/ignored by ESLint; avoid editing generated build output.
- Electron download mirrors and `shamefully-hoist=true` are set in `.npmrc`; keep them unless install behavior is intentionally changed.


## 代码提交规范
- 示例: feat(app): 初始化