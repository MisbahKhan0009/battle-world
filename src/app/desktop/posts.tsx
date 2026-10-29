/**
 * Shared bits for showing autopilot posts: labels, chips, and the post detail panel with a live
 * step-by-step view of a post (planned, rendering, uploading, scheduled on YouTube, live).
 */
import {
  Check,
  CircleAlert,
  Clapperboard,
  ExternalLink,
  FolderOpen,
  ImageOff,
  Loader2,
  Upload,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Autopilot } from '../../autopilot/engine';
import { RENDER_LEAD_MS, SCHEDULED_RENDER_LEAD_MS } from '../../autopilot/engine';
import { dayKey, type PlannedSlot } from '../../autopilot/planner';
import type { AutopilotState, ContentFormat, Slot } from '../../autopilot/types';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { desktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { cn } from '../../lib/utils';
import { moduleById } from '../../modules/registry';

export const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function whenLabel(ms: number): string {
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  const k = dayKey(new Date(ms));
  const day =
    k === today
      ? 'Today'
      : k === tomorrow
        ? 'Tomorrow'
        : new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day}, ${fmtTime(ms)}`;
}

export const STATUS_STYLE: Record<Slot['status'], string> = {
  planned: 'text-muted',
  rendering: 'text-accent',
  rendered: 'text-text',
  uploading: 'text-accent',
  posted: 'text-hp-high',
  failed: 'text-danger',
  skipped: 'text-muted/70',
};

export const STATUS_LABEL: Record<Slot['status'], string> = {
  planned: 'Planned',
  rendering: 'Rendering',
  rendered: 'Ready',
  uploading: 'Uploading',
  posted: 'Posted',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** Posted but YouTube has not published it yet (scheduled with publishAt). */
export const isScheduledOnYouTube = (s: Slot, now = Date.now()) =>
  s.status === 'posted' && !s.manual && s.at > now;

export function statusLabel(s: Slot, now = Date.now()): string {
  return isScheduledOnYouTube(s, now) ? 'Scheduled' : s.status === 'posted' ? 'Live' : STATUS_LABEL[s.status];
}

export function FormatChip({ format, className }: { format: ContentFormat; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium',
        format === 'short' ? 'bg-accent/12 text-accent' : 'bg-[#3DDCFF]/12 text-[#3DDCFF]',
        className,
      )}
    >
      {format === 'short' ? 'Short' : 'Video'}
    </span>
  );
}

/** The game a post belongs to, in its color. */
export function GameTag({ moduleId, className }: { moduleId: string; className?: string }) {
  const m = moduleById(moduleId);
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 text-xs', className)}>
      <span className="h-2 w-2 rounded-full" style={{ background: m?.accent ?? '#888' }} />
      <span style={{ color: m?.accent }}>{m?.name ?? moduleId}</span>
    </span>
  );
}

export const youtubeUrl = (s: Pick<Slot, 'videoId' | 'format'>) =>
  s.format === 'short'
    ? `https://www.youtube.com/shorts/${s.videoId}`
    : `https://www.youtube.com/watch?v=${s.videoId}`;

/** Re-renders every second while mounted (for countdowns). */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return `in ${Math.ceil(ms / 1000)} s`;
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h} h ${m % 60} min`;
  return `in ${Math.floor(h / 24)} days`;
}

type StepState = 'done' | 'active' | 'pending' | 'error' | 'skipped';

function Step({
  icon,
  title,
  state,
  children,
  last,
}: {
  icon: ReactNode;
  title: string;
  state: StepState;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-4 pb-5">
      {!last && (
        <span
          aria-hidden
          className={cn(
            'absolute top-9 bottom-0 left-[17px] w-px',
            state === 'done' ? 'bg-hp-high/50' : 'bg-line-strong',
          )}
        />
      )}
      <span
        className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1',
          state === 'done' && 'bg-hp-high/15 text-hp-high ring-hp-high/40',
          state === 'active' && 'bg-accent/15 text-accent ring-accent/50',
          state === 'pending' && 'bg-surface-2 text-muted ring-line-strong',
          state === 'error' && 'bg-danger/15 text-danger ring-danger/40',
          state === 'skipped' && 'bg-surface-2 text-muted/50 ring-line',
        )}
      >
        {state === 'done' ? <Check size={16} /> : state === 'error' ? <CircleAlert size={16} /> : icon}
      </span>
      <div className="min-w-0 flex-1 pt-1.5">
        <div className={cn('text-sm font-medium', state === 'skipped' && 'text-muted/60')}>{title}</div>
        {children && <div className="mt-1 space-y-2 text-[13px] text-muted">{children}</div>}
      </div>
    </li>
  );
}

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${Math.max(2, value * 100)}%` }}
        />
      </div>
      <div className="mt-1 text-xs tabular text-accent">{Math.round(value * 100)}%</div>
    </div>
  );
}

