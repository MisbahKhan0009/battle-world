export type ContentFormat = 'short' | 'video';

/** How much one game posts. */
export type ModulePace = { shortsPerDay: number; videosPerWeek: number };

/**
 * How often and when the autopilot posts. Each game has its own pace; all games share the
 * posting window, gaps and the daily upload cap, so their posts never overlap. Window times are
 * the computer's local time.
 */
export type ScheduleSettings = {
  /** Pace per game (module id). Games missing here use DEFAULT_PACE. */
  perModule: Record<string, ModulePace>;
  /** Active posting window, minutes after local midnight. */
  activeStartMin: number;
  activeEndMin: number;
  /** Minimum minutes between two posts on the same channel. */
  minGapMin: number;
  /** Vary the daily count by one now and then, like a person would. */
  varyDaily: boolean;
  /** Hard cap on uploads per channel per day (YouTube API quota). */
  dailyCap: number;
  /**
   * Uploads a day for all channels together: they share one Google project's API quota (about 6 by default).
   * Each day's posts are shared fairly between channels within it.
   */
  projectCap?: number;
  /** Favour the hours when the audience is most active on YouTube. */
  peakHours: boolean;
  /** IANA time zone of the main audience ('' = this computer's time zone). */
  audienceTz: string;
};

export type PostSettings = {
  privacy: 'public' | 'unlisted' | 'private';
  /** Upload early as private and let YouTube publish at the planned time. */
  publishViaYouTube: boolean;
  madeForKids: boolean;
  categoryId: string;
};

export type SlotStatus = 'planned' | 'rendering' | 'rendered' | 'uploading' | 'posted' | 'failed' | 'skipped';

export type Slot = {
  id: string;
  channelId: string;
  /** Planned publish time (epoch ms). */
  at: number;
  format: ContentFormat;
  moduleId: string;
  /** Content seed: the same seed renders the same video. */
  seed: number;
  status: SlotStatus;
  attempts: number;
  nextAttemptAt?: number;
  error?: string;
  filePath?: string;
  title?: string;
  meta?: VideoMeta;
  videoId?: string;
  postedAt?: number;
  /** True for slots created with "Post now". */
  manual?: boolean;
  /** Spoiler-free cover image uploaded as the YouTube thumbnail. */
  thumbPath?: string;
  /** Why YouTube refused the custom thumbnail (the video itself was posted). */
  thumbError?: string;
  /** What happened to this post, oldest first (shown in the post's timeline). */
  log?: SlotEvent[];
};

export type SlotEvent = { t: number; text: string; error?: boolean };

/**
 * What a rendered post contained, kept so later posts can avoid repeats (winners, lineups,
 * flag counts, looks). Module-specific fields are optional.
 */
export type ContentRecord = {
  slotId: string;
  at: number;
  format: ContentFormat;
  moduleId: string;
  count: number;
  /** ISO codes (or names) of every competitor. */
  roster: string[];
  winner?: string;
  runnerUp?: string;
  mode?: string;
  group?: string;
  theme?: string;
  template?: string;
  /** The music track used instead of the game sounds, if any. */
  music?: string;
};

export type VideoMeta = {
  title: string;
  description: string;
  tags: string[];
};

export type Channel = {
  id: string;
  title: string;
  thumbnail: string;
  subscribers?: number;
  connectedAt: number;
  enabled: boolean;
  /** Games this channel posts (module id -> pace). Two per channel works best. */
  games: Record<string, ModulePace>;
  /** Uploads a day on this channel. All channels on the same Google keys share one API quota. */
  dailyCap: number;
};

/** Recommended number of games per channel. */
export const GAMES_PER_CHANNEL = 2;

/** Upload quota of one Google Cloud project (10,000 units, about 1,600 per upload). */
export const PROJECT_UPLOADS_PER_DAY = 6;

/** Games on a channel that can post (ready modules only), in a stable order. */
export function channelGames(ch: Pick<Channel, 'games'>, ready: string[]): string[] {
  return ready.filter((id) => ch.games && id in ch.games);
}

/** The schedule as seen by one channel: shared timing settings with its own games and limit. */
export function channelSchedule(
  base: ScheduleSettings,
  ch: Pick<Channel, 'games' | 'dailyCap'>,
): ScheduleSettings {
  return { ...base, perModule: ch.games ?? {}, dailyCap: ch.dailyCap ?? base.dailyCap };
}

/** A freshly connected channel (or a reconnected one, keeping its games and settings). */
export function connectedChannel(
  info: Pick<Channel, 'id' | 'title' | 'thumbnail' | 'subscribers'>,
  existing: Channel[],
  ready: string[],
): Channel {
  const prev = existing.find((c) => c.id === info.id);
  const others = existing.filter((c) => c.id !== info.id);
  return {
    games: gamesForNewChannel(others, ready),
    dailyCap: PROJECT_UPLOADS_PER_DAY,
    enabled: true,
    ...prev,
    ...info,
    connectedAt: Date.now(),
  };
}

/**
 * Games for a newly connected channel: the first channel gets the first two games; later
 * channels get ready games no other channel uses yet (so each channel has its own games).
 */
export function gamesForNewChannel(existing: Channel[], ready: string[]): Record<string, ModulePace> {
  const taken = new Set(existing.flatMap((c) => Object.keys(c.games ?? {})));
  const free = ready.filter((id) => !taken.has(id));
  const pick = (existing.length ? free : ready).slice(0, GAMES_PER_CHANNEL);
  return Object.fromEntries(
    pick.map((id) => [id, { ...(DEFAULT_PACE[id] ?? { shortsPerDay: 2, videosPerWeek: 2 }) }]),
  );
}

