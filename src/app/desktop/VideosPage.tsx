/**
 * Every video the autopilot makes, day by day: watch the rendered file, edit its title,
 * description or time, make a new one, publish it now, skip or restore it, approve it for upload,
 * and prepare a whole date range at once (render and upload ahead, then sleep or shut down).
 */
import {
  CalendarRange,
  Check,
  CirclePause,
  CirclePlay,
  ExternalLink,
  FolderOpen,
  Lock,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Send,
  SkipForward,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Autopilot } from '../../autopilot/engine';
import { dayKey, parseDayKey, planChannelsDay } from '../../autopilot/planner';
import {
  DEFAULT_PREPARE,
  MAX_AHEAD_DAYS,
  PLATFORM_NAME,
  platformOf,
  type AfterAction,
  type AutopilotState,
  type Slot,
} from '../../autopilot/types';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { inputClass, Segmented } from '../../components/ui/controls';
import { cachedDashboard } from '../../dashboard/store';
import { lockedPrivate } from '../../dashboard/insights';
import { desktop, isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { cn } from '../../lib/utils';
import { moduleById, readyModuleIds } from '../../modules/registry';
import { Card, DesktopLayout, DesktopOnly } from './Layout';
import { FormatChip, GameTag, PostDetail, STATUS_STYLE, fmtTime, statusLabel, youtubeUrl } from './posts';

type Filter = 'coming' | 'review' | 'posted' | 'all';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const dayTitle = (key: string) => {
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  const d = parseDayKey(key).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  return key === today ? `Today, ${d}` : key === tomorrow ? `Tomorrow, ${d}` : d;
};

const addDays = (key: string, n: number) => {
  const d = parseDayKey(key);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};

/** A local file the window can show (rendered video or its cover). */
function useMedia(path?: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!path) setUrl(null);
    else void desktop.mediaUrl(path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

function Cover({ slot }: { slot: Slot }) {
  const url = useMedia(slot.thumbPath);
  const [broken, setBroken] = useState(false);
  const accent = moduleById(slot.moduleId)?.accent ?? '#333';
  const short = slot.format === 'short';
  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-3 ring-1 ring-line',
        short ? 'h-[72px] w-[41px]' : 'h-[45px] w-[80px]',
      )}
      style={url && !broken ? undefined : { background: `linear-gradient(135deg, ${accent}55, transparent)` }}
    >
      {url && !broken && (
        <img src={url} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      )}
    </div>
  );
}

