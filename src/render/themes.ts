import type { Look } from '../engine/types';

export type Theme = {
  bgInner: string;
  bgOuter: string;
  glow: string;
  grid: string;
  floorInner: string;
  floorOuter: string;
  border: string;
  text: string;
  subtext: string;
  hudBg: string;
  accent: string;
  danger: string;
  stars?: boolean;
  dark: boolean;
};

export const THEMES: Record<Look['theme'], Theme> = {
  night: {
    bgInner: '#141925',
    bgOuter: '#06070B',
    glow: 'rgba(198,255,61,0.10)',
    grid: 'rgba(255,255,255,0.045)',
    floorInner: '#161B26',
    floorOuter: '#0E1119',
    border: '#C6FF3D',
    text: '#F2F4F8',
    subtext: '#A7AFC0',
    hudBg: 'rgba(10,12,18,0.72)',
    accent: '#C6FF3D',
    danger: '#FF4D5E',
    dark: true,
  },
  neon: {
    bgInner: '#1B0F2E',
    bgOuter: '#05030B',
    glow: 'rgba(255,61,206,0.16)',
    grid: 'rgba(80,220,255,0.08)',
    floorInner: '#170C29',
    floorOuter: '#0B0616',
    border: '#3DF5FF',
    text: '#FBF4FF',
    subtext: '#C3A9E0',
    hudBg: 'rgba(14,6,26,0.75)',
    accent: '#FF3DCE',
    danger: '#FF4D5E',
    dark: true,
  },
  paper: {
    bgInner: '#F7F3EA',
    bgOuter: '#E4DDCD',
    glow: 'rgba(255,255,255,0.5)',
    grid: 'rgba(30,30,40,0.06)',
    floorInner: '#FFFDF8',
    floorOuter: '#F0EADC',
    border: '#17181C',
    text: '#141518',
    subtext: '#5B5E68',
    hudBg: 'rgba(255,253,248,0.85)',
    accent: '#E8452C',
    danger: '#D92D3F',
    dark: false,
  },
  space: {
    bgInner: '#0D1433',
    bgOuter: '#020309',
    glow: 'rgba(120,140,255,0.14)',
    grid: 'rgba(160,180,255,0.035)',
    floorInner: 'rgba(18,24,52,0.78)',
    floorOuter: 'rgba(6,8,22,0.86)',
    border: '#8EA2FF',
    text: '#EEF1FF',
    subtext: '#9CA6CF',
    hudBg: 'rgba(5,7,20,0.72)',
    accent: '#C6FF3D',
    danger: '#FF4D5E',
    stars: true,
    dark: true,
  },
};

export const HP_HIGH = [74, 222, 128] as const;
export const HP_MID = [251, 191, 36] as const;
export const HP_LOW = [255, 77, 94] as const;

/** Green to amber to red as HP drops. */
export function hpColor(frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const [a, b, k] = f > 0.5 ? [HP_MID, HP_HIGH, (f - 0.5) / 0.5] : [HP_LOW, HP_MID, f / 0.5];
  const r = Math.round(a[0] + (b[0] - a[0]) * k);
  const g = Math.round(a[1] + (b[1] - a[1]) * k);
  const bl = Math.round(a[2] + (b[2] - a[2]) * k);
  return `rgb(${r},${g},${bl})`;
}
