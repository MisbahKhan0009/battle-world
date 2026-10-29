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
  // Marble Race: a cyan circuit at night, a race-amber asphalt track, and a bright daytime run.
  circuit: {
    bgInner: '#0B2027',
    bgOuter: '#03090C',
    glow: 'rgba(61,220,255,0.12)',
    grid: 'rgba(61,220,255,0.06)',
    floorInner: '#0E252D',
    floorOuter: '#071419',
    border: '#3DDCFF',
    text: '#EAFBFF',
    subtext: '#8DB3BE',
    hudBg: 'rgba(3,12,16,0.8)',
    accent: '#3DDCFF',
    danger: '#FF5A4E',
    dark: true,
  },
  asphalt: {
    bgInner: '#1D1F22',
    bgOuter: '#0A0B0C',
    glow: 'rgba(255,194,61,0.08)',
    grid: 'rgba(255,255,255,0.04)',
    floorInner: '#222528',
    floorOuter: '#151719',
    border: '#F2F1EC',
    text: '#F6F4EE',
    subtext: '#ABA79D',
    hudBg: 'rgba(12,13,14,0.82)',
    accent: '#FFC23D',
    danger: '#FF4D3D',
    dark: true,
  },
  daylight: {
    bgInner: '#EAF6F9',
    bgOuter: '#CDE5EC',
    glow: 'rgba(255,255,255,0.5)',
    grid: 'rgba(15,54,64,0.07)',
    floorInner: '#F8FCFD',
    floorOuter: '#E2EFF3',
    border: '#0F3640',
    text: '#0D2229',
    subtext: '#4B666E',
    hudBg: 'rgba(248,252,253,0.9)',
    accent: '#0092C2',
    danger: '#E0393E',
    dark: false,
  },
  // Ring Escape: magenta on deep plum, and magenta under a teal night sky.
  plum: {
    bgInner: '#2B0E30',
    bgOuter: '#0B030D',
    glow: 'rgba(255,61,206,0.14)',
    grid: 'rgba(255,61,206,0.05)',
    floorInner: '#24102A',
    floorOuter: '#12061A',
    border: '#FF3DCE',
    text: '#FFF0FB',
    subtext: '#C99BBF',
    hudBg: 'rgba(16,4,18,0.8)',
    accent: '#FF3DCE',
    danger: '#FF4D5E',
    stars: true,
    dark: true,
  },
  aurora: {
    bgInner: '#0A2027',
    bgOuter: '#02070A',
    glow: 'rgba(124,245,210,0.12)',
    grid: 'rgba(124,245,210,0.04)',
    floorInner: '#0B1D24',
    floorOuter: '#050E12',
    border: '#7CF5D2',
    text: '#EFFFFA',
    subtext: '#8DB6AC',
    hudBg: 'rgba(2,10,12,0.8)',
    accent: '#FF5CD6',
    danger: '#FF4D5E',
    stars: true,
    dark: true,
  },
  // Growing Ball: coral on warm ember dark, and coral on soft peach.
  ember: {
    bgInner: '#2B1515',
    bgOuter: '#0D0505',
    glow: 'rgba(255,90,95,0.12)',
    grid: 'rgba(255,90,95,0.05)',
    floorInner: '#2F1818',
    floorOuter: '#1A0B0B',
    border: '#FF5A5F',
    text: '#FFF3EE',
    subtext: '#CBA49B',
    hudBg: 'rgba(18,6,6,0.8)',
    accent: '#FF5A5F',
    danger: '#FFB13D',
    dark: true,
  },
  peach: {
    bgInner: '#FFF4EC',
    bgOuter: '#FFDFCB',
    glow: 'rgba(255,255,255,0.5)',
    grid: 'rgba(43,26,23,0.06)',
    floorInner: '#FFFAF6',
    floorOuter: '#FFE9DB',
    border: '#2B1A17',
    text: '#2B1A17',
    subtext: '#7A5A50',
    hudBg: 'rgba(255,250,246,0.92)',
    accent: '#EE3E48',
    danger: '#C2410C',
    dark: false,
  },
  // Paper Land: a pale board floating on bright aqua (like Paper.io 2), and kraft paper.
  mint: {
    bgInner: '#86ECDD',
    bgOuter: '#25A99B',
    glow: 'rgba(255,255,255,0.3)',
    grid: 'rgba(40,90,80,0.07)',
    floorInner: '#F4FBF8',
    floorOuter: '#C9E4DC',
    border: '#FFFFFF',
    text: '#FFFFFF',
    subtext: '#E8FFFA',
    hudBg: 'rgba(6,60,55,0.45)',
    accent: '#FFD23D',
    danger: '#FF4D5E',
    dark: true,
  },
  kraft: {
    bgInner: '#E9DCC0',
    bgOuter: '#CDB78E',
    glow: 'rgba(255,255,255,0.4)',
    grid: 'rgba(60,40,20,0.08)',
    floorInner: '#F7F0E1',
    floorOuter: '#EADFC6',
    border: '#3A2A18',
    text: '#2A1F12',
    subtext: '#6E5A40',
    hudBg: 'rgba(247,240,225,0.92)',
    accent: '#0E8A5F',
    danger: '#C2410C',
    dark: false,
  },
  // Territory Wars: amber on a night-blue war map (slate land, deep sea), and an old paper atlas.
  atlas: {
    bgInner: '#13233A',
    bgOuter: '#050B14',
    glow: 'rgba(255,178,61,0.10)',
    grid: 'rgba(255,178,61,0.05)',
    floorInner: '#3A4A5E',
    floorOuter: '#0B1A2C',
    border: '#FFB23D',
    text: '#F5F1E8',
    subtext: '#A9B4C2',
    hudBg: 'rgba(5,11,20,0.8)',
    accent: '#FFB23D',
    danger: '#FF4D5E',
    dark: true,
  },
  parchment: {
    bgInner: '#F4E9D2',
    bgOuter: '#DCC9A3',
    glow: 'rgba(255,255,255,0.4)',
    grid: 'rgba(60,40,20,0.06)',
    floorInner: '#D9C49A',
    floorOuter: '#9FC3CF',
    border: '#3B2A17',
    text: '#2B1E10',
    subtext: '#6E5A40',
    hudBg: 'rgba(250,243,228,0.92)',
    accent: '#C2410C',
    danger: '#B91C1C',
    dark: false,
  },
};

/** The color worlds each game draws from (first is the game's signature look). */
export const GAME_THEMES: Record<string, Look['theme'][]> = {
  'flag-battle': ['night', 'space', 'paper'],
  'marble-race': ['circuit', 'asphalt', 'daylight'],
  'ring-escape': ['plum', 'aurora'],
  'growing-ball': ['ember', 'peach'],
  'paper-land': ['mint', 'kraft'],
  'territory-wars': ['atlas', 'parchment'],
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
