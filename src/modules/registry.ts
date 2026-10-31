import type { RenderResult } from '../autopilot/engine';
import type { MusicBed } from '../audio/music';
import type { VideoSink } from '../export/exporter';
import type { ContentFormat, ContentRecord } from '../autopilot/types';

/** What to render. `recent` is the channel's content history (oldest first) to avoid repeats. */
export type RenderJob = {
  format: ContentFormat;
  seed: number;
  recent?: ContentRecord[];
  /** Made for kids: comments are off on YouTube, so the video must not ask for them. */
  kids?: boolean;
  /** A music track to play instead of the game sounds. */
  music?: MusicBed | null;
  /** Stream the MP4 into this file as it renders (the result then carries no bytes). */
  sink?: VideoSink | null;
};

export type ContentModule = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  status: 'ready' | 'coming-soon';
  formats: ContentFormat[];
  /** Brand color for the module card. */
  accent: string;
  /** Route of the module's sample page, if it has one. */
  previewRoute?: 'battle' | 'race' | 'rings' | 'grow' | 'paper';
  render?: (job: RenderJob, onProgress: (p: number) => void, signal: AbortSignal) => Promise<RenderResult>;
};

/**
 * Every content generator the app can post. Modules render a complete video from a seed, so the
 * autopilot can pick any ready module for a slot. New games plug in here.
 */
export const MODULES: ContentModule[] = [
  {
    id: 'flag-battle',
    name: 'Flag Battle',
    tagline: 'Escape the circle or battle royale',
    description:
      'Country flags bounce inside a circle with a rotating exit, or fight it out battle-royale style. Last flag left wins.',
    status: 'ready',
    formats: ['short', 'video'],
    accent: '#C6FF3D',
    previewRoute: 'battle',
    render: (job, onProgress, signal) =>
      import('./flagBattle/autopilot').then((m) => m.renderFlagBattle(job, onProgress, signal)),
  },
  {
    id: 'marble-race',
    name: 'Marble Race',
    tagline: 'Countries race to the finish',
    description:
      'Flag marbles roll down a track of ramps, plinko pegs, spinners, bumpers and forks. First across the line wins.',
    status: 'ready',
    formats: ['short', 'video'],
    accent: '#3DDCFF',
    previewRoute: 'race',
    render: (job, onProgress, signal) =>
      import('./marbleRace/autopilot').then((m) => m.renderMarbleRace(job, onProgress, signal)),
  },
  {
    id: 'ring-escape',
    name: 'Ring Escape',
    tagline: 'Break out of spinning rings',
    description:
      'Flag balls bounce inside nested spinning rings. Slip through a gap and that ring shatters; the first flag out of the last ring wins. Long videos are a knockout of heats and a final.',
    status: 'ready',
    formats: ['short', 'video'],
    accent: '#FF3DCE',
    previewRoute: 'rings',
    render: (job, onProgress, signal) =>
      import('./ringEscape/autopilot').then((m) => m.renderRingEscape(job, onProgress, signal)),
  },
  {
    id: 'growing-ball',
    name: 'Growing Ball',
    tagline: 'Every bounce makes it bigger',
    description:
      'Every bounce off the wall grows the flag. Big balls get boxed in while small ones keep bouncing; when the arena is full, the biggest flag wins. Long videos are a knockout.',
    status: 'ready',
    formats: ['short', 'video'],
    accent: '#FF4D5E',
    previewRoute: 'grow',
    render: (job, onProgress, signal) =>
      import('./growingBall/autopilot').then((m) => m.renderGrowingBall(job, onProgress, signal)),
  },
  {
    id: 'black-hole',
    name: 'Black Hole',
    tagline: 'Swallow the city, then each other',
    description:
      'Like Hole.io: country holes roam a city and swallow everything smaller than them. Bigger holes eat smaller ones; the biggest hole wins.',
    status: 'coming-soon',
    formats: ['short', 'video'],
    accent: '#B07CFF',
  },
  {
    id: 'paper-land',
    name: 'Paper Land',
    tagline: 'Claim land, cut the trails',
    description:
      'Like Paper.io: flags paint trails to claim land, and crossing a rival’s trail knocks it out. When the clock runs out, the most land wins. Long videos are a knockout.',
    status: 'ready',
    formats: ['short', 'video'],
    accent: '#3DFFB0',
    previewRoute: 'paper',
    render: (job, onProgress, signal) =>
      import('./paperLand/autopilot').then((m) => m.renderPaperLand(job, onProgress, signal)),
  },
];

export const readyModuleIds = (): string[] => MODULES.filter((m) => m.status === 'ready').map((m) => m.id);

export function moduleById(id: string): ContentModule | undefined {
  return MODULES.find((m) => m.id === id);
}
