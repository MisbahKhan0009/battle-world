import type { Look } from '../engine/types';

export type TextAnchor = { x: number; y: number; align: CanvasTextAlign; maxW: number; size: number };

export type Layout = {
  W: number;
  H: number;
  /** Arena center and the pixel size of the full (unshrunk) arena. */
  arena: { cx: number; cy: number; size: number };
  title: TextAnchor;
  subtitle: TextAnchor;
  counter: TextAnchor;
  feed: {
    x: number;
    y: number;
    align: 'left' | 'right';
    lineH: number;
    max: number;
    maxW: number;
    size: number;
  };
  /** Shorts-only YouTube overlay zones (top/bottom pixel bands). */
  safe: { top: number; bottom: number } | null;
  /** Base unit for overlays (min dimension / 1080). */
  u: number;
};

export const DESIGN_SIZE: Record<Look['aspect'], { W: number; H: number }> = {
  '9:16': { W: 1080, H: 1920 },
  '16:9': { W: 1920, H: 1080 },
  '1:1': { W: 1080, H: 1080 },
};

const TITLE_SCALE = { S: 0.8, M: 1, L: 1.22 } as const;

export function computeLayout(look: Pick<Look, 'aspect' | 'titleSize' | 'titlePosition'>): Layout {
  const { W, H } = DESIGN_SIZE[look.aspect];
  const ts = TITLE_SCALE[look.titleSize];
  if (look.aspect === '9:16') {
    // YouTube Shorts covers roughly the top 12% and bottom 20% with its own UI.
    const safeTop = Math.round(H * 0.12);
    const safeBottom = Math.round(H * 0.8);
    const titleY = look.titlePosition === 'safe' ? safeTop + 70 * ts : 110 * ts;
    const arenaSize = 960;
    const arenaTop = Math.max(titleY + 150, 450);
    return {
      W,
      H,
      arena: { cx: W / 2, cy: arenaTop + arenaSize / 2, size: arenaSize },
      title: { x: W / 2, y: titleY, align: 'center', maxW: W - 120, size: 92 * ts },
      subtitle: { x: W / 2, y: titleY + 78 * ts, align: 'center', maxW: W - 160, size: 40 * ts },
      counter: { x: 64, y: arenaTop + arenaSize + 62, align: 'left', maxW: 360, size: 76 },
      feed: {
        x: W - 64,
        y: arenaTop + arenaSize + 40,
        align: 'right',
        lineH: 46,
        max: 2,
        maxW: 640,
        size: 28,
      },
      safe: { top: safeTop, bottom: safeBottom },
      u: 1,
    };
  }
  if (look.aspect === '16:9') {
    const arenaSize = 960;
    const left = 96;
    return {
      W,
      H,
      arena: { cx: W - 120 - arenaSize / 2, cy: H / 2, size: arenaSize },
      title: {
        x: left,
        y: (look.titlePosition === 'safe' ? 150 : 120) * 1,
        align: 'left',
        maxW: 680,
        size: 96 * ts,
      },
      subtitle: { x: left, y: 150 + 76 * ts, align: 'left', maxW: 680, size: 38 * ts },
      counter: { x: left, y: 470, align: 'left', maxW: 600, size: 110 },
      feed: { x: left, y: 560, align: 'left', lineH: 54, max: 7, maxW: 680, size: 30 },
      safe: null,
      u: 1,
    };
  }
  const arenaSize = 820;
  const titleY = 92 * ts;
  return {
    W,
    H,
    arena: { cx: W / 2, cy: H - 40 - arenaSize / 2, size: arenaSize },
    title: { x: W / 2, y: titleY, align: 'center', maxW: W - 100, size: 80 * ts },
    subtitle: { x: W / 2, y: titleY + 62 * ts, align: 'center', maxW: W - 140, size: 34 * ts },
    counter: { x: 44, y: H - 64, align: 'left', maxW: 200, size: 64 },
    feed: { x: W - 36, y: 250, align: 'right', lineH: 44, max: 3, maxW: 360, size: 24 },
    safe: null,
    u: 1,
  };
}
