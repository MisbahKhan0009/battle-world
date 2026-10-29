import type { RenderResult } from '../autopilot/engine';
import type { ContentFormat, ContentRecord } from '../autopilot/types';

/** What to render. `recent` is the channel's content history (oldest first) to avoid repeats. */
export type RenderJob = { format: ContentFormat; seed: number; recent?: ContentRecord[] };

export type ContentModule = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  status: 'ready' | 'coming-soon';
  formats: ContentFormat[];
  /** Brand color for the module card. */
  accent: string;
  /** Route of the module's manual editor, if it has one. */
  studioRoute?: 'studio';
  /** Route of the module's preview page, if it has one. */
  previewRoute?: 'race';
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
    studioRoute: 'studio',
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
      'A flag bounces inside nested rotating rings and smashes through each gap to break out. Every ring it clears shatters.',
    status: 'coming-soon',
    formats: ['short'],
    accent: '#FF3DCE',
  },
  {
    id: 'territory-wars',
    name: 'Territory Wars',
    tagline: 'Conquer the map tile by tile',
    description:
      'Countries expand across a pixel world map, capturing tiles from each other until one rules the globe.',
    status: 'coming-soon',
    formats: ['short', 'video'],
    accent: '#FFB23D',
  },
  {
    id: 'growing-ball',
    name: 'Growing Ball',
    tagline: 'Every bounce makes it bigger',
    description:
      'Each bounce grows the flag a little. Countries race to fill the arena first, with a satisfying sound on every hit.',
    status: 'coming-soon',
    formats: ['short'],
    accent: '#FF4D5E',
  },
];

export const readyModuleIds = (): string[] => MODULES.filter((m) => m.status === 'ready').map((m) => m.id);

export function moduleById(id: string): ContentModule | undefined {
  return MODULES.find((m) => m.id === id);
}
