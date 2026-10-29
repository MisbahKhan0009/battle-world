import { Download, Pause, Play, Shuffle, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Mixer } from '../../audio/mix';
import { buildRaceCues } from '../../audio/raceCues';
import { SAMPLE_RATE } from '../../audio/synth';
import type { ContentFormat } from '../../autopilot/types';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/controls';
import { loadCountries } from '../../data/countries';
import type { RaceConfig } from '../../engine/race/types';
import { desktop, isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { runExport } from '../../export/exporter';
import { loadSceneFighters } from '../../lib/battle';
import { loadFlagSafe, WINNER_RASTER } from '../../lib/flags';
import { RaceClient } from '../../lib/raceClient';
import { planMarbleRace, type MarbleRacePlan } from '../../modules/marbleRace/content';
import { DESIGN_SIZE } from '../../render/layout';
import { RaceRenderer } from '../../render/race/renderer';
import { buildRaceScene, type RaceScene } from '../../render/race/scene';
import type { SceneFighter } from '../../render/scene';
import { DesktopLayout } from './Layout';

type Loaded = {
  plan: MarbleRacePlan;
  config: RaceConfig;
  scene: RaceScene;
  fighters: SceneFighter[];
  winnerImage: ImageBitmap | null;
};

const fmt = (v: number) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;

/** Watch sample Marble Races (the same renderer and sound as the uploads) and export one by hand. */
export function RacePage() {
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
  const rendererRef = useRef<RaceRenderer | null>(null);
  const clock = useRef<{
    start: number;
    from: number;
    audio: AudioContext | null;
    src: AudioBufferSourceNode | null;
  }>({ start: 0, from: 0, audio: null, src: null });
  const audioBuf = useRef<AudioBuffer | null>(null);

  // Plan and simulate a race in the worker whenever the format or seed changes.
  useEffect(() => {
    let live = true;
    const client = new RaceClient();
    setBusy(true);
    setPlaying(false);
    (async () => {
      const plan = planMarbleRace({ format, seed }, await loadCountries(), []);
      const { config, result } = await client.run({
        seed: plan.raceSeed,
        ids: plan.fighters.map((f) => f.id),
        targetSec: plan.targetSec,
        maxSec: plan.maxSec,
      });
      const fighters = await loadSceneFighters(plan.fighters);
      const w = plan.fighters[result.winnerIndex];
      const winnerImage = w ? (await loadFlagSafe(w.imageSrc, WINNER_RASTER)).bitmap : null;
      const scene = buildRaceScene({ result, look: plan.look, fighters, winnerImage });
      if (!live) return;
      audioBuf.current = null;
      setRace({ plan, config, scene, fighters, winnerImage });
      setV(0);
      setBusy(false);
    })()
      .catch((err) => toast.error(String(err)))
      .finally(() => client.dispose());
    return () => {
      live = false;
    };
  }, [format, seed]);

  // Renderer at the canvas' pixel size.
  useEffect(() => {
    const c = canvasRef.current;
    if (!race || !c) return;
    const { W, H } = DESIGN_SIZE[race.plan.look.aspect];
    const scale = Math.min(1, 1100 / Math.max(W, H)) * (window.devicePixelRatio > 1 ? 1 : 0.8);
    c.width = Math.round(W * scale);
    c.height = Math.round(H * scale);
    rendererRef.current = new RaceRenderer(race.scene, c.width, c.height);
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
        const total = race.scene.timeline.total;
        const frames = Math.ceil(total * SAMPLE_RATE);
        const mixer = new Mixer(null, { sfxVolume: 0.85 }, buildRaceCues(race.scene));
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
    const total = race.scene.timeline.total;
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
        content: { kind: 'marble-race', config: race.config },
        look: race.plan.look,
        fighters: race.fighters,
        winnerImage: race.winnerImage,
        fps: format === 'short' ? 60 : 30,
        quality: 'high',
        audio: { enabled: true, sfxVolume: 0.85 },
        onProgress: (p) => setExporting(Math.round(p.percent)),
        onThumb: (b) => b.close(),
        signal: new AbortController().signal,
      });
      const name = `marble-race_${format}_${seed}.${out.ext}`;
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

  const total = race?.scene.timeline.total ?? 0;
  const wide = race?.plan.look.aspect === '16:9';
  return (
    <DesktopLayout
      title="Marble Race"
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
            <Shuffle size={15} /> New race
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
          <canvas ref={canvasRef} className="h-full w-full" aria-label="Marble race preview" />
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-muted">
              Building the track and running the race…
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
            <span className="text-text">{race.plan.meta.title}</span>
            <br />
            {race.fighters.length} marbles, {race.config.sections} track sections. Every race is new: the
            track, lineup, flag count and winner change each time, the same way the autopilot makes them.
          </p>
        )}
      </div>
    </DesktopLayout>
  );
}
