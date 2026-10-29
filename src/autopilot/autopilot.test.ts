import { describe, expect, test } from 'vitest';
import {
  Autopilot,
  MISSED_GRACE_MS,
  PLAN_DAYS,
  RENDER_LEAD_MS,
  SCHEDULED_RENDER_LEAD_MS,
  type Backend,
} from './engine';
import { dayKey, planDay, videosOnDay } from './planner';
import { DEFAULT_SCHEDULE, defaultState, paceFor, type AutopilotState, type ScheduleSettings } from './types';

const DAY = new Date(2026, 9, 29); // a Thursday

describe('planner', () => {
  test('is deterministic per channel and day', () => {
    const a = planDay('UC1', DAY, DEFAULT_SCHEDULE, ['flag-battle']);
    const b = planDay('UC1', DAY, DEFAULT_SCHEDULE, ['flag-battle']);
    expect(a).toEqual(b);
    const other = planDay('UC2', DAY, DEFAULT_SCHEDULE, ['flag-battle']);
    expect(other.map((s) => s.at)).not.toEqual(a.map((s) => s.at));
  });

  test('respects the window, minimum gap, cap and avoids round minutes', () => {
    for (let d = 0; d < 60; d++) {
      const day = new Date(2026, 9, 1 + d);
      for (const ch of ['UCa', 'UCb', 'UCc']) {
        const plan = planDay(ch, day, DEFAULT_SCHEDULE, ['flag-battle']);
        expect(plan.length).toBeLessThanOrEqual(DEFAULT_SCHEDULE.dailyCap);
        for (let i = 0; i < plan.length; i++) {
          const t = new Date(plan[i].at);
          const min = t.getHours() * 60 + t.getMinutes();
          expect(dayKey(t)).toBe(dayKey(day));
          expect(min).toBeGreaterThanOrEqual(DEFAULT_SCHEDULE.activeStartMin);
          expect(min).toBeLessThanOrEqual(DEFAULT_SCHEDULE.activeEndMin);
          expect(min % 5).not.toBe(0);
          if (i > 0)
            expect(plan[i].at - plan[i - 1].at).toBeGreaterThanOrEqual(
              (DEFAULT_SCHEDULE.minGapMin - 5) * 60_000,
            );
        }
      }
    }
  });

  test('daily counts vary organically around the target and weekly videos add up', () => {
    const counts = new Map<number, number>();
    let videos = 0;
    for (let d = 0; d < 28; d++) {
      const day = new Date(2026, 10, 2 + d); // four whole weeks starting Monday
      const plan = planDay('UCx', day, { ...DEFAULT_SCHEDULE, dailyCap: 20 }, ['flag-battle']);
      const shorts = plan.filter((p) => p.format === 'short').length;
      counts.set(shorts, (counts.get(shorts) ?? 0) + 1);
      videos += plan.filter((p) => p.format === 'video').length;
    }
    expect(counts.size).toBeGreaterThan(1);
    const pace = paceFor(DEFAULT_SCHEDULE, 'flag-battle');
    for (const k of counts.keys()) expect(Math.abs(k - pace.shortsPerDay)).toBeLessThanOrEqual(1);
    expect(videos).toBe(pace.videosPerWeek * 4);
  });

  test('videos per week spread over distinct days', () => {
    const days = Array.from({ length: 7 }, (_, i) => videosOnDay('UCz', new Date(2026, 10, 2 + i), 3));
    expect(days.reduce((a, b) => a + b, 0)).toBe(3);
    expect(Math.max(...days)).toBe(1);
  });

  test('peak hours put more posts in the evening than the morning, at varying times', () => {
    let morning = 0;
    let evening = 0;
    const firstTimes = new Set<number>();
    for (let d = 0; d < 60; d++) {
      const plan = planDay('UCp', new Date(2026, 9, 1 + d), DEFAULT_SCHEDULE, ['flag-battle']);
      for (const p of plan) {
        const h = new Date(p.at).getHours();
        if (h >= 9 && h < 12) morning++;
        if (h >= 18 && h < 23) evening++;
      }
      const t = new Date(plan[0].at);
      firstTimes.add(t.getHours() * 60 + t.getMinutes());
    }
    expect(evening).toBeGreaterThan(morning * 1.5);
    expect(firstTimes.size).toBeGreaterThan(40);
  });

  test('audience time zone shifts the plan', () => {
    const local = planDay('UCt', DAY, { ...DEFAULT_SCHEDULE, activeStartMin: 0, activeEndMin: 1439 }, [
      'flag-battle',
    ]);
    const far = planDay(
      'UCt',
      DAY,
      { ...DEFAULT_SCHEDULE, activeStartMin: 0, activeEndMin: 1439, audienceTz: 'Pacific/Kiritimati' },
      ['flag-battle'],
    );
    expect(far.map((p) => p.at)).not.toEqual(local.map((p) => p.at));
  });

  test('zero frequency plans nothing', () => {
    const s: ScheduleSettings = {
      ...DEFAULT_SCHEDULE,
      perModule: {
        'flag-battle': { shortsPerDay: 0, videosPerWeek: 0 },
        'marble-race': { shortsPerDay: 0, videosPerWeek: 0 },
      },
    };
    expect(planDay('UC1', DAY, s, ['flag-battle', 'marble-race'])).toEqual([]);
  });

  test('each game keeps its own pace on one shared, non-overlapping timeline', () => {
    const both = ['flag-battle', 'marble-race'];
    const s: ScheduleSettings = {
      ...DEFAULT_SCHEDULE,
      dailyCap: 20,
      varyDaily: false,
      perModule: {
        'flag-battle': { shortsPerDay: 3, videosPerWeek: 2 },
        'marble-race': { shortsPerDay: 2, videosPerWeek: 3 },
      },
    };
    const per = { 'flag-battle': { short: 0, video: 0 }, 'marble-race': { short: 0, video: 0 } };
    let backToBack = 0;
    let pairs = 0;
    for (let d = 0; d < 28; d++) {
      const plan = planDay('UCm', new Date(2026, 10, 2 + d), s, both);
      for (let i = 0; i < plan.length; i++) {
        per[plan[i].moduleId as keyof typeof per][plan[i].format]++;
        if (i > 0) {
          // Never overlapping: every post keeps the minimum gap, whatever game it belongs to.
          expect(plan[i].at - plan[i - 1].at).toBeGreaterThanOrEqual((s.minGapMin - 5) * 60_000);
          pairs++;
          if (plan[i].moduleId === plan[i - 1].moduleId) backToBack++;
        }
      }
    }
    expect(per['flag-battle']).toEqual({ short: 3 * 28, video: 2 * 4 });
    expect(per['marble-race']).toEqual({ short: 2 * 28, video: 3 * 4 });
    // Games alternate most of the time.
    expect(backToBack / pairs).toBeLessThan(0.35);
  });

  test('the shared daily cap is split fairly between games', () => {
    const s: ScheduleSettings = {
      ...DEFAULT_SCHEDULE,
      dailyCap: 4,
      varyDaily: false,
      perModule: {
        'flag-battle': { shortsPerDay: 5, videosPerWeek: 0 },
        'marble-race': { shortsPerDay: 5, videosPerWeek: 0 },
      },
    };
    const plan = planDay('UCc', DAY, s, ['flag-battle', 'marble-race']);
    expect(plan.length).toBe(4);
    expect(plan.filter((p) => p.moduleId === 'marble-race').length).toBe(2);
  });
});