function Player({ slot, onClose }: { slot: Slot | null; onClose: () => void }) {
  const url = useMedia(slot?.filePath);
  const short = slot?.format === 'short';
  return (
    <Dialog
      open={!!slot}
      onOpenChange={(o) => !o && onClose()}
      title={slot?.title ?? 'Video'}
      description={
        slot
          ? `${moduleById(slot.moduleId)?.name}, goes out ${new Date(slot.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
          : undefined
      }
      className={short ? 'max-w-md' : 'max-w-4xl'}
    >
      {slot && url && (
        <video
          key={url}
          src={url}
          controls
          autoPlay
          className={cn('w-full rounded-xl bg-black', short ? 'aspect-[9/16]' : 'aspect-video')}
        />
      )}
      {slot && !slot.filePath && <p className="text-sm text-muted">This video has not been rendered yet.</p>}
    </Dialog>
  );
}

function Editor({ ap, slot, onClose }: { ap: Autopilot; slot: Slot | null; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState('');
  useEffect(() => {
    if (!slot) return;
    setTitle(slot.meta?.title ?? '');
    setDescription(slot.meta?.description ?? '');
    const d = new Date(slot.at);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    setWhen(local);
  }, [slot]);
  if (!slot) return null;
  const save = async () => {
    const at = new Date(when).getTime();
    await ap.editSlot(slot.id, {
      ...(slot.meta ? { title, description } : {}),
      ...(Number.isFinite(at) && at !== slot.at ? { at } : {}),
    });
    toast.success('Saved');
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Edit video" className="max-w-xl">
      <div className="space-y-4">
        {slot.meta ? (
          <>
            <label className="block space-y-1.5 text-[13px] font-medium">
              <span>Title</span>
              <input
                className={inputClass}
                value={title}
                maxLength={100}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-[13px] font-medium">
              <span>Description</span>
              <textarea
                className={cn(inputClass, 'h-40 py-2 leading-relaxed')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </>
        ) : (
          <p className="text-[13px] text-muted">
            The title and description are written when the video is rendered.
          </p>
        )}
        <label className="block space-y-1.5 text-[13px] font-medium">
          <span>Goes out at</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** How many posts each day in a range holds (queued ones, plus the plan for days not queued yet). */
function countRange(state: AutopilotState, from: string, to: string): { shorts: number; videos: number } {
  let shorts = 0;
  let videos = 0;
  const ready = readyModuleIds();
  for (let key = from; key <= to; key = addDays(key, 1)) {
    const queued = state.slots.filter(
      (s) => dayKey(new Date(s.at)) === key && !s.manual && s.status !== 'skipped',
    );
    const planned = state.channels.some((c) => c.enabled && (state.plannedDays[c.id] ?? []).includes(key));
    const list = planned
      ? queued
      : [...planChannelsDay(parseDayKey(key), state.channels, state.schedule, ready).values()].flat();
    for (const s of list) {
      if (s.format === 'short') shorts++;
      else videos++;
    }
  }
  return { shorts, videos };
}

function BatchDialog({
  ap,
  state,
  open,
  onClose,
}: {
  ap: Autopilot;
  state: AutopilotState;
  open: boolean;
  onClose: () => void;
}) {
  const today = dayKey(new Date());
  const tomorrow = addDays(today, 1);
  const [from, setFrom] = useState(tomorrow);
  const [to, setTo] = useState(tomorrow);
  const [mode, setMode] = useState<'upload' | 'render'>('upload');
  const [after, setAfter] = useState<AfterAction>('nothing');
  const last = addDays(today, MAX_AHEAD_DAYS);
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const count = useMemo(
    () => (open ? countRange(state, lo, hi) : { shorts: 0, videos: 0 }),
    [open, state, lo, hi],
  );
  const total = count.shorts + count.videos;
  const days = Math.round((parseDayKey(hi).getTime() - parseDayKey(lo).getTime()) / 86_400_000) + 1;
  const start = async () => {
    // Uploading ahead means scheduling on YouTube for each video's own time.
    if (mode === 'upload' && state.post.privacy === 'public' && !state.post.publishViaYouTube)
      await ap.update({ post: { ...state.post, publishViaYouTube: true } });
    await ap.startBatch({ from: lo, to: hi, upload: mode === 'upload', after });
    toast.success(`Preparing ${plural(total, 'video')}`, {
      description:
        after === 'nothing'
          ? undefined
          : `The computer will ${after === 'sleep' ? 'sleep' : 'shut down'} when it is done.`,
    });
    onClose();
  };
  const quick = (a: string, b: string) => {
    setFrom(a);
    setTo(b);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Render and upload"
      description="Prepare every video for a day or a range of days now. Uploads are scheduled on YouTube for each video's own time, so the computer can be off when they go out."
      className="max-w-xl"
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => quick(tomorrow, tomorrow)}>
            Tomorrow
          </Button>
          <Button size="sm" variant="secondary" onClick={() => quick(tomorrow, addDays(today, 7))}>
            Next 7 days
          </Button>
          <Button size="sm" variant="secondary" onClick={() => quick(tomorrow, addDays(today, 14))}>
            Next 14 days
          </Button>
          <Button size="sm" variant="secondary" onClick={() => quick(tomorrow, last)}>
            Next 30 days
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5 text-[13px] font-medium">
            <span>From</span>
            <input
              type="date"
              className={inputClass}
              min={today}
              max={last}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-[13px] font-medium">
            <span>To</span>
            <input
              type="date"
              className={inputClass}
              min={today}
              max={last}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div className="space-y-2">
          <span className="text-[13px] font-medium">What to do</span>
          <Segmented<'upload' | 'render'>
            label="What to do"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'upload', label: 'Render and upload' },
              { value: 'render', label: 'Render only' },
            ]}
          />
          <p className="text-xs text-muted">
            {mode === 'upload'
              ? 'Each video is uploaded as soon as it is rendered and published by YouTube at its planned time.'
              : 'Videos are rendered now so you can watch and edit them; each one is uploaded a few hours before its time while the app runs.'}
          </p>
        </div>
        <div className="space-y-2">
          <span className="text-[13px] font-medium">When it is done</span>
          <Segmented<AfterAction>
            label="When it is done"
            value={after}
            onChange={setAfter}
            options={[
              { value: 'nothing', label: 'Keep everything on' },
              { value: 'sleep', label: 'Sleep' },
              { value: 'shutdown', label: 'Shut down' },
            ]}
          />
          {after !== 'nothing' && (
            <p className="text-xs text-muted">
              You get a one-minute countdown in the app first, with a button to cancel.
            </p>
          )}
        </div>
        <div className="rounded-xl bg-surface-2/60 p-4 text-[13px] ring-1 ring-line">
          <span className="text-text">
            {plural(days, 'day')}: {plural(count.shorts, 'Short')} and {plural(count.videos, 'long video')}.
          </span>{' '}
          <span className="text-muted">
            Rendering takes a while, so leave the app running (it can stay in the tray). YouTube allows 100
            uploads a day; anything over that goes up after the daily reset.
          </span>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!total} onClick={() => void start()}>
            <CalendarRange size={15} /> Prepare {plural(total, 'video')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function BatchCard({ ap, state }: { ap: Autopilot; state: AutopilotState }) {
  const { activity } = useAutopilot();
  const b = state.batch;
  if (!b) return null;
  const inRange = state.slots.filter((s) => {
    const k = dayKey(new Date(s.at));
    return k >= b.from && k <= b.to && s.status !== 'skipped' && !s.manual;
  });
  const rendered = inRange.filter((s) => ['rendered', 'uploading', 'posted'].includes(s.status)).length;
  const uploaded = inRange.filter((s) => s.status === 'posted').length;
  const failed = inRange.filter((s) => s.status === 'failed').length;
  const goal = inRange.length || 1;
  const done = !!b.finishedAt;
  const range =
    b.from === b.to
      ? dayTitle(b.from)
      : `${parseDayKey(b.from).toLocaleDateString([], { month: 'short', day: 'numeric' })} to ${parseDayKey(b.to).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  const paused = !!state.uploadPausedUntil && state.uploadPausedUntil > Date.now();
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-medium">
            {done ? 'Prepared' : 'Preparing'} {range}
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            {rendered} of {inRange.length} rendered
            {b.upload ? `, ${uploaded} uploaded and scheduled` : ''}
            {failed ? `, ${failed} failed` : ''}
            {!done && activity ? ` · ${activity.stage} ${Math.round(activity.progress * 100)}%` : ''}
            {!done && b.after !== 'nothing' ? ` · then ${b.after === 'sleep' ? 'sleep' : 'shut down'}` : ''}
          </p>
          {paused && (
            <p className="mt-1 text-[13px] text-hp-mid">
              YouTube's daily upload limit is reached; the rest uploads after{' '}
              {new Date(state.uploadPausedUntil!).toLocaleString([], {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit',
              })}
              .
            </p>
          )}
        </div>
        <Button size="sm" variant={done ? 'ghost' : 'danger'} onClick={() => void ap.cancelBatch()}>
          {done ? 'Dismiss' : 'Stop'}
        </Button>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${(100 * (b.upload ? (rendered + uploaded) / 2 : rendered)) / goal}%` }}
        />
      </div>
    </Card>
  );
}

function LockedWarning({ state }: { state: AutopilotState }) {
  if (state.post.privacy !== 'public') return null;
  const locked = state.channels.flatMap((c) => {
    const data = cachedDashboard(c.id);
    return data
      ? lockedPrivate(
          data.videos,
          state.slots.filter((s) => s.channelId === c.id),
          Date.now(),
        )
      : [];
  });
  if (!locked.length) return null;
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-2xl bg-hp-mid/10 p-4 text-[13px] ring-1 ring-hp-mid/30">
      <Lock size={18} className="mt-0.5 shrink-0 text-hp-mid" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-hp-mid">
          {plural(locked.length, 'upload')} stayed private after {locked.length === 1 ? 'its' : 'their'} time
        </p>
        <p className="mt-1 text-muted">
          YouTube locks every upload from a Google project that has not passed its API audit as private, so
          scheduled videos do not go public on their own. Publish them in YouTube Studio for now, and apply
          for the free audit so future uploads go public by themselves.
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void desktop.openUrl('https://studio.youtube.com/')}
        >
          YouTube Studio <ExternalLink size={13} />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void desktop.openUrl('https://support.google.com/youtube/contact/yt_api_form')}
        >
          Apply for the audit <ExternalLink size={13} />
        </Button>
      </div>
    </div>
  );
}

function Row({
  ap,
  state,
  slot: s,
  onPlay,
  onEdit,
  onOpen,
}: {
  ap: Autopilot;
  state: AutopilotState;
  slot: Slot;
  onPlay: () => void;
  onEdit: () => void;
  onOpen: () => void;
}) {
  const review = (state.prepare ?? DEFAULT_PREPARE).review;
  const busy = s.status === 'rendering' || s.status === 'uploading';
  const onYouTube = s.status === 'posted';
  const needsReview = review && s.status === 'rendered' && !s.approved && !s.paused;
  const ch = state.channels.find((c) => c.id === s.channelId);
  const platform = platformOf(ch);
  const open = s.status !== 'posted' && s.status !== 'skipped';
  // Stuck, failed, or waiting for another attempt: offer to try again now.
  const canRetry = s.status === 'failed' || busy || (!!s.error && !!s.nextAttemptAt);
  const link =
    s.videoId && platform === 'youtube'
      ? youtubeUrl(s)
      : s.videoId && platform === 'facebook'
        ? `https://www.facebook.com/${s.videoId}`
        : null;
  return (
    <li className="flex items-center gap-4 py-3">
      <button
        type="button"
        onClick={onPlay}
        disabled={!s.filePath}
        className="relative flex w-[80px] shrink-0 justify-center"
        aria-label="Play"
      >
        <Cover slot={s} />
        {s.filePath && (
          <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/25 opacity-0 transition-opacity hover:opacity-100">
            <Play size={18} className="text-white" />
          </span>
        )}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="w-[64px] shrink-0 text-[13px] tabular text-muted">{fmtTime(s.at)}</span>
          <FormatChip format={s.format} />
          <GameTag moduleId={s.moduleId} />
          {(state.channels.length > 1 || platform !== 'youtube') && (
            <span className="truncate text-xs text-muted">
              {PLATFORM_NAME[platform]}
              {state.channels.filter((c) => platformOf(c) === platform).length > 1 && ch
                ? `, ${ch.title}`
                : ''}
            </span>
          )}
        </div>
        <div className="mt-1 truncate text-sm">
          {s.title ?? <span className="text-muted">Not rendered yet</span>}
        </div>
      </button>
      {!needsReview && (
        <span
          className={cn(
            'w-[86px] shrink-0 text-right text-xs',
            s.paused ? 'text-hp-mid' : STATUS_STYLE[s.status],
          )}
          title={s.error}
        >
          {s.paused ? 'Paused' : statusLabel(s)}
        </span>
      )}
      <div className="flex min-w-[300px] shrink-0 justify-end gap-1">
        {open && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={s.paused ? 'Resume' : 'Pause'}
            title={s.paused ? 'Resume rendering and uploading' : 'Pause rendering and uploading'}
            onClick={() => void ap.setPaused(s.id, !s.paused)}
          >
            {s.paused ? <CirclePlay size={15} /> : <CirclePause size={15} />}
          </Button>
        )}
        {canRetry && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Retry"
            title={busy ? 'Stuck? Stop and try again' : 'Try again now'}
            onClick={() => void ap.retry(s.id)}
          >
            <RotateCw size={15} />
          </Button>
        )}
        {needsReview && (
          <Button size="sm" variant="primary" onClick={() => void ap.approve([s.id])}>
            <Check size={14} /> Approve
          </Button>
        )}
        {s.filePath && (
          <Button size="icon-sm" variant="ghost" aria-label="Play" title="Play" onClick={onPlay}>
            <Play size={15} />
          </Button>
        )}
        {!onYouTube && !busy && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Edit"
            title="Edit title, description or time"
            onClick={onEdit}
          >
            <Pencil size={15} />
          </Button>
        )}
        {!onYouTube && !busy && s.status !== 'skipped' && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="New video"
            title="Make a new video for this slot"
            onClick={() => void ap.rerender(s.id)}
          >
            <RefreshCw size={15} />
          </Button>
        )}
        {['planned', 'rendered', 'failed'].includes(s.status) && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Publish now"
            title="Publish now"
            onClick={() => void ap.publishNow(s.id)}
          >
            <Send size={15} />
          </Button>
        )}
        {['planned', 'rendered'].includes(s.status) && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Skip"
            title="Skip"
            onClick={() => void ap.skip(s.id)}
          >
            <SkipForward size={15} />
          </Button>
        )}
        {s.status === 'skipped' && s.at > Date.now() && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Restore"
            title="Put back in the plan"
            onClick={() => void ap.restore(s.id)}
          >
            <RotateCcw size={15} />
          </Button>
        )}
        {link && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Open on ${PLATFORM_NAME[platform]}`}
            title={`Open on ${PLATFORM_NAME[platform]}`}
            onClick={() => void desktop.openUrl(link)}
          >
            <ExternalLink size={15} />
          </Button>
        )}
      </div>
    </li>
  );
}

export function VideosPage() {
  const { ap, state } = useAutopilot();
  const [filter, setFilter] = useState<Filter>('coming');
  const [batchOpen, setBatchOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (state?.outputDir) void desktop.allowMedia(state.outputDir).catch(() => undefined);
  }, [state?.outputDir]);

  if (!isDesktop()) {
    return (
      <DesktopLayout title="Videos">
        <DesktopOnly feature="Your videos" />
      </DesktopLayout>
    );
  }
  if (!ap || !state) return <DesktopLayout title="Videos">{null}</DesktopLayout>;

  const now = Date.now();
  const startOfToday = parseDayKey(dayKey(new Date(now))).getTime();
  const review = (state.prepare ?? DEFAULT_PREPARE).review;
  const shown = state.slots.filter((s) => {
    // Today and later, until it is live on YouTube.
    if (filter === 'coming') return s.at >= startOfToday && (s.status !== 'posted' || s.at > now);
    if (filter === 'review') return s.status === 'rendered' && (!review || !s.approved);
    if (filter === 'posted') return s.status === 'posted';
    return true;
  });
  const byDay = new Map<string, Slot[]>();
  for (const s of filter === 'posted' ? [...shown].reverse() : shown) {
    const k = dayKey(new Date(s.at));
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const waiting = state.slots.filter((s) => s.status === 'rendered' && review && !s.approved);
  const find = (id: string | null) => (id ? (state.slots.find((s) => s.id === id) ?? null) : null);

  return (
    <DesktopLayout
      title="Videos"
      actions={
        <Button variant="primary" onClick={() => setBatchOpen(true)}>
          <CalendarRange size={15} /> Render and upload
        </Button>
      }
    >
      <div className="mx-auto max-w-[1100px] space-y-5">
        <LockedWarning state={state} />
        <BatchCard ap={ap} state={state} />
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<Filter>
            label="Show"
            className="w-[460px]"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'coming', label: 'Coming up' },
              { value: 'review', label: review ? `To review (${waiting.length})` : 'Rendered' },
              { value: 'posted', label: 'On YouTube' },
              { value: 'all', label: 'All' },
            ]}
          />
          {filter === 'review' && review && waiting.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => void ap.approve(waiting.map((s) => s.id))}>
              <Check size={14} /> Approve all {waiting.length}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => void desktop.openPath(state.outputDir)}
          >
            <FolderOpen size={14} /> Videos folder
          </Button>
        </div>
        {byDay.size === 0 && (
          <Card>
            <p className="text-sm text-muted">
              {filter === 'review'
                ? 'Nothing waiting. Rendered videos show up here before they are uploaded.'
                : 'Nothing here yet. Use Render and upload to prepare the coming days.'}
            </p>
          </Card>
        )}
        {[...byDay].map(([key, list]) => (
          <Card key={key}>
            <div className="flex items-baseline justify-between">
              <h2 className="text-[15px] font-medium">{dayTitle(key)}</h2>
              <span className="text-xs text-muted">
                {plural(list.filter((s) => s.format === 'short').length, 'Short')},{' '}
                {plural(list.filter((s) => s.format === 'video').length, 'long video')}
              </span>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {list.map((s) => (
                <Row
                  key={s.id}
                  ap={ap}
                  state={state}
                  slot={s}
                  onPlay={() => setPlaying(s.id)}
                  onEdit={() => setEditing(s.id)}
                  onOpen={() => setOpen(s.id)}
                />
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <BatchDialog ap={ap} state={state} open={batchOpen} onClose={() => setBatchOpen(false)} />
      <Player slot={find(playing)} onClose={() => setPlaying(null)} />
      <Editor ap={ap} slot={find(editing)} onClose={() => setEditing(null)} />
      <PostDetail ap={ap} slotId={open} onClose={() => setOpen(null)} />
    </DesktopLayout>
  );
}
