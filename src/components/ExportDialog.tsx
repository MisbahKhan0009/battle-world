import { Check, Copy, Download, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { runExport, webCodecsAvailable, type ExportOutcome, type ExportProgress } from '../export/exporter';
import { buildFilename, hashtagsFor } from '../lib/battle';
import { cn, formatTime, slug } from '../lib/utils';
import { DESIGN_SIZE } from '../render/layout';
import { useApp } from '../store/app';
import { useBattle } from '../store/battle';
import { useUi } from '../store/ui';
import { Button } from './ui/Button';
import { Field, Segmented, Slider, Toggle, inputClass } from './ui/controls';
import { Dialog } from './ui/Dialog';

type Phase =
  | { kind: 'setup' }
  | { kind: 'running'; progress: ExportProgress }
  | { kind: 'done'; out: ExportOutcome; url: string; filename: string; seconds: number }
  | { kind: 'error'; message: string };

const STAGE_LABEL: Record<ExportProgress['stage'], string> = {
  preparing: 'Preparing',
  audio: 'Mixing and encoding audio',
  video: 'Rendering and encoding video',
  finalizing: 'Finalizing the MP4',
  recording: 'Recording in real time',
};

export function ExportDialog() {
  const setUi = useUi((s) => s.set);
  const scene = useBattle((s) => s.scene);
  const config = useBattle((s) => s.config);
  const sceneFighters = useBattle((s) => s.fighters);
  const winnerImage = useBattle((s) => s.winnerImage);
  const look = useApp((s) => s.look);
  const audio = useApp((s) => s.audio);
  const setAudio = useApp((s) => s.setAudio);
  const ex = useApp((s) => s.exportSettings);
  const setExport = useApp((s) => s.setExport);
  const setRules = useApp((s) => s.setRules);
  const pushRecent = useApp((s) => s.pushRecent);
  const status = useBattle((s) => s.status);
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const abortRef = useRef<AbortController | null>(null);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  const { W, H } = DESIGN_SIZE[look.aspect];
  const total = scene?.timeline.total ?? 0;
  const winner = scene ? scene.fighters[scene.result.winnerIndex] : null;
  const filename = useMemo(
    () =>
      buildFilename(ex.filenameTemplate, {
        count: scene?.fighters.length ?? 0,
        winner: slug(winner?.name ?? 'winner'),
        seed: config?.seed ?? 0,
      }),
    [ex.filenameTemplate, scene, winner, config],
  );
  const tooLong = look.aspect === '9:16' && total > 60;
  const running = phase.kind === 'running';

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (phase.kind === 'done') URL.revokeObjectURL(phase.url);
    };
  }, [phase]);

  const close = () => {
    if (running) return;
    setUi({ exportOpen: false });
  };

  const start = async () => {
    if (!scene || !config || !sceneFighters) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const t0 = performance.now();
    setPhase({ kind: 'running', progress: { stage: 'preparing', percent: 0, etaSec: null } });
    try {
      const out = await runExport({
        config,
        look,
        fighters: sceneFighters,
        winnerImage,
        fps: ex.fps,
        quality: ex.quality,
        audio,
        signal: ac.signal,
        onProgress: (progress) => setPhase((p) => (p.kind === 'running' ? { kind: 'running', progress } : p)),
        onThumb: (bitmap) => {
          const c = thumbRef.current;
          const ctx = c?.getContext('2d');
          if (c && ctx) {
            c.width = bitmap.width;
            c.height = bitmap.height;
            ctx.drawImage(bitmap, 0, 0);
          }
          bitmap.close();
        },
      });
      pushRecent();
      const seconds = (performance.now() - t0) / 1000;
      setPhase({
        kind: 'done',
        out,
        url: URL.createObjectURL(out.blob),
        filename: `${filename}.${out.ext}`,
        seconds,
      });
      toast.success('Export done. Your video is ready to download.');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setPhase({ kind: 'setup' });
        toast('Export cancelled');
      } else {
        setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      abortRef.current = null;
    }
  };

  const copyMeta = async () => {
    if (!winner || !scene) return;
    const { title, tags } = hashtagsFor(winner.name, scene.fighters.length, scene.result.config.mode);
    try {
      await navigator.clipboard.writeText(`${title}\n\n${tags}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Clipboard access was blocked by the browser.');
    }
  };

  const title =
    phase.kind === 'done' ? 'Your video is ready' : phase.kind === 'running' ? 'Exporting' : 'Export video';

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      dismissible={!running}
      title={title}
      description={
        phase.kind === 'setup'
          ? `${W} × ${H}, ${formatTime(total)} long. Rendered frame by frame, so it matches the preview exactly.`
          : undefined
      }
      className="max-w-[560px]"
    >
      {phase.kind === 'setup' && (
        <div className="space-y-6">
          {!webCodecsAvailable() && (
            <p className="flex gap-2 rounded-xl bg-hp-mid/10 p-3 text-[13px] text-hp-mid">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              This browser cannot encode MP4, so the video will be recorded in real time as WebM. Keep this
              tab visible while it records.
            </p>
          )}
          {tooLong && (
            <p className="flex flex-wrap items-center gap-2 rounded-xl bg-hp-mid/10 p-3 text-[13px] text-hp-mid">
              <TriangleAlert size={16} className="shrink-0" />
              This video is {formatTime(total)}, longer than a 60s Short.
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => setRules({ targetDurationSec: 58 })}
              >
                Auto-fit to 58s
              </button>
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Frame rate">
              <Segmented<'30' | '60'>
                label="Frame rate"
                value={String(ex.fps) as '30' | '60'}
                onChange={(v) => setExport({ fps: Number(v) as 30 | 60 })}
                options={[
                  { value: '30', label: '30 fps' },
                  { value: '60', label: '60 fps' },
                ]}
              />
            </Field>
            <Field label="Quality">
              <Segmented<'standard' | 'high'>
                label="Quality"
                value={ex.quality}
                onChange={(quality) => setExport({ quality })}
                options={[
                  { value: 'standard', label: 'Standard', title: '8 Mbps' },
                  { value: 'high', label: 'High', title: '16 Mbps' },
                ]}
              />
            </Field>
          </div>

          <div className="space-y-4 rounded-xl bg-surface-2/50 p-4 ring-1 ring-line">
            <Toggle
              label="Include audio"
              description="Sound effects only: bumps, exits, eliminations and the winner fanfare."
              checked={audio.enabled}
              onChange={(enabled) => setAudio({ enabled })}
            />
            {audio.enabled && (
              <>
                <Slider
                  label="Sound effects"
                  value={audio.sfxVolume}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(sfxVolume) => setAudio({ sfxVolume })}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </>
            )}
          </div>

          <Field label="File name" hint={`${filename}.mp4`} htmlFor="filename">
            <input
              id="filename"
              value={ex.filenameTemplate}
              onChange={(e) => setExport({ filenameTemplate: e.target.value })}
              className={inputClass}
              spellCheck={false}
            />
          </Field>
          <p className="-mt-4 text-xs text-muted">
            Use {'{count}'}, {'{winner}'} and {'{seed}'} as placeholders.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={start} disabled={!scene || status === 'tuning'}>
              <Download size={15} /> Export {webCodecsAvailable() ? 'MP4' : 'WebM'}
            </Button>
          </div>
        </div>
      )}

      {phase.kind === 'running' && (
        <div className="space-y-5">
          <div className="flex gap-4">
            <div className="checker grid h-[150px] w-[150px] shrink-0 place-items-center overflow-hidden rounded-xl ring-1 ring-line-strong">
              <canvas ref={thumbRef} className="max-h-full max-w-full" aria-label="Latest rendered frame" />
            </div>
            <div className="min-w-0 flex-1 space-y-2 self-center">
              <div className="font-display text-6xl leading-none tabular">
                {Math.floor(phase.progress.percent)}%
              </div>
              <div className="text-sm">{STAGE_LABEL[phase.progress.stage]}</div>
              <div className="text-xs text-muted tabular">
                {phase.progress.etaSec !== null
                  ? `About ${formatTime(phase.progress.etaSec)} left`
                  : 'Estimating time left…'}
              </div>
            </div>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(phase.progress.percent)}
            aria-label="Export progress"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${phase.progress.percent}%` }}
            />
          </div>
          <div className="flex justify-end">
            <Button variant="danger" onClick={() => abortRef.current?.abort()}>
              Cancel export
            </Button>
          </div>
        </div>
      )}

      {phase.kind === 'done' && (
        <div className="space-y-5">
          <video
            src={phase.url}
            controls
            playsInline
            className={cn(
              'mx-auto max-h-[52dvh] rounded-xl bg-black ring-1 ring-line-strong',
              look.aspect === '16:9' ? 'w-full' : 'w-auto',
            )}
          />
          <p className="text-xs text-muted tabular">
            {phase.out.videoCodec}
            {phase.out.audioCodec ? ` + ${phase.out.audioCodec}` : ', no audio'},{' '}
            {(phase.out.blob.size / 1024 / 1024).toFixed(1)} MB, rendered in {phase.seconds.toFixed(0)}s
            {phase.out.fallback ? '. Recorded as WebM because this browser cannot encode MP4.' : ''}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={copyMeta}>
              {copied ? <Check size={15} /> : <Copy size={15} />}{' '}
              {copied ? 'Copied' : 'Copy title + hashtags'}
            </Button>
            <Button variant="secondary" onClick={() => setPhase({ kind: 'setup' })}>
              Export again
            </Button>
            <a
              href={phase.url}
              download={phase.filename}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink hover:brightness-110"
            >
              <Download size={15} /> Download {phase.out.ext.toUpperCase()}
            </a>
          </div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="space-y-4">
          <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">Export failed: {phase.message}</p>
          <p className="text-sm text-muted">
            Try 30 fps or Standard quality, close other heavy tabs, or use the latest Chrome or Edge.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Button variant="primary" onClick={() => setPhase({ kind: 'setup' })}>
              Back to settings
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
