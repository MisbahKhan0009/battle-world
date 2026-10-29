import { describe, expect, test } from 'vitest';
import {
  Autopilot,
  MISSED_GRACE_MS,
  PLAN_DAYS,
  RENDER_LEAD_MS,
  SCHEDULED_RENDER_LEAD_MS,
  type Backend,
} from './engine';
import { dayKey, planChannelsDay, planDay, shareFairly, videosOnDay } from './planner';
import {
  assignNewGames,
  connectedChannel,
  DEFAULT_SCHEDULE,
  defaultState,
  gamesForNewChannel,
  paceFor,
  type AutopilotState,
  type Channel,
  type ScheduleSettings,
} from './types';

const DAY = new Date(2026, 9, 29); // a Thursday
/** Older settings: a weekly pace of long videos per game and organic daily variation. */
const WEEKLY: ScheduleSettings = {
  ...DEFAULT_SCHEDULE,
  longPerDay: undefined,
  varyDaily: true,
  minGapMin: 75,
  perModule: { 'flag-battle': { shortsPerDay: 3, videosPerWeek: 2 } },
};
const GAMES = ['flag-battle', 'marble-race', 'ring-escape', 'growing-ball', 'paper-land'];

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

  test('every game posts one Short a day, and one long video a day takes turns between games', () => {
    const long = new Map<string, number>();
    for (let d = 0; d < 10; d++) {
      const plan = planDay('UCone', new Date(2026, 10, 2 + d), DEFAULT_SCHEDULE, GAMES);
      for (const g of GAMES)
        expect(plan.filter((p) => p.moduleId === g && p.format === 'short')).toHaveLength(1);
      const videos = plan.filter((p) => p.format === 'video');
      expect(videos).toHaveLength(1);
      long.set(videos[0].moduleId, (long.get(videos[0].moduleId) ?? 0) + 1);
    }
    // Ten days, five games: every game's long video comes round twice.
    expect([...long.values()]).toEqual([2, 2, 2, 2, 2]);
  });

  test('daily counts vary organically around the target and weekly videos add up', () => {
    const counts = new Map<number, number>();
    let videos = 0;
    for (let d = 0; d < 28; d++) {
      const day = new Date(2026, 10, 2 + d); // four whole weeks starting Monday
      const plan = planDay('UCx', day, { ...WEEKLY, dailyCap: 20 }, ['flag-battle']);
      const shorts = plan.filter((p) => p.format === 'short').length;
      counts.set(shorts, (counts.get(shorts) ?? 0) + 1);
      videos += plan.filter((p) => p.format === 'video').length;
    }
    expect(counts.size).toBeGreaterThan(1);
    const pace = paceFor(WEEKLY, 'flag-battle');
    for (const k of counts.keys()) expect(Math.abs(k - pace.shortsPerDay)).toBeLessThanOrEqual(1);
    expect(videos).toBe(pace.videosPerWeek * 4);
  });

  test('videos per week spread over distinct days', () => {
    const days = Array.from({ length: 7 }, (_, i) => videosOnDay('UCz', new Date(2026, 10, 2 + i), 3));
    expect(days.reduce((a, b) => a + b, 0)).toBe(3);
    expect(Math.max(...days)).toBe(1);
  });

  test('any 7 days in a row hold exactly the weekly number of long videos', () => {
    for (const perWeek of [1, 2, 3, 5]) {
      for (const key of ['UC1:flag-battle', 'UC2:ring-escape']) {
        const daily = Array.from({ length: 40 }, (_, i) =>
          videosOnDay(key, new Date(2026, 9, 1 + i), perWeek),
        );
        for (let s = 0; s + 7 <= daily.length; s++)
          expect(daily.slice(s, s + 7).reduce((a, b) => a + b, 0)).toBe(perWeek);
      }
    }
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
      longPerDay: 0,
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
      ...WEEKLY,
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

  test('organic variation keeps every weekly total exact, even at one a day', () => {
    for (const perDay of [1, 2, 3]) {
      const s: ScheduleSettings = {
        ...WEEKLY,
        dailyCap: 20,
        perModule: {
          'flag-battle': { shortsPerDay: perDay, videosPerWeek: 0 },
          'marble-race': { shortsPerDay: 1, videosPerWeek: 0 },
        },
      };
      for (let w = 0; w < 4; w++) {
        const per: Record<string, number> = {};
        const daily = new Set<number>();
        for (let d = 0; d < 7; d++) {
          const plan = planDay('UCw', new Date(2026, 10, 2 + w * 7 + d), s, ['flag-battle', 'marble-race']);
          const fb = plan.filter((p) => p.moduleId === 'flag-battle').length;
          daily.add(fb);
          for (const p of plan) per[p.moduleId] = (per[p.moduleId] ?? 0) + 1;
        }
        expect(per['flag-battle']).toBe(perDay * 7);
        expect(per['marble-race']).toBe(7);
        expect(daily.size).toBeGreaterThan(1);
      }
    }
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
  stored.channels = [
    {
      id: 'UC1',
      title: 'Me',
      thumbnail: '',
      connectedAt: start,
      enabled: true,
      games: { 'flag-battle': { shortsPerDay: 3, videosPerWeek: 2 } },
      dailyCap: 6,
    },
  ];
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

  test('each channel posts only its own games', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 6, 0).getTime());
    const ap = new Autopilot(env.backend, () => ['flag-battle', 'marble-race', 'ring-escape']);
    await ap.init();
    const [first] = ap.snapshot!.channels;
    await ap.update(
      {
        channels: [
          {
            ...first,
            games: {
              'flag-battle': { shortsPerDay: 2, videosPerWeek: 1 },
              'marble-race': { shortsPerDay: 2, videosPerWeek: 1 },
            },
          },
          {
            ...first,
            id: 'UC2',
            title: 'Second',
            games: { 'ring-escape': { shortsPerDay: 3, videosPerWeek: 2 } },
          },
        ],
      },
      { replan: true },
    );
    const slots = ap.snapshot!.slots;
    expect(new Set(slots.filter((s) => s.channelId === 'UC1').map((s) => s.moduleId))).toEqual(
      new Set(['flag-battle', 'marble-race']),
    );
    expect(new Set(slots.filter((s) => s.channelId === 'UC2').map((s) => s.moduleId))).toEqual(
      new Set(['ring-escape']),
    );
  });

  test('the week ahead never plans more than the all-channels limit on any day', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 6, 0).getTime());
    const ap = new Autopilot(env.backend, () => [
      'flag-battle',
      'marble-race',
      'ring-escape',
      'growing-ball',
    ]);
    await ap.init();
    const [first] = ap.snapshot!.channels;
    await ap.update(
      {
        channels: [
          {
            ...first,
            games: {
              'flag-battle': { shortsPerDay: 3, videosPerWeek: 2 },
              'marble-race': { shortsPerDay: 2, videosPerWeek: 2 },
            },
          },
          {
            ...first,
            id: 'UC2',
            title: 'Second',
            games: {
              'ring-escape': { shortsPerDay: 3, videosPerWeek: 2 },
              'growing-ball': { shortsPerDay: 2, videosPerWeek: 2 },
            },
          },
        ],
        schedule: { ...ap.snapshot!.schedule, projectCap: 6 },
      },
      { replan: true },
    );
    const perDay = new Map<string, { UC1: number; UC2: number }>();
    for (const s of ap.snapshot!.slots) {
      const d = perDay.get(dayKey(new Date(s.at))) ?? { UC1: 0, UC2: 0 };
      d[s.channelId as 'UC1' | 'UC2']++;
      perDay.set(dayKey(new Date(s.at)), d);
    }
    expect(perDay.size).toBeGreaterThanOrEqual(6);
    for (const d of perDay.values()) {
      expect(d.UC1 + d.UC2).toBeLessThanOrEqual(6);
      expect(d.UC1).toBeGreaterThan(0);
      expect(d.UC2).toBeGreaterThan(0);
    }
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
    // Every upload waits for the reset (midnight Pacific), within a day.
    expect(s.nextAttemptAt!).toBeGreaterThan(env.now);
    expect(s.nextAttemptAt! - env.now).toBeLessThanOrEqual(86_400_000);
    expect(ap.snapshot!.uploadPausedUntil).toBe(s.nextAttemptAt);
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
        schedule: { ...ap.snapshot!.schedule, varyDaily: false, longPerDay: 0 },
        channels: ap.snapshot!.channels.map((c) => ({
          ...c,
          games: { 'flag-battle': { shortsPerDay: 1, videosPerWeek: 0 } },
        })),
      },
      { replan: true },
    );
    const today = ap.snapshot!.slots.filter((s) => dayKey(new Date(s.at)) === '2026-10-29');
    expect(today.length).toBe(1);
  });
});

