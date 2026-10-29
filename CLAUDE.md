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
  audience-activity curves in the audience's time zone; each channel posts its own games (`Channel.games`, about 2
  per channel, each with its own pace) on one non-overlapping timeline with the channel's `dailyCap`; the engine
  plans with `channelGames` + `channelSchedule`; `schedule` holds the shared timing; `state.modules` and
  `schedule.perModule` are legacy, migrated in `runtime.ts`), `engine.ts` (render → upload → thumbnail state machine,
  retries, quota handling, per-slot event log, `contentLog` history), `types.ts` (defaults). Tests in
  `autopilot.test.ts`.
- `src/modules/common.ts` – shared no-repeat rules: `chooseLineup` (counts, lineups, groups vs recent posts) and
  `freshenPair` (relabels the winning ball; country fighters/marbles are physically identical, so winners and final
  pairs don't repeat). `src/modules/thumbnail.ts` composes the spoiler-free cover for any game.
- `src/modules/flagBattle/`, `src/modules/marbleRace/`, `src/modules/ringEscape/` – per-game content planning (`content.ts`) and headless
  autopilot rendering (`autopilot.ts`, `thumbnail.ts`).
- `src/engine/race/` – Marble Race: `track.ts` (procedural sections with a clear top band), `sim.ts` (rolling
  spheres with friction impulses, I = 2/5 m r²), `race.ts` (finish line placed at the section boundary closest to
  the target time; `planBestRace` keeps the most exciting of a few candidate tracks). Same determinism rules as
  `src/engine`. Rendering in `src/render/race/`, sound cues in `src/audio/raceCues.ts`.
- `src/engine/rings/` – Ring Escape: `sim.ts` (nested turning rings, one gap each; first ball through shatters the
  ring for everyone; ring k depends only on seed and k, so probe runs give exact break times), `show.ts` (ring count
  fitted from a probe; Shorts are one game, long videos a knockout of heats + final on one sim clock). Rendering in
  `src/render/rings/`, cues in `src/audio/ringCues.ts`, preview page shared with the race in `PreviewPage.tsx`.
- `src/dashboard/` – channel dashboard data: read-only YouTube calls via the `youtube_api_get` command
  (channels, playlistItems, videos), pure insight math (`insights.ts`, tested), and channel snapshots saved to
  `state.stats` every 3 hours (the growth charts). UI in `src/app/desktop/DashboardPage.tsx` + `charts.tsx`.
- `src/modules/plans.ts` – written plans for every coming-soon game (shown on the Modules page; a test requires one).
- Videos default to made-for-kids (`post.madeForKids`); planners get `job.kids` and must not ask for comments then.
- `src/export/production.ts` – builds the renderer + mixer for any game from its config (worker and fallback).
- `src/modules/registry.ts` – content modules. Flag Battle, Marble Race and Ring Escape are ready; territory-wars,
  growing-ball, black-hole and paper-land are next. A new game also needs a `DEFAULT_PACE` entry. A module needs `status: 'ready'` and a `render(job, onProgress, signal)`.
- `src/desktop/` – `bridge.ts` (typed Tauri invokes), `runtime.ts` (autopilot singleton + `useAutopilot` hook).
- `src/app/desktop/` – Setup wizard, Autopilot, Calendar, Modules, Channels (per-channel games, limits, quota
  banner), Settings screens, `PreviewPage.tsx` (Marble Race and Ring Escape preview/export); `posts.tsx` is the live post timeline dialog. Hash router in `src/app/router.ts`.
- `src-tauri/src/` – OAuth loopback + PKCE (`oauth.rs`), tokens in Windows Credential Manager (`tokens.rs`),
  resumable uploads (`youtube.rs`), files/state (`files.rs`), tray (`tray.rs`), app lifecycle + 30 s heartbeat (`lib.rs`).

## Gotchas

- `useSyncExternalStore` must get a stable, module-level `subscribe` (an inline one caused an infinite render loop).
- Debug Tauri builds load `devUrl`; to test a debug binary against `dist`, build with
  `--features tauri/custom-protocol`.
- YouTube: unaudited Google projects force uploads private; apps left in "Testing" lose refresh tokens after
  7 days; quota is 10,000 units/day and an upload costs ~1,600, hence the daily cap of 6. The quota is per Google
  project, so it is shared by every channel on the same keys.
- Users bring their own Google OAuth client (Desktop app type); nothing secret is bundled. They can load it from
  Google's client_secret JSON (`src/desktop/clientSecret.ts`).
- The YouTube API cannot create Community posts. Custom thumbnails need a verified channel and don't show in the
  Shorts feed (only search, channel page, subscriptions).
- The autopilot mutates its state object in place; memoize on derived keys, not on `state` identity.
