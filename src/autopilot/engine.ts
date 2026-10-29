/**
 * Autopilot runtime. Keeps every connected channel's plan for the coming days, renders each post
 * before its slot, uploads it, retries failures with backoff, and skips slots missed while the
 * computer was off (posting them late in a burst would look unnatural).
 *
 * Videos can also be prepared well ahead: rendered and uploaded as scheduled YouTube videos,
 * so they go out at their planned time even when the computer is off. That happens every day or
 * week at a set time, continuously in hands-off mode (always N days ahead), or for a date range
 * on demand (a batch, with an optional sleep or shutdown when it is done).
 *
 * All side effects go through a Backend, so the logic is testable without Tauri.
 */
import { dayKey, parseDayKey, planChannelsDay } from './planner';
import {
  channelGames,
  DEFAULT_PREPARE,
  MAX_AHEAD_DAYS,
  type AfterAction,
  type AutopilotState,
  type ContentFormat,
  type ContentRecord,
  type Slot,
  type VideoMeta,
} from './types';

export type RenderResult = {
  bytes: Uint8Array;
  ext: string;
  meta: VideoMeta;
  /** Spoiler-free cover (JPEG) to upload as the YouTube thumbnail. */
  thumbnail?: Uint8Array;
  /** What the post contains, so later posts can avoid repeating it. */
  content?: Omit<ContentRecord, 'slotId' | 'at' | 'format' | 'moduleId'>;
};

export type Backend = {
  now(): number;
  load(): Promise<AutopilotState>;
  save(state: AutopilotState): Promise<void>;
  /** Renders a post for a module. Progress is 0..1. `recent` is the content history, oldest first. */
  render(
    slot: Slot,
    onProgress: (p: number) => void,
    signal: AbortSignal,
    recent: ContentRecord[],
  ): Promise<RenderResult>;
  saveFile(dir: string, name: string, bytes: Uint8Array): Promise<string>;
  deleteFile(path: string): Promise<void>;
  upload(
    channelId: string,
    path: string,
    meta: VideoMeta,
    opts: {
      privacy: 'public' | 'unlisted' | 'private';
      publishAt?: string;
      madeForKids: boolean;
      categoryId: string;
    },
    onProgress: (p: number) => void,
  ): Promise<{ videoId: string }>;
  /** Sets a custom thumbnail on an uploaded video. */
  setThumbnail?(channelId: string, videoId: string, path: string): Promise<void>;
};

export type Activity = { slotId: string; stage: 'rendering' | 'uploading'; progress: number } | null;

/** Render this long before the slot so the post is ready on time. */
export const RENDER_LEAD_MS = 30 * 60_000;
/**
 * When YouTube publishes the post at its time, render and upload well ahead, so a slot at a time
 * the computer is usually off (for example evening in the audience's time zone) still goes out.
 */
export const SCHEDULED_RENDER_LEAD_MS = 3 * 3_600_000;
/** Slots missed by more than this (app was off) are skipped. */
export const MISSED_GRACE_MS = 2 * 3_600_000;
const RETRY_DELAYS_MIN = [5, 20, 60];
const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1;
/** How many days ahead (today included) the plan is queued at least, so the week is visible and editable. */
export const PLAN_DAYS = 7;
const DAY_MS = 86_400_000;
/** A batch counts as done for now when what is left waits longer than this (quota, retries). */
const BATCH_WAIT_MS = 30 * 60_000;
const HISTORY_DAYS = 45;
const CONTENT_LOG_MAX = 500;
const SLOT_LOG_MAX = 30;
/** YouTube needs publishAt comfortably in the future. */
const MIN_SCHEDULE_AHEAD_MS = 15 * 60_000;

const DONE: Slot['status'][] = ['posted', 'failed', 'skipped'];

function startOfDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date, plusDays = 0): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays + 1).getTime() - 1;
}

const pacific = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** YouTube's daily quota resets at midnight Pacific time; a few minutes after that. */
export function nextQuotaReset(ms: number): number {
  const parts = pacific.formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return ms + (24 * 60 - (h * 60 + m) + 7) * 60_000;
}

function note(s: Slot, t: number, text: string, error = false): void {
  s.log = [...(s.log ?? []), { t, text, ...(error ? { error } : {}) }].slice(-SLOT_LOG_MAX);
}

