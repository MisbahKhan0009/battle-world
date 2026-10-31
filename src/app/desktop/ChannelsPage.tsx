import { Info, Plus, Unplug } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Stepper, Toggle } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/Dialog';
import {
  connectedChannel,
  DEFAULT_PACE,
  PLATFORM_NAME,
  platformOf,
  PROJECT_UPLOADS_PER_DAY,
  type AutopilotState,
  type Channel,
  type ScheduleSettings,
} from '../../autopilot/types';
import { desktop, isDesktop } from '../../desktop/bridge';
import { cn } from '../../lib/utils';
import { MODULES, readyModuleIds } from '../../modules/registry';
import { useAutopilot } from '../../desktop/runtime';
import { navigate } from '../router';
import { Card, DesktopLayout, DesktopOnly } from './Layout';
import { MetaConnect } from './MetaPlatforms';

/** Uploads a day the channels' paces ask for (within each channel's own limit). */
export function askedPerDay(channels: Channel[], schedule: ScheduleSettings): number {
  return channels
    .filter((c) => c.enabled && platformOf(c) === 'youtube')
    .reduce((sum, c) => {
      const games = Object.values(c.games ?? {});
      const asked =
        games.reduce(
          (a, p) => a + p.shortsPerDay + (schedule.longPerDay === undefined ? p.videosPerWeek / 7 : 0),
          0,
        ) + (schedule.longPerDay !== undefined && games.length ? schedule.longPerDay : 0);
      return sum + Math.min(c.dailyCap, asked);
    }, 0);
}

