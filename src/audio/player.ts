/**
 * Real-time audio for the preview. Plays the same sound-effect cues as the export mixer,
 * scheduled through Web Audio as playback crosses them.
 */
import type { Scene } from '../render/scene';
import { buildCues, type Cue } from './mix';
import { SAMPLE_RATE, getSound, type SoundId } from './synth';

export class LiveAudio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SoundId, AudioBuffer>();
  private master: GainNode | null = null;
  private cues: Cue[] = [];
  private cursor = 0;
  private sfxVolume = 0.8;

  setScene(scene: Scene): void {
    this.cues = buildCues(scene);
    this.cursor = 0;
  }

  setSettings(s: { sfxVolume: number }): void {
    this.sfxVolume = s.sfxVolume;
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private buffer(id: SoundId): AudioBuffer {
    let b = this.buffers.get(id);
    if (!b) {
      const ctx = this.ensure();
      const data = getSound(id);
      b = ctx.createBuffer(1, data.length, SAMPLE_RATE);
      b.copyToChannel(data, 0);
      this.buffers.set(id, b);
    }
    return b;
  }

  /** Call from a user gesture to unlock audio. */
  async resume(): Promise<void> {
    const ctx = this.ensure();
    if (ctx.state !== 'running') await ctx.resume();
  }

  /** Repositions cue scheduling (after seek/restart). */
  seek(v: number): void {
    let lo = 0;
    let hi = this.cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cues[mid].at < v) lo = mid + 1;
      else hi = mid;
    }
    this.cursor = lo;
  }

  /** Advances playback to video time v; plays cues crossed since the last call. */
  update(v: number, speed: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master || this.sfxVolume <= 0) {
      this.seek(v);
      return;
    }
    let played = 0;
    while (this.cursor < this.cues.length && this.cues[this.cursor].at <= v) {
      const c = this.cues[this.cursor++];
      // Skip stale cues (e.g. after a long frame) and cap bursts at high speeds.
      if (v - c.at > 0.25 || played > 4) continue;
      played++;
      const src = ctx.createBufferSource();
      src.buffer = this.buffer(c.sound);
      src.playbackRate.value = c.rate * Math.min(speed, 2);
      const g = ctx.createGain();
      g.gain.value = c.gain * this.sfxVolume * 1.1;
      const p = ctx.createStereoPanner();
      p.pan.value = c.pan;
      src.connect(g).connect(p).connect(this.master);
      src.start();
    }
  }

  pause(): void {
    /* one-shot sounds finish on their own */
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.buffers.clear();
  }
}