export function isQuotaError(message: string): boolean {
  return /quotaExceeded|uploadLimitExceeded|rateLimitExceeded|dailyLimitExceeded/i.test(message);
}

export class Autopilot {
  private state: AutopilotState | null = null;
  private busy = false;
  private activity: Activity = null;
  private listeners = new Set<() => void>();
  private abort: AbortController | null = null;

  constructor(
    private readonly backend: Backend,
    private readonly readyModules: () => string[],
  ) {}

  async init(): Promise<AutopilotState> {
    this.state = await this.backend.load();
    // A crash mid-job leaves slots in a working state; send them back a stage.
    let changed = false;
    for (const s of this.state.slots) {
      if (s.status === 'rendering') {
        s.status = 'planned';
        changed = true;
      } else if (s.status === 'uploading') {
        s.status = 'rendered';
        changed = true;
      }
    }
    if (changed) await this.persist();
    this.emit();
    return this.state;
  }

  get snapshot(): AutopilotState | null {
    return this.state;
  }

  get currentActivity(): Activity {
    return this.activity;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private async persist(): Promise<void> {
    if (this.state) await this.backend.save(this.state);
    this.emit();
  }

  /** Applies a settings change. Schedule changes re-plan the not-yet-started future. */
  async update(patch: Partial<AutopilotState>, opts: { replan?: boolean } = {}): Promise<void> {
    if (!this.state) return;
    this.state = { ...this.state, ...patch };
    if (opts.replan) this.replanFuture();
    await this.persist();
  }

  /** Is this slot part of the batch being prepared? */
  private inBatch(s: Pick<Slot, 'at'>): boolean {
    const b = this.state?.batch;
    if (!b || b.finishedAt) return false;
    const key = dayKey(new Date(s.at));
    return key >= b.from && key <= b.to;
  }

  /**
   * Up to when videos get rendered, and up to when they get uploaded (scheduled on YouTube): just
   * in time, plus whatever the daily or weekly preparation, hands-off mode or a batch asks for.
   */
  horizons(now = this.backend.now()): { render: number; upload: number } {
    const st = this.state!;
    const p = st.prepare ?? DEFAULT_PREPARE;
    const today = startOfDay(now);
    let ahead = now + this.renderLead();
    if (st.running) {
      if (p.handsOffDays > 0)
        ahead = Math.max(ahead, endOfDay(today, Math.min(p.handsOffDays, MAX_AHEAD_DAYS)));
      const trigger = (d: Date) => d.getTime() + p.atMin * 60_000;
      if (p.auto === 'daily') ahead = Math.max(ahead, endOfDay(today, now >= trigger(today) ? 1 : 0));
      if (p.auto === 'weekly') {
        // The most recent preparation day (this week's, or last week's if it is still to come).
        let back = (((today.getDay() + 6) % 7) - p.weekday + 7) % 7;
        let day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
        if (now < trigger(day)) {
          back += 7;
          day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
        }
        ahead = Math.max(ahead, endOfDay(day, 7));
      }
    }
    let render = ahead;
    let upload = ahead;
    const b = st.batch;
    if (b && !b.finishedAt) {
      const end = endOfDay(parseDayKey(b.to));
      render = Math.max(render, end);
      if (b.upload) upload = Math.max(upload, end);
    }
    return { render, upload };
  }

  /** Renders (and, with `upload`, schedules on YouTube) every post from `from` to `to` now. */
  async startBatch(opts: { from: string; to: string; upload: boolean; after: AfterAction }): Promise<void> {
    if (!this.state) return;
    const [from, to] = opts.from <= opts.to ? [opts.from, opts.to] : [opts.to, opts.from];
    this.state.batch = { ...opts, from, to, startedAt: this.backend.now() };
    await this.persist();
    await this.tick();
  }

  async cancelBatch(): Promise<void> {
    if (!this.state?.batch) return;
    this.state.batch = null;
    await this.persist();
  }

  /** The after-action of a finished batch was carried out (or cancelled). */
  async batchHandled(): Promise<void> {
    if (!this.state?.batch) return;
    this.state.batch.afterHandled = true;
    await this.persist();
  }

  private slot(id: string): Slot | undefined {
    return this.state?.slots.find((x) => x.id === id);
  }

  /** Throws away a video that is not on YouTube yet and makes a new one for the same slot. */
  async rerender(slotId: string): Promise<void> {
    const s = this.slot(slotId);
    if (!s || ['posted', 'rendering', 'uploading'].includes(s.status)) return;
    await this.removeFiles(s);
    s.seed = (Math.floor(Math.random() * 999_999) + 1) >>> 0;
    s.status = 'planned';
    s.attempts = 0;
    s.error = undefined;
    s.nextAttemptAt = undefined;
    s.meta = undefined;
    s.title = undefined;
    s.approved = undefined;
    s.uploadAhead = undefined;
    this.state!.contentLog = this.state!.contentLog.filter((r) => r.slotId !== s.id);
    note(s, this.backend.now(), 'Sent back for a new video');
    await this.persist();
  }

  /** Edits a post that is not on YouTube yet: its title, description, or planned time. */
  async editSlot(
    slotId: string,
    patch: { title?: string; description?: string; at?: number },
  ): Promise<void> {
    const s = this.slot(slotId);
    if (!s || ['posted', 'uploading'].includes(s.status)) return;
    if (s.meta && (patch.title !== undefined || patch.description !== undefined)) {
      s.meta = {
        ...s.meta,
        title: (patch.title ?? s.meta.title).slice(0, 100),
        description: patch.description ?? s.meta.description,
      };
      s.title = s.meta.title;
      note(s, this.backend.now(), 'Title or description edited');
    }
    if (patch.at !== undefined && patch.at !== s.at) {
      s.at = patch.at;
      if (s.status === 'skipped' || s.status === 'failed') s.status = s.filePath ? 'rendered' : 'planned';
      s.error = undefined;
      note(
        s,
        this.backend.now(),
        `Moved to ${new Date(patch.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`,
      );
      this.state!.slots.sort((a, b) => a.at - b.at);
    }
    await this.persist();
  }

  /** Approves rendered videos for upload (with "review before upload" on). */
  async approve(slotIds: string[]): Promise<void> {
    const now = this.backend.now();
    for (const id of slotIds) {
      const s = this.slot(id);
      if (!s || s.approved) continue;
      s.approved = true;
      note(s, now, 'Approved for upload');
    }
    await this.persist();
    await this.tick();
  }

  /** Brings a skipped post back into the plan. */
  async restore(slotId: string): Promise<void> {
    const s = this.slot(slotId);
    if (!s || s.status !== 'skipped') return;
    s.status = s.filePath ? 'rendered' : 'planned';
    s.error = undefined;
    note(s, this.backend.now(), 'Back in the plan');
    await this.persist();
  }

  /** Publishes a post right away instead of at its planned time. */
  async publishNow(slotId: string): Promise<void> {
    const s = this.slot(slotId);
    if (!s || !['planned', 'rendered', 'failed'].includes(s.status)) return;
    const now = this.backend.now();
    s.manual = true;
    s.at = now;
    s.approved = true;
    s.nextAttemptAt = undefined;
    if (s.status === 'failed') s.status = s.filePath ? 'rendered' : 'planned';
    note(s, now, 'Publishing now');
    this.state!.slots.sort((a, b) => a.at - b.at);
    await this.persist();
    await this.tick();
  }

  /** Drops planned (not started) automatic slots and plans the coming week again. */
  replanFuture(): void {
    const st = this.state!;
    st.slots = st.slots.filter((s) => s.status !== 'planned' || s.manual);
    st.plannedDays = {};
    this.ensurePlans();
  }

  private ensurePlans(): boolean {
    const st = this.state!;
    const now = this.backend.now();
    const ready = this.readyModules();
    let changed = false;
    const active = st.channels.filter((c) => c.enabled);
    const done = new Map(active.map((ch) => [ch.id, new Set(st.plannedDays[ch.id] ?? [])]));
    const today = startOfDay(now);
    const days = Math.min(
      MAX_AHEAD_DAYS + 1,
      Math.max(PLAN_DAYS, Math.ceil((this.horizons(now).render - today.getTime()) / DAY_MS)),
    );
    for (let offset = 0; offset < days; offset++) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      const key = dayKey(day);
      const todo = active.filter((ch) => !done.get(ch.id)!.has(key));
      if (!todo.length) continue;
      // Each channel posts its own games at its own pace and limit; together they share the
      // all-channels limit (one Google project's quota).
      const plans = planChannelsDay(day, st.channels, st.schedule, ready);
      const existing = new Set(st.slots.map((s) => s.id));
      for (const ch of todo) {
        let plan = plans.get(ch.id) ?? [];
        if (offset === 0) {
          // Planning mid-day: keep only future slots, within what is left of today's share.
          const used = st.slots.filter(
            (s) =>
              s.channelId === ch.id && !s.manual && dayKey(new Date(s.at)) === key && s.status !== 'skipped',
          ).length;
          const share = plan.length;
          plan = plan.filter((p) => p.at > now + 2 * 60_000).slice(0, Math.max(0, share - used));
        }
        for (const p of plan) {
          if (existing.has(p.id)) continue;
          st.slots.push({
            ...p,
            status: 'planned',
            attempts: 0,
            log: [{ t: now, text: 'Added to the schedule' }],
          });
        }
        done.get(ch.id)!.add(key);
        changed = true;
      }
    }
    const yesterday = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
    for (const ch of active)
      st.plannedDays[ch.id] = [...done.get(ch.id)!].filter((k) => k >= yesterday).sort();
    if (changed) st.slots.sort((a, b) => a.at - b.at);
    return changed;
  }

