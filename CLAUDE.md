# Flag Clash

Windows desktop app (Tauri 2 + React) that renders "flag battle" style videos and posts them to YouTube on an
organic schedule. Only the Windows NSIS installer is shipped; there is no website.

## Commands

- `npm run desktop:dev` – run the app with hot reload (needs Rust + MSVC; see `scripts/setup-windows.ps1`)
- `npm run desktop:build` – build the installer into `src-tauri/target/release/bundle/nsis`
- `npm run dev` – UI alone in the browser (desktop screens show "desktop only" notes)
- Before committing: `npx prettier --check .`, `npx tsc -b`, `npm run lint`, `npm test`
- Rust: `cargo fmt` and `cargo clippy` in `src-tauri`

## Releases

Every push to `main` runs `.github/workflows/desktop.yml`, which builds on windows-latest and publishes a GitHub
release "Flag Clash 1.0.<run number>" (tag `build-<run>`) with the installer attached. Pushing a `v*` tag uses the
tag as the version instead. The version is injected through `src-tauri/tauri.ci.conf.json` (generated, git-ignored).

## Layout

- `src/engine/` – deterministic simulation: fixed 1/120 s steps, seeded `mulberry32` RNG, polynomial `dsin`/`dcos`.
  ESLint bans `Math.random`, `Date` and `performance` here; the same seed must give the same video.
  Default mode is escape (flags leave through a rotating gap in a fixed ring; last one inside wins).
- `src/render/` – renderer is a pure function of time, shared by preview and export.
- `src/audio/` – synthesized sound effects only (no music, by design).
- `src/export/` – WebCodecs worker + mp4-muxer, with a timer-driven WebM fallback.
- `src/autopilot/` – `planner.ts` (organic daily plan, deterministic per channel+day, weighted by `engagement.ts`
  audience-activity curves in the audience's time zone), `engine.ts` (render → upload → thumbnail state machine,
  retries, quota handling, per-slot event log, `contentLog` history), `types.ts` (defaults). Tests in
  `autopilot.test.ts`.
- `src/modules/flagBattle/content.ts` – plans a post from a seed plus `contentLog` history so counts, lineups,
  themes and titles avoid recent repeats; `freshenOutcome` relabels the winning ball (country fighters are
  physically identical) so winners and final pairs don't repeat. `thumbnail.ts` draws the spoiler-free cover.
- `src/modules/registry.ts` – content modules. Flag Battle is ready; four placeholders (marble-race, ring-escape,
  territory-wars, growing-ball) are next. A module needs `status: 'ready'` and a `render(job, onProgress, signal)`.
- `src/desktop/` – `bridge.ts` (typed Tauri invokes), `runtime.ts` (autopilot singleton + `useAutopilot` hook).
- `src/app/desktop/` – Setup wizard, Autopilot, Calendar, Modules, Channels, Settings screens; `posts.tsx` is the
  live post timeline dialog. Hash router in `src/app/router.ts`.
- `src-tauri/src/` – OAuth loopback + PKCE (`oauth.rs`), tokens in Windows Credential Manager (`tokens.rs`),
  resumable uploads (`youtube.rs`), files/state (`files.rs`), tray (`tray.rs`), app lifecycle + 30 s heartbeat (`lib.rs`).

## Gotchas

- `useSyncExternalStore` must get a stable, module-level `subscribe` (an inline one caused an infinite render loop).
- Debug Tauri builds load `devUrl`; to test a debug binary against `dist`, build with
  `--features tauri/custom-protocol`.
- YouTube: unaudited Google projects force uploads private; apps left in "Testing" lose refresh tokens after
  7 days; quota is 10,000 units/day and an upload costs ~1,600, hence the daily cap of 6.
- Users bring their own Google OAuth client (Desktop app type); nothing secret is bundled. They can load it from
  Google's client_secret JSON (`src/desktop/clientSecret.ts`).
- The YouTube API cannot create Community posts. Custom thumbnails need a verified channel and don't show in the
  Shorts feed (only search, channel page, subscriptions).
- The autopilot mutates its state object in place; memoize on derived keys, not on `state` identity.
