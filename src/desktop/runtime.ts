/**
 * Desktop autopilot runtime: one Autopilot instance wired to the Tauri backend and the module
 * registry, ticked by the Rust heartbeat (works while the window is hidden in the tray).
 */
import { useSyncExternalStore } from 'react';
import { Autopilot, type Activity, type Backend } from '../autopilot/engine';
import {
  assignNewGames,
  DEFAULT_PACE,
  defaultState,
  LEGACY_GAMES,
  type AutopilotState,
  type ScheduleSettings,
} from '../autopilot/types';
import { moduleById, readyModuleIds } from '../modules/registry';
import { desktop, isDesktop } from './bridge';

let instance: Autopilot | null = null;
let starting: Promise<Autopilot> | null = null;

function mergeState(raw: string | null, outputDir: string): AutopilotState {
  const base = { ...defaultState(outputDir), knownGames: readyModuleIds() };
  if (!raw) return base;
  try {
    const p = JSON.parse(raw) as Partial<AutopilotState>;
    // Before per-game schedules there was one global pace. Move it over, and re-plan the week so
    // newly added games get their share.
    const old = p.schedule as
      | (Partial<ScheduleSettings> & { shortsPerDay?: number; videosPerWeek?: number })
      | undefined;
    const { shortsPerDay, videosPerWeek, ...restSchedule } = old ?? {};
    let perModule = old?.perModule;
    const migrate = !!old && !perModule;
    if (!perModule) {
      perModule = structuredClone(DEFAULT_PACE);
      // A customized global pace stays with Flag Battle; the defaults are now split between games.
      if (shortsPerDay !== undefined && !(shortsPerDay === 5 && videosPerWeek === 4))
        perModule['flag-battle'] = { shortsPerDay, videosPerWeek: videosPerWeek ?? 2 };
    }
    // Before games belonged to channels, every channel posted every switched-on game. Give each
    // existing channel those games with the paces and limit it had.
    const legacyModules: Record<string, boolean> = { 'flag-battle': true, 'marble-race': true, ...p.modules };
    const needGames = (p.channels ?? []).some((c) => !c.games);
    let channels = (p.channels ?? []).map((c) =>
      c.games
        ? c
        : {
            ...c,
            games: Object.fromEntries(
              ['flag-battle', 'marble-race']
                .filter((id) => legacyModules[id])
                .map((id) => [id, perModule![id] ?? DEFAULT_PACE[id]]),
            ),
            dailyCap: old?.dailyCap ?? base.schedule.dailyCap,
          },
    );
    // A game released since the last start goes to a channel that still has room for one.
    const assigned = assignNewGames(channels, readyModuleIds(), p.knownGames ?? LEGACY_GAMES);
    if (assigned) channels = assigned;
    const replan = migrate || needGames || !!assigned;
    return {
      ...base,
      ...p,
      channels,
      ...(replan
        ? { slots: (p.slots ?? []).filter((s) => s.status !== 'planned' || s.manual), plannedDays: {} }
        : {}),
      schedule: { ...base.schedule, ...restSchedule, perModule },
      // Made for kids became the default; apply it once to existing installs too.
      post: { ...base.post, ...p.post, ...(p.kidsDefaulted ? {} : { madeForKids: true }) },
      kidsDefaulted: true,
      knownGames: readyModuleIds(),
      stats: p.stats ?? {},
      google: { ...base.google, ...p.google },
      modules: { ...base.modules, ...p.modules },
      outputDir: p.outputDir || outputDir,
      // Older installs that already have a channel skip the wizard.
      setupDone: p.setupDone ?? (p.channels?.length ?? 0) > 0,
    };
  } catch {
    return base;
  }
}

