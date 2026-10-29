/**
 * Dashboard data from the YouTube Data API (read-only, about 7 quota units per refresh):
 * channel totals, and the latest uploads with their statistics.
 */
import type { AutopilotState } from '../autopilot/types';
import { desktop } from '../desktop/bridge';

export type ChannelInfo = {
  id: string;
  title: string;
  thumbnail: string;
  subs: number;
  views: number;
  videos: number;
  hiddenSubs: boolean;
  uploads: string;
};

export type VideoStat = {
  id: string;
  title: string;
  publishedAt: number;
  durationSec: number;
  views: number;
  likes: number;
  comments: number;
  thumbnail: string;
  privacy: string;
  /** Scheduled publish time for uploads YouTube has not published yet. */
  publishAt?: number;
  madeForKids: boolean;
};

type Json = Record<string, unknown>;

async function get(
  state: AutopilotState,
  channelId: string,
  endpoint: 'channels' | 'playlistItems' | 'videos',
  query: Record<string, string>,
): Promise<Json> {
  const text = await desktop.apiGet({
    channelId,
    clientId: state.google.clientId,
    clientSecret: state.google.clientSecret,
    endpoint,
    query: Object.entries(query),
  });
  return JSON.parse(text) as Json;
}

const num = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? Number(v) || 0 : 0);

/** ISO 8601 duration (PT1H2M3S) to seconds. */
export function parseDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso ?? '');
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

export async function fetchChannel(state: AutopilotState, channelId: string): Promise<ChannelInfo> {
  const res = await get(state, channelId, 'channels', {
    part: 'snippet,statistics,contentDetails',
    id: channelId,
  });
  const item = (res.items as Json[] | undefined)?.[0];
  if (!item) throw new Error('YouTube did not return this channel.');
  const sn = item.snippet as Json;
  const st = item.statistics as Json;
  const cd = item.contentDetails as Json;
  const thumbs = sn.thumbnails as Record<string, { url: string }> | undefined;
  return {
    id: channelId,
    title: String(sn.title ?? ''),
    thumbnail: thumbs?.medium?.url ?? thumbs?.default?.url ?? '',
    subs: num(st.subscriberCount),
    views: num(st.viewCount),
    videos: num(st.videoCount),
    hiddenSubs: !!st.hiddenSubscriberCount,
    uploads: String((cd.relatedPlaylists as Json)?.uploads ?? ''),
  };
}

/** The newest `limit` uploads (including private and scheduled ones) with their statistics. */
export async function fetchUploads(
  state: AutopilotState,
  channel: ChannelInfo,
  limit = 150,
): Promise<VideoStat[]> {
  const ids: string[] = [];
  let page = '';
  while (ids.length < limit && channel.uploads) {
    const res = await get(state, channel.id, 'playlistItems', {
      part: 'contentDetails',
      playlistId: channel.uploads,
      maxResults: '50',
      ...(page ? { pageToken: page } : {}),
    });
    for (const it of (res.items as Json[] | undefined) ?? [])
      ids.push(String((it.contentDetails as Json).videoId));
    page = String(res.nextPageToken ?? '');
    if (!page) break;
  }
  const out: VideoStat[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const res = await get(state, channel.id, 'videos', {
      part: 'snippet,statistics,contentDetails,status',
      id: ids.slice(i, i + 50).join(','),
      maxResults: '50',
    });
    for (const v of (res.items as Json[] | undefined) ?? []) {
      const sn = v.snippet as Json;
      const st = (v.statistics as Json) ?? {};
      const status = (v.status as Json) ?? {};
      const thumbs = sn.thumbnails as Record<string, { url: string }> | undefined;
      out.push({
        id: String(v.id),
        title: String(sn.title ?? ''),
        publishedAt: Date.parse(String(sn.publishedAt ?? '')) || 0,
        durationSec: parseDuration(String((v.contentDetails as Json)?.duration ?? '')),
        views: num(st.viewCount),
        likes: num(st.likeCount),
        comments: num(st.commentCount),
        thumbnail: thumbs?.medium?.url ?? thumbs?.default?.url ?? '',
        privacy: String(status.privacyStatus ?? 'public'),
        publishAt: status.publishAt ? Date.parse(String(status.publishAt)) : undefined,
        madeForKids: !!status.madeForKids,
      });
    }
  }
  return out.slice(0, limit);
}
