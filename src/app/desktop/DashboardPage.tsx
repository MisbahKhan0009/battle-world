import { ArrowDownRight, ArrowUpRight, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import {
  byGame,
  byHour,
  change,
  compact,
  engagementRate,
  enrich,
  median,
  type Enriched,
} from '../../dashboard/insights';
import { cachedDashboard, loadDashboard, type DashboardData } from '../../dashboard/store';
import { desktop, isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { cn } from '../../lib/utils';
import { MODULES, moduleById } from '../../modules/registry';
import { navigate } from '../router';
import { BarChart, HBars, LineChart } from './charts';
import { Card, DesktopLayout, DesktopOnly } from './Layout';
import { FormatChip, GameTag, youtubeUrl } from './posts';

const OTHER = '#8A93A6';
const full = (n: number) => Math.round(n).toLocaleString();
const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

function Kpi({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
}) {
  return (
    <div className="panel p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-display text-4xl leading-none tabular">{value}</div>
      <div className="mt-2 flex items-center gap-1 text-xs text-muted">
        {delta !== undefined && delta !== null ? (
          <>
            {delta > 0 ? (
              <ArrowUpRight size={14} className="text-hp-high" aria-hidden />
            ) : delta < 0 ? (
              <ArrowDownRight size={14} className="text-danger" aria-hidden />
            ) : null}
            <span className="tabular text-text">
              {delta > 0 ? '+' : ''}
              {compact(delta)}
            </span>{' '}
            in 7 days
          </>
        ) : (
          (hint ?? '')
        )}
      </div>
    </div>
  );
}

function TopVideos({ videos }: { videos: Enriched[] }) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead className="text-xs text-muted">
          <tr>
            <th className="px-2 py-2 font-normal">Video</th>
            <th className="px-2 py-2 font-normal">Game</th>
            <th className="px-2 py-2 text-right font-normal">Views</th>
            <th className="px-2 py-2 text-right font-normal">Per day</th>
            <th className="px-2 py-2 text-right font-normal">Likes</th>
            <th className="px-2 py-2 text-right font-normal">Comments</th>
            <th className="px-2 py-2 text-right font-normal">vs typical</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {videos.map((v) => (
            <tr key={v.id}>
              <td className="px-2 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  {v.thumbnail ? (
                    <img
                      src={v.thumbnail}
                      alt=""
                      className="h-10 w-[72px] shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="h-10 w-[72px] shrink-0 rounded-md bg-surface-3" />
                  )}
                  <div className="min-w-0">
                    <div className="max-w-[340px] truncate">{v.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <FormatChip format={v.format} className="h-5" />
                      {new Date(v.publishedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-2 py-2">
                {v.moduleId ? (
                  <GameTag moduleId={v.moduleId} />
                ) : (
                  <span className="text-xs text-muted">Not by autopilot</span>
                )}
              </td>
              <td className="px-2 py-2 text-right tabular">{full(v.views)}</td>
              <td className="px-2 py-2 text-right tabular text-muted">{compact(v.viewsPerDay)}</td>
              <td className="px-2 py-2 text-right tabular text-muted">{full(v.likes)}</td>
              <td className="px-2 py-2 text-right tabular text-muted">{full(v.comments)}</td>
              <td className="px-2 py-2 text-right">
                <span
                  className={cn(
                    'rounded-md px-1.5 py-0.5 text-xs tabular',
                    v.vsTypical >= 1.5
                      ? 'bg-hp-high/15 text-hp-high'
                      : v.vsTypical < 0.6
                        ? 'bg-surface-3 text-muted'
                        : 'text-text',
                  )}
                >
                  {v.vsTypical.toFixed(1)}×
                </span>
              </td>
              <td className="px-2 py-2 text-right">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Open ${v.title} on YouTube`}
                  onClick={() => void desktop.openUrl(youtubeUrl(v))}
                >
                  <ExternalLink size={14} />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardPage() {
  const { ap, state } = useAutopilot();
  const channels = state?.channels ?? [];
  const [channelId, setChannelId] = useState<string>('');
  const id = channelId || channels[0]?.id || '';
  const [data, setData] = useState<DashboardData | null>(() => (id ? cachedDashboard(id) : null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (force: boolean) => {
      if (!ap || !id) return;
      setBusy(true);
      setError(null);
      try {
        setData(await loadDashboard(ap, id, force));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [ap, id],
  );
  useEffect(() => {
    setData(id ? cachedDashboard(id) : null);
    void refresh(false);
  }, [id, refresh]);

  // "Now" moves with each load, so memoized numbers stay stable between renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [data]);
  const videos = useMemo(
    () => (data && state ? enrich(data.videos, state.slots, now) : []),
    [data, state, now],
  );
  const points = state?.stats[id] ?? [];

  if (!isDesktop()) {
    return (
      <DesktopLayout title="Dashboard">
        <DesktopOnly feature="The channel dashboard" />
      </DesktopLayout>
    );
  }
  if (!ap || !state) {
    return (
      <DesktopLayout title="Dashboard">
        <p className="text-sm text-muted">Starting…</p>
      </DesktopLayout>
    );
  }
  if (!channels.length) {
    return (
      <DesktopLayout title="Dashboard">
        <Card title="No channel yet">
          <p className="text-sm text-muted">Connect your YouTube channel to see its numbers here.</p>
          <Button className="mt-4" variant="primary" onClick={() => navigate('setup')}>
            Open the setup guide
          </Button>
        </Card>
      </DesktopLayout>
    );
  }

  const live = videos.filter((v) => v.live);
  const shorts = live.filter((v) => v.format === 'short');
  const longs = live.filter((v) => v.format === 'video');
  const recent = [...live].reverse().slice(-30);
  const typicalShort = median(shorts.map((v) => v.views));
  const games = byGame(videos);
  const hours = byHour(videos);
  const bestHours = [...hours]
    .filter((h) => h.median > 0)
    .sort((a, b) => b.median - a.median)
    .slice(0, 3);
  const top = [...live].sort((a, b) => b.views - a.views).slice(0, 10);
  const scheduled = videos.filter((v) => v.publishAt && v.publishAt > now).length;
  const ready = MODULES.filter((m) => m.status === 'ready');
  const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });

  return (
    <DesktopLayout
      title="Dashboard"
      actions={
        <div className="flex items-center gap-2">
          {channels.length > 1 && (
            <select
              value={id}
              onChange={(e) => setChannelId(e.target.value)}
              aria-label="Channel"
              className="h-9 rounded-xl border border-line-strong bg-bg px-3 text-sm"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          <Button variant="ghost" onClick={() => void refresh(true)} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Refresh
          </Button>
          <Button
            variant="secondary"
            onClick={() => void desktop.openUrl(`https://studio.youtube.com/channel/${id}`)}
          >
            YouTube Studio <ExternalLink size={14} />
          </Button>
        </div>
      }
    >
      <div className="mx-auto max-w-[1300px] space-y-5">
        {error && (
          <div className="panel flex flex-wrap items-center gap-3 p-4 text-sm ring-1 ring-danger/40">
            <span className="text-danger">Could not load the channel: {error}</span>
            <Button size="sm" variant="secondary" onClick={() => void refresh(true)}>
              Try again
            </Button>
          </div>
        )}
        {!data ? (
          <p className="py-16 text-center text-sm text-muted">
            {busy ? 'Loading your channel…' : 'No data yet.'}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {data.channel.thumbnail && (
                <img src={data.channel.thumbnail} alt="" className="h-11 w-11 rounded-full" />
              )}
              <div>
                <div className="font-display text-3xl leading-none">{data.channel.title}</div>
                <div className="mt-1 text-xs text-muted">
                  Updated {ago(data.at)} · {live.length} public videos loaded
                  {scheduled ? ` · ${scheduled} scheduled on YouTube` : ''}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Kpi
                label="Subscribers"
                value={
                  data.channel.hiddenSubs
                    ? 'Hidden'
                    : data.channel.subs < 1e6
                      ? full(data.channel.subs)
                      : compact(data.channel.subs)
                }
                delta={change(points, 'subs', 7, now)}
                hint="Change appears after a day of tracking"
              />
              <Kpi
                label="Total views"
                value={compact(data.channel.views)}
                delta={change(points, 'views', 7, now)}
                hint="Change appears after a day of tracking"
              />
              <Kpi
                label="Videos"
                value={compact(data.channel.videos)}
                delta={change(points, 'videos', 7, now)}
                hint=""
              />
              <Kpi
                label="Typical Short"
                value={compact(typicalShort)}
                hint={`median views of ${shorts.length} Shorts`}
              />
              <Kpi
                label="Engagement"
                value={`${(engagementRate(videos) * 100).toFixed(1)}%`}
                hint="likes and comments per view"
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {(['subs', 'views'] as const).map((k) => (
                <Card key={k} title={k === 'subs' ? 'Subscribers over time' : 'Total views over time'}>
                  {points.length >= 2 ? (
                    <LineChart
                      points={points.map((p) => ({ t: p.t, v: p[k] }))}
                      format={compact}
                      label={k === 'subs' ? 'Subscribers' : 'Views'}
                    />
                  ) : (
                    <p className="py-10 text-center text-sm text-muted">
                      Flag Clash saves your totals every 3 hours while it runs. The chart appears after the
                      next few.
                    </p>
                  )}
                </Card>
              ))}
            </div>

            <Card
              title="Latest uploads"
              note="Views of your last 30 public uploads, oldest on the left, colored by game. The dashed line is your typical Short."
            >
              {recent.length ? (
                <>
                  <BarChart
                    bars={recent.map((v) => ({
                      key: v.id,
                      label: new Date(v.publishedAt).toLocaleDateString([], {
                        month: 'numeric',
                        day: 'numeric',
                      }),
                      value: v.views,
                      color: v.moduleId ? moduleById(v.moduleId)?.accent : OTHER,
                      tip: (
                        <>
                          <div className="line-clamp-2 text-text">{v.title}</div>
                          <div className="mt-1 tabular text-muted">
                            {full(v.views)} views · {full(v.likes)} likes · {v.vsTypical.toFixed(1)}× typical
                          </div>
                        </>
                      ),
                    }))}
                    label="Views of the latest uploads"
                    reference={{ value: typicalShort, label: `typical Short ${compact(typicalShort)}` }}
                    labelEvery={Math.ceil(recent.length / 10)}
                  />
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
                    {ready.map((m) => (
                      <span key={m.id} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: m.accent }} />
                        {m.name}
                      </span>
                    ))}
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: OTHER }} />
                      Other uploads
                    </span>
                  </div>
                </>
              ) : (
                <p className="py-8 text-center text-sm text-muted">No public uploads yet.</p>
              )}
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card
                title="Which game performs best"
                note="Average views per video the autopilot posted, by game and format."
              >
                {games.length ? (
                  <HBars
                    rows={games
                      .sort((a, b) => b.avgViews - a.avgViews)
                      .map((g) => {
                        const [mod, format] = g.key.split(':');
                        const m = moduleById(mod);
                        return {
                          key: g.key,
                          label: (
                            <span className="flex items-center gap-2">
                              <GameTag moduleId={mod} />
                              <span className="text-muted">
                                {format === 'short' ? 'Shorts' : 'Long videos'}
                              </span>
                            </span>
                          ),
                          value: g.avgViews,
                          color: m?.accent ?? OTHER,
                          note: `${g.count} posted · ${(g.engagement * 100).toFixed(1)}% engagement`,
                        };
                      })}
                    format={compact}
                  />
                ) : (
                  <p className="py-8 text-center text-sm text-muted">
                    Appears once the autopilot has posted public videos.
                  </p>
                )}
              </Card>
              <Card
                title="Best hours to post"
                note={
                  bestHours.length
                    ? `Your Shorts do best around ${bestHours.map((h) => hourLabel(h.hour)).join(', ')} (median views by the hour they went live).`
                    : 'Median views of your Shorts by the hour they went live. Needs a few posts per hour.'
                }
              >
                {bestHours.length ? (
                  <BarChart
                    bars={hours.map((h) => ({
                      key: String(h.hour),
                      label: hourLabel(h.hour),
                      value: h.median,
                      dim: !bestHours.some((b) => b.hour === h.hour),
                      tip: (
                        <>
                          <div className="text-text">{hourLabel(h.hour)}</div>
                          <div className="mt-1 tabular text-muted">
                            {h.count
                              ? `${compact(h.median)} median views · ${h.count} Shorts`
                              : 'No Shorts at this hour yet'}
                          </div>
                        </>
                      ),
                    }))}
                    label="Median Short views by posting hour"
                    labelEvery={3}
                  />
                ) : (
                  <p className="py-8 text-center text-sm text-muted">Not enough Shorts yet.</p>
                )}
              </Card>
            </div>

            <Card
              title="Top videos"
              note={`Your ${top.length} most viewed public videos among the latest uploads.`}
            >
              {top.length ? (
                <TopVideos videos={top} />
              ) : (
                <p className="py-8 text-center text-sm text-muted">No public uploads yet.</p>
              )}
            </Card>

            <div className="grid gap-3 sm:grid-cols-3">
              <Kpi
                label="Shorts loaded"
                value={String(shorts.length)}
                hint={`${compact(shorts.reduce((s, v) => s + v.views, 0))} views in total`}
              />
              <Kpi
                label="Long videos loaded"
                value={String(longs.length)}
                hint={`${compact(longs.reduce((s, v) => s + v.views, 0))} views in total`}
              />
              <Kpi
                label="Posted by the autopilot (7 days)"
                value={String(
                  state.slots.filter((s) => s.status === 'posted' && (s.postedAt ?? 0) > now - 7 * 86_400_000)
                    .length,
                )}
                hint={`${state.slots.filter((s) => s.status === 'failed' && s.at > now - 7 * 86_400_000).length} failed`}
              />
            </div>
          </>
        )}
      </div>
    </DesktopLayout>
  );
}
