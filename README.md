# Flag Clash

Viral game videos for YouTube, made and posted for you. Flag Clash renders physics game videos (Shorts and
long videos) on your own computer and, in the desktop app, posts them to your YouTube channel on an organic
schedule while it sits in the system tray.

- **Web app:** build and export videos by hand in the browser (https://misbahkhan0009.github.io/battle-world/).
- **Desktop app (Windows, macOS, Linux):** everything in the web app plus the **Autopilot**: connect your
  YouTube channel once and it keeps posting on its own.

Videos carry sound effects only (no background music).

## Modules

Each module is a game that renders complete videos from a seed. The autopilot picks from the ones you switch on.

| Module | Status | What it is |
| ------ | ------ | ---------- |
| **Flag Battle** | Ready | Flags bounce inside a circle with one rotating exit (last one inside wins), or battle royale with HP. |
| Marble Race | Placeholder | Flag marbles race down an obstacle track. |
| Ring Escape | Placeholder | A flag breaks out through nested rotating rings. |
| Territory Wars | Placeholder | Countries conquer a pixel world map tile by tile. |
| Growing Ball | Placeholder | Every bounce makes the flag bigger. |

New modules plug into `src/modules/registry.ts` with a `render(job)` function.

## Desktop app

### Install

- **Releases:** push a tag like `v1.0.0` and the **Desktop app** workflow publishes a draft GitHub release with
  installers. Or open the latest **Desktop app** workflow run under the repo's Actions tab and download the
  artifact for your system (`.msi`/`.exe` for Windows, `.dmg` for macOS, `.deb`/`.AppImage` for Linux).
- **From source:** `npm install`, then `npm run desktop:dev` (needs Rust and the
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)). `npm run desktop:build` makes installers.

The installers are not code-signed yet, so Windows SmartScreen and macOS Gatekeeper ask for confirmation the
first time ("More info, Run anyway" on Windows; right-click, Open on macOS).

### First-time setup (about five minutes)

Flag Clash uploads with **your own** free Google Cloud project, so quota and access stay yours.

1. Create a project at https://console.cloud.google.com/projectcreate.
2. Enable **YouTube Data API v3** for it.
3. Set up the **OAuth consent screen**: user type External, and add your Google account under Test users.
4. Create **Credentials, OAuth client ID**, application type **Desktop app**. Paste the client ID and secret
   into Flag Clash, under Settings.
5. In Flag Clash, open **Channels** and click **Connect a YouTube channel**. Sign in in the browser window
   that opens and allow access.
6. Open **Autopilot** and click **Start autopilot**.