describe('preparing ahead', () => {
  const NOW = new Date(2026, 9, 29, 21, 0).getTime();
  const end = (offset: number) => new Date(2026, 9, 29 + offset + 1).getTime();

  test('hands-off mode keeps the next days rendered and scheduled on YouTube', async () => {
    const env = fakeBackend(NOW);
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.update({ prepare: { ...ap.snapshot!.prepare!, handsOffDays: 3 } });
    await drain(ap, 40);
    const slots = ap.snapshot!.slots;
    const within = slots.filter((x) => x.at > NOW && x.at < end(3));
    expect(within.length).toBeGreaterThan(6);
    for (const x of within) expect(x.status).toBe('posted');
    for (const x of slots.filter((y) => y.at >= end(3))) expect(x.status).toBe('planned');
    // Every upload is scheduled for its own planned time.
    expect(env.uploads.every((u) => u.privacy === 'private' && u.publishAt)).toBe(true);
  });

  test('daily preparation readies tomorrow once its time has come', async () => {
    const env = fakeBackend(new Date(2026, 9, 29, 19, 0).getTime());
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.update({ prepare: { ...ap.snapshot!.prepare!, auto: 'daily', atMin: 20 * 60 } });
    await drain(ap, 10);
    const tomorrow = () => ap.snapshot!.slots.filter((x) => dayKey(new Date(x.at)) === '2026-10-30');
    expect(tomorrow().every((x) => x.status === 'planned')).toBe(true);
    env.advance(90 * 60_000);
    await drain(ap, 20);
    expect(tomorrow().length).toBeGreaterThan(0);
    expect(tomorrow().every((x) => x.status === 'posted')).toBe(true);
  });

  test('a batch prepares a date range even while paused, then finishes', async () => {
    const env = fakeBackend(NOW);
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.update({ running: false });
    await ap.startBatch({ from: '2026-11-04', to: '2026-11-03', upload: true, after: 'shutdown' });
    await drain(ap, 30);
    const st = ap.snapshot!;
    expect(st.batch!.from).toBe('2026-11-03');
    const days = st.slots.filter((x) => ['2026-11-03', '2026-11-04'].includes(dayKey(new Date(x.at))));
    expect(days.length).toBeGreaterThan(2);
    expect(days.every((x) => x.status === 'posted')).toBe(true);
    expect(st.slots.filter((x) => !days.includes(x)).every((x) => x.status === 'planned')).toBe(true);
    expect(st.batch!.finishedAt).toBeDefined();
  });

  test('a render-only batch leaves the uploads for later', async () => {
    const env = fakeBackend(NOW);
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.startBatch({ from: '2026-11-03', to: '2026-11-03', upload: false, after: 'nothing' });
    await drain(ap, 20);
    const day = ap.snapshot!.slots.filter((x) => dayKey(new Date(x.at)) === '2026-11-03');
    expect(day.every((x) => x.status === 'rendered')).toBe(true);
    expect(ap.snapshot!.batch!.finishedAt).toBeDefined();
  });

  test('when the upload quota runs out, the batch is done for tonight and uploads wait', async () => {
    const env = fakeBackend(NOW);
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.startBatch({ from: '2026-11-03', to: '2026-11-05', upload: true, after: 'sleep' });
    env.always.fail = 'youtube:quotaExceeded';
    await drain(ap, 40);
    const st = ap.snapshot!;
    expect(st.batch!.finishedAt).toBeDefined();
    const range = st.slots.filter((x) => ['2026-11-03', '2026-11-05'].includes(dayKey(new Date(x.at))));
    expect(range.every((x) => x.status === 'rendered')).toBe(true);
    // After the reset they go up.
    env.always.fail = '';
    env.advance(st.uploadPausedUntil! - env.now + 1000);
    await drain(ap, 40);
    expect(range.map((x) => ap.snapshot!.slots.find((y) => y.id === x.id)!.status)).not.toContain('rendered');
  });

  test('review before upload waits for your approval', async () => {
    const env = fakeBackend(NOW);
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.update({ prepare: { ...ap.snapshot!.prepare!, handsOffDays: 1, review: true } });
    await drain(ap, 20);
    const ready = ap.snapshot!.slots.filter((x) => x.status === 'rendered');
    expect(ready.length).toBeGreaterThan(0);
    expect(env.uploads).toHaveLength(0);
    await ap.approve([ready[0].id]);
    await drain(ap, 3);
    expect(ap.snapshot!.slots.find((x) => x.id === ready[0].id)!.status).toBe('posted');
    expect(env.uploads).toHaveLength(1);
  });

  test('a video can be edited, re-rendered or published right away', async () => {
    const env = fakeBackend(NOW);
    const ap = new Autopilot(env.backend, () => ['flag-battle']);
    await ap.init();
    await ap.update({ prepare: { ...ap.snapshot!.prepare!, review: true }, running: false });
    await ap.startBatch({ from: '2026-11-03', to: '2026-11-03', upload: false, after: 'nothing' });
    await drain(ap, 10);
    const s = ap.snapshot!.slots.find((x) => x.status === 'rendered')!;
    await ap.editSlot(s.id, { title: 'My own title' });
    expect(ap.snapshot!.slots.find((x) => x.id === s.id)!.meta!.title).toBe('My own title');
    const seed = s.seed;
    await ap.rerender(s.id);
    const again = ap.snapshot!.slots.find((x) => x.id === s.id)!;
    expect(again.status).toBe('planned');
    expect(again.seed).not.toBe(seed);
    await ap.publishNow(s.id);
    await drain(ap, 3);
    const out = ap.snapshot!.slots.find((x) => x.id === s.id)!;
    expect(out.status).toBe('posted');
    expect(env.uploads.at(-1)!.publishAt).toBeUndefined();
  });
});

