/**
 * Procedural sound design. Every SFX and music loop is synthesized from code with a stateless
 * hash for noise, so the app ships no audio files, has no licensing concerns (the output is
 * original work, dedicated to the public domain), and renders identically every time.
 * Works in the main thread and in workers (plain Float32Array math, no Web Audio needed).
 */
import { hashFloat } from '../engine/rng';

export const SAMPLE_RATE = 48000;
const SR = SAMPLE_RATE;
const TAU = Math.PI * 2;

export type SoundId =
  | 'hit0'
  | 'hit1'
  | 'hit2'
  | 'hit3'
  | 'hit4'
  | 'elim'
  | 'whoosh'
  | 'fanfare'
  | 'tick'
  | 'boom'
  | 'exit';
export type MusicId = 'energetic' | 'epic' | 'chill';
export type Stereo = { L: Float32Array; R: Float32Array };

const noise = (i: number, seed: number) => hashFloat(seed, i) * 2 - 1;

/** One-pole low-pass coefficient for a cutoff in Hz. */
const lpCoef = (hz: number) => 1 - Math.exp((-TAU * hz) / SR);

function normalize(buf: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
}

function hit(variant: number): Float32Array {
  const len = Math.floor(SR * 0.22);
  const out = new Float32Array(len);
  const f0 = [190, 150, 230, 170, 210][variant];
  const tone = [0.9, 1, 0.75, 0.95, 0.85][variant];
  let phase = 0;
  let lp = 0;
  let hpPrev = 0;
  let hpOut = 0;
  const bandHz = [1800, 1200, 2600, 1500, 2100][variant];
  const a = lpCoef(bandHz);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // Body: pitched thump with a fast downward sweep.
    const f = 55 + (f0 - 55) * Math.exp(-t / 0.03);
    phase += (TAU * f) / SR;
    const body = Math.sin(phase) * Math.exp(-t / 0.075) * tone;
    // Smack: band-limited noise burst.
    const n = noise(i, 300 + variant);
    lp += (n - lp) * a;
    hpOut = 0.97 * (hpOut + lp - hpPrev);
    hpPrev = lp;
    const smack = hpOut * Math.exp(-t / 0.018) * 1.6;
    const click = i < 90 ? noise(i, 900 + variant) * (1 - i / 90) * 0.6 : 0;
    out[i] = body + smack + click;
  }
  return normalize(out, 0.85);
}

function elim(): Float32Array {
  const len = Math.floor(SR * 0.9);
  const out = new Float32Array(len);
  let phase = 0;
  let hpPrev = 0;
  let hpOut = 0;
  const pings = Array.from({ length: 7 }, (_, k) => ({
    f: 2200 + 3200 * hashFloat(77, k),
    at: 0.01 + 0.18 * hashFloat(78, k),
    d: 0.08 + 0.18 * hashFloat(79, k),
  }));
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 48 + 90 * Math.exp(-t / 0.06);
    phase += (TAU * f) / SR;
    const boom = Math.sin(phase) * Math.exp(-t / 0.22) * 0.9;
    const n = noise(i, 41);
    hpOut = 0.92 * (hpOut + n - hpPrev);
    hpPrev = n;
    const crash = hpOut * Math.exp(-t / 0.12) * 0.7;
    let glass = 0;
    for (const p of pings) {
      if (t < p.at) continue;
      const tt = t - p.at;
      glass += Math.sin(TAU * p.f * tt) * Math.exp(-tt / p.d) * 0.22;
    }
    out[i] = boom + crash + glass;
  }
  return normalize(out, 0.9);
}

function whoosh(): Float32Array {
  const dur = 1.6;
  const len = Math.floor(SR * dur);
  const out = new Float32Array(len);
  // State-variable band-pass sweeping upward.
  let low = 0;
  let band = 0;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const p = t / dur;
    const fc = 250 * Math.pow(18, p);
    const f = 2 * Math.sin((Math.PI * Math.min(fc, 9000)) / SR);
    const q = 0.25;
    const n = noise(i, 55);
    low += f * band;
    const high = n - low - q * band;
    band += f * high;
    const env = Math.pow(p, 1.6) * (p > 0.9 ? (1 - p) / 0.1 : 1);
    phase += (TAU * (180 + 520 * p * p)) / SR;
    out[i] = band * env * 1.3 + Math.sin(phase) * env * 0.25;
  }
  return normalize(out, 0.75);
}