  /** Queues an immediate post (renders and uploads right away, outside the plan). */
  async postNow(channelId: string, format: ContentFormat, moduleId?: string): Promise<void> {
    if (!this.state) return;
    const ch = this.state.channels.find((c) => c.id === channelId);
    // Default to one of the channel's own games.
    moduleId ??= (ch ? channelGames(ch, this.readyModules())[0] : undefined) ?? this.readyModules()[0];
    const now = this.backend.now();
    this.state.slots.push({
      id: `${channelId}:now:${now}`,
      channelId,
      at: now,
      format,
      moduleId,
      seed: (Math.floor(Math.random() * 999_999) + 1) >>> 0,
      status: 'planned',
      attempts: 0,
      manual: true,
      log: [{ t: now, text: 'Queued with Post now' }],
    });
    this.state.slots.sort((a, b) => a.at - b.at);
    await this.persist();
    await this.tick();
  }

  async skip(slotId: string): Promise<void> {
    const s = this.state?.slots.find((x) => x.id === slotId);
    if (!s || DONE.includes(s.status) || s.status === 'rendering' || s.status === 'uploading') return;
    s.status = 'skipped';
    s.error = 'Skipped by you';
    note(s, this.backend.now(), 'Skipped by you');
    await this.persist();
  }

  /** Stops the current job (used when pausing). */
  cancelCurrent(): void {
    this.abort?.abort();
  }

