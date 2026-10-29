/**
 * Desktop autopilot runtime: one Autopilot instance wired to the Tauri backend and the module
 * registry, ticked by the Rust heartbeat (works while the window is hidden in the tray).
 */
import { useSyncExternalStore } from 'react';
import { Autopilot, type Activity, type Backend } from '../autopilot/engine';
import { DEFAULT_PACE, defaultState, type AutopilotState, type ScheduleSettings } from '../autopilot/types';
import { moduleById, readyModuleIds } from '../modules/registry';
import { desktop, isDesktop } from './bridge';

let instance: Autopilot | null = null;
let starting: Promise<Autopilot> | null = null;

function mergeState(raw: string | null, outputDir: string): AutopilotState {
  const base = defaultState(outputDir);
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
    return {
      ...base,
      ...p,
      ...(migrate
        ? { slots: (p.slots ?? []).filter((s) => s.status !== 'planned' || s.manual), plannedDays: {} }
        : {}),
      schedule: { ...base.schedule, ...restSchedule, perModule },
      post: { ...base.post, ...p.post },
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
      return mod.render({ format: slot.format, seed: slot.seed, recent }, onProgress, signal);
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
