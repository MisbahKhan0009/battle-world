import { Info, Plus, Unplug } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/Dialog';
import { desktop, isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { navigate } from '../router';
import { Card, DesktopLayout, DesktopOnly } from './Layout';

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
        { channels: [...others, { ...info, connectedAt: Date.now(), enabled: true }] },
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
          <ul className="space-y-3">
            {state.channels.map((c) => (
              <li key={c.id} className="panel flex items-center gap-4 p-4">
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
                <div className="w-[210px]">
                  <Toggle
                    label="Autopilot posts here"
                    checked={c.enabled}
                    onChange={(enabled) =>
                      void ap.update(
                        { channels: state.channels.map((x) => (x.id === c.id ? { ...x, enabled } : x)) },
                        { replan: true },
                      )
                    }
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Disconnect ${c.title}`}
                  onClick={() => setConfirm(c.id)}
                >
                  <Unplug size={16} />
                </Button>
              </li>
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