  /** One scheduler step. Safe to call often; does at most one job stage at a time. */
  async tick(): Promise<void> {
    const st = this.state;
    if (!st || this.busy) return;
    const now = this.backend.now();
    let changed = false;

    const batching = !!st.batch && !st.batch.finishedAt;
    if (st.running || batching) changed = this.ensurePlans() || changed;
    if (st.uploadPausedUntil && st.uploadPausedUntil <= now) {
      st.uploadPausedUntil = undefined;
      changed = true;
    }

    // Skip automatic slots missed while the app was off.
    for (const s of st.slots) {
      if (s.status === 'planned' && !s.manual && s.at < now - MISSED_GRACE_MS) {
        s.status = 'skipped';
        s.error = 'Missed while the app was not running';
        note(s, now, s.error, true);
        changed = true;
      }
    }

    // Trim history.
    const cutoff = now - HISTORY_DAYS * 86_400_000;
    const before = st.slots.length;
    st.slots = st.slots.filter((s) => !(DONE.includes(s.status) && s.at < cutoff));
    if (st.slots.length !== before) changed = true;

    // Delete rendered files past the retention period (counted from when the post goes out).
    for (const s of st.slots) {
      if (
        s.status === 'posted' &&
        (s.filePath || s.thumbPath) &&
        Math.max(s.postedAt ?? 0, s.at) < now - st.keepDays * DAY_MS
      ) {
        await this.removeFiles(s);
        changed = true;
      }
    }

    if (changed) await this.persist();
    if (!st.running && !batching && !st.slots.some((s) => s.manual && !DONE.includes(s.status))) return;

    this.busy = true;
    try {
      // Keep going while work is ready (e.g. render then upload a "Post now" job).
      for (let i = 0; i < 4; i++) {
        const next = this.nextJob(this.backend.now());
        if (!next) break;
        if (next.status === 'planned') await this.renderSlot(next);
        else if (next.status === 'rendered') await this.uploadSlot(next);
        if (next.nextAttemptAt && next.nextAttemptAt > this.backend.now()) break;
      }
    } finally {
      this.busy = false;
      this.activity = null;
      this.abort = null;
      this.emit();
    }
    if (this.checkBatch(this.backend.now())) await this.persist();
  }

