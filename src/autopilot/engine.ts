/**
 * Autopilot runtime. Keeps every connected channel's plan for today and tomorrow, renders each
 * post shortly before its slot, uploads it, retries failures with backoff, and skips slots missed
 * while the computer was off (posting them late in a burst would look unnatural).
 *
 * All side effects go through a Backend, so the logic is testable without Tauri.
 */
import { dayKey, planDay, type PlannedSlot } from './planner';
import type { AutopilotState, ContentFormat, Slot, VideoMeta } from './types';

export type RenderResult = { bytes: Uint8Array; ext: string; meta: VideoMeta };

export type Backend = {
  now(): number;
  load(): Promise<AutopilotState>;
  save(state: AutopilotState): Promise<void>;
  /** Renders a post for a module. Progress is 0..1. */
  render(slot: Slot, onProgress: (p: number) => void, signal: AbortSignal): Promise<RenderResult>;
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
};

export type Activity = { slotId: string; stage: 'rendering' | 'uploading'; progress: number } | null;

/** Render this long before the slot so the post is ready on time. */
export const RENDER_LEAD_MS = 30 * 60_000;
/** Slots missed by more than this (app was off) are skipped. */
export const MISSED_GRACE_MS = 2 * 3_600_000;
const RETRY_DELAYS_MIN = [5, 20, 60];
const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1;
const HISTORY_DAYS = 30;
/** YouTube needs publishAt comfortably in the future. */
const MIN_SCHEDULE_AHEAD_MS = 15 * 60_000;

const DONE: Slot['status'][] = ['posted', 'failed', 'skipped'];

