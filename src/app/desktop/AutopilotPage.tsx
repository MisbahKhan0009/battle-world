import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ExternalLink, Pause, Play, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AUDIENCE_ZONES } from '../../autopilot/engagement';
import type { Autopilot } from '../../autopilot/engine';
import { dayKey, parseDayKey } from '../../autopilot/planner';
import {
  PROJECT_UPLOADS_PER_DAY,
  type AutopilotState,
  type Channel,
  type ContentFormat,
  type ModulePace,
  type PostSettings,
  type ScheduleSettings,
} from '../../autopilot/types';
import { Button } from '../../components/ui/Button';
import { Segmented, Slider, Stepper, Toggle } from '../../components/ui/controls';
import { desktop, isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { cn } from '../../lib/utils';
import { MODULES } from '../../modules/registry';
import { navigate } from '../router';
import { Card, DesktopLayout, DesktopOnly } from './Layout';
import {
  FormatChip,
  GameTag,
  PostDetail,
  STATUS_STYLE,
  fmtTime,
  isScheduledOnYouTube,
  statusLabel,
  whenLabel,
  youtubeUrl,
} from './posts';

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

function dayHeading(key: string): string {
  const nice = parseDayKey(key).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  if (key === dayKey(new Date())) return `Today, ${nice}`;
  if (key === dayKey(new Date(Date.now() + 86_400_000))) return `Tomorrow, ${nice}`;
  return nice;
}

function UpNext({ ap, state, onOpen }: { ap: Autopilot; state: AutopilotState; onOpen: OpenPost }) {
  const now = Date.now();
  // Everything still to come this week, including posts already uploaded and waiting for YouTube.
  const upcoming = state.slots.filter(
    (s) =>
      ['planned', 'rendering', 'rendered', 'uploading'].includes(s.status) || isScheduledOnYouTube(s, now),
  );
  const days = new Map<string, typeof upcoming>();
  for (const s of upcoming) {
    const k = dayKey(new Date(s.at));
    days.set(k, [...(days.get(k) ?? []), s]);
  }
  const channel = (id: string) => state.channels.find((c) => c.id === id)?.title ?? 'Unknown channel';
  const many = state.channels.length > 1;
  const shorts = upcoming.filter((s) => s.format === 'short').length;
  return (
    <Card
      title="This week"
      note={
        upcoming.length
          ? `${shorts} Shorts and ${upcoming.length - shorts} long videos over the next 7 days, at your audience's busiest hours. Click a post to follow it live.`
          : undefined
      }
    >
      {upcoming.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {state.running ? 'Nothing scheduled.' : 'Start the autopilot to plan the week.'}
        </p>
      ) : (
        <div className="-mx-2 max-h-[560px] space-y-4 overflow-y-auto pr-1 scrollbar-thin">
          {[...days.entries()].map(([key, list]) => {
            const n = list.filter((s) => s.format === 'short').length;
            return (
              <section key={key}>
                <h3 className="sticky top-0 z-10 flex items-baseline gap-2 bg-surface px-2 py-1 text-[13px] font-medium">
                  {dayHeading(key)}
                  <span className="text-xs font-normal text-muted">
                    {n} Short{n === 1 ? '' : 's'}
                    {list.length - n ? `, ${list.length - n} video${list.length - n === 1 ? '' : 's'}` : ''}
                  </span>
                </h3>
                <ul className="divide-y divide-line">
                  {list.map((s) => (
                    <li key={s.id} className="flex items-center gap-1">
                      <button type="button" className={rowClass} onClick={() => onOpen(s.id)}>
                        <span className="w-[72px] shrink-0 tabular">{fmtTime(s.at)}</span>
                        <FormatChip format={s.format} />
                        <GameTag moduleId={s.moduleId} className="w-[96px]" />
                        <span className="min-w-0 flex-1 truncate text-muted">
                          {s.title ??
                            (many ? channel(s.channelId) : 'Renders a few hours before it goes live')}
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
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function History({ state, onOpen }: { state: AutopilotState; onOpen: OpenPost }) {
  const done = state.slots
    .filter((s) => ['posted', 'failed', 'skipped'].includes(s.status) && !isScheduledOnYouTube(s))
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
                <GameTag moduleId={s.moduleId} className="w-[96px]" />
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

/** Posts in the next 7 days by game and format ("flag-battle:short" → count), from the live plan. */
function upcomingWeek(state: AutopilotState, channelId?: string): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const s of state.slots) {
    if (s.at < now || s.at > now + 7 * 86_400_000 || s.status === 'skipped' || s.status === 'failed')
      continue;
    if (channelId && s.channelId !== channelId) continue;
    out[`${s.moduleId}:${s.format}`] = (out[`${s.moduleId}:${s.format}`] ?? 0) + 1;
  }
  return out;
}

function ReplanBar({
  dirty,
  busy,
  onReplan,
  onReset,
}: {
  dirty: boolean;
  busy: boolean;
  onReplan: () => void;
  onReset: () => void;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-xl p-3 ring-1',
        dirty ? 'bg-accent/10 ring-accent/40' : 'bg-surface-2/50 ring-line',
      )}
    >
      <p className="min-w-0 flex-1 text-xs text-muted">
        {dirty
          ? 'Changes are not applied yet. Replan to update this week and the calendar.'
          : 'Change the numbers, then replan. Posts already rendering or uploaded are kept.'}
      </p>
      {dirty && (
        <Button size="sm" variant="ghost" onClick={onReset} disabled={busy}>
          Reset
        </Button>
      )}
      <Button size="sm" variant={dirty ? 'primary' : 'secondary'} onClick={onReplan} disabled={busy}>
        {busy ? 'Replanning…' : 'Replan the week'}
      </Button>
    </div>
  );
}

type ChannelDraft = Record<string, Pick<Channel, 'games' | 'dailyCap'>>;

const channelDraftOf = (channels: Channel[]): ChannelDraft =>
  Object.fromEntries(channels.map((c) => [c.id, { games: c.games ?? {}, dailyCap: c.dailyCap }]));

function ScheduleForm({ ap, state }: { ap: Autopilot; state: AutopilotState }) {
  const [draft, setDraft] = useState<ScheduleSettings>(state.schedule);
  const [chDraft, setChDraft] = useState<ChannelDraft>(() => channelDraftOf(state.channels));
  const [post, setPost] = useState<PostSettings>(state.post);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(state.channels[0]?.id ?? '');
  // Edits stay a draft until "Replan the week"; follow the saved settings when they change elsewhere.
  const applied = JSON.stringify(state.schedule);
  const appliedCh = JSON.stringify(channelDraftOf(state.channels));
  useEffect(() => setDraft(JSON.parse(applied) as ScheduleSettings), [applied]);
  useEffect(() => setChDraft(JSON.parse(appliedCh) as ChannelDraft), [appliedCh]);
  const dirty = JSON.stringify(draft) !== applied || JSON.stringify(chDraft) !== appliedCh;
  const apply = (s: ScheduleSettings) => setDraft(s);
  const reset = () => {
    setDraft(state.schedule);
    setChDraft(channelDraftOf(state.channels));
  };
  const replan = async () => {
    setBusy(true);
    try {
      await ap.update(
        {
          schedule: draft,
          channels: state.channels.map((c) => ({ ...c, ...(chDraft[c.id] ?? {}) })),
        },
        { replan: true },
      );
      const snap = ap.snapshot!;
      toast.success('Week re-planned', {
        description: snap.channels
          .filter((c) => c.enabled)
          .map((c) => {
            const week = upcomingWeek(snap, c.id);
            const n = Object.values(week).reduce((a, b) => a + b, 0);
            return `${c.title}: ${n} posts`;
          })
          .join(' · '),
      });
    } finally {
      setBusy(false);
    }
  };
  const applyPost = (p: PostSettings) => {
    setPost(p);
    void ap.update({ post: p });
  };
  const ready = MODULES.filter((m) => m.status === 'ready');
  const channel = state.channels.find((c) => c.id === sel) ?? state.channels[0];
  const cd = channel ? (chDraft[channel.id] ?? { games: {}, dailyCap: 6 }) : null;
  const games = cd ? ready.filter((m) => m.id in cd.games) : [];
  const totals = games.reduce(
    (acc, m) => {
      const p = cd!.games[m.id];
      return { shorts: acc.shorts + p.shortsPerDay, videos: acc.videos + p.videosPerWeek };
    },
    { shorts: 0, videos: 0 },
  );
  const perDayAvg = totals.shorts + totals.videos / 7;
  const overCap = !!cd && perDayAvg > cd.dailyCap;
  const week = channel ? upcomingWeek(state, channel.id) : {};
  // The Google quota is shared by every channel on the same keys.
  const projectPerDay = state.channels
    .filter((c) => c.enabled)
    .reduce((sum, c) => {
      const d = chDraft[c.id];
      if (!d) return sum;
      const asked = Object.values(d.games).reduce((a, p) => a + p.shortsPerDay + p.videosPerWeek / 7, 0);
      return sum + Math.min(d.dailyCap, asked);
    }, 0);
  const setCh = (patch: Partial<Pick<Channel, 'games' | 'dailyCap'>>) =>
    channel && setChDraft({ ...chDraft, [channel.id]: { ...cd!, ...patch } });
  const setPace = (id: string, patch: Partial<ModulePace>) =>
    setCh({ games: { ...cd!.games, [id]: { ...cd!.games[id], ...patch } } });

  return (
    <Card
      title="Schedule"
      note="Every channel posts its own games. Defaults post as often as YouTube's API quota allows while still looking natural."
    >
      <div className="space-y-6">
        <ReplanBar dirty={dirty} busy={busy} onReplan={() => void replan()} onReset={reset} />
        {!channel ? (
          <p className="text-sm text-muted">Connect a channel to set its schedule.</p>
        ) : (
          <div className="space-y-3">
            {state.channels.length > 1 && (
              <label className="block space-y-2 text-[13px] font-medium">
                <span>Channel</span>
                <select
                  value={channel.id}
                  onChange={(e) => setSel(e.target.value)}
                  className="h-10 w-full rounded-xl border border-line-strong bg-bg px-3 text-sm"
                >
                  {state.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                      {c.enabled ? '' : ' (paused)'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-medium">Games on {channel.title}</span>
              <button
                type="button"
                className="text-xs text-muted underline-offset-2 hover:text-text hover:underline"
                onClick={() => navigate('channels')}
              >
                Change games
              </button>
            </div>
            {games.length === 0 && (
              <p className="rounded-xl bg-surface-2/50 p-4 text-sm text-muted ring-1 ring-line">
                No games on this channel yet. Pick them on the Channels page.
              </p>
            )}
            {games.map((m) => {
              const pace = cd!.games[m.id];
              return (
                <div
                  key={m.id}
                  className="space-y-4 rounded-xl bg-surface-2/50 p-4 ring-1 ring-line"
                  style={{ boxShadow: `inset 3px 0 0 ${m.accent}` }}
                >
                  <div className="text-[13px] font-medium" style={{ color: m.accent }}>
                    {m.name}
                  </div>
                  <Stepper
                    label="Shorts"
                    value={pace.shortsPerDay}
                    min={0}
                    max={10}
                    unit="a day"
                    onChange={(v) => setPace(m.id, { shortsPerDay: v })}
                  />
                  <Stepper
                    label="Long videos"
                    value={pace.videosPerWeek}
                    min={0}
                    max={14}
                    unit="a week"
                    onChange={(v) => setPace(m.id, { videosPerWeek: v })}
                  />
                  <p className="text-xs text-muted">
                    Planned for the next 7 days:{' '}
                    <span className="text-text tabular">{week[`${m.id}:short`] ?? 0}</span> Shorts,{' '}
                    <span className="text-text tabular">{week[`${m.id}:video`] ?? 0}</span> long videos
                  </p>
                </div>
              );
            })}
            <Stepper
              label="Daily upload limit"
              hint="for this channel"
              value={cd!.dailyCap}
              min={1}
              max={20}
              unit="a day"
              onChange={(dailyCap) => setCh({ dailyCap })}
            />
            <p className="text-xs text-muted">
              Together: {totals.shorts} Shorts a day and {totals.videos} long videos a week on this channel
              (about {perDayAvg.toFixed(1)} posts a day). Its games share one timeline, so posts never
              overlap, keep the minimum gap, and alternate between games.
            </p>
            {overCap && (
              <p className="rounded-xl bg-hp-mid/10 p-3 text-xs text-hp-mid ring-1 ring-hp-mid/30">
                That is more than this channel&apos;s daily upload limit of {cd!.dailyCap}. Each day keeps{' '}
                {cd!.dailyCap} posts, trimmed fairly from the busiest game, so raising a game above this
                changes nothing. Lower another game, or raise the limit.
              </p>
            )}
            <p
              className={cn(
                'text-xs',
                projectPerDay > PROJECT_UPLOADS_PER_DAY + 0.01 ? 'text-hp-mid' : 'text-muted',
              )}
            >
              All channels together: about {projectPerDay.toFixed(1)} uploads a day. Your Google project
              allows about {PROJECT_UPLOADS_PER_DAY} a day (10,000 API units, about 1,600 per upload); above
              that, uploads wait for the daily reset. Ask Google for more quota to go higher.
            </p>
          </div>
        )}
        <div className="text-[13px] font-medium">Timing (all channels)</div>
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
        <ReplanBar dirty={dirty} busy={busy} onReplan={() => void replan()} onReset={reset} />

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
            label="Made for kids (suitable for everyone)"
            description="On by default. YouTube then turns off comments, notifications and personalised ads on these videos, so they never ask viewers to comment. Turn off to allow comments."
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
  const [game, setGame] = useState('');
  useEffect(() => {
    if (!channelId && state.channels[0]) setChannelId(state.channels[0].id);
  }, [channelId, state.channels]);
  const ch = state.channels.find((c) => c.id === channelId);
  const games = ch ? MODULES.filter((m) => m.status === 'ready' && m.id in (ch.games ?? {})) : [];
  const gameId = games.some((m) => m.id === game) ? game : games[0]?.id;
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
          {games.length > 1 && (
            <label className="block space-y-2 text-[13px] font-medium">
              <span>Game</span>
              <select
                value={gameId}
                onChange={(e) => setGame(e.target.value)}
                className="h-10 w-full rounded-xl border border-line-strong bg-bg px-3 text-sm"
              >
                {games.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Popover.Close asChild>
            <Button
              variant="primary"
              className="w-full justify-center"
              disabled={!gameId}
              onClick={() => {
                toast('Rendering your post. It uploads as soon as it is ready.');
                void ap.postNow(channelId, format, gameId);
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
