import { Info, Plus, Unplug } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Stepper, Toggle } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/Dialog';
import {
  connectedChannel,
  DEFAULT_PACE,
  GAMES_PER_CHANNEL,
  PROJECT_UPLOADS_PER_DAY,
  type Channel,
} from '../../autopilot/types';
import { desktop, isDesktop } from '../../desktop/bridge';
import { cn } from '../../lib/utils';
import { MODULES, readyModuleIds } from '../../modules/registry';
import { useAutopilot } from '../../desktop/runtime';
import { navigate } from '../router';
import { Card, DesktopLayout, DesktopOnly } from './Layout';

function QuotaBanner({ channels }: { channels: Channel[] }) {
  const active = channels.filter((c) => c.enabled);
  const perDay = active.reduce((sum, c) => {
    const asked = Object.values(c.games ?? {}).reduce((a, p) => a + p.shortsPerDay + p.videosPerWeek / 7, 0);
    return sum + Math.min(c.dailyCap, asked);
  }, 0);
  const over = perDay > PROJECT_UPLOADS_PER_DAY + 0.01;
  return (
    <div
      className={cn(
        'rounded-2xl p-4 text-[13px] ring-1',
        over ? 'bg-hp-mid/10 text-hp-mid ring-hp-mid/30' : 'bg-surface-2/60 text-muted ring-line',
      )}
    >
      <span className={over ? '' : 'text-text'}>
        About {perDay.toFixed(1)} uploads a day across {active.length} channel{active.length === 1 ? '' : 's'}
        .
      </span>{' '}
      All channels use your one Google project, which allows about {PROJECT_UPLOADS_PER_DAY} uploads a day
      (10,000 API units).{' '}
      {over
        ? 'Above that, uploads wait for the daily reset and fall behind. Lower some paces or daily limits, or request more quota from Google.'
        : 'You are within it.'}
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
          <div className="truncate font-medium">{c.title}</div>
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
          <span className={cn('text-xs', count === GAMES_PER_CHANNEL ? 'text-muted' : 'text-hp-mid')}>
            {count === GAMES_PER_CHANNEL
              ? `${count} games`
              : `${count} game${count === 1 ? '' : 's'}, ${GAMES_PER_CHANNEL} per channel works best`}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {MODULES.map((m) => {
            const on = m.id in games;
            const ready = m.status === 'ready';
            const elsewhere = all.filter((x) => x.id !== c.id && m.id in (x.games ?? {})).map((x) => x.title);
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
          Set how often each game posts on the Autopilot page. Giving every channel its own games keeps each
          channel's identity clear for viewers and YouTube.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-4">
        <div className="min-w-[280px] flex-1">
          <Stepper
            label="Daily upload limit"
            value={c.dailyCap}
            min={1}
            max={20}
            unit="a day"
            onChange={(dailyCap) => onChange({ ...c, dailyCap })}
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => navigate('autopilot', c.id)}>
          Edit schedule
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate('dashboard')}>
          Dashboard
        </Button>
      </div>
    </li>
  );
}

export function ChannelsPage() {
  const { ap, state } = useAutopilot();
  const [connecting, setConnecting] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  if (!isDesktop()) {
    return (
      <DesktopLayout title="Channels">
        <DesktopOnly feature="Posting to YouTube" />
      </DesktopLayout>
    );
  }
  if (!ap || !state) {
    return (
      <DesktopLayout title="Channels">
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
      title="Channels"
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
            <QuotaBanner channels={state.channels} />
            <ul className="space-y-4">
              {state.channels.map((c) => (
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
              await desktop.disconnectChannel(target.id).catch(() => undefined);
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