function startOfDay(ms: number): Date {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function nextMidnight(ms: number): number {
  const d = startOfDay(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 7).getTime();
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

  private enabledModules(): string[] {
    const ready = new Set(this.readyModules());
    return Object.entries(this.state!.modules)
      .filter(([id, on]) => on && ready.has(id))
      .map(([id]) => id);
  }

  /** Drops planned (not started) automatic slots and plans today and tomorrow again. */
  replanFuture(): void {
    const st = this.state!;
    st.slots = st.slots.filter((s) => s.status !== 'planned' || s.manual);
    st.plannedDays = {};
    this.ensurePlans();
  }

  private ensurePlans(): boolean {
    const st = this.state!;
    const now = this.backend.now();
    const modules = this.enabledModules();
    let changed = false;
    for (const ch of st.channels) {
      if (!ch.enabled) continue;
      const done = new Set(st.plannedDays[ch.id] ?? []);
      for (let offset = 0; offset < 2; offset++) {
        const today = startOfDay(now);
        const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
        const key = dayKey(day);
        if (done.has(key)) continue;
        let plan: PlannedSlot[] = planDay(ch.id, day, st.schedule, modules);
        if (offset === 0) {
          // Planning mid-day: keep only future slots, within what is left of today's cap.
          const used = st.slots.filter(
            (s) =>
              s.channelId === ch.id && !s.manual && dayKey(new Date(s.at)) === key && s.status !== 'skipped',
          ).length;
          plan = plan
            .filter((p) => p.at > now + 2 * 60_000)
            .slice(0, Math.max(0, st.schedule.dailyCap - used));
        }
        const existing = new Set(st.slots.map((s) => s.id));
        for (const p of plan) {
          if (existing.has(p.id)) continue;
          st.slots.push({ ...p, status: 'planned', attempts: 0 });
        }
        done.add(key);
        changed = true;
      }
      st.plannedDays[ch.id] = [...done].sort().slice(-7);
    }
    if (changed) st.slots.sort((a, b) => a.at - b.at);
    return changed;
  }

  /** Queues an immediate post (renders and uploads right away, outside the plan). */
  async postNow(channelId: string, format: ContentFormat, moduleId = 'flag-battle'): Promise<void> {
    if (!this.state) return;
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

    if (st.running) changed = this.ensurePlans() || changed;

    // Skip automatic slots missed while the app was off.
    for (const s of st.slots) {
      if (s.status === 'planned' && !s.manual && s.at < now - MISSED_GRACE_MS) {
        s.status = 'skipped';
        s.error = 'Missed while the app was not running';
        changed = true;
      }
    }

    // Trim history.
    const cutoff = now - HISTORY_DAYS * 86_400_000;
    const before = st.slots.length;
    st.slots = st.slots.filter((s) => !(DONE.includes(s.status) && s.at < cutoff));
    if (st.slots.length !== before) changed = true;

    // Delete rendered files past the retention period.
    for (const s of st.slots) {
      if (s.status === 'posted' && s.filePath && (s.postedAt ?? 0) < now - st.keepDays * 86_400_000) {
        await this.backend.deleteFile(s.filePath).catch(() => undefined);
        s.filePath = undefined;
        changed = true;
      }
    }

    if (changed) await this.persist();
    if (!st.running && !st.slots.some((s) => s.manual && !DONE.includes(s.status))) return;

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
  }

  /** Disabled channels keep their history but only take "Post now" jobs. */
  private channelUsable(s: Slot): boolean {
    const ch = this.state!.channels.find((c) => c.id === s.channelId);
    return !!ch && (ch.enabled || !!s.manual);
  }

  private nextJob(now: number): Slot | null {
    const st = this.state!;
    const candidates = st.slots.filter((s) => {
      if (!this.channelUsable(s)) return false;
      if (!st.running && !s.manual) return false;
      if (s.nextAttemptAt && s.nextAttemptAt > now) return false;
      if (s.status === 'planned') return s.manual || s.at - RENDER_LEAD_MS <= now;
      if (s.status === 'rendered') return s.manual || this.canUploadNow(s, now);
      return false;
    });
    // Uploads first (they are time-critical), then renders, earliest slot first.
    candidates.sort((a, b) => (a.status === b.status ? a.at - b.at : a.status === 'rendered' ? -1 : 1));
    return candidates[0] ?? null;
  }

  private canUploadNow(s: Slot, now: number): boolean {
    const { post } = this.state!;
    if (post.privacy === 'public' && post.publishViaYouTube && s.at - now > MIN_SCHEDULE_AHEAD_MS)
      return true;
    return s.at <= now;
  }

  private fail(s: Slot, message: string): void {
    const now = this.backend.now();
    s.error = message;
    if (isQuotaError(message)) {
      // Out of quota: try again after the daily reset without burning an attempt.
      s.nextAttemptAt = nextMidnight(now);
      return;
    }
    s.attempts += 1;
    if (s.attempts >= MAX_ATTEMPTS) s.status = 'failed';
    else s.nextAttemptAt = now + RETRY_DELAYS_MIN[s.attempts - 1] * 60_000;
  }

  private async renderSlot(s: Slot): Promise<void> {
    const st = this.state!;
    s.status = 'rendering';
    s.error = undefined;
    this.abort = new AbortController();
    this.activity = { slotId: s.id, stage: 'rendering', progress: 0 };
    await this.persist();
    try {
      const out = await this.backend.render(
        s,
        (p) => {
          this.activity = { slotId: s.id, stage: 'rendering', progress: p };
          this.emit();
        },
        this.abort.signal,
      );
      const name = `${new Date(s.at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}_${s.format}_${s.seed}.${out.ext}`;
      s.filePath = await this.backend.saveFile(st.outputDir, name, out.bytes);
      s.meta = out.meta;
      s.title = out.meta.title;
      s.status = 'rendered';
      s.nextAttemptAt = undefined;
    } catch (err) {
      s.status = 'planned';
      if ((err as Error)?.name === 'AbortError') s.error = 'Cancelled';
      else this.fail(s, err instanceof Error ? err.message : String(err));
    }
    await this.persist();
  }

  private async uploadSlot(s: Slot): Promise<void> {
    const st = this.state!;
    const now = this.backend.now();
    s.status = 'uploading';
    this.activity = { slotId: s.id, stage: 'uploading', progress: 0 };
    await this.persist();
    const scheduleAhead =
      st.post.privacy === 'public' &&
      st.post.publishViaYouTube &&
      s.at - now > MIN_SCHEDULE_AHEAD_MS &&
      !s.manual;
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
      if (st.keepDays <= 0 && s.filePath) {
        await this.backend.deleteFile(s.filePath).catch(() => undefined);
        s.filePath = undefined;
      }
    } catch (err) {
      s.status = 'rendered';
      this.fail(s, err instanceof Error ? err.message : String(err));
    }
    await this.persist();
  }
}