function boom(): Float32Array {
  const len = Math.floor(SR * 0.8);
  const out = new Float32Array(len);
  let phase = 0;
  let lp = 0;
  const a = lpCoef(900);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    phase += (TAU * (40 + 80 * Math.exp(-t / 0.05))) / SR;
    lp += (noise(i, 66) - lp) * a;
    out[i] = Math.sin(phase) * Math.exp(-t / 0.3) + lp * Math.exp(-t / 0.15) * 1.4;
  }
  return normalize(out, 0.9);
}

/** A flag slipping out through the opening: quick rising zip with an airy tail. */
function exit(): Float32Array {
  const dur = 0.55;
  const len = Math.floor(SR * dur);
  const out = new Float32Array(len);
  let phase = 0;
  let lp = 0;
  const a = lpCoef(3000);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const p = t / dur;
    const f = 260 * Math.pow(5, Math.min(1, p / 0.45));
    phase += (TAU * f) / SR;
    const env = Math.min(1, t / 0.008) * Math.exp(-t / 0.16);
    lp += (noise(i, 88) - lp) * a;
    out[i] = (Math.sin(phase) + 0.35 * Math.sin(phase * 2.01)) * env + lp * Math.exp(-t / 0.09) * 0.8;
  }
  return normalize(out, 0.8);
}

function tick(): Float32Array {
  const len = Math.floor(SR * 0.09);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    out[i] = (Math.sin(TAU * 1320 * t) + 0.4 * Math.sin(TAU * 2640 * t)) * Math.exp(-t / 0.018);
  }
  return normalize(out, 0.7);
}