function renderLead(state: AutopilotState): number {
  return state.post.privacy === 'public' && state.post.publishViaYouTube
    ? SCHEDULED_RENDER_LEAD_MS
    : RENDER_LEAD_MS;
}

/** The step-by-step flow of one post, updated live from the autopilot. */
function PostFlow({ ap, state, slot }: { ap: Autopilot; state: AutopilotState; slot: Slot }) {
  const { activity } = useAutopilot();
  const now = useNow();
  const s = slot;
  const act = activity?.slotId === s.id ? activity : null;
  const renderedOnce = !!s.filePath || !!s.title;
  const skipped = s.status === 'skipped';
  const failed = s.status === 'failed';

  const renderState: StepState =
    s.status === 'rendering'
      ? 'active'
      : renderedOnce || ['rendered', 'uploading', 'posted'].includes(s.status)
        ? 'done'
        : failed || (s.status === 'planned' && s.error && s.error !== 'Cancelled')
          ? 'error'
          : skipped
            ? 'skipped'
            : 'pending';
  const uploadState: StepState =
    s.status === 'uploading'
      ? 'active'
      : s.status === 'posted'
        ? 'done'
        : (failed && renderedOnce) || (s.status === 'rendered' && s.error)
          ? 'error'
          : skipped
            ? 'skipped'
            : 'pending';
  const scheduled = isScheduledOnYouTube(s, now);
  const publishState: StepState =
    s.status === 'posted' ? (scheduled ? 'active' : 'done') : skipped ? 'skipped' : 'pending';
  const renderAt = s.manual ? s.at : s.at - renderLead(state);

  return (
    <ol className="mt-1">
      <Step icon={<Clapperboard size={16} />} title="Planned" state="done">
        {s.manual ? 'Added with Post now.' : `Goes live ${fmtDateTime(s.at)}.`}
      </Step>
      <Step
        icon={<Loader2 size={16} className={act?.stage === 'rendering' ? 'animate-spin' : ''} />}
        title="Render video"
        state={renderState}
      >
        {renderState === 'active' && (
          <Progress value={act?.stage === 'rendering' ? act.progress : 0} label="Render progress" />
        )}
        {renderState === 'pending' &&
          (state.running || s.manual
            ? renderAt > now
              ? `Starts ${countdown(renderAt - now)} (${fmtTime(renderAt)}).`
              : 'Starting soon.'
            : 'Waiting: the autopilot is paused.')}
        {renderState === 'done' && s.title && <span className="text-text">{s.title}</span>}
        {renderState === 'error' && (
          <span className="text-danger">
            {s.error}
            {s.nextAttemptAt && !failed && ` Next try ${countdown(s.nextAttemptAt - now)}.`}
          </span>
        )}
      </Step>
      <Step icon={<Upload size={16} />} title="Upload to YouTube" state={uploadState}>
        {uploadState === 'active' && (
          <Progress value={act?.stage === 'uploading' ? act.progress : 0} label="Upload progress" />
        )}
        {uploadState === 'pending' &&
          renderedOnce &&
          !skipped &&
          'Uploads as soon as YouTube can schedule it.'}
        {uploadState === 'done' &&
          (s.thumbError ? (
            <span className="flex items-start gap-1.5">
              <ImageOff size={14} className="mt-0.5 shrink-0" /> Custom thumbnail not set: {s.thumbError}
            </span>
          ) : s.thumbPath || s.log?.some((e) => e.text === 'Custom thumbnail set') ? (
            'Uploaded with a spoiler-free thumbnail.'
          ) : (
            'Uploaded.'
          ))}
        {uploadState === 'error' && (
          <span className="text-danger">
            {s.error}
            {s.nextAttemptAt && !failed && ` Next try ${countdown(s.nextAttemptAt - now)}.`}
          </span>
        )}
      </Step>
      <Step
        icon={<ExternalLink size={16} />}
        title={scheduled ? 'Scheduled on YouTube' : 'Live on YouTube'}
        state={publishState}
        last
      >
        {scheduled && `YouTube publishes it ${countdown(s.at - now)} (${fmtDateTime(s.at)}).`}
        {publishState === 'done' && s.postedAt && `Published ${fmtDateTime(Math.max(s.at, s.postedAt))}.`}
        {skipped && <span>{s.error ?? 'Skipped.'}</span>}
        {s.videoId && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => void desktop.openUrl(youtubeUrl(s))}>
              <ExternalLink size={13} /> Open on YouTube
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void desktop.openUrl(`https://studio.youtube.com/video/${s.videoId}/edit`)}
            >
              YouTube Studio
            </Button>
          </div>
        )}
      </Step>
      {(s.status === 'planned' || s.status === 'rendered') && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => void ap.skip(s.id)}>
            Skip this post
          </Button>
        </div>
      )}
    </ol>
  );
}

