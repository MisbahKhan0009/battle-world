import { Eye, EyeOff, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { LiveAudio } from '../audio/player';
import type { Phase } from '../engine/timeline';
import { cn, formatTime } from '../lib/utils';
import { DESIGN_SIZE } from '../render/layout';
import { BattleRenderer } from '../render/renderer';
import type { Scene } from '../render/scene';
import { useApp } from '../store/app';
import { Segmented, Tip } from './ui/controls';

export type FrameInfo = { v: number; alive: number; phase: Phase; total: number };

export type PlayerHandle = {
  restart: () => void;
  toggle: () => void;
  pause: () => void;
};

type Props = {
  scene: Scene | null;
  variant: 'full' | 'compact' | 'ambient';
  autoPlay?: boolean;
  loop?: boolean;
  hotkeys?: boolean;
  busy?: boolean;
  className?: string;
  onFrame?: (info: FrameInfo) => void;
  onEnded?: () => void;
};

const SPEEDS = ['0.5', '1', '2', '4'] as const;

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    !!el.closest('[role="dialog"]')
  );
}

export const BattlePlayer = forwardRef<PlayerHandle, Props>(function BattlePlayer(
  {
    scene,
    variant,
    autoPlay = false,
    loop = false,
    hotkeys = false,
    busy = false,
    className,
    onFrame,
    onEnded,
  },
  ref,
) {
  const ambient = variant === 'ambient';
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0, dpr: 1 });
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>('1');
  const [shownV, setShownV] = useState(0);
  const vRef = useRef(0);
  const dirty = useRef(true);
  const audioRef = useRef<LiveAudio | null>(null);
  const safeArea = useApp((s) => s.ui.safeArea);
  const muted = useApp((s) => s.ui.muted);
  const setUi = useApp((s) => s.setUi);
  const audioSettings = useApp((s) => s.audio);
  const aspect = scene?.look.aspect ?? useApp.getState().look.aspect;
  const { W, H } = DESIGN_SIZE[aspect];
  const total = scene?.timeline.total ?? 0;

  // Fit the canvas to the stage at the design aspect ratio.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBox({ w: width, h: height, dpr: Math.min(window.devicePixelRatio || 1, ambient ? 1.25 : 2) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ambient]);

  const fit = box.w > 0 && box.h > 0 ? Math.min(box.w / W, box.h / H) : 0;
  const cssW = Math.floor(W * fit);
  const cssH = Math.floor(H * fit);
  const pxW = Math.max(1, Math.round(cssW * box.dpr));
  const pxH = Math.max(1, Math.round(cssH * box.dpr));

  const renderer = useMemo(
    () => (scene && fit > 0 ? new BattleRenderer(scene, pxW, pxH) : null),
    [scene, pxW, pxH, fit],
  );

  // Audio engine (not for the ambient home background).
  useEffect(() => {
    if (ambient) return;
    const a = new LiveAudio();
    audioRef.current = a;
    return () => {
      a.dispose();
      audioRef.current = null;
    };
  }, [ambient]);

  useEffect(() => {
    if (scene) audioRef.current?.setScene(scene);
    if (scene) audioRef.current?.seek(vRef.current);
    if (scene && ambient) {
      // The home background swaps in a fresh battle each round.
      vRef.current = 0;
      setPlaying(true);
    }
  }, [scene, ambient]);

  useEffect(() => {
    audioRef.current?.setSettings({
      sfxVolume: audioSettings.enabled && !muted ? audioSettings.sfxVolume : 0,
    });
  }, [audioSettings, muted]);

  useEffect(() => {
    dirty.current = true;
  }, [renderer, safeArea]);

  const seek = useCallback(
    (v: number) => {
      vRef.current = Math.max(0, Math.min(total, v));
      audioRef.current?.seek(vRef.current);
      dirty.current = true;
      setShownV(vRef.current);
    },
    [total],
  );

  const play = useCallback(() => {
    if (vRef.current >= total - 0.01) seek(0);
    void audioRef.current?.resume();
    setPlaying(true);
  }, [seek, total]);

  const pause = useCallback(() => {
    setPlaying(false);
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);
  const restart = useCallback(() => {
    seek(0);
    play();
  }, [seek, play]);

  useImperativeHandle(ref, () => ({ restart, toggle, pause }), [restart, toggle, pause]);

  // Clamp time when the battle changes length.
  useEffect(() => {
    if (vRef.current > total) seek(total);
  }, [total, seek]);

  // Main loop: advance time, draw only when something changed.
  const onFrameRef = useRef(onFrame);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onFrameRef.current = onFrame;
    onEndedRef.current = onEnded;
  });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !renderer) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const sp = Number(speed);
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      if (playing) {
        vRef.current += dt * sp;
        if (vRef.current >= total) {
          if (loop) {
            vRef.current = 0;
            audioRef.current?.seek(0);
          } else {
            vRef.current = total;
            setPlaying(false);
            audioRef.current?.pause();
            onEndedRef.current?.();
          }
        }
        audioRef.current?.update(vRef.current, sp);
        dirty.current = true;
      }
      if (dirty.current) {
        dirty.current = false;
        renderer.render(ctx, vRef.current, { safeArea: safeArea && !ambient });
        if (now - lastUi > 100 || !playing) {
          lastUi = now;
          if (!ambient) setShownV(vRef.current);
          const tl = renderer.scene.timeline;
          onFrameRef.current?.({
            v: vRef.current,
            alive: renderer.aliveCount(tl.simAt(vRef.current)),
            phase: tl.phaseAt(vRef.current),
            total: tl.total,
          });
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [renderer, playing, speed, total, loop, safeArea, ambient]);

  // Keyboard shortcuts.
  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        restart();
      } else if (e.key === 'ArrowRight') seek(vRef.current + 2);
      else if (e.key === 'ArrowLeft') seek(vRef.current - 2);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeys, toggle, restart, seek]);

  const markers = useMemo(() => {
    if (!scene || total <= 0) return [];
    const tl = scene.timeline;
    const m: { at: number; kind: 'elim' | 'final2' }[] = scene.fx.elims.map((e) => ({
      at: tl.videoAt(e.t) / total,
      kind: 'elim',
    }));
    if (tl.vFinal2 !== null) m.push({ at: tl.vFinal2 / total, kind: 'final2' });
    return m;
  }, [scene, total]);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative" style={{ width: cssW, height: cssH }}>
          <canvas
            ref={canvasRef}
            width={pxW}
            height={pxH}
            style={{ width: cssW, height: cssH }}
            className={cn(
              'block',
              !ambient && 'rounded-[10px] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)] ring-1 ring-line-strong',
            )}
            role="img"
            aria-label={scene ? `Battle preview, ${scene.fighters.length} flags` : 'Battle preview'}
            onClick={ambient ? undefined : toggle}
          />
          {!ambient && (busy || !scene) && fit > 0 && (
            <div
              className="absolute inset-0 grid place-items-center rounded-[10px] bg-bg/55 backdrop-blur-[1px]"
              aria-live="polite"
            >
              <span className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                {scene ? 'Tuning…' : 'Preparing battle…'}
              </span>
            </div>
          )}
          {!ambient && scene && !playing && !busy && shownV === 0 && (
            <button
              type="button"
              onClick={play}
              aria-label="Play battle"
              className="absolute top-1/2 left-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent text-accent-ink shadow-[0_10px_40px_-6px_rgb(198_255_61/0.7)] transition-transform hover:scale-105"
            >
              <Play size={26} fill="currentColor" className="ml-1" />
            </button>
          )}
        </div>
      </div>

      {!ambient && (
        <div className={cn('mx-auto mt-3 w-full', variant === 'compact' ? 'max-w-[560px]' : 'max-w-[900px]')}>
          <div className="flex items-center gap-2">
            <Tip content={playing ? 'Pause (Space)' : 'Play (Space)'}>
              <button
                type="button"
                onClick={toggle}
                disabled={!scene}
                aria-label={playing ? 'Pause' : 'Play'}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-text text-bg transition-transform active:scale-95 disabled:opacity-40"
              >
                {playing ? (
                  <Pause size={16} fill="currentColor" />
                ) : (
                  <Play size={16} fill="currentColor" className="ml-0.5" />
                )}
              </button>
            </Tip>
            <Tip content="Restart (R)">
              <button
                type="button"
                onClick={restart}
                disabled={!scene}
                aria-label="Restart"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
              >
                <RotateCcw size={16} />
              </button>
            </Tip>
            <div className="relative flex-1">
              <input
                type="range"
                min={0}
                max={Math.max(0.01, total)}
                step={0.01}
                value={Math.min(shownV, total)}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Timeline"
                aria-valuetext={`${formatTime(shownV)} of ${formatTime(total)}`}
                disabled={!scene}
                className="timeline w-full"
                style={{ ['--p' as string]: `${total ? (shownV / total) * 100 : 0}%` }}
              />
              <div className="pointer-events-none absolute inset-x-[7px] top-1/2 h-0">
                {markers.map((m, i) => (
                  <span
                    key={i}
                    className={cn(
                      'absolute -top-[5px] h-[10px] w-[2px] rounded-full',
                      m.kind === 'elim' ? 'bg-danger/70' : 'bg-accent',
                    )}
                    style={{ left: `${m.at * 100}%` }}
                  />
                ))}
              </div>
            </div>
            <span className="w-[84px] shrink-0 text-right text-xs text-muted tabular">
              {formatTime(shownV)} / {formatTime(total)}
            </span>
            <Tip content={muted ? 'Unmute' : 'Mute'}>
              <button
                type="button"
                onClick={() => setUi({ muted: !muted })}
                aria-label={muted ? 'Unmute' : 'Mute'}
                aria-pressed={muted}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-text"
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
            </Tip>
          </div>
          {variant === 'full' && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Segmented
                label="Playback speed"
                value={speed}
                onChange={setSpeed}
                options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
                className="w-[220px]"
              />
              {aspect === '9:16' && (
                <button
                  type="button"
                  onClick={() => setUi({ safeArea: !safeArea })}
                  aria-pressed={safeArea}
                  className={cn(
                    'flex h-10 items-center gap-2 rounded-xl px-3 text-[13px] ring-1 ring-line transition-colors',
                    safeArea ? 'bg-danger/12 text-danger ring-danger/30' : 'text-muted hover:text-text',
                  )}
                >
                  {safeArea ? <Eye size={15} /> : <EyeOff size={15} />}
                  Safe areas
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
