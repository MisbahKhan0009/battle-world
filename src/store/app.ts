import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { flagUrl, STARTER, type Country } from '../data/countries';
import type { Fighter, Look, Preset, Rules } from '../engine/types';
import { randomSeed, uid } from '../lib/utils';

/** Sound effects only; videos carry no background music. */
export type AudioSettings = {
  enabled: boolean;
  sfxVolume: number;
};

export type ExportSettings = {
  fps: 30 | 60;
  quality: 'standard' | 'high';
  filenameTemplate: string;
};

export type UiPrefs = { safeArea: boolean; muted: boolean; spoiler: boolean };

export const MAX_FIGHTERS = 64;
export const MIN_FIGHTERS = 2;

export const DEFAULT_RULES: Rules = {
  mode: 'escape',
  gap: { size: 2, speedDeg: 45, direction: 'cw' },
  arena: 'circle',
  shrink: { enabled: true, startSec: 12, rate: 0.008 },
  damageModel: 'impact',
  damageRamp: 0.02,
  targetDurationSec: 45,
  seed: 20251,
};

export const DEFAULT_LOOK: Look = {
  aspect: '9:16',
  theme: 'night',
  title: 'Last flag inside wins 🔥',
  subtitle: 'Comment your country 👇',
  titleFont: 'display',
  titleSize: 'M',
  titlePosition: 'safe',
  showHpNumbers: true,
  showKillFeed: true,
  showCounter: true,
  showDamageNumbers: true,
  particles: true,
  screenShake: true,
  intro: true,
  outro: true,
  outroCta: 'Which flags should battle next? Comment below 👇',
};

export const DEFAULT_AUDIO: AudioSettings = { enabled: true, sfxVolume: 0.85 };
export const DEFAULT_EXPORT: ExportSettings = {
  fps: 60,
  quality: 'high',
  filenameTemplate: 'flag-clash_{count}_{winner}_{seed}',
};

export function countryFighter(c: Pick<Country, 'iso2' | 'name'>): Fighter {
  return {
    id: uid(),
    kind: 'country',
    iso2: c.iso2,
    name: c.name,
    imageSrc: flagUrl(c.iso2),
    accent: '',
    hp: 100,
    size: 1,
    speed: 1,
    attack: 1,
  };
}

type State = {
  fighters: Fighter[];
  rules: Rules;
  look: Look;
  balanced: boolean;
  seedLocked: boolean;
  audio: AudioSettings;
  exportSettings: ExportSettings;
  ui: UiPrefs;
  presets: Preset[];
  recent: Preset[];
};

type Actions = {
  setFighters: (f: Fighter[]) => void;
  addFighters: (f: Fighter[]) => void;
  updateFighter: (id: string, patch: Partial<Fighter>) => void;
  removeFighter: (id: string) => void;
  duplicateFighter: (id: string) => void;
  moveFighter: (from: number, to: number) => void;
  setRules: (patch: Partial<Rules>) => void;
  setShrink: (patch: Partial<Rules['shrink']>) => void;
  setLook: (patch: Partial<Look>) => void;
  setAudio: (patch: Partial<AudioSettings>) => void;
  setExport: (patch: Partial<ExportSettings>) => void;
  setUi: (patch: Partial<UiPrefs>) => void;
  setBalanced: (b: boolean) => void;
  setSeedLocked: (b: boolean) => void;
  rerollSeed: () => void;
  savePreset: (name: string) => Preset;
  applyPreset: (p: Preset) => void;
  deletePreset: (id: string) => void;
  addPreset: (p: Preset) => void;
  pushRecent: () => void;
  newBattle: () => void;
};

const snapshot = (s: State, name: string, id = uid()): Preset => ({
  id,
  name,
  fighters: s.fighters,
  rules: s.rules,
  look: s.look,
  balanced: s.balanced,
  updatedAt: Date.now(),
});

