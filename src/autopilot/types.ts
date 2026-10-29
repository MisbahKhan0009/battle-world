export type ContentFormat = 'short' | 'video';

/** How often and when the autopilot posts. All times are the computer's local time. */
export type ScheduleSettings = {
  shortsPerDay: number;
  videosPerWeek: number;
  /** Active posting window, minutes after local midnight. */
  activeStartMin: number;
  activeEndMin: number;
  /** Minimum minutes between two posts on the same channel. */
  minGapMin: number;
  /** Vary the daily count by one now and then, like a person would. */
  varyDaily: boolean;
  /** Hard cap on uploads per channel per day (YouTube API quota). */
  dailyCap: number;
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
};

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
};

/**
 * Defaults aim for "as much as possible while still looking organic": up to 5 Shorts a day plus
 * about every other day a long video, spread over waking hours with random gaps, capped at 6
 * uploads a day (the default YouTube API quota allows roughly six uploads per day).
 */
export const DEFAULT_SCHEDULE: ScheduleSettings = {
  shortsPerDay: 5,
  videosPerWeek: 4,
  activeStartMin: 9 * 60,
  activeEndMin: 23 * 60,
  minGapMin: 75,
  varyDaily: true,
  dailyCap: 6,
};

export const DEFAULT_POST: PostSettings = {
  privacy: 'public',
  publishViaYouTube: true,
  madeForKids: false,
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
    modules: { 'flag-battle': true },
    google: { clientId: '', clientSecret: '' },
    outputDir,
    keepDays: 3,
    launchAtLogin: true,
    closeToTray: true,
    setupDone: false,
  };
}
