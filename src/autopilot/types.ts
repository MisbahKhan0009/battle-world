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
  /** Hard cap on uploads per channel per day. */
  dailyCap: number;
  /**
   * Uploads a day for all channels together: they share one Google project's upload quota (100 uploads
   * a day). Each day's posts are shared fairly between channels within it.
   */
  projectCap?: number;
  /**
   * Long videos a day, taking turns between the channel's games. When unset (older settings), each
   * game's `videosPerWeek` is used instead.
   */
  longPerDay?: number;
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
  /** You approved the rendered video for upload (only needed with "review before upload"). */
  approved?: boolean;
  /** Prepared ahead: upload (scheduled on YouTube) as soon as possible, even after the batch ended. */
  uploadAhead?: boolean;
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
  /** Games this channel posts (module id -> pace). One channel with every game is the default. */
  games: Record<string, ModulePace>;
  /** Uploads a day on this channel. All channels on the same Google keys share one API quota. */
  dailyCap: number;
};

/** Upload quota of one Google Cloud project: videos.insert has its own bucket of 100 uploads a day. */
export const PROJECT_UPLOADS_PER_DAY = 100;

/** Default uploads a day on one channel (YouTube also limits uploads per channel per day). */
export const CHANNEL_UPLOADS_PER_DAY = 15;

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
    dailyCap: CHANNEL_UPLOADS_PER_DAY,
    enabled: true,
    ...prev,
    ...info,
    connectedAt: Date.now(),
  };
}

/**
 * Games for a newly connected channel: the first channel gets every game; a later channel gets
 * the ready games no other channel uses yet.
 */
export function gamesForNewChannel(existing: Channel[], ready: string[]): Record<string, ModulePace> {
  const taken = new Set(existing.flatMap((c) => Object.keys(c.games ?? {})));
  const pick = existing.length ? ready.filter((id) => !taken.has(id)) : ready;
  return Object.fromEntries(
    pick.map((id) => [id, { ...(DEFAULT_PACE[id] ?? { shortsPerDay: 2, videosPerWeek: 2 }) }]),
  );
}

/** Games that were ready before new games were handed out automatically (app 1.0.12). */
export const LEGACY_GAMES = ['flag-battle', 'marble-race', 'ring-escape'];

/**
 * Hands each newly released game (ready, not in `known`, on no channel) to the first enabled
 * channel (the main channel posts every game).
 */
export function assignNewGames(channels: Channel[], ready: string[], known: string[]): Channel[] | null {
  const taken = new Set(channels.flatMap((c) => Object.keys(c.games ?? {})));
  const fresh = ready.filter((id) => !known.includes(id) && !taken.has(id));
  if (!fresh.length) return null;
  let changed = false;
  const out = channels.map((c) => ({ ...c, games: { ...(c.games ?? {}) } }));
  for (const id of fresh) {
    const ch = out.find((c) => c.enabled) ?? out[0];
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
  /** 2 = the one-channel plan (a Short a day per game, long videos a day taking turns). */
  planVersion?: number;
  prepare?: PrepareSettings;
  batch?: Batch | null;
  /** YouTube's upload quota ran out: uploads wait until this time (the quota resets at midnight Pacific). */
  uploadPausedUntil?: number;
};

export type StatPoint = { t: number; subs: number; views: number; videos: number };

/** What the computer does when a batch is finished. */
export type AfterAction = 'nothing' | 'sleep' | 'shutdown';

/**
 * Preparing ahead: videos are rendered and uploaded (scheduled on YouTube for their planned time)
 * before the day comes, so the computer does not need to be on when they go out.
 */
export type PrepareSettings = {
  /** Prepare the next day every day, or the next 7 days every week, at `atMin`. */
  auto: 'off' | 'daily' | 'weekly';
  /** Minutes after local midnight, and the weekday for weekly (0 = Monday). */
  atMin: number;
  weekday: number;
  /** Hands-off mode: always keep this many days ahead prepared (0 = off). */
  handsOffDays: number;
  /** Rendered videos wait for your approval before they are uploaded. */
  review: boolean;
};

/** A one-off "render and upload these days now" job. Days are local "YYYY-MM-DD" keys. */
export type Batch = {
  from: string;
  to: string;
  /** Upload as well (scheduled on YouTube), or only render. */
  upload: boolean;
  after: AfterAction;
  startedAt: number;
  /** Everything that can be done now is done (anything left waits for the quota or a retry). */
  finishedAt?: number;
  /** The after-action ran or was cancelled. */
  afterHandled?: boolean;
};

/** How far ahead videos can be prepared. */
export const MAX_AHEAD_DAYS = 30;

export const DEFAULT_PREPARE: PrepareSettings = {
  auto: 'off',
  atMin: 22 * 60,
  weekday: 6,
  handsOffDays: 0,
  review: false,
};

/**
 * Default pace per game: one Short a day each. Long videos are set per day for the whole channel
 * (`longPerDay`, taking turns between games); `videosPerWeek` only applies to older settings.
 */
export const DEFAULT_PACE: Record<string, ModulePace> = {
  'flag-battle': { shortsPerDay: 1, videosPerWeek: 1 },
  'marble-race': { shortsPerDay: 1, videosPerWeek: 1 },
  'ring-escape': { shortsPerDay: 1, videosPerWeek: 1 },
  'growing-ball': { shortsPerDay: 1, videosPerWeek: 1 },
  'paper-land': { shortsPerDay: 1, videosPerWeek: 1 },
  'territory-wars': { shortsPerDay: 1, videosPerWeek: 1 },
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
 * Defaults: one Short a day from every game plus one long video a day (the games take turns),
 * spread over waking hours with random gaps.
 */
export const DEFAULT_SCHEDULE: ScheduleSettings = {
  perModule: structuredClone(DEFAULT_PACE),
  activeStartMin: 9 * 60,
  activeEndMin: 23 * 60,
  minGapMin: 60,
  varyDaily: false,
  dailyCap: CHANNEL_UPLOADS_PER_DAY,
  projectCap: PROJECT_UPLOADS_PER_DAY,
  longPerDay: 1,
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
    prepare: { ...DEFAULT_PREPARE },
    batch: null,
  };
}
