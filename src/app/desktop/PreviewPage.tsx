import { Download, Pause, Play, Shuffle, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { buildCues, Mixer, type Cue } from '../../audio/mix';
import { buildRaceCues } from '../../audio/raceCues';
import { buildRingsCues } from '../../audio/ringCues';
import { buildGrowCues } from '../../audio/growCues';
import { buildPaperCues } from '../../audio/paperCues';
import { SAMPLE_RATE } from '../../audio/synth';
import type { ContentFormat, VideoMeta } from '../../autopilot/types';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/controls';
import { loadCountries } from '../../data/countries';
import type { Look } from '../../engine/types';
import { desktop, isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { runExport } from '../../export/exporter';
import type { ExportContent } from '../../export/production';
import { loadSceneFighters } from '../../lib/battle';
import { loadFlagSafe, WINNER_RASTER } from '../../lib/flags';
import { RaceClient } from '../../lib/raceClient';
import { RingsClient } from '../../lib/ringsClient';
import { GrowClient } from '../../lib/growClient';
import { PaperClient } from '../../lib/paperClient';
import { planFlagBattle } from '../../modules/flagBattle/content';
import { planMarbleRace } from '../../modules/marbleRace/content';
import { SimClient } from '../../lib/simClient';
import { simFighters } from '../../store/app';
import { BattleRenderer } from '../../render/renderer';
import { buildScene } from '../../render/scene';
import { planRingEscape } from '../../modules/ringEscape/content';
import { planGrowingBall } from '../../modules/growingBall/content';
import { planPaperLand } from '../../modules/paperLand/content';
import type { Fighter } from '../../engine/types';
import type { Ctx2D } from '../../render/canvas';
import { DESIGN_SIZE } from '../../render/layout';
import { RaceRenderer } from '../../render/race/renderer';
import { buildRaceScene } from '../../render/race/scene';
import { RingsRenderer } from '../../render/rings/renderer';
import { GrowRenderer } from '../../render/grow/renderer';
import { buildGrowScene } from '../../render/grow/scene';
import { PaperRenderer } from '../../render/paper/renderer';
import { buildPaperScene } from '../../render/paper/scene';
import { buildRingsScene } from '../../render/rings/scene';
import type { SceneFighter } from '../../render/scene';
import { DesktopLayout } from './Layout';

/** One playable sample of a game, ready to preview and export. */
type Loaded = {
  meta: VideoMeta;
  look: Look;
  content: ExportContent;
  fighters: SceneFighter[];
  winnerImage: ImageBitmap | null;
  total: number;
  renderer: (W: number, H: number) => { render(ctx: Ctx2D, v: number): void };
  cues: () => Cue[];
  summary: string;
};

type PreviewGame = {
  id: string;
  title: string;
  newLabel: string;
  busyText: string;
  load: (format: ContentFormat, seed: number) => Promise<Loaded>;
};

async function art(fighters: Fighter[], winner: number) {
  const scene = await loadSceneFighters(fighters);
  const w = fighters[winner];
  const winnerImage = w ? (await loadFlagSafe(w.imageSrc, WINNER_RASTER)).bitmap : null;
  return { scene, winnerImage };
}

const FLAG_BATTLE: PreviewGame = {
  id: 'flag-battle',
  title: 'Flag Battle',
  newLabel: 'New battle',
  busyText: 'Playing the battle…',
  load: async (format, seed) => {
    const plan = planFlagBattle({ format, seed }, await loadCountries(), []);
    const client = new SimClient();
    try {
      const sim = await client.run({
        fighters: simFighters(plan.fighters, false),
        rules: plan.rules,
        intro: plan.look.intro,
        outro: plan.look.outro,
      });
      const { scene: fighters, winnerImage } = await art(plan.fighters, sim.result.winnerIndex);
      const scene = buildScene({ result: sim.result, look: plan.look, fighters, winnerImage });
      return {
        meta: plan.meta,
        look: plan.look,
        content: { kind: 'flag-battle', config: sim.config },
        fighters,
        winnerImage,
        total: scene.timeline.total,
        renderer: (W, H) => new BattleRenderer(scene, W, H),
        cues: () => buildCues(scene),
        summary: `${fighters.length} flags. Every battle is new: the lineup, flag count, rules and winner change each time, the same way the autopilot makes them.`,
      };
    } finally {
      client.dispose();
    }
  },
};

const MARBLE_RACE: PreviewGame = {
  id: 'marble-race',
  title: 'Marble Race',
  newLabel: 'New race',
  busyText: 'Building the track and running the race…',
  load: async (format, seed) => {
    const plan = planMarbleRace({ format, seed }, await loadCountries(), []);
    const client = new RaceClient();
    try {
      const { config, result } = await client.run({
        seed: plan.raceSeed,
        ids: plan.fighters.map((f) => f.id),
        targetSec: plan.targetSec,
        maxSec: plan.maxSec,
      });
      const { scene: fighters, winnerImage } = await art(plan.fighters, result.winnerIndex);
      const scene = buildRaceScene({ result, look: plan.look, fighters, winnerImage });
      return {
        meta: plan.meta,
        look: plan.look,
        content: { kind: 'marble-race', config },
        fighters,
        winnerImage,
        total: scene.timeline.total,
        renderer: (W, H) => new RaceRenderer(scene, W, H),
        cues: () => buildRaceCues(scene),
        summary: `${fighters.length} marbles, ${config.sections} track sections. Every race is new: the track, lineup, flag count and winner change each time, the same way the autopilot makes them.`,
      };
    } finally {
      client.dispose();
    }
  },
};

const RING_ESCAPE: PreviewGame = {
  id: 'ring-escape',
  title: 'Ring Escape',
  newLabel: 'New game',
  busyText: 'Building the rings and playing the game…',
  load: async (format, seed) => {
    const plan = planRingEscape({ format, seed }, await loadCountries(), []);
    const client = new RingsClient();
    try {
      const { config, result } = await client.run({
        seed: plan.gameSeed,
        ids: plan.fighters.map((f) => f.id),
        heats: plan.heats,
        targetSec: plan.targetSec,
        maxSec: plan.maxSec,
      });
      const { scene: fighters, winnerImage } = await art(plan.fighters, result.winnerIndex);
      const scene = buildRingsScene({ result, look: plan.look, fighters, winnerImage });
      const rings = config.rounds.map((r) => r.rings);
      return {
        meta: plan.meta,
        look: plan.look,
        content: { kind: 'ring-escape', config },
        fighters,
        winnerImage,
        total: scene.timeline.total,
        renderer: (W, H) => new RingsRenderer(scene, W, H),
        cues: () => buildRingsCues(scene),
        summary:
          (plan.heats
            ? `${fighters.length} flags in ${plan.heats.length} heats (${rings.slice(0, -1).join(', ')} rings) and a final of ${rings[rings.length - 1]} rings.`
            : `${fighters.length} flags, ${rings[0]} rings.`) +
          ' Every game is new: the rings, lineup, flag count and winner change each time, the same way the autopilot makes them.',
      };
    } finally {
      client.dispose();
    }
  },
};

const GROWING_BALL: PreviewGame = {
  id: 'growing-ball',
  title: 'Growing Ball',
  newLabel: 'New game',
  busyText: 'Playing the game…',
  load: async (format, seed) => {
    const plan = planGrowingBall({ format, seed }, await loadCountries(), []);
    const client = new GrowClient();
    try {
      const { config, result } = await client.run({
        seed: plan.gameSeed,
        ids: plan.fighters.map((f) => f.id),
        heats: plan.heats,
        targetSec: plan.targetSec,
        maxSec: plan.maxSec,
      });
      const { scene: fighters, winnerImage } = await art(plan.fighters, result.winnerIndex);
      const scene = buildGrowScene({ result, look: plan.look, fighters, winnerImage });
      return {
        meta: plan.meta,
        look: plan.look,
        content: { kind: 'growing-ball', config },
        fighters,
        winnerImage,
        total: scene.timeline.total,
        renderer: (W, H) => new GrowRenderer(scene, W, H),
        cues: () => buildGrowCues(scene),
        summary:
          (plan.heats
            ? `${fighters.length} flags in ${plan.heats.length} heats and a final.`
            : `${fighters.length} flags.`) +
          ' Every game is new: the lineup, flag count, growth and winner change each time, the same way the autopilot makes them.',
      };
    } finally {
      client.dispose();
    }
  },
};

const PAPER_LAND: PreviewGame = {
  id: 'paper-land',
  title: 'Paper Land',
  newLabel: 'New game',
  busyText: 'Playing the game…',
  load: async (format, seed) => {
    const plan = planPaperLand({ format, seed }, await loadCountries(), []);
    const client = new PaperClient();
    try {
      const { config, result } = await client.run({
        seed: plan.gameSeed,
        ids: plan.fighters.map((f) => f.id),
        heats: plan.heats,
        targetSec: plan.targetSec,
        maxSec: plan.maxSec,
      });
      const { scene: fighters, winnerImage } = await art(plan.fighters, result.winnerIndex);
      const scene = buildPaperScene({ result, look: plan.look, fighters, winnerImage });
      const sizes = config.rounds.map((r) => `${r.size}×${r.size}`);
      return {
        meta: plan.meta,
        look: plan.look,
        content: { kind: 'paper-land', config },
        fighters,
        winnerImage,
        total: scene.timeline.total,
        renderer: (W, H) => new PaperRenderer(scene, W, H),
        cues: () => buildPaperCues(scene),
        summary:
          (plan.heats
            ? `${fighters.length} flags in ${plan.heats.length} heats and a final on a ${sizes[sizes.length - 1]} board.`
            : `${fighters.length} flags on a ${sizes[0]} board.`) +
          ' Every game is new: the lineup, flag count, board and winner change each time, the same way the autopilot makes them.',
      };
    } finally {
      client.dispose();
    }
  },
};

export const BattlePage = () => <GamePreview game={FLAG_BATTLE} />;
export const RacePage = () => <GamePreview game={MARBLE_RACE} />;
export const GrowPage = () => <GamePreview game={GROWING_BALL} />;
export const PaperPage = () => <GamePreview game={PAPER_LAND} />;
export const RingsPage = () => <GamePreview game={RING_ESCAPE} />;

const fmt = (v: number) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;

/** Watch samples of a game (the same renderer and sound as the uploads) and export one by hand. */
function GamePreview({ game }: { game: PreviewGame }) {
  const { state } = useAutopilot();
  const [format, setFormat] = useState<ContentFormat>('short');
  const [seed, setSeed] = useState(() => 1 + Math.floor(Math.random() * 999_999));
  const [race, setRace] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [v, setV] = useState(0);
  const [exporting, setExporting] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<{ render(ctx: Ctx2D, v: number): void } | null>(null);
  const clock = useRef<{
    start: number;
    from: number;
    audio: AudioContext | null;
    src: AudioBufferSourceNode | null;
  }>({ start: 0, from: 0, audio: null, src: null });
  const audioBuf = useRef<AudioBuffer | null>(null);

  // Plan and simulate a game in a worker whenever the format or seed changes.
  useEffect(() => {
    let live = true;
    setBusy(true);
    setPlaying(false);
    game
      .load(format, seed)
      .then((loaded) => {
        if (!live) return;
        audioBuf.current = null;
        setRace(loaded);
        setV(0);
        setBusy(false);
      })
      .catch((err) => toast.error(String(err)));
    return () => {
      live = false;
    };
  }, [game, format, seed]);

  // Renderer at the canvas' pixel size.
  useEffect(() => {
    const c = canvasRef.current;
    if (!race || !c) return;
    const { W, H } = DESIGN_SIZE[race.look.aspect];
    const scale = Math.min(1, 1100 / Math.max(W, H)) * (window.devicePixelRatio > 1 ? 1 : 0.8);
    c.width = Math.round(W * scale);
    c.height = Math.round(H * scale);
    rendererRef.current = race.renderer(c.width, c.height);
    rendererRef.current.render(c.getContext('2d')!, 0);
  }, [race]);

  const stopAudio = () => {
    try {
      clock.current.src?.stop();
    } catch {
      /* not started */
    }
    clock.current.src = null;
  };

  const startAudio = useCallback(
    (from: number) => {
      if (!race || muted) return;
      const ctx = (clock.current.audio ??= new AudioContext({ sampleRate: SAMPLE_RATE }));
      if (!audioBuf.current) {
        const total = race.total;
        const frames = Math.ceil(total * SAMPLE_RATE);
        const mixer = new Mixer(null, { sfxVolume: 0.85 }, race.cues());
        const { L, R } = mixer.render(0, frames);
        const buf = ctx.createBuffer(2, frames, SAMPLE_RATE);
        buf.copyToChannel(L, 0);
        buf.copyToChannel(R, 1);
        audioBuf.current = buf;
      }
      const src = ctx.createBufferSource();
      src.buffer = audioBuf.current;
      src.connect(ctx.destination);
      src.start(0, from);
      clock.current.src = src;
    },
    [race, muted],
  );

  // Playback loop.
  useEffect(() => {
    if (!playing || !race) return;
    const total = race.total;
    clock.current.start = performance.now();
    clock.current.from = v >= total - 0.05 ? 0 : v;
    startAudio(clock.current.from);
    let raf = 0;
    const loop = () => {
      const t = clock.current.from + (performance.now() - clock.current.start) / 1000;
      const now = Math.min(t, total);
      const c = canvasRef.current;
      if (c && rendererRef.current) rendererRef.current.render(c.getContext('2d')!, now);
      setV(now);
      if (t >= total) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      stopAudio();
    };
    // Restart only when play state, race or sound changes (not on every frame's v).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, race, muted]);

  const seek = (to: number) => {
    setV(to);
    const c = canvasRef.current;
    if (c && rendererRef.current) rendererRef.current.render(c.getContext('2d')!, to);
    if (playing) {
      setPlaying(false);
      requestAnimationFrame(() => setPlaying(true));
    }
  };

  const exportMp4 = async () => {
    if (!race) return;
    setExporting(0);
    try {
      const out = await runExport({
        content: race.content,
        look: race.look,
        fighters: race.fighters,
        winnerImage: race.winnerImage,
        fps: format === 'short' ? 60 : 30,
        quality: 'high',
        audio: { enabled: true, sfxVolume: 0.85 },
        onProgress: (p) => setExporting(Math.round(p.percent)),
        onThumb: (b) => b.close(),
        signal: new AbortController().signal,
      });
      const name = `${game.id}_${format}_${seed}.${out.ext}`;
      if (isDesktop() && state) {
        const path = await desktop.saveVideo(
          state.outputDir,
          name,
          new Uint8Array(await out.blob.arrayBuffer()),
        );
        toast.success('Saved', {
          description: path,
          action: { label: 'Open folder', onClick: () => void desktop.openPath(state.outputDir) },
        });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(out.blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } catch (err) {
      toast.error(`Export failed: ${String(err)}`);
    } finally {
      setExporting(null);
    }
  };

  const total = race?.total ?? 0;
  const wide = race?.look.aspect === '16:9';
  return (
    <DesktopLayout
      title={game.title}
      actions={
        <div className="flex items-center gap-2">
          <Segmented<ContentFormat>
            label="Format"
            className="w-[220px]"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'short', label: 'Short' },
              { value: 'video', label: 'Long video' },
            ]}
          />
          <Button
            variant="secondary"
            onClick={() => setSeed(1 + Math.floor(Math.random() * 999_999))}
            disabled={busy}
          >
            <Shuffle size={15} /> {game.newLabel}
          </Button>
          <Button variant="primary" onClick={() => void exportMp4()} disabled={busy || exporting !== null}>
            <Download size={15} /> {exporting !== null ? `Exporting ${exporting}%` : 'Export MP4'}
          </Button>
        </div>
      }
    >
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-4">
        <div
          className="relative overflow-hidden rounded-2xl bg-black ring-1 ring-line"
          style={
            wide
              ? { width: 'min(100%, 960px)', aspectRatio: '16 / 9' }
              : { height: 'min(72vh, 820px)', aspectRatio: '9 / 16' }
          }
        >
          <canvas ref={canvasRef} className="h-full w-full" aria-label={`${game.title} preview`} />
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-muted">
              {game.busyText}
            </div>
          )}
        </div>
        {race && (
          <div className="flex w-full max-w-[960px] items-center gap-3">
            <Button
              size="icon"
              variant="secondary"
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={() => setPlaying(!playing)}
              disabled={busy}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={muted ? 'Sound on' : 'Mute'}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </Button>
            <input
              type="range"
              min={0}
              max={total}
              step={0.01}
              value={v}
              onChange={(e) => seek(Number(e.target.value))}
              className="flex-1 accent-[var(--color-accent)]"
              aria-label="Position"
            />
            <span className="w-[90px] text-right text-xs tabular text-muted">
              {fmt(v)} / {fmt(total)}
            </span>
          </div>
        )}
        {race && (
          <p className="max-w-[960px] text-center text-sm text-muted">
            <span className="text-text">{race.meta.title}</span>
            <br />
            {race.summary}
          </p>
        )}
      </div>
    </DesktopLayout>
  );
}
