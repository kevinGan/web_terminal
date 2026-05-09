# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root unless noted. This is a pnpm workspace (`packages/*`).

| Task | Command |
|---|---|
| Install deps (runs `postinstall` chmod fix for `node-pty`) | `pnpm install` |
| Dev (server + web concurrently, vite at 5173 proxying to server 7681) | `pnpm dev` |
| Typecheck both packages | `pnpm typecheck` |
| Production build (web first, then server) | `pnpm build` |
| Run built server | `pnpm start` (or `pnpm start --port 8080 --host 127.0.0.1 --no-token`) |
| Single-package dev | `pnpm -F @wt/server dev` / `pnpm -F @wt/web dev` |
| Single-package typecheck | `pnpm -F @wt/server typecheck` / `pnpm -F @wt/web typecheck` |
| WS smoke test (requires server running + token in `~/.web_terminal/token`) | `node scripts/ws-smoke.mjs` |

There is **no test framework** — verification is via `pnpm typecheck` and the WS smoke script.

## Architecture

### Two-package layout, one wire protocol

- `@wt/server` (Fastify + node-pty + ws) speaks two contracts to the browser: a token-authed REST API under `/api/*` and a single binary-frame WebSocket at `/ws/terminal`.
- `@wt/web` (React + Vite + xterm.js + zustand) is a SPA that the server also serves statically in production. In dev, vite (5173) proxies `/api`, `/qr`, `/ws` → server (7681); see `packages/web/vite.config.ts`.
- `packages/server/src/index.ts` mounts every route group inside an inner Fastify scope so the auth `onRequest` hook applies uniformly (the WS handles its own auth via `?token=` because Fastify hooks don't run on upgrade).

### PTY session lifecycle (`packages/server/src/pty/`)

- `SessionManager.attachOrCreate({id, cols, rows, cwd})` is the single entry point used by `ws/terminal.ts`. Reattaching by id cancels the soft-close timer.
- **Soft-close is 24h** (`config.ptySoftCloseMs`) — surprisingly long, intentional: a refresh or a different browser opening the same workspace should still hit the same PTY. Explicit pane close kills immediately via `destroy()`.
- `session.snapshot()` returns the in-memory scrollback. The WS sends a `ready{replayed: snap.length > 0}` control message before the bytes; the client uses that flag to decide whether to paint its own localStorage scrollback (avoids double-paint after a fresh server restart).
- **OSC-based cwd tracking**: the ZDOTDIR wrapper (`pty/zdotdir.ts`) injects a `precmd` hook that emits `\e]1337;CurrentDir=<path>\a`. `pty/osc-parser.ts` parses these out of the byte stream server-side and pushes `{type:'cwd'}` control frames; xterm.js ignores them so they don't render. **Do not change the OSC sequence without updating both ends.**

### ZDOTDIR wrapper — non-obvious

Server boot writes `.zshenv` / `.zprofile` / `.zshrc` / `.zlogin` into `~/.web_terminal/zsh-init/`. Each wrapper sources the user's original same-named file (preserved via `WEBTERM_USER_HOME` / `WEBTERM_USER_ZDOTDIR`) and then injects the cwd-reporting hook. Spawned shells get `ZDOTDIR=<wrapper dir>`. This is how we reuse the user's full zsh environment without writing into their actual dotfiles. If a user reports "my prompt is wrong" or "alias missing", inspect this wrapper layer first.

### WebSocket protocol (`packages/server/src/ws/terminal.ts` ↔ `packages/web/src/api/ws.ts`)

- Client → server: JSON control on first frame (`{type:'init', cols, rows, cwd?, id?}`), then raw stdin bytes as binary frames; resize is JSON.
- Server → client: JSON control (`ready` / `cwd` / `title` / `exit`) interleaved with binary stdout bytes.
- The client `PtyConn` class implements **exponential backoff reconnect** (500ms base, 10s cap, jitter) with a **terminal-close-code whitelist** (`1000, 1001, 1005, 4001, 4003`) — codes in that set are auth/policy/clean exits and must NOT be retried. New retry policy lives in `api/ws.ts`; if you add a new server-side close code with `4xxx`, update the whitelist there.

### Frontend pane model (`packages/web/src/store/tabs.ts`)

- A `Tab` owns a recursive `Pane` tree: `leaf` (terminal | diff) or `split` (h/v binary node). Splitting/closing are pure tree mutations.
- **Diff leaves are conceptually singletons**: `openOrUpdateDiffTab` finds the existing diff tab (root must be a diff leaf) and retargets it; `splitActive` is a no-op when the active leaf is a diff (would orphan the lookup). If you add new pane types, mirror these guards.
- `migrateLegacyPane` in the same file is the persistence migration path — when changing the `Pane` shape, extend it instead of breaking old snapshots.

### Workspace persistence (`packages/web/src/store/persist.ts` + `routes/state.ts`)

`bootstrapPersistence()` runs once on boot: GET `/api/state` → `tabsStore.hydrate()`, then subscribes to store changes and debounce-PUTs back (300ms). The server treats the tab tree as an opaque blob; only the client knows the real shape (note the cast in `persist.ts`). This is how a refresh — or a second browser pointed at the same server — sees the same tabs/panes/cwds.

### Terminal control registry (`packages/web/src/store/terminalRegistry.ts`)

A non-reactive `Map<leafId, TerminalControl>` lets toolbar buttons / side panels send bytes to a specific xterm without prop-drilling the WS conn. `focus()`/`blur()` operate on the xterm DOM textarea — used by the dedicated mobile "⌨" button (we deliberately do NOT auto-focus on every tap).

### Security model (`auth.ts`, `lan-guard.ts`, `routes/files.ts`, `routes/git.ts`)

Two layers, applied in order via Fastify `onRequest` hooks:

1. **LAN guard** — only `127.0.0.1`, RFC1918 ranges, IPv6 ULA/link-local. Other sources get 403.
2. **Bearer token** — 32-byte hex in `~/.web_terminal/token` (mode 600). Required on REST (`Authorization: Bearer`) and WS (`?token=`).

Any route that takes a path (`files`, `git`) MUST: `realpath` the input, then verify it falls under one of `config.allowedRoots` (default: `$HOME:/tmp:/Users:/Volumes`, configurable via `--allow-root`). The pattern lives in `routes/files.ts` and `routes/git.ts:safeResolve` — copy it; don't reinvent.

### Vite + `@pierre/diffs` quirk

`@pierre/diffs` ships a `web-components.js` that registers the custom element used in diff rendering, but it's not in the package's `exports` map. `vite.config.ts` resolves an absolute path alias and **fails fast at config load** if the file isn't present. If you switch package managers or pnpm hoisting changes, expect a clear error here rather than a silent runtime "custom element undefined" deep inside the diff render path.

### node-pty postinstall

`scripts/fix-node-pty-perms.mjs` chmods `node-pty`'s prebuilt `spawn-helper` to executable. pnpm sometimes drops the executable bit when extracting the prebuild tarball; without this fix you'll see `posix_spawnp failed` at session start. If you upgrade `node-pty` or change package managers, verify this script still finds the helper path.
