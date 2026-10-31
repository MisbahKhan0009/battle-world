# Flag Clash

Windows desktop app (Tauri 2 + React) that renders "flag battle" style videos and posts them to YouTube on an
organic schedule (optionally also to a Facebook Page and Instagram). Only the Windows NSIS installer is shipped; there is no website.

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
- `src/render/` – renderer is a pure function of time, shared by preview and export. Each game has its own color
  worlds (`GAME_THEMES` in `themes.ts`) and voices (`src/audio/*Cues.ts`; no sound is shared between games).
  Overlay type goes through `overlay.ts` (soft-shadow text, accent band banners, the winner name + verb lockup);
  no outlined text, no eyebrow labels, no emoji on screen.
- `src/audio/` – synthesized sound effects. Optional music: `state.music` (Settings) picks a track from the user's
  Audio Library folder (`src/desktop/music.ts`, Rust `music_list`/`music_read`); `MusicMix` replaces the effects mixer
  in `buildProduction` (music only, no effects); a sidecar `.txt` credit goes into the description.
- `src/export/` – WebCodecs worker + mp4-muxer, with a timer-driven WebM fallback. On desktop the worker streams
  (`StreamTarget`, fastStart with reserved chunk counts) and posts `chunk` messages that a `VideoSink` writes at their
  offsets through Rust `video_create`/`video_write_at` (raw IPC). Building the whole file in memory made long
  videos hang at 99%; don't go back to it. Long videos use 'standard' quality (8 Mbps), Shorts 'high'.
- `src/autopilot/` – `planner.ts` (organic daily plan, deterministic per channel+day, weighted by `engagement.ts`
  audience-activity curves in the audience's time zone; one channel with every game is the default: each game posts
  `shortsPerDay` Shorts (default 1) and `schedule.longPerDay` long videos a day take turns between the games (older
  settings without `longPerDay` use each game's `videosPerWeek`); `planChannelsDay` shares `schedule.projectCap`
  between channels; `planVersion` 2 migration in `runtime.ts`), `engine.ts` (render → upload → thumbnail state
  machine, retries, quota pause until midnight Pacific (`uploadPausedUntil`), per-slot event log, `contentLog`
  history; `horizons()` decides how far ahead to render and upload: just in time, `prepare.auto` daily/weekly at
  `atMin`, `prepare.handsOffDays`, or a `batch` date range with an after-action; slots rendered for upload ahead get
  `uploadAhead`; per-video controls `rerender`/`editSlot`/`approve`/`publishNow`/`restore`; `prepare.review` holds
  uploads until approved; `setPaused`/`retry` per video, and a watchdog stops a job with no progress for `STALL_MS`
  (10 min) via `stopCurrent`, which aborts a render or cancels an upload (`upload_cancel`, checked between chunks)),
  `types.ts` (defaults: 100 uploads a day per Google project, 15 per channel). Tests in `autopilot.test.ts`.
- Platforms: a `Channel` has `platform` ('youtube' when unset; `platformOf`), and Facebook Pages/Instagram accounts
  are channels too (`metaChannel`, `pageId`, `reuseYouTube`, own `longPerDay`; Instagram 0). They post a rendered
  YouTube video when one fits (`donorFor` → `sourceSlotId`; shared files are deleted only when no unfinished slot
  needs them), don't count against `projectCap`, and `schedulable` says who can schedule ahead (YouTube private/
  publishViaYouTube, Facebook long videos; Reels and Instagram publish at their time). Rust `meta.rs` (Graph API
  v26.0, Page token stored as `meta:{pageId}`); guide and connect form in `MetaPlatforms.tsx`. YouTube must keep
  working without them.