  /** Marks the batch done once everything in it that can be done now is done. */
  private checkBatch(now: number): boolean {
    const st = this.state!;
    const b = st.batch;
    if (!b || b.finishedAt) return false;
    const review = (st.prepare ?? DEFAULT_PREPARE).review;
    const paused = !!st.uploadPausedUntil && st.uploadPausedUntil > now;
    const left = st.slots.filter((s) => {
      if (!this.inBatch(s) || !this.channelUsable(s)) return false;
      const waitsLong = !!s.nextAttemptAt && s.nextAttemptAt > now + BATCH_WAIT_MS;
      if (s.status === 'planned' || s.status === 'rendering') return !waitsLong;
      if (s.status === 'uploading') return true;
      if (s.status === 'rendered')
        return b.upload && !waitsLong && !paused && !(review && !s.approved && !s.manual);
      return false;
    });
    if (left.length) return false;
    b.finishedAt = now;
    return true;
  }

  /** Disabled channels keep their history but only take "Post now" jobs. */
  private channelUsable(s: Slot): boolean {
    const ch = this.state!.channels.find((c) => c.id === s.channelId);
    return !!ch && (ch.enabled || !!s.manual);
  }

  private nextJob(now: number): Slot | null {
    const st = this.state!;
    const h = this.horizons(now);
    const candidates = st.slots.filter((s) => {
      if (!this.channelUsable(s)) return false;
      if (!st.running && !s.manual && !this.inBatch(s)) return false;
      if (s.nextAttemptAt && s.nextAttemptAt > now) return false;
      if (s.status === 'planned') return s.manual || s.at <= h.render;
      if (s.status === 'rendered') return this.canUploadNow(s, now, h.upload);
      return false;
    });
    // Uploads first (they are time-critical), then renders, earliest slot first.
    candidates.sort((a, b) => (a.status === b.status ? a.at - b.at : a.status === 'rendered' ? -1 : 1));
    return candidates[0] ?? null;
  }

  private renderLead(): number {
    const { post } = this.state!;
    return post.privacy === 'public' && post.publishViaYouTube ? SCHEDULED_RENDER_LEAD_MS : RENDER_LEAD_MS;
  }

  private async removeFiles(s: Slot): Promise<void> {
    for (const path of [s.filePath, s.thumbPath])
      if (path) await this.backend.deleteFile(path).catch(() => undefined);
    s.filePath = undefined;
    s.thumbPath = undefined;
  }

  private canUploadNow(s: Slot, now: number, horizon: number): boolean {
    const st = this.state!;
    if (s.manual) return true;
    if (st.uploadPausedUntil && st.uploadPausedUntil > now) return false;
    if ((st.prepare ?? DEFAULT_PREPARE).review && !s.approved) return false;
    if (s.at <= now) return true;
    // Uploading ahead: scheduled on YouTube when public (or already unlisted/private anyway).
    const ahead = st.post.privacy !== 'public' || st.post.publishViaYouTube;
    return ahead && s.at - now > MIN_SCHEDULE_AHEAD_MS && (s.uploadAhead || s.at <= horizon);
  }

