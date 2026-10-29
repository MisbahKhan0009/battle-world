/**
 * Music instead of the game sounds: picks a track from the user's music folder for each video
 * (a different one each time, avoiding the channel's recent tracks) and decodes it for the
 * exporter.
 */
import type { MusicBed } from '../audio/music';
import { SAMPLE_RATE } from '../audio/synth';
import { hash32 } from '../engine/rng';
import type { ContentRecord } from '../autopilot/types';
import { desktop, type MusicFile } from './bridge';

/** A video never runs longer than this, so longer tracks are cut here to save memory. */
const MAX_SEC = 6 * 60;

/**
 * The track for one video: among the tracks the channel used least recently, one chosen by the
 * video's seed (so the same post always gets the same track).
 */
export function pickTrack(tracks: MusicFile[], seed: number, recent: ContentRecord[]): MusicFile | null {
  if (!tracks.length) return null;
  const lastUse = new Map<string, number>();
  recent.forEach((r, i) => r.music && lastUse.set(r.music, i));
  const age = (t: MusicFile) => lastUse.get(t.name) ?? -1;
  const oldest = Math.min(...tracks.map(age));
  const fresh = tracks.filter((t) => age(t) === oldest);
  return fresh[hash32(seed, 0x6d75) % fresh.length];
}

/** Decodes a track to planar stereo at the export sample rate. */
export async function decodeTrack(bytes: ArrayBuffer): Promise<MusicBed> {
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  const buf = await ctx.decodeAudioData(bytes);
  const n = Math.min(buf.length, MAX_SEC * SAMPLE_RATE);
  const L = buf.getChannelData(0).slice(0, n);
  const R = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice(0, n);
  return { L, R };
}

/** The track for a video, decoded, or null when music is off or the folder is empty. */
export async function musicFor(
  settings: { enabled: boolean; dir: string } | undefined,
  seed: number,
  recent: ContentRecord[],
): Promise<{ track: MusicFile; bed: MusicBed } | null> {
  if (!settings?.enabled || !settings.dir) return null;
  const track = pickTrack(await desktop.musicList(settings.dir), seed, recent);
  if (!track) return null;
  return { track, bed: await decodeTrack(await desktop.musicRead(track.path)) };
}