function Details({ slot, state }: { slot: Slot; state: AutopilotState }) {
  const channel = state.channels.find((c) => c.id === slot.channelId)?.title ?? 'Unknown channel';
  const rows: [string, ReactNode][] = [
    ['Channel', channel],
    ['Game', moduleById(slot.moduleId)?.name ?? slot.moduleId],
    ['Seed', <span className="tabular">{slot.seed}</span>],
  ];
  if (slot.filePath)
    rows.push([
      'File',
      <button
        type="button"
        className="flex min-w-0 items-center gap-1.5 text-left hover:text-text"
        onClick={() => void desktop.openPath(slot.filePath!.replace(/[\\/][^\\/]+$/, ''))}
      >
        <FolderOpen size={13} className="shrink-0" /> <span className="truncate">{slot.filePath}</span>
      </button>,
    ]);
  return (
    <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Detail panel for a post. Pass a slot id from the autopilot state (live), or a preview of a
 * post that is in the plan but not queued yet.
 */
export function PostDetail({
  ap,
  slotId,
  preview,
  onClose,
}: {
  ap: Autopilot;
  slotId: string | null;
  preview?: PlannedSlot | null;
  onClose: () => void;
}) {
  const { state } = useAutopilot();
  // A previewed post becomes a real slot (same id) once the autopilot queues its day.
  const slot = slotId ? state?.slots.find((s) => s.id === slotId) : undefined;
  const open = !!(slot || preview);
  const p = slot ?? preview;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={
        p
          ? `${moduleById(p.moduleId)?.name ?? ''} ${p.format === 'short' ? 'Short' : 'video'}, ${whenLabel(p.at)}`.trim()
          : 'Post'
      }
      description={
        slot?.title ??
        (slot ? undefined : 'In the plan. It is queued the day before and rendered a few hours ahead.')
      }
      className="max-w-xl"
    >
      {state && slot && (
        <div className="space-y-5">
          <PostFlow ap={ap} state={state} slot={slot} />
          <Details slot={slot} state={state} />
          {slot.meta && (
            <details className="rounded-xl bg-surface-2/60 p-3 text-[13px] ring-1 ring-line">
              <summary className="cursor-pointer text-muted">Description and tags</summary>
              <p className="mt-2 whitespace-pre-line">{slot.meta.description}</p>
              <p className="mt-2 text-muted">{slot.meta.tags.join(', ')}</p>
            </details>
          )}
          {!!slot.log?.length && (
            <div>
              <h3 className="mb-2 text-[13px] font-medium">Activity</h3>
              <ul className="space-y-1 text-[13px]">
                {[...slot.log].reverse().map((e, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-[170px] shrink-0 whitespace-nowrap tabular text-muted">
                      {whenLabel(e.t)}
                    </span>
                    <span className={cn('min-w-0', e.error && 'text-danger')}>{e.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {state && !slot && preview && (
        <div className="space-y-4 text-sm">
          <ol>
            <Step icon={<Clapperboard size={16} />} title="In the plan" state="active">
              Goes live {fmtDateTime(preview.at)}.
            </Step>
            <Step icon={<Loader2 size={16} />} title="Render video" state="pending" />
            <Step icon={<Upload size={16} />} title="Upload to YouTube" state="pending" />
            <Step icon={<ExternalLink size={16} />} title="Live on YouTube" state="pending" last />
          </ol>
          <p className="text-[13px] text-muted">
            Changing the schedule re-plans days that have not been queued yet, so this time can still move.
          </p>
        </div>
      )}
    </Dialog>
  );
}