function backend(): Backend {
  let state: AutopilotState | null = null;
  return {
    now: () => Date.now(),
    async load() {
      const [raw, dir] = await Promise.all([desktop.readState(), desktop.defaultOutputDir()]);
      state = mergeState(raw, dir);
      return state;
    },
    async save(s) {
      state = s;
      await desktop.writeState(JSON.stringify(s));
    },
    async render(slot, onProgress, signal, recent) {
      const mod = moduleById(slot.moduleId);
      if (!mod?.render) throw new Error(`Module "${slot.moduleId}" cannot render yet.`);
      return mod.render(
        { format: slot.format, seed: slot.seed, recent, kids: !!state?.post.madeForKids },
        onProgress,
        signal,
      );
    },
    saveFile: (dir, name, bytes) => desktop.saveVideo(dir, name, bytes),
    deleteFile: (path) => desktop.deleteFile(path),
    async upload(channelId, path, meta, opts, onProgress) {
      const unlisten = await desktop.onUploadProgress((p) => {
        if (p.path === path && p.total > 0) onProgress(p.sent / p.total);
      });
      try {
        return await desktop.upload({
          channelId,
          clientId: state?.google.clientId ?? '',
          clientSecret: state?.google.clientSecret ?? '',
          path,
          meta,
          ...opts,
        });
      } finally {
        unlisten();
      }
    },
    setThumbnail: (channelId, videoId, path) =>
      desktop.setThumbnail({
        channelId,
        clientId: state?.google.clientId ?? '',
        clientSecret: state?.google.clientSecret ?? '',
        videoId,
        path,
      }),
  };
}

export function statusText(state: AutopilotState | null, activity: Activity): string {
  if (!state) return 'starting';
  if (activity?.stage === 'rendering') return `rendering ${Math.round(activity.progress * 100)}%`;
  if (activity?.stage === 'uploading') return `uploading ${Math.round(activity.progress * 100)}%`;
  if (!state.running) return 'paused';
  const next = state.slots.find((s) => s.status === 'planned' || s.status === 'rendered');
  if (!next) return 'running, nothing planned';
  return `next post ${new Date(next.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** Starts the autopilot once (desktop only). Safe to call repeatedly. */
export function startAutopilot(): Promise<Autopilot> {
  if (instance) return Promise.resolve(instance);
  if (starting) return starting;
  starting = (async () => {
    const ap = new Autopilot(backend(), readyModuleIds);
    const st = await ap.init();
    instance = ap;
    void desktop.setCloseToTray(st.closeToTray);
    // Keep the OS login item in line with the setting (on by default so the schedule survives reboots).
    void desktop.setAutostart(st.launchAtLogin).catch(() => undefined);
    const syncTray = () => {
      const s = ap.snapshot;
      void desktop.trayUpdate(!!s?.running, statusText(s, ap.currentActivity)).catch(() => undefined);
    };
    ap.subscribe(syncTray);
    syncTray();
    await desktop.onTick(() => void ap.tick());
    await desktop.onTrayToggle(() => {
      const s = ap.snapshot;
      if (s) void ap.update({ running: !s.running });
    });
    // Fallback timer in case the heartbeat is missed.
    setInterval(() => void ap.tick(), 60_000);
    // Channel totals every 3 hours for the dashboard's growth charts.
    const snap = () => void import('../dashboard/store').then((m) => m.snapshotAll(ap));
    setTimeout(snap, 30_000);
    setInterval(snap, 3 * 3_600_000);
    void ap.tick();
    return ap;
  })();
  return starting;
}

let version = 0;
const listeners = new Set<() => void>();
let unsubscribeAp: (() => void) | null = null;

function notify() {
  version++;
  for (const l of listeners) l();
}

/** Stable subscribe for useSyncExternalStore (a new function per render would re-subscribe forever). */
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (isDesktop() && !unsubscribeAp) {
    void startAutopilot().then((ap) => {
      if (!unsubscribeAp) {
        unsubscribeAp = ap.subscribe(notify);
        notify();
      }
    });
  }
  return () => {
    listeners.delete(cb);
  };
}

const getVersion = () => version;

/** React hook: autopilot state + current activity (desktop), or nulls on the web. */
export function useAutopilot(): { ap: Autopilot | null; state: AutopilotState | null; activity: Activity } {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return { ap: instance, state: instance?.snapshot ?? null, activity: instance?.currentActivity ?? null };
}