function QuotaCard({ state, onCap }: { state: AutopilotState; onCap: (cap: number) => void }) {
  const active = state.channels.filter((c) => c.enabled && platformOf(c) === 'youtube');
  const cap = state.schedule.projectCap ?? PROJECT_UPLOADS_PER_DAY;
  const asked = askedPerDay(state.channels, state.schedule);
  const trimmed = asked > cap + 0.01;
  return (
    <div className="panel space-y-3 p-5">
      <Stepper
        label="Uploads a day, all channels"
        hint="shared by every channel"
        value={cap}
        min={1}
        max={PROJECT_UPLOADS_PER_DAY}
        unit="a day"
        onChange={onCap}
      />
      <p className="text-[13px] text-muted">
        Your channels ask for about <span className="text-text tabular">{asked.toFixed(1)}</span> uploads a
        day
        {active.length > 1 ? ` across ${active.length} channels` : ''}.{' '}
        {trimmed
          ? `The limit keeps the total at ${cap} a day, shared fairly between the channels (about ${(cap / Math.max(1, active.length)).toFixed(1)} each) and, within each channel, between its games.`
          : `That is within the limit of ${cap} a day.`}{' '}
        All channels use one Google project, which can upload {PROJECT_UPLOADS_PER_DAY} videos a day
        (YouTube's upload quota). Custom thumbnails come out of a separate 10,000-unit pool, 50 each. That is
        plenty to prepare days or weeks ahead.
      </p>
    </div>
  );
}

function ChannelCard({
  channel: c,
  all,
  onChange,
  onDisconnect,
}: {
  channel: Channel;
  all: Channel[];
  onChange: (next: Channel) => void;
  onDisconnect: () => void;
}) {
  const games = c.games ?? {};
  const count = Object.keys(games).length;
  const toggleGame = (id: string) => {
    const next = { ...games };
    if (id in next) delete next[id];
    else next[id] = { ...(DEFAULT_PACE[id] ?? { shortsPerDay: 2, videosPerWeek: 2 }) };
    onChange({ ...c, games: next });
  };
  return (
    <li className="panel space-y-4 p-5">
      <div className="flex items-center gap-4">
        {c.thumbnail ? (
          <img
            src={c.thumbnail}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="h-12 w-12 rounded-full bg-surface-3" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{c.title}</span>
            <span className="shrink-0 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-muted">
              {PLATFORM_NAME[platformOf(c)]}
            </span>
          </div>
          <div className="text-xs text-muted tabular">
            {c.subscribers !== undefined ? `${c.subscribers.toLocaleString()} subscribers, ` : ''}
            connected {new Date(c.connectedAt).toLocaleDateString()}
          </div>
        </div>
        <div className="w-[200px]">
          <Toggle
            label="Autopilot posts here"
            checked={c.enabled}
            onChange={(enabled) => onChange({ ...c, enabled })}
          />
        </div>
        <Button size="icon" variant="ghost" aria-label={`Disconnect ${c.title}`} onClick={onDisconnect}>
          <Unplug size={16} />
        </Button>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium">Games on this channel</span>
          <span className="flex items-center gap-3 text-xs text-muted">
            {count} game{count === 1 ? '' : 's'}
            {count < readyModuleIds().length && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  onChange({
                    ...c,
                    games: Object.fromEntries(
                      readyModuleIds().map((id) => [
                        id,
                        games[id] ?? { ...(DEFAULT_PACE[id] ?? { shortsPerDay: 1, videosPerWeek: 1 }) },
                      ]),
                    ),
                  })
                }
              >
                Post every game here
              </Button>
            )}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {MODULES.map((m) => {
            const on = m.id in games;
            const ready = m.status === 'ready';
            const elsewhere = all
              .filter((x) => x.id !== c.id && platformOf(x) === platformOf(c) && m.id in (x.games ?? {}))
              .map((x) => x.title);
            return (
              <button
                key={m.id}
                type="button"
                disabled={!ready}
                aria-pressed={on}
                onClick={() => toggleGame(m.id)}
                title={elsewhere.length ? `Also on ${elsewhere.join(', ')}` : undefined}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] ring-1 transition-colors',
                  on ? 'bg-surface-3 text-text' : 'text-muted ring-line hover:text-text',
                  !ready && 'cursor-not-allowed opacity-50 hover:text-muted',
                )}
                style={on ? { boxShadow: `inset 0 0 0 1.5px ${m.accent}` } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: m.accent }} />
                {m.name}
                {!ready && <span className="text-[11px]">soon</span>}
                {ready && elsewhere.length > 0 && (
                  <span className="text-[11px] text-muted">also elsewhere</span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          Every game on this channel posts its Shorts each day, and the long video of the day takes turns
          between them. Set how many Shorts each game posts on the Autopilot page.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-4">
        <div className="min-w-[280px] flex-1">
          <Stepper
            label="Daily upload limit"
            value={c.dailyCap}
            min={1}
            max={50}
            unit="a day"
            onChange={(dailyCap) => onChange({ ...c, dailyCap })}
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => navigate('autopilot', c.id)}>
          Edit schedule
        </Button>
        {platformOf(c) === 'youtube' && (
          <Button size="sm" variant="ghost" onClick={() => navigate('dashboard')}>
            Dashboard
          </Button>
        )}
      </div>
      {platformOf(c) !== 'youtube' && (
        <div className="grid gap-x-6 gap-y-3 border-t border-line pt-4 md:grid-cols-2">
          <Toggle
            label="Post the YouTube videos"
            description="Uses the YouTube channel's video of the same kind from the same days, so nothing renders twice. Off: it renders its own."
            checked={c.reuseYouTube !== false}
            onChange={(reuseYouTube) => onChange({ ...c, reuseYouTube })}
          />
          <Stepper
            label="Long videos"
            hint={platformOf(c) === 'instagram' ? 'Reels are made for Shorts' : 'the games take turns'}
            value={c.longPerDay ?? 1}
            min={0}
            max={3}
            unit="a day"
            onChange={(longPerDay) => onChange({ ...c, longPerDay })}
          />
        </div>
      )}
    </li>
  );
}

export function ChannelsPage() {
  const { ap, state } = useAutopilot();
  const [connecting, setConnecting] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  if (!isDesktop()) {
    return (
      <DesktopLayout title="Platforms">
        <DesktopOnly feature="Posting to YouTube" />
      </DesktopLayout>
    );
  }
  if (!ap || !state) {
    return (
      <DesktopLayout title="Platforms">
        <p className="text-sm text-muted">Starting…</p>
      </DesktopLayout>
    );
  }
  const hasCreds = !!(state.google.clientId && state.google.clientSecret);

  const connect = async () => {
    setConnecting(true);
    try {
      const info = await desktop.connectChannel(state.google.clientId, state.google.clientSecret);
      const others = state.channels.filter((c) => c.id !== info.id);
      await ap.update(
        { channels: [...others, connectedChannel(info, state.channels, readyModuleIds())] },
        { replan: true },
      );
      toast.success(`Connected ${info.title}`);
    } catch (err) {
      toast.error(String(err).replace(/^youtube:\w+:\s*/, ''));
    } finally {
      setConnecting(false);
    }
  };

  const target = state.channels.find((c) => c.id === confirm);

  return (
    <DesktopLayout
      title="Platforms"
      actions={
        <Button variant="primary" onClick={connect} disabled={!hasCreds || connecting}>
          <Plus size={15} /> {connecting ? 'Finish signing in in your browser…' : 'Connect a YouTube channel'}
        </Button>
      }
    >
      <div className="max-w-[880px] space-y-5">
        {!hasCreds && (
          <Card>
            <div className="flex items-start gap-3">
              <Info size={18} className="mt-0.5 shrink-0 text-accent" />
              <div className="flex-1 text-sm">
                <p>
                  Connecting a channel needs your own Google API keys. The setup guide shows every click and
                  takes about five minutes.
                </p>
                <Button size="sm" className="mt-3" onClick={() => navigate('setup')}>
                  Open the setup guide
                </Button>
              </div>
            </div>
          </Card>
        )}

        {state.channels.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong p-10 text-center text-sm text-muted">
            No channels yet. Connect one and the autopilot starts planning posts for it.
          </p>
        ) : (
          <>
            <QuotaCard
              state={state}
              onCap={(projectCap) =>
                void ap.update({ schedule: { ...state.schedule, projectCap } }, { replan: true })
              }
            />
            <ul className="space-y-4">
              {state.channels
                .filter((c) => platformOf(c) === 'youtube')
                .map((c) => (
                  <ChannelCard
                    key={c.id}
                    channel={c}
                    all={state.channels}
                    onChange={(next) =>
                      void ap.update(
                        { channels: state.channels.map((x) => (x.id === c.id ? next : x)) },
                        { replan: true },
                      )
                    }
                    onDisconnect={() => setConfirm(c.id)}
                  />
                ))}
            </ul>
          </>
        )}

        <MetaConnect ap={ap} state={state} />
        {state.channels.some((c) => platformOf(c) !== 'youtube') && (
          <ul className="space-y-4">
            {state.channels
              .filter((c) => platformOf(c) !== 'youtube')
              .map((c) => (
                <ChannelCard
                  key={c.id}
                  channel={c}
                  all={state.channels}
                  onChange={(next) =>
                    void ap.update(
                      { channels: state.channels.map((x) => (x.id === c.id ? next : x)) },
                      { replan: true },
                    )
                  }
                  onDisconnect={() => setConfirm(c.id)}
                />
              ))}
          </ul>
        )}

        <Card title="Good to know">
          <ul className="list-disc space-y-2 pl-5 text-[13px] text-muted">
            <li>
              Google keeps uploads from a new, unaudited API project{' '}
              <strong className="text-text">private</strong>. To publish publicly, request YouTube's API audit
              for your Google Cloud project (free, see Settings).
            </li>
            <li>
              Your login is stored in your operating system's secure credential store, never in plain
              settings.
            </li>
            <li>
              Vary your content. YouTube may limit monetization for repetitive, mass-produced videos. The
              autopilot rotates rosters, modes, themes and titles for you.
            </li>
          </ul>
        </Card>
      </div>

      <Dialog
        open={!!target}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Disconnect channel"
        description={
          target ? `Flag Clash will stop posting to ${target.title} and revoke its access.` : undefined
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Keep connected
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!target) return;
              if (platformOf(target) === 'youtube')
                await desktop.disconnectChannel(target.id).catch(() => undefined);
              // The Page token goes once no account of that Page is left.
              else if (!state.channels.some((x) => x.id !== target.id && x.pageId === target.pageId))
                await desktop.metaDisconnect(target.pageId ?? target.id).catch(() => undefined);
              await ap.update(
                {
                  channels: state.channels.filter((x) => x.id !== target.id),
                  slots: state.slots.filter(
                    (s) => s.channelId !== target.id || ['posted', 'failed', 'skipped'].includes(s.status),
                  ),
                },
                { replan: true },
              );
              setConfirm(null);
              toast(`Disconnected ${target.title}`);
            }}
          >
            Disconnect
          </Button>
        </div>
      </Dialog>
    </DesktopLayout>
  );
}
