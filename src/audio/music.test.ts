import { describe, expect, test } from 'vitest';
import { MusicMix } from './music';
import { SAMPLE_RATE } from './synth';

const tone = (sec: number) => {
  const n = Math.round(sec * SAMPLE_RATE);
  const L = new Float32Array(n).fill(0.5);
  return { L, R: L.slice() };
};

describe('music bed', () => {
  test('fades in, holds, fades out by the end of the video and stays silent after', () => {
    const mix = new MusicMix(tone(30), 10, 1);
    const { L } = mix.render(0, 11 * SAMPLE_RATE);
    expect(L[0]).toBe(0);
    expect(L[Math.round(5 * SAMPLE_RATE)]).toBeCloseTo(0.5, 5);
    expect(L[Math.round(9.9 * SAMPLE_RATE)]).toBeLessThan(0.05);
    expect(L[Math.round(10.5 * SAMPLE_RATE)]).toBe(0);
  });

  test('a short track loops without a gap or a jump in level', () => {
    const mix = new MusicMix(tone(4), 20, 1);
    const { L } = mix.render(0, 17 * SAMPLE_RATE);
    for (let s = 1; s < 16; s += 0.25) expect(L[Math.round(s * SAMPLE_RATE)]).toBeCloseTo(0.5, 5);
  });

  test('rendering in chunks gives the same samples as one pass', () => {
    const bed = tone(3);
    bed.L.forEach((_, i) => (bed.L[i] = Math.sin(i / 50)));
    const whole = new MusicMix(bed, 8, 0.8).render(0, 8 * SAMPLE_RATE).L;
    const mix = new MusicMix(bed, 8, 0.8);
    const a = mix.render(0, 100_000).L;
    const b = mix.render(100_000, 8 * SAMPLE_RATE - 100_000).L;
    expect(Array.from(a.slice(-5))).toEqual(Array.from(whole.slice(99_995, 100_000)));
    expect(Array.from(b.slice(0, 5))).toEqual(Array.from(whole.slice(100_000, 100_005)));
  });
});