  private fail(s: Slot, message: string): void {
    const now = this.backend.now();
    s.error = message;
    if (isQuotaError(message)) {
      // Out of quota: every upload waits for the daily reset, without burning an attempt.
      s.nextAttemptAt = nextQuotaReset(now);
      this.state!.uploadPausedUntil = s.nextAttemptAt;
      note(
        s,
        now,
        `YouTube's daily upload limit reached; uploads continue at ${new Date(s.nextAttemptAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
        true,
      );
      return;
    }
    s.attempts += 1;
    if (s.attempts >= MAX_ATTEMPTS) {
      s.status = 'failed';
      note(s, now, `Failed: ${message}`, true);
    } else {
      s.nextAttemptAt = now + RETRY_DELAYS_MIN[s.attempts - 1] * 60_000;
      note(s, now, `Error: ${message}. Retrying in ${RETRY_DELAYS_MIN[s.attempts - 1]} min`, true);
    }
  }

  private async renderSlot(s: Slot): Promise<void> {
    const st = this.state!;
    s.status = 'rendering';
    s.error = undefined;
    this.abort = new AbortController();
    this.activity = { slotId: s.id, stage: 'rendering', progress: 0 };
    note(s, this.backend.now(), 'Rendering started');
    await this.persist();
    try {
      const recent = st.contentLog.filter((r) => r.slotId !== s.id);
      const out = await this.backend.render(
        s,
        (p) => {
          this.activity = { slotId: s.id, stage: 'rendering', progress: p };
          this.emit();
        },
        this.abort.signal,
        recent,
      );
      const base = `${new Date(s.at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}_${s.format}_${s.seed}`;
      s.filePath = await this.backend.saveFile(st.outputDir, `${base}.${out.ext}`, out.bytes);
      s.thumbPath = out.thumbnail
        ? await this.backend.saveFile(st.outputDir, `${base}.jpg`, out.thumbnail)
        : undefined;
      s.meta = out.meta;
      s.title = out.meta.title;
      s.status = 'rendered';
      s.nextAttemptAt = undefined;
      // Rendered to be uploaded ahead: it stays that way even if the batch ends first.
      if (s.at <= this.horizons().upload) s.uploadAhead = true;
      if (out.content) {
        const record: ContentRecord = {
          ...out.content,
          slotId: s.id,
          at: s.at,
          format: s.format,
          moduleId: s.moduleId,
        };
        st.contentLog = [...recent, record].slice(-CONTENT_LOG_MAX);
      }
      note(s, this.backend.now(), `Rendered: ${out.meta.title}`);
    } catch (err) {
      s.status = 'planned';
      if ((err as Error)?.name === 'AbortError') {
        s.error = 'Cancelled';
        note(s, this.backend.now(), 'Rendering cancelled');
      } else this.fail(s, err instanceof Error ? err.message : String(err));
    }
    await this.persist();
  }

  private async uploadSlot(s: Slot): Promise<void> {
    const st = this.state!;
    const now = this.backend.now();
    s.status = 'uploading';
    this.activity = { slotId: s.id, stage: 'uploading', progress: 0 };
    const scheduleAhead =
      st.post.privacy === 'public' &&
      st.post.publishViaYouTube &&
      s.at - now > MIN_SCHEDULE_AHEAD_MS &&
      !s.manual;
    note(s, now, 'Uploading to YouTube');
    await this.persist();
    try {
      const res = await this.backend.upload(
        s.channelId,
        s.filePath!,
        s.meta!,
        {
          privacy: scheduleAhead ? 'private' : st.post.privacy,
          publishAt: scheduleAhead ? new Date(s.at).toISOString() : undefined,
          madeForKids: st.post.madeForKids,
          categoryId: st.post.categoryId,
        },
        (p) => {
          this.activity = { slotId: s.id, stage: 'uploading', progress: p };
          this.emit();
        },
      );
      s.status = 'posted';
      s.videoId = res.videoId;
      s.postedAt = this.backend.now();
      s.error = undefined;
      s.nextAttemptAt = undefined;
      note(
        s,
        s.postedAt,
        scheduleAhead
          ? `Uploaded; YouTube publishes it at ${new Date(s.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
          : `Published (${st.post.privacy})`,
      );
      if (s.thumbPath && this.backend.setThumbnail) {
        try {
          await this.backend.setThumbnail(s.channelId, res.videoId, s.thumbPath);
          s.thumbError = undefined;
          note(s, this.backend.now(), 'Custom thumbnail set');
        } catch (err) {
          // The video is up; a refused thumbnail (e.g. unverified channel, or a Short) is not a failure.
          s.thumbError = err instanceof Error ? err.message : String(err);
          note(s, this.backend.now(), `Thumbnail not set: ${s.thumbError}`, true);
        }
      }
      if (st.keepDays <= 0) await this.removeFiles(s);
    } catch (err) {
      s.status = 'rendered';
      this.fail(s, err instanceof Error ? err.message : String(err));
    }
    await this.persist();
  }
}