**Important:** YouTube keeps videos uploaded from a new, unaudited API project **private**. To publish
publicly, submit the free [YouTube API audit](https://support.google.com/youtube/contact/yt_api_form) for
your project. Until it is approved, posts land as private videos you can publish by hand.

### How posting works

- **Schedule (editable):** by default up to **5 Shorts a day** and **4 long videos a week**, between 9:00 and
  23:00, at least 75 minutes apart. Times are spread across the day with random offsets and never land on
  round minutes, and the daily count varies by one now and then, so the channel looks run by a person.
- **Daily upload limit (default 6):** the default YouTube API quota is 10,000 units a day and an upload costs
  about 1,600, so about 6 uploads fit. Ask Google for more quota to raise it.
- **On time:** each post is rendered about 30 minutes ahead, uploaded as private with a publish time, and
  YouTube publishes it at the planned minute ("Let YouTube publish on time").
- **Resilient:** uploads are resumable in 8 MB chunks and resume after network drops; failed jobs retry
  after 5, 20 and 60 minutes; quota errors wait for the daily reset; slots missed while the computer was off
  are skipped (no catch-up bursts). **Post now** renders and uploads one post immediately.
- **Background:** closing the window keeps the app running in the tray (tray menu: open, start or pause
  autopilot, quit). It starts with your computer by default (turn off in Settings). The computer must be on
  and awake for posts to render.
- **Variety:** each post gets a fresh seed, so rosters (world, regions, G20, most populous, South Asia), mode,
  theme, opening speed and title all rotate. Titles never spoil the winner.
- **Security:** your channel login (refresh token) is stored in the OS credential store (Windows Credential
  Manager, macOS Keychain, Secret Service on Linux). Sign-in uses the system browser with PKCE.

Rendered videos are saved to `Videos/Flag Clash` (configurable) and deleted a few days after posting.

**Platform note:** Windows (WebView2) and macOS render H.264 at the chosen bitrate. On Linux the system
webview (WebKitGTK) encodes VP9 and ignores bitrate targets, so files come out much larger (about 85 Mbps).
They upload and play fine, just more slowly.

### Desktop architecture

```
src-tauri/        Rust shell (Tauri 2)
  src/oauth.rs    Google sign-in: system browser + loopback redirect + PKCE, channel lookup
  src/tokens.rs   refresh tokens in the OS keychain (file fallback), access-token cache
  src/youtube.rs  resumable chunked uploads with resume-on-error
  src/files.rs    state file (atomic writes), saving rendered videos (raw IPC body)
  src/tray.rs     tray menu and status
  src/lib.rs      window/tray lifecycle, launch at login, single instance, 30 s autopilot heartbeat
src/autopilot/    planner.ts (organic schedule), engine.ts (render, upload, retry), types.ts
src/desktop/      bridge.ts (typed Tauri calls), runtime.ts (wires the engine to the app)
src/modules/      module registry and the Flag Battle autopilot content generator
src/app/desktop/  Autopilot, Modules, Channels and Settings screens
```

Rendering happens in the webview with the same WebCodecs pipeline as the web export, so autopilot videos
look exactly like the studio preview.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Requires Node 20 or newer. Use the latest Chrome or Edge on desktop for MP4 export.

## Scripts

| Script               | What it does                                                         |
| -------------------- | -------------------------------------------------------------------- |
| `npm run dev`        | Copies flag SVGs into `public/flags` and starts the Vite dev server   |
| `npm run build`      | Type-checks and builds the static site into `dist/`                   |
| `npm run preview`    | Serves the production build locally                                  |
| `npm test`           | Vitest: determinism, physics, timeline and duration-tuning tests     |
| `npm run lint`       | ESLint (includes a rule banning `Math.random`/clock reads in the sim) |
| `npm run format`     | Prettier                                                             |

## Deploying

The site is fully static and uses relative paths plus hash routing, so `dist/` works on any static host
(GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3).

**GitHub Pages:** `.github/workflows/deploy.yml` lints, tests, builds and deploys on every push to `main`.
If the first run's deploy step fails with "Pages not enabled", open the repository's
**Settings → Pages** and set **Source** to **GitHub Actions** once, then re-run the workflow.
The site is then served at `https://<user>.github.io/<repo>/`.

## How it works

```
src/
  app/        Home, Studio (setup), Preview screens, hash router
  components/ UI (Radix primitives, restyled), roster, palette (Ctrl/Cmd+K), editors, export dialog
  store/      Zustand stores (persisted setup and presets, shared battle state, transient UI)
  data/       Country dataset (lazy-loaded), regions and quick-fill groups
  engine/     rng.ts, physics.ts, sim.ts, timeline.ts, tuning.ts (pure, deterministic)
  render/     renderer.ts (shared by preview and export), effects, tokens, layout, themes
  audio/      synth.ts (procedural SFX), mix.ts (cues + streaming mixer), player.ts (preview)
  export/     worker.ts (WebCodecs + mp4-muxer), exporter.ts (controller), fallback.ts (WebM)
  workers/    sim.worker.ts (tuning + recorded simulation off the main thread)
```

### Determinism

- Fixed 1/120 s physics steps. The sim uses only `+ - * / sqrt` and a seeded mulberry32 PRNG, so the same
  seed and roster replay the same battle bit for bit (tested in `src/engine/engine.test.ts`).
- Positions and HP are recorded at 60 Hz. The renderer is a pure function of `(scene, video time)`:
  particles, shards, confetti, screen shake and camera moves are computed analytically from events and a
  stateless hash, so scrubbing works and the export matches the preview frame for frame.

### Escape physics

- The rim is a fixed circle minus the opening: the solid part is an arc (discs reflect off it), and the
  opening's two edges are point obstacles that move with the rotation (collisions use the edge velocity).
- A flag is out once its center crosses the rim inside the opening. Crossing anywhere else is impossible:
  the arc pushes it back. A test checks every exit point lies inside the opening.
- Angles use deterministic polynomial sin/cos (error below 1e-8) so replays stay bit-identical.
- Pacing keeps the opening small where it can: to hit a target length the director first speeds every
  flag up (up to 2×), and only widens the opening (up to 2.5×) if that is not enough. Once a winner is
  decided the opening closes.

### Battle royale physics

- Circle bodies with mass proportional to area, positional correction plus impulse resolution
  (restitution 0.95), uniform spatial-hash broad phase, rounded-box SDF walls for square and rounded arenas.
- Speeds relax back to a cruise speed so flags never stall. A small seeded deflection on wall bounces and a
  stalemate "hunt" steer prevent endless billiard orbits.
- Damage: `baseDamage × impactFactor × attack × ramp(t)`, 150 ms per-pair cooldown and a 0.5 s
  per-fighter invulnerability window so crowds produce clear, readable hits.
- Shrinking arenas never pack alive discs tighter than 42% coverage.

### Duration tuning

Battles are chaotic, so a pure binary search is unreliable. Tuned battles use a deterministic pacing
director inside the sim (the "AI director" technique from games): it compares progress (head count, plus
the HP pool in battle royale) with a planned curve and nudges a smoothed multiplier (damage in battle
royale; speed, then opening width, in escape mode). The tuner then runs up to 8
fast headless probes to calibrate base damage and correct the director's deadline. Tests check that 8 to 64
fighters land within ±3 s of 30, 45 and 58 s targets; 64 fighters tune in well under a second.

### Export

- Runs in a Web Worker on an `OffscreenCanvas`, frame by frame (`t = i / fps`), so the output is smooth
  whatever the machine speed.
- Video: best supported of H.264 High/Main/Baseline (level picked from resolution and fps), then VP9,
  then AV1. Keyframe every 2 s, backpressure on `encodeQueueSize`, every `VideoFrame` closed.
- Audio (sound effects only): mixed in one-second chunks by a plain-JS streaming mixer (same cues as the preview) and encoded
  with `AudioEncoder`: AAC where the browser has it (Chrome on Windows and macOS), Opus otherwise.
- Muxed by `mp4-muxer` with `fastStart: 'in-memory'` (moov atom first, YouTube friendly).
- Without WebCodecs, the app records in real time with `MediaRecorder` to WebM.

## Sound

Videos carry **sound effects only** (bumps, exits, eliminations, final-2 riser, winner fanfare, intro
ticks), with no background music. All sounds are generated in `src/audio/synth.ts` (no files, CC0). To
change a sound, edit its generator (`hit`, `exit`, `elim`, `whoosh`, `fanfare`, `tick`, `boom`). If you add
real audio files under `public/audio/`, list them in `public/audio/CREDITS.md`.

## Keyboard shortcuts

| Key              | Action               |
| ---------------- | -------------------- |
| Space            | Play or pause        |
| R                | Restart              |
| ← / →            | Skip 2 seconds       |
| E                | Open export          |
| Ctrl/Cmd + K     | Add countries        |

## Notes on the spec

Decisions made where the requirements left room:

- Sound effects are synthesized instead of shipping CC0 files: zero licensing risk, nothing to download.
- The export mixer is a streaming JS mixer rather than one big `OfflineAudioContext` render, because Web
  Audio is not available in workers and streaming keeps memory flat for long videos.
- Linux builds of Chrome have no AAC encoder; there the MP4 carries Opus audio, which YouTube and VLC accept.
- Flag artwork comes from [flag-icons](https://github.com/lipis/flag-icons) (MIT) and country data from
  [world-countries](https://github.com/mledoze/countries) (ODbL).
