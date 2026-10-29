import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ExternalLink, Pause, Play, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AUDIENCE_ZONES } from '../../autopilot/engagement';
import type { Autopilot } from '../../autopilot/engine';
import type { AutopilotState, ContentFormat, PostSettings, ScheduleSettings } from '../../autopilot/types';
import { Button } from '../../components/ui/Button';
import { Segmented, Slider, Toggle } from '../../components/ui/controls';
import { desktop, isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { cn } from '../../lib/utils';
import { moduleById } from '../../modules/registry';
import { navigate } from '../router';
import { Card, DesktopLayout, DesktopOnly } from './Layout';
import { FormatChip, PostDetail, STATUS_STYLE, fmtTime, statusLabel, whenLabel, youtubeUrl } from './posts';

/** Opens the post detail panel. */
type OpenPost = (slotId: string) => void;

const rowClass =
  'flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition-colors hover:bg-surface-2';

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function timeToMinutes(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function SetupSteps({ state }: { state: AutopilotState }) {
  if (state.setupDone && state.channels.length > 0) return null;
  return (
    <section className="panel flex flex-wrap items-center gap-4 p-5 ring-1 ring-accent/30">
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-medium">Connect your channel in about five minutes</h2>
        <p className="mt-1 text-sm text-muted">
          A step-by-step guide walks you through every click, then the autopilot takes over.
        </p>
      </div>
      <Button variant="primary" onClick={() => navigate('setup')}>
        Start setup
      </Button>
    </section>
  );
}

function NowCard({ ap, state, onOpen }: { ap: Autopilot; state: AutopilotState; onOpen: OpenPost }) {
  const { activity } = useAutopilot();
  const slot = activity ? state.slots.find((s) => s.id === activity.slotId) : null;
  const next = state.slots.find((s) => s.status === 'planned' || s.status === 'rendered');
  const channel = (id: string) => state.channels.find((c) => c.id === id)?.title ?? 'channel';
  return (
    <Card>
      {activity && slot ? (
        <div>
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            <button type="button" className="hover:underline" onClick={() => onOpen(slot.id)}>
              {activity.stage === 'rendering' ? 'Rendering' : 'Uploading'} a{' '}
              {slot.format === 'short' ? 'Short' : 'video'} for {channel(slot.channelId)}
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => ap.cancelCurrent()}
              disabled={activity.stage !== 'rendering'}
            >
              Cancel
            </Button>
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuenow={Math.round(activity.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Job progress"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${Math.max(2, activity.progress * 100)}%` }}
            />
          </div>
          {slot.title && <p className="mt-2 truncate text-xs text-muted">{slot.title}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <button
            type="button"
            className="text-left"
            disabled={!next}
            onClick={() => next && onOpen(next.id)}
            aria-label={next ? `Next post at ${whenLabel(next.at)}, show details` : 'No post planned'}
          >
            <div className="text-xs text-muted">Next post</div>
            <div className="font-display text-4xl leading-none tabular">
              {next ? fmtTime(next.at) : '--:--'}
            </div>
          </button>
          <p className="text-sm text-muted">
            {!state.running
              ? 'The autopilot is paused. Start it to post on your schedule.'
              : next
                ? `${next.format === 'short' ? 'A Short' : 'A long video'} for ${channel(next.channelId)}, ${whenLabel(next.at).toLowerCase()}. Click it to follow every step.`
                : 'Nothing planned yet. Connect a channel and set a schedule.'}
          </p>
        </div>
      )}
    </Card>
  );
}

function UpNext({ ap, state, onOpen }: { ap: Autopilot; state: AutopilotState; onOpen: OpenPost }) {
  const upcoming = state.slots
    .filter((s) => ['planned', 'rendering', 'rendered', 'uploading'].includes(s.status))
    .slice(0, 10);
  const channel = (id: string) => state.channels.find((c) => c.id === id)?.title ?? 'Unknown channel';
  return (
    <Card
      title="Up next"
      note="Times follow your audience's busiest hours with natural gaps. Click a post to follow it live."
    >
      {upcoming.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing scheduled.</p>
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {upcoming.map((s) => (
            <li key={s.id} className="flex items-center gap-1">
              <button type="button" className={rowClass} onClick={() => onOpen(s.id)}>
                <span className="w-[150px] shrink-0 tabular">{whenLabel(s.at)}</span>
                <FormatChip format={s.format} />
                <span className="min-w-0 flex-1 truncate text-muted">
                  {channel(s.channelId)}, {moduleById(s.moduleId)?.name ?? s.moduleId}
                  {s.error && s.status === 'planned' && (
                    <span className="text-danger"> (retrying: {s.error})</span>
                  )}
                </span>
                <span className={cn('text-xs', STATUS_STYLE[s.status])}>{statusLabel(s)}</span>
              </button>
              {(s.status === 'planned' || s.status === 'rendered') && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void ap.skip(s.id)}
                  aria-label={`Skip post at ${whenLabel(s.at)}`}
                >
                  Skip
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function History({ state, onOpen }: { state: AutopilotState; onOpen: OpenPost }) {
  const done = state.slots
    .filter((s) => ['posted', 'failed', 'skipped'].includes(s.status))
    .sort((a, b) => b.at - a.at)
    .slice(0, 30);
  return (
    <Card title="Recent posts">
      {done.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Posts will show up here.</p>
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {done.map((s) => (
            <li key={s.id} className="flex items-center gap-1">
              <button type="button" className={rowClass} onClick={() => onOpen(s.id)}>
                <span className="w-[150px] shrink-0 text-muted tabular">{whenLabel(s.at)}</span>
                <FormatChip format={s.format} />
                <span className="min-w-0 flex-1 truncate">
                  {s.title ?? '(not rendered)'}
                  {s.status !== 'posted' && s.error && (
                    <span className="block truncate text-xs text-muted">{s.error}</span>
                  )}
                </span>
                <span className={cn('text-xs', STATUS_STYLE[s.status])}>{statusLabel(s)}</span>
              </button>
              {s.videoId && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Open on YouTube"
                  onClick={() => void desktop.openUrl(youtubeUrl(s))}
                >
                  <ExternalLink size={14} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ScheduleForm({ ap, state }: { ap: Autopilot; state: AutopilotState }) {
  const [draft, setDraft] = useState<ScheduleSettings>(state.schedule);
  const [post, setPost] = useState<PostSettings>(state.post);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounced apply: re-plans the not-yet-started future.
  const apply = (s: ScheduleSettings) => {
    setDraft(s);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void ap.update({ schedule: s }, { replan: true }), 500);
  };
  const applyPost = (p: PostSettings) => {
    setPost(p);
    void ap.update({ post: p });
  };
  const perDayAvg = draft.shortsPerDay + draft.videosPerWeek / 7;
  const quotaUnits = Math.round(
    Math.min(draft.dailyCap, Math.ceil(perDayAvg + (draft.varyDaily ? 1 : 0))) * 1600,
  );

  return (
    <Card
      title="Schedule"
      note="Defaults post as often as YouTube's API quota allows while still looking natural."
    >
      <div className="space-y-6">
        <Slider
          label="Shorts per day"
          value={draft.shortsPerDay}
          min={0}
          max={10}
          onChange={(v) => apply({ ...draft, shortsPerDay: v })}
          format={(v) => (v === 0 ? 'None' : `${v} a day`)}
        />
        <Slider
          label="Long videos per week"
          value={draft.videosPerWeek}
          min={0}
          max={14}
          onChange={(v) => apply({ ...draft, videosPerWeek: v })}
          format={(v) => (v === 0 ? 'None' : `${v} a week`)}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-2 text-[13px] font-medium">
            <span>Post from</span>
            <input
              type="time"
              value={minutesToTime(draft.activeStartMin)}
              onChange={(e) => apply({ ...draft, activeStartMin: timeToMinutes(e.target.value) })}
              className="h-10 w-full rounded-xl border border-line-strong bg-bg/60 px-3 text-sm tabular"
            />
          </label>
          <label className="space-y-2 text-[13px] font-medium">
            <span>Until</span>
            <input
              type="time"
              value={minutesToTime(Math.min(draft.activeEndMin, 23 * 60 + 59))}
              onChange={(e) => apply({ ...draft, activeEndMin: timeToMinutes(e.target.value) })}
              className="h-10 w-full rounded-xl border border-line-strong bg-bg/60 px-3 text-sm tabular"
            />
          </label>
        </div>
        <Slider
          label="Minimum gap between posts"
          value={draft.minGapMin}
          min={30}
          max={240}
          step={5}
          onChange={(v) => apply({ ...draft, minGapMin: v })}
          format={(v) =>
            `${Math.floor(v / 60) ? `${Math.floor(v / 60)} h ` : ''}${v % 60 ? `${v % 60} min` : ''}`
          }
        />
        <Toggle
          label="Post at peak hours"
          description="More posts land when your audience is most active (lunch and evening, later on weekends), at different times every day."
          checked={draft.peakHours}
          onChange={(v) => apply({ ...draft, peakHours: v })}
        />
        {draft.peakHours && (
          <label className="block space-y-2 text-[13px] font-medium">
            <span>Where most of your viewers live</span>
            <select
              value={draft.audienceTz}
              onChange={(e) => apply({ ...draft, audienceTz: e.target.value })}
              className="h-10 w-full rounded-xl border border-line-strong bg-bg px-3 text-sm"
            >
              {AUDIENCE_ZONES.map((z) => (
                <option key={z.tz} value={z.tz}>
                  {z.label}
                </option>
              ))}
            </select>
            <span className="block text-xs font-normal text-muted">
              YouTube Studio shows this under Analytics, Audience, Top geographies. If it differs from your
              own time zone, widen the posting window above so it covers their evening.
            </span>
          </label>
        )}
        <Toggle
          label="Organic variation"
          description="Some days post one more or one fewer, at irregular minutes."
          checked={draft.varyDaily}
          onChange={(v) => apply({ ...draft, varyDaily: v })}
        />
        <div className="space-y-2">
          <Slider
            label="Daily upload limit"
            value={draft.dailyCap}
            min={1}
            max={20}
            onChange={(v) => apply({ ...draft, dailyCap: v })}
            format={(v) => `${v} per channel`}
          />
          <p className={cn('text-xs', quotaUnits > 10_000 ? 'text-hp-mid' : 'text-muted')}>
            About {quotaUnits.toLocaleString()} of the default 10,000 daily API units. Each upload costs about
            1,600, so the default quota fits about 6 uploads a day. Ask Google for more quota to go higher.
          </p>
        </div>

        <div className="space-y-3 border-t border-line pt-5">
          <Segmented<PostSettings['privacy']>
            label="Visibility"
            value={post.privacy}
            onChange={(privacy) => applyPost({ ...post, privacy })}
            options={[
              { value: 'public', label: 'Public' },
              { value: 'unlisted', label: 'Unlisted' },
              { value: 'private', label: 'Private' },
            ]}
          />
          {post.privacy === 'public' && (
            <Toggle
              label="Let YouTube publish on time"
              description="Uploads early as private with a publish time, so posts go live on schedule even if this computer is busy."
              checked={post.publishViaYouTube}
              onChange={(publishViaYouTube) => applyPost({ ...post, publishViaYouTube })}
            />
          )}
          <Toggle
            label="Made for kids"
            checked={post.madeForKids}
            onChange={(madeForKids) => applyPost({ ...post, madeForKids })}
          />
        </div>
      </div>
    </Card>
  );
}

function PostNow({ ap, state }: { ap: Autopilot; state: AutopilotState }) {
  const [channelId, setChannelId] = useState(state.channels[0]?.id ?? '');
  const [format, setFormat] = useState<ContentFormat>('short');
  useEffect(() => {
    if (!channelId && state.channels[0]) setChannelId(state.channels[0].id);
  }, [channelId, state.channels]);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" disabled={!state.channels.length}>
          <Send size={15} /> Post now
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[300px] space-y-4 rounded-2xl border border-line-strong bg-surface-2 p-4 shadow-2xl"
        >
          <p className="text-sm">Render and upload one post right away, outside the schedule.</p>
          <Segmented<ContentFormat>
            label="Format"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'short', label: 'Short' },
              { value: 'video', label: 'Long video' },
            ]}
          />
          {state.channels.length > 1 && (
            <label className="block space-y-2 text-[13px] font-medium">
              <span>Channel</span>
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="h-10 w-full rounded-xl border border-line-strong bg-bg px-3 text-sm"
              >
                {state.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Popover.Close asChild>
            <Button
              variant="primary"
              className="w-full justify-center"
              onClick={() => {
                toast('Rendering your post. It uploads as soon as it is ready.');
                void ap.postNow(channelId, format);
              }}
            >
              Render and post
            </Button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AutopilotPage() {
  const { ap, state } = useAutopilot();
  const [openId, setOpenId] = useState<string | null>(null);
  const ready = useMemo(() => !!state && !!state.google.clientId && state.channels.length > 0, [state]);

  if (!isDesktop()) {
    return (
      <DesktopLayout title="Autopilot">
        <DesktopOnly feature="Autopilot" />
      </DesktopLayout>
    );
  }
  if (!ap || !state) {
    return (
      <DesktopLayout title="Autopilot">
        <p className="text-sm text-muted">Starting…</p>
      </DesktopLayout>
    );
  }

  return (
    <DesktopLayout
      title="Autopilot"
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate('calendar')}>
            <CalendarDays size={15} /> Calendar
          </Button>
          <PostNow ap={ap} state={state} />
          <Button
            variant={state.running ? 'secondary' : 'primary'}
            disabled={!ready && !state.running}
            onClick={() => {
              if (state.running) ap.cancelCurrent();
              void ap.update({ running: !state.running });
            }}
          >
            {state.running ? <Pause size={15} /> : <Play size={15} />}{' '}
            {state.running ? 'Pause autopilot' : 'Start autopilot'}
          </Button>
        </>
      }
    >
      <div className="mx-auto grid max-w-[1200px] gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          <SetupSteps state={state} />
          <NowCard ap={ap} state={state} onOpen={setOpenId} />
          <UpNext ap={ap} state={state} onOpen={setOpenId} />
          <History state={state} onOpen={setOpenId} />
        </div>
        <div className="space-y-5">
          <ScheduleForm ap={ap} state={state} />
        </div>
      </div>
      <PostDetail ap={ap} slotId={openId} onClose={() => setOpenId(null)} />
    </DesktopLayout>
  );
}
