/**
 * Dashboard data cache plus channel snapshots. Totals are saved every few hours while the app
 * runs, which is what draws the growth charts (the YouTube Data API only gives current totals).
 */
import type { Autopilot } from '../autopilot/engine';
import { addSnapshot } from './insights';
import { fetchChannel, fetchUploads, type ChannelInfo, type VideoStat } from './youtube';

export type DashboardData = { at: number; channel: ChannelInfo; videos: VideoStat[] };

const cache = new Map<string, DashboardData>();
const FRESH_MS = 15 * 60_000;

async function snapshot(ap: Autopilot, channel: ChannelInfo): Promise<void> {
  const st = ap.snapshot;
  if (!st || channel.hiddenSubs) return;
  const points = addSnapshot(st.stats[channel.id] ?? [], {
    t: Date.now(),
    subs: channel.subs,
    views: channel.views,
    videos: channel.videos,
  });
  await ap.update({ stats: { ...st.stats, [channel.id]: points } });
}

export function cachedDashboard(channelId: string): DashboardData | null {
  return cache.get(channelId) ?? null;
}

/** Loads (or reuses, if fresh) the channel totals and latest uploads. */
export async function loadDashboard(ap: Autopilot, channelId: string, force = false): Promise<DashboardData> {
  const hit = cache.get(channelId);
  if (hit && !force && Date.now() - hit.at < FRESH_MS) return hit;
  const st = ap.snapshot!;
  const channel = await fetchChannel(st, channelId);
  await snapshot(ap, channel);
  const videos = await fetchUploads(st, channel);
  const data = { at: Date.now(), channel, videos };
  cache.set(channelId, data);
  return data;
}

/** Saves a snapshot for every connected channel (cheap: one API unit each). */
export async function snapshotAll(ap: Autopilot): Promise<void> {
  const st = ap.snapshot;
  if (!st?.google.clientId) return;
  for (const ch of st.channels.filter((c) => !c.platform || c.platform === 'youtube')) {
    try {
      await snapshot(ap, await fetchChannel(st, ch.id));
    } catch {
      // Offline or signed out: try again next time.
    }
  }
}