function fakeBackend(start: number) {
  let now = start;
  let stored: AutopilotState = { ...defaultState('/out'), running: true };
  stored.channels = [{ id: 'UC1', title: 'Me', thumbnail: '', connectedAt: start, enabled: true }];
  const uploads: { publishAt?: string; privacy: string }[] = [];
  const thumbs: string[] = [];
  const failNext: string[] = [];
  const always = { fail: '' };
  const backend: Backend = {
    now: () => now,
    load: async () => structuredClone(stored),
    save: async (s) => {
      stored = structuredClone(s);
    },
    render: async (slot) => ({
      bytes: new Uint8Array([1, 2, 3]),
      ext: 'mp4',
      meta: { title: 'T', description: 'D', tags: [] },
      thumbnail: new Uint8Array([9]),
      content: { count: 10 + (slot.seed % 20), roster: ['xx'], winner: `w${slot.seed}` },
    }),
    saveFile: async (dir, name) => `${dir}/${name}`,
    deleteFile: async () => undefined,
    setThumbnail: async (_c, videoId) => {
      thumbs.push(videoId);
    },
    upload: async (_c, _p, _m, opts) => {
      const f = always.fail || failNext.shift();
      if (f) throw new Error(f);
      uploads.push(opts);
      return { videoId: `v${uploads.length}` };
    },
  };
  return {
    backend,
    uploads,
    thumbs,
    failNext,
    always,
    advance: (ms: number) => (now += ms),
    get now() {
      return now;
    },
  };
}

async function drain(ap: Autopilot, n = 10) {
  for (let i = 0; i < n; i++) await ap.tick();
}

