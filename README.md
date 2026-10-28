# Flag Clash

Build physics flag battles for YouTube Shorts and regular videos, right in the browser. Pick a roster of
up to 64 countries (or your own images), watch a deterministic physics battle play out, and export it as an
MP4 with sound effects and music.

No backend, no login. Everything is saved in your browser and the app works offline after the first visit.

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
  audio/      synth.ts (procedural SFX + music), mix.ts (cues + streaming mixer), player.ts (preview)
  export/     worker.ts (WebCodecs + mp4-muxer), exporter.ts (controller), fallback.ts (WebM)
  workers/    sim.worker.ts (tuning + recorded simulation off the main thread)
```

### Determinism

- Fixed 1/120 s physics steps. The sim uses only `+ - * / sqrt` and a seeded mulberry32 PRNG, so the same
  seed and roster replay the same battle bit for bit (tested in `src/engine/engine.test.ts`).
- Positions and HP are recorded at 60 Hz. The renderer is a pure function of `(scene, video time)`:
  particles, shards, confetti, screen shake and camera moves are computed analytically from events and a
  stateless hash, so scrubbing works and the export matches the preview frame for frame.

### Physics

- Circle bodies with mass proportional to area, positional correction plus impulse resolution
  (restitution 0.95), uniform spatial-hash broad phase, rounded-box SDF walls for square and rounded arenas.
- Speeds relax back to a cruise speed so flags never stall. A small seeded deflection on wall bounces and a
  stalemate "hunt" steer prevent endless billiard orbits.
- Damage: `baseDamage × impactFactor × attack × ramp(t)`, 150 ms per-pair cooldown and a 0.5 s
  per-fighter invulnerability window so crowds produce clear, readable hits.
- Shrinking arenas never pack alive discs tighter than 42% coverage.

### Duration tuning

Battles are chaotic, so a pure binary search over damage is unreliable. Tuned battles use a deterministic
pacing director inside the sim (the "AI director" technique from games): it compares the remaining HP pool
and head count with a planned curve and nudges a smoothed damage multiplier. The tuner then runs up to 8
fast headless probes to calibrate base damage and correct the director's deadline. Tests check that 8 to 64
fighters land within ±3 s of 30, 45 and 58 s targets; 64 fighters tune in well under a second.

### Export

- Runs in a Web Worker on an `OffscreenCanvas`, frame by frame (`t = i / fps`), so the output is smooth
  whatever the machine speed.
- Video: best supported of H.264 High/Main/Baseline (level picked from resolution and fps), then VP9,
  then AV1. Keyframe every 2 s, backpressure on `encodeQueueSize`, every `VideoFrame` closed.
- Audio: mixed in one-second chunks by a plain-JS streaming mixer (same cues as the preview) and encoded
  with `AudioEncoder`: AAC where the browser has it (Chrome on Windows and macOS), Opus otherwise.
- Muxed by `mp4-muxer` with `fastStart: 'in-memory'` (moov atom first, YouTube friendly).
- Without WebCodecs, the app records in real time with `MediaRecorder` to WebM.

## Adding sound effects and music

- **Your own music:** in the Export dialog choose **Music → Yours** and pick any audio file. It is stored in
  IndexedDB, decoded and resampled to 48 kHz, and used in both the preview and the export.
- **Bundled sounds:** all bundled audio is generated in `src/audio/synth.ts` (no files, CC0). To add a
  track, add an entry to `SONGS` (tempo, chords and a `build` function that places voices) and a label in
  `MUSIC_LABELS`. To change a sound effect, edit its generator (`hit`, `elim`, `whoosh`, `fanfare`, `tick`,
  `boom`). If you add real audio files under `public/audio/`, list them in `public/audio/CREDITS.md`.

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

- Audio is synthesized instead of shipping CC0 files: zero licensing risk, nothing to download.
- The export mixer is a streaming JS mixer rather than one big `OfflineAudioContext` render, because Web
  Audio is not available in workers and streaming keeps memory flat for long videos.
- Linux builds of Chrome have no AAC encoder; there the MP4 carries Opus audio, which YouTube and VLC accept.
- Flag artwork comes from [flag-icons](https://github.com/lipis/flag-icons) (MIT) and country data from
  [world-countries](https://github.com/mledoze/countries) (ODbL).