/** Games that were ready before new games were handed out automatically (app 1.0.12). */
export const LEGACY_GAMES = ['flag-battle', 'marble-race', 'ring-escape'];

/**
 * Hands each newly released game (ready, not in `known`, on no channel) to the first channel
 * that still has room for one (fewer than GAMES_PER_CHANNEL games). Games nobody has room for
 * wait for the next channel to be connected.
 */
export function assignNewGames(channels: Channel[], ready: string[], known: string[]): Channel[] | null {
  const taken = new Set(channels.flatMap((c) => Object.keys(c.games ?? {})));
  const fresh = ready.filter((id) => !known.includes(id) && !taken.has(id));
  if (!fresh.length) return null;
  let changed = false;
  const out = channels.map((c) => ({ ...c, games: { ...(c.games ?? {}) } }));
  for (const id of fresh) {
    const ch = out.find((c) => Object.keys(c.games).length < GAMES_PER_CHANNEL);
    if (!ch) break;
    ch.games[id] = { ...(DEFAULT_PACE[id] ?? { shortsPerDay: 2, videosPerWeek: 2 }) };
    changed = true;
  }
  return changed ? out : null;
}

export type AutopilotState = {
  version: 1;
  running: boolean;
  schedule: ScheduleSettings;
  post: PostSettings;
  channels: Channel[];
  slots: Slot[];
  /** Days already planned, per channel ("YYYY-MM-DD"). */
  plannedDays: Record<string, string[]>;
  /** Modules the autopilot may use (ready modules only). */
  modules: Record<string, boolean>;
  google: { clientId: string; clientSecret: string };
  outputDir: string;
  /** Delete rendered files this many days after posting (0 = right after upload). */
  keepDays: number;
  launchAtLogin: boolean;
  closeToTray: boolean;
  /** The first-run setup wizard was completed. */
  setupDone: boolean;
  /** Recent content, newest last, used to keep every post fresh. */
  contentLog: ContentRecord[];
  /** Channel totals over time (the dashboard's growth charts), per channel, oldest first. */
  stats: Record<string, StatPoint[]>;
  /** The "made for kids" default has been applied to this install. */
  kidsDefaulted: boolean;
  /**
   * Music instead of the game sounds: tracks from a folder (e.g. downloaded from YouTube's Audio
   * Library), a different one for each video.
   */
  music?: { enabled: boolean; dir: string };
  /** Ready games this install has already handed out to channels (new games get assigned once). */
  knownGames?: string[];
};

export type StatPoint = { t: number; subs: number; views: number; videos: number };

/** Default pace per game: together 5 Shorts a day and 4 long videos a week. */
export const DEFAULT_PACE: Record<string, ModulePace> = {
  'flag-battle': { shortsPerDay: 3, videosPerWeek: 2 },
  'marble-race': { shortsPerDay: 2, videosPerWeek: 2 },
  'ring-escape': { shortsPerDay: 3, videosPerWeek: 2 },
  'growing-ball': { shortsPerDay: 2, videosPerWeek: 2 },
};

/** Splits an overall pace across games (remainders go to the first games). */
export function splitPace(shorts: number, videos: number, moduleIds: string[]): Record<string, ModulePace> {
  const out: Record<string, ModulePace> = {};
  const k = Math.max(1, moduleIds.length);
  moduleIds.forEach((m, i) => {
    out[m] = {
      shortsPerDay: Math.floor(shorts / k) + (i < shorts % k ? 1 : 0),
      videosPerWeek: Math.floor(videos / k) + (i < videos % k ? 1 : 0),
    };
  });
  return out;
}

export function paceFor(settings: ScheduleSettings, moduleId: string): ModulePace {
  return settings.perModule[moduleId] ?? DEFAULT_PACE[moduleId] ?? { shortsPerDay: 1, videosPerWeek: 1 };
}

/**
 * Defaults aim for "as much as possible while still looking organic": about 5 Shorts a day plus
 * 4 long videos a week across the games, spread over waking hours with random gaps, capped at 6
 * uploads a day (the default YouTube API quota allows roughly six uploads per day).
 */
export const DEFAULT_SCHEDULE: ScheduleSettings = {
  perModule: structuredClone(DEFAULT_PACE),
  activeStartMin: 9 * 60,
  activeEndMin: 23 * 60,
  minGapMin: 75,
  varyDaily: true,
  dailyCap: 6,
  projectCap: 6,
  peakHours: true,
  audienceTz: '',
};

export const DEFAULT_POST: PostSettings = {
  privacy: 'public',
  publishViaYouTube: true,
  // Everyone can watch: videos are marked made for kids unless you change it.
  madeForKids: true,
  categoryId: '20', // Gaming
};

export function defaultState(outputDir = ''): AutopilotState {
  return {
    version: 1,
    running: false,
    schedule: { ...DEFAULT_SCHEDULE },
    post: { ...DEFAULT_POST },
    channels: [],
    slots: [],
    plannedDays: {},
    modules: { 'flag-battle': true, 'marble-race': true },
    google: { clientId: '', clientSecret: '' },
    outputDir,
    keepDays: 3,
    launchAtLogin: true,
    closeToTray: true,
    setupDone: false,
    contentLog: [],
    stats: {},
    kidsDefaulted: true,
  };
}
