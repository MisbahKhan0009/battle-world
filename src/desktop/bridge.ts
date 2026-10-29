/**
 * Typed bridge to the Tauri (Rust) side. Everything here only works in the desktop app; the web
 * build checks `isDesktop()` and shows desktop-only notes instead.
 */
import type { Channel, VideoMeta } from '../autopilot/types';

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown> | Uint8Array,
  headers?: Record<string, string>,
): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args as Record<string, unknown>, headers ? { headers } : undefined);
}

async function listen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  const ev = await import('@tauri-apps/api/event');
  return ev.listen<T>(event, (e) => cb(e.payload));
}

export type UploadRequest = {
  channelId: string;
  clientId: string;
  clientSecret: string;
  path: string;
  meta: VideoMeta;
  privacy: 'public' | 'unlisted' | 'private';
  publishAt?: string;
  madeForKids: boolean;
  categoryId: string;
};

/** A track in the music folder, with its credit line when a .txt file of the same name holds one. */
export type MusicFile = { name: string; path: string; attribution: string | null };

export const desktop = {
  readState: () => invoke<string | null>('state_read'),
  writeState: (json: string) => invoke<void>('state_write', { json }),
  defaultOutputDir: () => invoke<string>('default_output_dir'),

  /** Writes a rendered video to disk (raw bytes, no JSON encoding) and returns its path. */
  saveVideo: (dir: string, name: string, bytes: Uint8Array) =>
    invoke<string>('save_video', bytes, {
      'x-dir': encodeURIComponent(dir),
      'x-name': encodeURIComponent(name),
    }),
  deleteFile: (path: string) => invoke<void>('delete_file', { path }),

  /** The default music folder (Music\Flag Clash Music). */
  defaultMusicDir: () => invoke<string>('default_music_dir'),
  /** Tracks in the music folder (the folder is created the first time). */
  musicList: (dir: string) => invoke<MusicFile[]>('music_list', { dir }),
  /** One track's raw bytes. */
  musicRead: (path: string) => invoke<ArrayBuffer>('music_read', { path }),

  connectChannel: (clientId: string, clientSecret: string) =>
    invoke<Pick<Channel, 'id' | 'title' | 'thumbnail' | 'subscribers'>>('oauth_connect', {
      clientId,
      clientSecret,
    }),
  disconnectChannel: (channelId: string) => invoke<void>('oauth_disconnect', { channelId }),
  upload: (req: UploadRequest) => invoke<{ videoId: string }>('youtube_upload', { req }),
  /** Read-only YouTube Data API call (channels, playlistItems, videos); returns the JSON text. */
  apiGet: (req: {
    channelId: string;
    clientId: string;
    clientSecret: string;
    endpoint: 'channels' | 'playlistItems' | 'videos';
    query: [string, string][];
  }) => invoke<string>('youtube_api_get', { req }),
  setThumbnail: (req: {
    channelId: string;
    clientId: string;
    clientSecret: string;
    videoId: string;
    path: string;
  }) => invoke<void>('youtube_set_thumbnail', { req }),

  onUploadProgress: (cb: (p: { path: string; sent: number; total: number }) => void) =>
    listen('upload-progress', cb),
  onTick: (cb: () => void) => listen<null>('autopilot-tick', cb),
  onTrayToggle: (cb: () => void) => listen<null>('tray-toggle-autopilot', cb),
  trayUpdate: (running: boolean, status: string) => invoke<void>('tray_update', { running, status }),

  getAutostart: () => invoke<boolean>('autostart_get'),
  setAutostart: (enabled: boolean) => invoke<void>('autostart_set', { enabled }),
  setCloseToTray: (enabled: boolean) => invoke<void>('close_to_tray_set', { enabled }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  /** Brings the app window forward. */
  showWindow: () => invoke<void>('window_show'),
  /** Lets the window play files from this folder. */
  allowMedia: (dir: string) => invoke<void>('media_allow', { dir }),
  /** A URL the window can play a local video file from. */
  mediaUrl: async (path: string) => (await import('@tauri-apps/api/core')).convertFileSrc(path),
  /** Shuts the computer down or puts it to sleep (Windows). */
  powerAction: (kind: 'shutdown' | 'sleep') => invoke<void>('power_action', { kind }),
  openPath: (path: string) => invoke<void>('open_path', { path }),
};