describe('engine', () => {
  test('plans, renders before the slot, schedules the upload on YouTube and marks it posted', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 6, 0).getTime());
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.tick();
    const slots = ap.snapshot!.slots;
    expect(slots.length).toBeGreaterThan(0);
    const first = slots[0];
    // Jump to just inside the render lead.
    env.advance(first.at - env.now - RENDER_LEAD_MS + 1000);
    await drain(ap, 3);
    const s = ap.snapshot!.slots.find((x) => x.id === first.id)!;
    expect(s.status).toBe('posted');
    expect(env.uploads[0].privacy).toBe('private');
    expect(new Date(env.uploads[0].publishAt!).getTime()).toBe(first.at);
    // Thumbnail set, history recorded, and the post's timeline tells the story.
    expect(env.thumbs).toContain(s.videoId);
    expect(ap.snapshot!.contentLog.map((r) => r.slotId)).toContain(first.id);
    expect(s.log!.map((e) => e.text)).toEqual([
      'Added to the schedule',
      'Rendering started',
      'Rendered: T',
      'Uploading to YouTube',
      expect.stringMatching(/^Uploaded; YouTube publishes it at/),
      'Custom thumbnail set',
    ]);
  });

  test('queues a full week ahead', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 6, 0).getTime());
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.tick();
    const days = new Set(ap.snapshot!.slots.map((s) => dayKey(new Date(s.at))));
    expect(days.size).toBe(PLAN_DAYS);
    expect(ap.snapshot!.slots.every((s) => s.status === 'planned')).toBe(true);
    // A day later the week rolls forward by one day.
    env.advance(86_400_000);
    await ap.tick();
    expect(ap.snapshot!.slots.some((s) => dayKey(new Date(s.at)) === '2026-11-05')).toBe(true);
  });

  test('scheduled publishing renders hours ahead so the PC can be off at post time', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 6, 0).getTime());
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.tick();
    const first = ap.snapshot!.slots[0];
    env.advance(first.at - env.now - SCHEDULED_RENDER_LEAD_MS + 60_000);
    await drain(ap, 3);
    expect(ap.snapshot!.slots.find((x) => x.id === first.id)!.status).toBe('posted');
  });

  test('retries failed uploads with backoff, then gives up', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 6, 0).getTime());
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.update({ post: { ...ap.snapshot!.post, publishViaYouTube: false } });
    await ap.tick();
    const first = ap.snapshot!.slots[0];
    env.advance(first.at - env.now + 1000);
    env.always.fail = 'network down';
    await drain(ap, 3);
    let s = ap.snapshot!.slots.find((x) => x.id === first.id)!;
    expect(s.status).toBe('rendered');
    expect(s.attempts).toBe(1);
    for (let i = 0; i < 4; i++) {
      env.advance(61 * 60_000);
      await drain(ap, 2);
    }
    s = ap.snapshot!.slots.find((x) => x.id === first.id)!;
    expect(s.status).toBe('failed');
  });

  test('quota errors wait for the daily reset without using up attempts', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 6, 0).getTime());
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.update({ post: { ...ap.snapshot!.post, publishViaYouTube: false } });
    await ap.tick();
    const first = ap.snapshot!.slots[0];
    env.advance(first.at - env.now + 1000);
    env.failNext.push('youtube:quotaExceeded: The request cannot be completed');
    await drain(ap, 3);
    const s = ap.snapshot!.slots.find((x) => x.id === first.id)!;
    expect(s.attempts).toBe(0);
    expect(new Date(s.nextAttemptAt!).getDate()).toBe(30);
  });

  test('slots missed while the app was off are skipped, not burst-posted', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 6, 0).getTime());
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.tick();
    const first = ap.snapshot!.slots[0];
    env.advance(first.at - env.now + MISSED_GRACE_MS + 60_000);
    await ap.tick();
    expect(ap.snapshot!.slots.find((x) => x.id === first.id)!.status).toBe('skipped');
  });

  test('paused autopilot does nothing except Post now', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 12, 0).getTime());
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.update({ running: false });
    await drain(ap, 2);
    expect(ap.snapshot!.slots.length).toBe(0);
    await ap.postNow('UC1', 'short');
    await drain(ap, 3);
    expect(ap.snapshot!.slots[0].status).toBe('posted');
    expect(env.uploads[0].publishAt).toBeUndefined();
  });

  test('changing the schedule re-plans only the future', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 6, 0).getTime());
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.tick();
    await ap.update(
      {
        schedule: {
          ...ap.snapshot!.schedule,
          perModule: { 'flag-battle': { shortsPerDay: 1, videosPerWeek: 0 } },
          varyDaily: false,
        },
      },
      { replan: true },
    );
    const today = ap.snapshot!.slots.filter((s) => dayKey(new Date(s.at)) === '2026-10-29');
    expect(today.length).toBe(1);
  });
});