/** Band-limited sawtooth via additive harmonics. */
function saw(phase: number, harmonics: number): number {
  let s = 0;
  for (let h = 1; h <= harmonics; h++) s += Math.sin(phase * h) / h;
  return s * 0.6;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function fanfare(): Float32Array {
  const dur = 2.6;
  const len = Math.floor(SR * dur);
  const out = new Float32Array(len);
  // C major flourish: G4 C5 E5 then a held C major chord.
  const notes: { m: number; at: number; d: number }[] = [
    { m: 67, at: 0, d: 0.16 },
    { m: 72, at: 0.16, d: 0.16 },
    { m: 76, at: 0.32, d: 0.16 },
    { m: 72, at: 0.5, d: 2.1 },
    { m: 76, at: 0.5, d: 2.1 },
    { m: 79, at: 0.5, d: 2.1 },
    { m: 84, at: 0.5, d: 2.1 },
  ];
  for (const n of notes) {
    const start = Math.floor(n.at * SR);
    const nlen = Math.floor(n.d * SR);
    const f = midiHz(n.m);
    let lp = 0;
    for (let i = 0; i < nlen && start + i < len; i++) {
      const t = i / SR;
      const att = Math.min(1, t / 0.025);
      const rel = Math.min(1, (n.d - t) / 0.25);
      const vib = 1 + 0.004 * Math.sin(TAU * 5.5 * t) * Math.min(1, t / 0.4);
      const ph = TAU * f * vib * t;
      const raw = saw(ph, 10) + 0.5 * saw(ph * 1.003, 10);
      lp += (raw - lp) * lpCoef(1400 + 2200 * Math.exp(-t / 0.3));
      out[start + i] += lp * att * Math.max(0, rel) * 0.5;
    }
  }
  return normalize(out, 0.85);
}

const sfxCache = new Map<SoundId, Float32Array>();

export function getSound(id: SoundId): Float32Array {
  let s = sfxCache.get(id);
  if (!s) {
    s =
      id === 'elim'
        ? elim()
        : id === 'whoosh'
          ? whoosh()
          : id === 'fanfare'
            ? fanfare()
            : id === 'tick'
              ? tick()
              : id === 'boom'
                ? boom()
                : id === 'exit'
                  ? exit()
                  : hit(Number(id.slice(3)));
    sfxCache.set(id, s);
  }
  return s;
}

// ------------------------------------------------------------------------------- music

type Song = {
  bpm: number;
  bars: number;
  chords: number[][];
  build: (ctx: SongCtx) => void;
};

type SongCtx = {
  L: Float32Array;
  R: Float32Array;
  beat: number;
  bars: number;
  chords: number[][];
};

function addVoice(
  c: SongCtx,
  at: number,
  dur: number,
  gen: (t: number, i: number) => number,
  gain: number,
  pan = 0,
): void {
  const start = Math.floor(at * SR);
  const len = Math.floor(dur * SR);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * gain;
  const gr = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
  const total = c.L.length;
  for (let i = 0; i < len; i++) {
    const v = gen(i / SR, i);
    // Wrap so the loop tail flows into its head seamlessly.
    const k = (start + i) % total;
    c.L[k] += v * gl;
    c.R[k] += v * gr;
  }
}

const kick = (t: number) =>
  Math.sin(TAU * (45 * t + 110 * 0.04 * (1 - Math.exp(-t / 0.04)))) * Math.exp(-t / 0.18);
const hat = (seed: number, decay: number) => (t: number, i: number) => {
  const n = noise(i, seed);
  return (n - noise(i - 1, seed)) * 0.5 * Math.exp(-t / decay);
};
const clap = (t: number, i: number) => {
  const n = noise(i, 333);
  const e = Math.exp(-t / 0.09) + (t < 0.02 ? 0.6 * Math.exp(-((t % 0.007) / 0.002)) : 0);
  return n * e * 0.6;
};

function pad(freqs: number[], dur: number, bright: number) {
  return (t: number) => {
    const env = Math.min(1, t / 0.4) * Math.min(1, (dur - t) / 0.5);
    let s = 0;
    for (const f of freqs) {
      const ph = TAU * f * t;
      s += Math.sin(ph) + 0.35 * Math.sin(ph * 2.003) * bright + 0.2 * Math.sin(ph * 0.998 + 1);
    }
    return (s / freqs.length) * Math.max(0, env);
  };
}

function pluck(f: number, decay: number) {
  return (t: number) => {
    const ph = TAU * f * t;
    return (
      (Math.sin(ph) +
        0.5 * Math.sin(2 * ph) * Math.exp(-t / 0.05) +
        0.25 * Math.sin(3 * ph) * Math.exp(-t / 0.03)) *
      Math.exp(-t / decay)
    );
  };
}

function bassSaw(f: number, dur: number) {
  let lp = 0;
  return (t: number) => {
    const raw = saw(TAU * f * t, 6);
    lp += (raw - lp) * lpCoef(500 + 900 * Math.exp(-t / 0.08));
    return lp * Math.min(1, (dur - t) / 0.02) * Math.min(1, t / 0.004);
  };
}

const SONGS: Record<MusicId, Song> = {
  energetic: {
    bpm: 128,
    bars: 8,
    chords: [
      [57, 60, 64],
      [53, 57, 60],
      [48, 52, 55],
      [55, 59, 62],
    ],
    build(c) {
      const b = c.beat;
      for (let bar = 0; bar < c.bars; bar++) {
        const ch = c.chords[bar % 4];
        for (let q = 0; q < 4; q++) {
          const at = (bar * 4 + q) * b;
          addVoice(c, at, 0.35, kick, 0.9);
          addVoice(c, at + b / 2, 0.12, hat(10 + q, 0.05), 0.35, 0.3);
          if (q % 2 === 1) addVoice(c, at, 0.25, clap, 0.45, -0.1);
          for (let e = 0; e < 2; e++) {
            const f = midiHz(ch[0] - 12 + (e === 1 ? 12 : 0));
            addVoice(c, at + (e * b) / 2, b / 2 - 0.01, bassSaw(f, b / 2 - 0.01), 0.42);
          }
        }
        for (let s = 0; s < 8; s++) {
          const note = ch[s % 3] + 12 + (s >= 4 ? 12 : 0);
          addVoice(c, (bar * 4 + s / 2) * b, 0.4, pluck(midiHz(note), 0.16), 0.16, s % 2 ? 0.45 : -0.45);
        }
      }
    },
  },
  epic: {
    bpm: 100,
    bars: 8,
    chords: [
      [50, 53, 57],
      [46, 50, 53],
      [53, 57, 60],
      [48, 52, 55],
    ],
    build(c) {
      const b = c.beat;
      for (let bar = 0; bar < c.bars; bar++) {
        const ch = c.chords[bar % 4];
        const at = bar * 4 * b;
        addVoice(c, at, 4 * b, pad(ch.map(midiHz), 4 * b, 0.6), 0.32);
        addVoice(c, at, 4 * b, pad([midiHz(ch[0] - 12)], 4 * b, 0.3), 0.3);
        // Taiko-style pattern.
        for (const [q, g] of [
          [0, 1],
          [1.5, 0.6],
          [2, 0.9],
          [3, 0.5],
          [3.5, 0.7],
        ] as const) {
          addVoice(c, at + q * b, 0.6, (t) => kick(t * 0.7) * 1.2, 0.75 * g);
        }
        for (let s = 0; s < 16; s++) {
          const note = ch[s % 3] + 24;
          addVoice(c, at + (s * b) / 4, 0.2, pluck(midiHz(note), 0.08), 0.1, s % 2 ? 0.35 : -0.35);
        }
        addVoice(c, at + 2 * b, 0.3, clap, 0.25);
      }
    },
  },
  chill: {
    bpm: 88,
    bars: 8,
    chords: [
      [53, 57, 60, 64],
      [52, 55, 59, 62],
      [50, 53, 57, 60],
      [48, 52, 55, 59],
    ],
    build(c) {
      const b = c.beat;
      for (let bar = 0; bar < c.bars; bar++) {
        const ch = c.chords[bar % 4];
        const at = bar * 4 * b;
        addVoice(c, at, 4 * b, pad(ch.map(midiHz), 4 * b, 0.25), 0.26);
        addVoice(c, at, 0.4, kick, 0.6);
        addVoice(c, at + 2.5 * b, 0.4, kick, 0.45);
        addVoice(c, at + b, 0.15, hat(40, 0.03), 0.3, 0.2);
        addVoice(c, at + 3 * b, 0.15, hat(41, 0.03), 0.3, 0.2);
        for (let s = 0; s < 8; s++) addVoice(c, at + (s * b) / 2, 0.08, hat(50 + s, 0.015), 0.12, -0.3);
        for (let s = 0; s < 4; s++) {
          const note = ch[(s * 2) % 4] + 12;
          addVoice(
            c,
            at + s * b + (s % 2 ? b / 2 : 0),
            0.9,
            pluck(midiHz(note), 0.45),
            0.14,
            (s - 1.5) * 0.25,
          );
        }
        addVoice(c, at, 4 * b, (t) => Math.sin(TAU * midiHz(ch[0] - 12) * t) * Math.min(1, t / 0.05), 0.3);
      }
    },
  },
};

const musicCache = new Map<MusicId, Stereo>();

/** Seamless stereo loop for a bundled track. */
export function getMusic(id: MusicId): Stereo {
  let m = musicCache.get(id);
  if (!m) {
    const song = SONGS[id];
    const beat = 60 / song.bpm;
    const len = Math.round(song.bars * 4 * beat * SR);
    const c: SongCtx = {
      L: new Float32Array(len),
      R: new Float32Array(len),
      beat,
      bars: song.bars,
      chords: song.chords,
    };
    song.build(c);
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(c.L[i]), Math.abs(c.R[i]));
    const g = peak > 0 ? 0.8 / peak : 1;
    for (let i = 0; i < len; i++) {
      c.L[i] *= g;
      c.R[i] *= g;
    }
    m = { L: c.L, R: c.R };
    musicCache.set(id, m);
  }
  return m;
}

export const MUSIC_LABELS: Record<MusicId, string> = {
  energetic: 'Energetic',
  epic: 'Epic',
  chill: 'Chill',
};