- `src/modules/common.ts` – shared no-repeat rules: `chooseLineup` (counts, lineups, groups vs recent posts) and
  `freshenPair` (relabels the winning ball; country fighters/marbles are physically identical, so winners and final
  pairs don't repeat). `src/modules/thumbnail.ts` composes the spoiler-free cover for any game.
- `src/modules/flagBattle/`, `src/modules/marbleRace/`, `src/modules/ringEscape/`, `src/modules/growingBall/`,
  `src/modules/paperLand/`, `src/modules/blackHole/` – per-game content planning (`content.ts`) and headless
  autopilot rendering (`autopilot.ts`, `thumbnail.ts`).
- `src/engine/race/` – Marble Race: `track.ts` (procedural sections with a clear top band), `sim.ts` (rolling
  spheres with friction impulses, I = 2/5 m r²), `race.ts` (finish line placed at the section boundary closest to
  the target time; `planBestRace` keeps the most exciting of a few candidate tracks). Same determinism rules as
  `src/engine`. Rendering in `src/render/race/`, sound cues in `src/audio/raceCues.ts`.
- `src/engine/rings/` – Ring Escape: `sim.ts` (nested turning rings, one gap each; first ball through shatters the
  ring for everyone; ring k depends only on seed and k, so probe runs give exact break times), `show.ts` (ring count
  fitted from a probe; Shorts are one game, long videos a knockout of heats + final on one sim clock). Rendering in
  `src/render/rings/`, cues in `src/audio/ringCues.ts`, preview page shared with the race in `PreviewPage.tsx`.
- `src/engine/grow/` – Growing Ball: `sim.ts` (firm wall bounces add area; springy wall so balls never heap up;
  game ends at 55% fill, biggest wins; no stealing, which made leads snowball), `show.ts` (growth rate chosen by
  playing a range in full; knockout like Ring Escape). Rendering in `src/render/grow/`, cues in
  `src/audio/growCues.ts`. The round-based games extend `src/render/show.ts` (title, banners, intro, winner, outro).
- `src/engine/paper/` – Paper Land (Paper.io 2): `sim.ts` (continuous movement at 60 steps/s with a limited turn rate,
  land on a fine grid, trails stamped as discs, flood-fill claims from the board edge, cuts wipe the victim's land;
  seeded steering AI tests headings by flying the real turning arc, only hunts after `CALM`), `show.ts` (runs on a
  clock of the target length; picks the liveliest of a few starts; knockout like Ring Escape). Land is recorded as
  change groups (`changeT`/`changeStart`/`cells`/`owners`). Rendering in `src/render/paper/`: a tilted three.js board
  (one solid color per country from `assignColors`, smooth land outlines from `src/render3d/contour.ts`) with 2D
  countryball sprites on top; cues in `src/audio/paperCues.ts`.
- `src/engine/black/` – Black Hole (Hole.io): `city.ts` (seeded grid of blocks: parks, homes, shops, downtown towers;
  cars, buses, lamps and cones on the roads; every object has a size `s` and footprint `area`), `sim.ts` (60 steps/s;
  an object falls in when `s <= FIT * r` and it is mostly over the hole, area grows by what it eats; a hole
  `EAT_MARGIN` bigger swallows a smaller one once it covers its center; seeded steering seeks food, flees bigger holes,
  chases smaller ones after `CALM`, slows near a target so it never orbits it), `show.ts` (on a clock like Paper Land;
  liveliest of a few cities; knockout like Ring Escape). Rendering in `src/render/black/` (top-down city baked once,
  holes as a flag rim with white countryball eyes, falling animation, Shorts camera follows a moving average of the
  leader); cues in `src/audio/blackCues.ts`, voices in `src/audio/holeVoices.ts`; preview loader `blackPreview.ts`.
- `src/render3d/` – three.js helpers (only Paper Land's board uses them): `gl.ts` (one shared WebGLRenderer per
  thread, transparent, copied into the 2D frame so overlays draw on top; works in the export worker), `rig.ts`
  (camera framing onto the 2D layout's arena, lights, `project`), `contour.ts`.
- `src/render/countryball.ts` – every game draws its flags as 2D countryballs (`drawCountryball`: flag disc, eyes
  from `paintEyes` that look where it is going, expressions, squash). The user rejected 3D countryballs: keep them
  2D/2.5D. A `ShowRenderer` with `countryballs = true` paints eyes on the intro and winner discs.
- `src/dashboard/` – channel dashboard data: read-only YouTube calls via the `youtube_api_get` command
  (channels, playlistItems, videos), pure insight math (`insights.ts`, tested), and channel snapshots saved to
  `state.stats` every 3 hours (the growth charts). UI in `src/app/desktop/DashboardPage.tsx` + `charts.tsx`.
- `src/modules/plans.ts` – written plans for every coming-soon game (shown on the Modules page; a test requires one;
  empty while every game is ready).
- Videos are not made for kids by default (`post.madeForKids` false; older states are switched once via `kidsOff`).
  Planners get `job.kids`: when false they add the comment prompt banner (`Look.prompt`, `PROMPTS`), engagement
  outros and `ENGAGE_ASK`; when true they must not ask for comments.
- Countries: `src/data/countries.ts` leaves out `state.excludedCountries` (default `DEFAULT_EXCLUDED`: kp, il, ps, tw,
  xk, eh, ru, ir, af, sy; edited in Settings) via `setExcludedCountries`. Territory Wars was removed on purpose
  (geopolitical); don't bring it back.
- `src/export/production.ts` – builds the renderer + mixer for any game from its config (worker and fallback).
- `src/modules/registry.ts` – content modules. Flag Battle, Marble Race, Ring Escape, Growing Ball, Paper Land
  and Black Hole are ready. A new game also needs a `DEFAULT_PACE` entry. A module needs `status: 'ready'` and a `render(job, onProgress, signal)`.
- `src/desktop/` – `bridge.ts` (typed Tauri invokes), `runtime.ts` (autopilot singleton + `useAutopilot` hook; runs a
  finished batch's sleep/shutdown after a 60 s cancellable countdown shown by `PowerCountdown.tsx`).
- `src/app/desktop/` – Setup wizard, Autopilot (prepare-ahead card + schedule), Videos (every video by day: play via
  the asset protocol, edit, re-render, publish now, skip/restore, approve; "Render and upload" batch dialog; locked-
  private warning from `lockedPrivate`), Calendar, Games (`ModulesPage.tsx`), Platforms (`ChannelsPage.tsx`), Settings screens,
  `PreviewPage.tsx` (a sample page for every game, with export); `posts.tsx` is the live post timeline dialog. There
  is no Studio any more. Hash router in `src/app/router.ts`.
- `src-tauri/src/` – OAuth loopback + PKCE (`oauth.rs`), tokens in Windows Credential Manager (`tokens.rs`),
  resumable uploads (`youtube.rs`), Facebook/Instagram (`meta.rs`), files/state (`files.rs`), tray (`tray.rs`), app lifecycle + 30 s heartbeat,
  `power_action` (shutdown/sleep, Windows), `media_allow` (asset protocol scope for the videos folder) and
  `window_show` (`lib.rs`).

## Gotchas

- `useSyncExternalStore` must get a stable, module-level `subscribe` (an inline one caused an infinite render loop).
- Debug Tauri builds load `devUrl`; to test a debug binary against `dist`, build with
  `--features tauri/custom-protocol`.
- YouTube: unaudited Google projects force uploads private (scheduled ones never go public on their own); apps left
  in "Testing" lose refresh tokens after 7 days. Uploads have their own quota of 100 a day per Google project
  (videos.insert costs 1 unit in that bucket); thumbnails (50 units) and reads come from the 10,000-unit pool. The
  quota resets at midnight Pacific and is shared by every channel on the same keys.
- Titles never name a country (`src/modules/titles.test.ts`).
- Users bring their own Google OAuth client (Desktop app type); nothing secret is bundled. They can load it from
  Google's client_secret JSON (`src/desktop/clientSecret.ts`).
- The YouTube API cannot create Community posts. Custom thumbnails need a verified channel and don't show in the
  Shorts feed (only search, channel page, subscriptions).
- The autopilot mutates its state object in place; memoize on derived keys, not on `state` identity.
