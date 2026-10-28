/**
 * Real-time audio for the preview. Plays the same cues and music envelope as the export mixer,
 * scheduled through Web Audio as playback crosses them.
 */
import type { Scene } from '../render/scene';
import { buildCues, musicEnvelope, type Cue } from './mix';
import { SAMPLE_RATE, getSound, type SoundId, type Stereo } from './synth';

export class LiveAudio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SoundId, AudioBuffer>();
  private musicBuffer: AudioBuffer | null = null;
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private master: GainNode | null = null;
  private cues: Cue[] = [];
  private env: (v: number) => number = () => 1;
  private cursor = 0;
  private music: Stereo | null = null;
  private sfxVolume = 0.8;
  private musicVolume = 0.45;

  setScene(scene: Scene): void {
    this.cues = buildCues(scene);
    this.env = musicEnvelope(scene, this.cues);
    this.cursor = 0;
  }

  setSettings(s: { sfxVolume: number; musicVolume: number; music: Stereo | null }): void {
    this.sfxVolume = s.sfxVolume;
    this.musicVolume = s.musicVolume;
    if (s.music !== this.music) {
      this.music = s.music;
      this.musicBuffer = null;
      this.stopMusic();
    }
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
    this.stopMusic();
  }

  /** Advances playback to video time v; plays cues crossed since the last call. */
  update(v: number, speed: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.master) return;
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
    this.updateMusic(v, speed);
  }

  private updateMusic(v: number, speed: number): void {
    const ctx = this.ctx!;
    if (!this.music || this.musicVolume <= 0 || speed !== 1) {
      this.stopMusic();
      return;
    }
    if (!this.musicBuffer) {
      this.musicBuffer = ctx.createBuffer(2, this.music.L.length, SAMPLE_RATE);
      this.musicBuffer.copyToChannel(this.music.L, 0);
      this.musicBuffer.copyToChannel(this.music.R, 1);
    }
    if (!this.musicSrc) {
      this.musicGain = ctx.createGain();
      this.musicGain.connect(this.master!);
      this.musicSrc = ctx.createBufferSource();
      this.musicSrc.buffer = this.musicBuffer;
      this.musicSrc.loop = true;
      this.musicSrc.connect(this.musicGain);
      const d = this.musicBuffer.duration;
      const offset = ((v % d) + d) % d;
      this.musicGain.gain.value = this.env(v) * this.musicVolume;
      this.musicSrc.start(0, offset);
    }
    this.musicGain!.gain.setTargetAtTime(this.env(v) * this.musicVolume, ctx.currentTime, 0.03);
  }

  stopMusic(): void {
    try {
      this.musicSrc?.stop();
    } catch {
      /* not started */
    }
    this.musicSrc?.disconnect();
    this.musicGain?.disconnect();
    this.musicSrc = null;
    this.musicGain = null;
  }

  pause(): void {
    this.stopMusic();
  }

  dispose(): void {
    this.stopMusic();
    void this.ctx?.close();
    this.ctx = null;
    this.buffers.clear();
  }
}