export const useApp = create<State & Actions>()(
  persist(
    (set, get) => ({
      fighters: STARTER.map(countryFighter),
      rules: DEFAULT_RULES,
      look: DEFAULT_LOOK,
      balanced: false,
      seedLocked: false,
      audio: DEFAULT_AUDIO,
      exportSettings: DEFAULT_EXPORT,
      ui: { safeArea: false, muted: false, spoiler: false },
      presets: [],
      recent: [],

      setFighters: (fighters) => set({ fighters: fighters.slice(0, MAX_FIGHTERS) }),
      addFighters: (f) => set((s) => ({ fighters: [...s.fighters, ...f].slice(0, MAX_FIGHTERS) })),
      updateFighter: (id, patch) =>
        set((s) => ({ fighters: s.fighters.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
      removeFighter: (id) => set((s) => ({ fighters: s.fighters.filter((f) => f.id !== id) })),
      duplicateFighter: (id) =>
        set((s) => {
          if (s.fighters.length >= MAX_FIGHTERS) return s;
          const i = s.fighters.findIndex((f) => f.id === id);
          if (i < 0) return s;
          const copy = { ...s.fighters[i], id: uid(), name: `${s.fighters[i].name} 2` };
          const fighters = [...s.fighters];
          fighters.splice(i + 1, 0, copy);
          return { fighters };
        }),
      moveFighter: (from, to) =>
        set((s) => {
          const fighters = [...s.fighters];
          const [m] = fighters.splice(from, 1);
          fighters.splice(to, 0, m);
          return { fighters };
        }),
      setRules: (patch) => set((s) => ({ rules: { ...s.rules, ...patch } })),
      setShrink: (patch) => set((s) => ({ rules: { ...s.rules, shrink: { ...s.rules.shrink, ...patch } } })),
      setLook: (patch) => set((s) => ({ look: { ...s.look, ...patch } })),
      setAudio: (patch) => set((s) => ({ audio: { ...s.audio, ...patch } })),
      setExport: (patch) => set((s) => ({ exportSettings: { ...s.exportSettings, ...patch } })),
      setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
      setBalanced: (balanced) => set({ balanced }),
      setSeedLocked: (seedLocked) => set({ seedLocked }),
      rerollSeed: () => {
        if (get().seedLocked) return;
        set((s) => ({ rules: { ...s.rules, seed: randomSeed() } }));
      },
      savePreset: (name) => {
        const p = snapshot(get(), name);
        set((s) => ({ presets: [p, ...s.presets] }));
        return p;
      },
      applyPreset: (p) =>
        set({
          fighters: p.fighters.map((f) => ({ ...f })),
          rules: mergeRules(p.rules),
          look: { ...DEFAULT_LOOK, ...p.look },
          balanced: p.balanced ?? false,
        }),
      deletePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
      addPreset: (p) => set((s) => ({ presets: [p, ...s.presets.filter((x) => x.id !== p.id)] })),
      pushRecent: () =>
        set((s) => {
          const names = s.fighters.slice(0, 3).map((f) => f.name);
          const label = `${s.fighters.length} flags: ${names.join(', ')}${s.fighters.length > 3 ? '…' : ''}`;
          const key = JSON.stringify([s.fighters.map((f) => f.id), s.rules, s.look.aspect]);
          const recent = s.recent.filter(
            (r) => JSON.stringify([r.fighters.map((f) => f.id), r.rules, r.look.aspect]) !== key,
          );
          return { recent: [snapshot(s, label), ...recent].slice(0, 6) };
        }),
      newBattle: () =>
        set((s) => ({
          fighters: STARTER.map(countryFighter),
          rules: { ...s.rules, seed: s.seedLocked ? s.rules.seed : randomSeed() },
          balanced: false,
        })),
    }),
    {
      name: 'flag-clash',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // v2 switched the default game to "escape the circle".
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<State>;
        if (version < 2 && p.rules) {
          p.rules = { ...p.rules, mode: 'escape' };
          if (p.look?.title === 'Which country wins? 🔥') p.look = { ...p.look, title: DEFAULT_LOOK.title };
        }
        return p as State & Actions;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>;
        return {
          ...current,
          ...p,
          rules: mergeRules(p.rules),
          look: { ...DEFAULT_LOOK, ...p.look },
          audio: {
            enabled: p.audio?.enabled ?? DEFAULT_AUDIO.enabled,
            sfxVolume: p.audio?.sfxVolume ?? DEFAULT_AUDIO.sfxVolume,
          },
          exportSettings: { ...DEFAULT_EXPORT, ...p.exportSettings },
          ui: { ...current.ui, ...p.ui },
        };
      },
    },
  ),
);

/** Fills rule fields added in later versions (older presets and saved setups). */
export function mergeRules(r: Partial<Rules> | undefined): Rules {
  return {
    ...DEFAULT_RULES,
    ...r,
    gap: { ...DEFAULT_RULES.gap, ...r?.gap },
    shrink: { ...DEFAULT_RULES.shrink, ...r?.shrink },
  };
}

/** Simulation-facing fighter stats (applies the Balanced toggle). */
export function simFighters(fighters: Fighter[], balanced: boolean) {
  return fighters.map((f) =>
    balanced
      ? { id: f.id, hp: 100, size: 1, speed: 1, attack: 1 }
      : { id: f.id, hp: f.hp, size: f.size, speed: f.speed, attack: f.attack },
  );
}