describe('channels', () => {
  const ready = ['flag-battle', 'marble-race', 'ring-escape'];
  const info = (id: string) => ({ id, title: id, thumbnail: '' });

  test('the first channel gets every game; a later one gets only games nobody posts yet', () => {
    const first = connectedChannel(info('UC1'), [], ready);
    expect(Object.keys(first.games)).toEqual(ready);
    expect(gamesForNewChannel([first], ready)).toEqual({});
  });

  test("reconnecting keeps a channel's games and limit", () => {
    const before: Channel = {
      ...connectedChannel(info('UC1'), [], ready),
      games: { 'ring-escape': { shortsPerDay: 4, videosPerWeek: 1 } },
      dailyCap: 3,
      enabled: false,
    };
    const again = connectedChannel({ ...info('UC1'), title: 'Renamed' }, [before], ready);
    expect(again.games).toEqual(before.games);
    expect(again.dailyCap).toBe(3);
    expect(again.enabled).toBe(false);
    expect(again.title).toBe('Renamed');
  });

  test('a newly released game goes to the main channel, once', () => {
    const ready = ['flag-battle', 'marble-race', 'ring-escape', 'growing-ball'];
    const known = ['flag-battle', 'marble-race', 'ring-escape'];
    const one = connectedChannel(info('UC1'), [], known);
    const out = assignNewGames([one], ready, known)!;
    expect(Object.keys(out[0].games)).toEqual(ready);
    // Already known (the user may have removed it on purpose): nothing changes.
    expect(assignNewGames([one], ready, ready)).toBeNull();
  });

  test('all channels together stay within the shared daily limit, split fairly', () => {
    expect(shareFairly([5, 6], 6, 0)).toEqual([3, 3]);
    expect(shareFairly([2, 6], 6, 0)).toEqual([2, 4]);
    expect(shareFairly([5, 6], 7, 1)).toEqual([3, 4]);
    expect(shareFairly([1, 1], 6, 0)).toEqual([1, 1]);
    const ready = ['flag-battle', 'marble-race', 'ring-escape', 'growing-ball'];
    const pace = { shortsPerDay: 2, videosPerWeek: 0 };
    const one = {
      ...connectedChannel(info('UC1'), [], ready),
      games: { 'flag-battle': pace, 'marble-race': pace },
    };
    const two = {
      ...connectedChannel(info('UC2'), [one], ready),
      games: { 'ring-escape': pace, 'growing-ball': pace },
    };
    const limited = { ...DEFAULT_SCHEDULE, projectCap: 6 };
    const totals = [0, 0];
    for (let d = 0; d < 28; d++) {
      const plans = planChannelsDay(new Date(2026, 10, 1 + d), [one, two], limited, ready);
      const a = plans.get('UC1')!.length;
      const b = plans.get('UC2')!.length;
      expect(a + b).toBeLessThanOrEqual(6);
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
      totals[0] += a;
      totals[1] += b;
      // Each channel still posts only its own games.
      for (const p of plans.get('UC2')!) expect(['ring-escape', 'growing-ball']).toContain(p.moduleId);
    }
    expect(totals[0] + totals[1]).toBe(6 * 28);
    // A raised limit (more quota from Google) lets each channel post its full pace again.
    const roomy = planChannelsDay(
      new Date(2026, 10, 3),
      [one, two],
      { ...DEFAULT_SCHEDULE, projectCap: 30 },
      ready,
    );
    expect(roomy.get('UC1')!.length).toBe(
      planDay('UC1', new Date(2026, 10, 3), { ...DEFAULT_SCHEDULE, perModule: one.games }, [
        'flag-battle',
        'marble-race',
      ]).length,
    );
  });
});
