/**
 * Draws the Black Hole city from above: flat roads and blocks (baked once), and every object as a
 * simple flat shape with a soft shadow. A night palette for dark themes, a sunny one for light.
 */
import { BLOCK, ROAD } from '../../engine/black/city';
import type { City, CityObject } from '../../engine/black/types';
import { context2d, createCanvas, type AnyCanvas, type Ctx2D } from '../canvas';

export type CityPalette = {
  road: string;
  lane: string;
  curb: string;
  lawn: string;
  tree: string[];
  bush: string;
  roof: string[];
  wall: string;
  tower: string[];
  car: string[];
  bus: string;
  lamp: string;
  glow: string;
  shadow: string;
};

export function cityPalette(dark: boolean): CityPalette {
  return dark
    ? {
        road: '#221D33',
        lane: 'rgba(214,200,255,0.28)',
        curb: '#3A3152',
        lawn: '#203A35',
        tree: ['#2E7A55', '#348B5A', '#2A6D63'],
        bush: '#3C9A62',
        roof: ['#7A4E8F', '#5E5A9E', '#8C5A6E', '#4F6F9A'],
        wall: '#C9BEDF',
        tower: ['#3E3760', '#4A4275', '#352F55'],
        car: ['#FF5C7A', '#FFD23D', '#3DDCFF', '#F2F4F8', '#B07CFF', '#5CFF9D'],
        bus: '#FFB23D',
        lamp: '#FFE7A3',
        glow: 'rgba(255,214,120,0.22)',
        shadow: 'rgba(0,0,0,0.35)',
      }
    : {
        road: '#8F8BA3',
        lane: 'rgba(255,255,255,0.75)',
        curb: '#D9D3E6',
        lawn: '#A9DB8E',
        tree: ['#4FA65A', '#5DB868', '#3F9A5E'],
        bush: '#6CC46F',
        roof: ['#E0675E', '#7C8BE0', '#E3A44F', '#9C6FD6'],
        wall: '#FFFFFF',
        tower: ['#9AA6C8', '#B3BCD9', '#8794B8'],
        car: ['#FF5C7A', '#FFC23D', '#2FB8E8', '#FFFFFF', '#9C6FD6', '#3DCB7A'],
        bus: '#FFB23D',
        lamp: '#FFF4C2',
        glow: 'rgba(255,240,180,0)',
        shadow: 'rgba(40,20,60,0.22)',
      };
}

/** Roads, lane marks, curbs and lawns, baked at `k` pixels per city unit. */
export function bakeGround(city: City, P: CityPalette, k: number): AnyCanvas {
  const S = city.size;
  const c = createCanvas(Math.ceil(S * k), Math.ceil(S * k));
  const g = context2d(c);
  g.scale(k, k);
  g.fillStyle = P.road;
  g.fillRect(0, 0, S, S);
  // Lane marks down the middle of every road.
  g.strokeStyle = P.lane;
  g.lineWidth = 2;
  g.setLineDash([14, 12]);
  for (let q = 0; q <= city.blocks; q++) {
    const m = q * BLOCK + ROAD / 2;
    g.beginPath();
    g.moveTo(0, m);
    g.lineTo(S, m);
    g.moveTo(m, 0);
    g.lineTo(m, S);
    g.stroke();
  }
  g.setLineDash([]);
  const w = BLOCK - ROAD;
  for (let by = 0; by < city.blocks; by++)
    for (let bx = 0; bx < city.blocks; bx++) {
      const x = ROAD + bx * BLOCK;
      const y = ROAD + by * BLOCK;
      g.fillStyle = P.curb;
      g.beginPath();
      g.roundRect(x - 3, y - 3, w + 6, w + 6, 14);
      g.fill();
      g.fillStyle = P.lawn;
      g.beginPath();
      g.roundRect(x + 5, y + 5, w - 10, w - 10, 10);
      g.fill();
    }
  return c;
}

const pickOf = <T>(list: T[], v: number): T => list[Math.min(list.length - 1, Math.floor(v * list.length))];

/** How tall an object stands (its shadow's reach), in city units. */
function height(o: CityObject): number {
  switch (o.kind) {
    case 'tower':
      return 26;
    case 'shop':
    case 'house':
      return 9;
    case 'tree':
      return 6;
    case 'bus':
    case 'car':
    case 'lamp':
      return 3;
    default:
      return 1.5;
  }
}

/** The object's soft shadow, cast down and to the right. */
export function drawShadow(ctx: Ctx2D, o: CityObject, P: CityPalette): void {
  const h = height(o);
  ctx.fillStyle = P.shadow;
  ctx.beginPath();
  if (o.kind === 'tree' || o.kind === 'bush' || o.kind === 'lamp' || o.kind === 'cone')
    ctx.arc(o.x + h * 0.6, o.y + h * 0.8, o.hw, 0, Math.PI * 2);
  else
    ctx.roundRect(o.x - o.hw + h * 0.6, o.y - o.hh + h * 0.8, 2 * o.hw, 2 * o.hh, Math.min(o.hw, o.hh) * 0.3);
  ctx.fill();
}

/** The object itself, centered on its own position (callers may transform for a fall). */
export function drawObject(ctx: Ctx2D, o: CityObject, P: CityPalette, x = o.x, y = o.y): void {
  const { hw, hh, v } = o;
  ctx.beginPath();
  switch (o.kind) {
    case 'tree':
      ctx.fillStyle = pickOf(P.tree, v);
      ctx.arc(x, y, hw, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(x - hw * 0.3, y - hw * 0.3, hw * 0.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'bush':
      ctx.fillStyle = P.bush;
      ctx.arc(x, y, hw, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'lamp':
      ctx.fillStyle = P.glow;
      ctx.arc(x, y, hw * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = P.lamp;
      ctx.beginPath();
      ctx.arc(x, y, hw, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'cone':
      ctx.fillStyle = '#FF7A1A';
      ctx.arc(x, y, hw, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(x, y, hw * 0.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'bench':
      ctx.fillStyle = '#A0703E';
      ctx.roundRect(x - hw, y - hh, 2 * hw, 2 * hh, 1.5);
      ctx.fill();
      return;
    case 'car':
    case 'bus': {
      ctx.fillStyle = o.kind === 'bus' ? P.bus : pickOf(P.car, v);
      ctx.roundRect(x - hw, y - hh, 2 * hw, 2 * hh, Math.min(hw, hh) * 0.55);
      ctx.fill();
      // Windshield toward the front (the long axis).
      ctx.fillStyle = 'rgba(20,24,40,0.7)';
      ctx.beginPath();
      if (hw > hh) {
        const f = v < 0.5 ? 1 : -1;
        if (o.kind === 'bus') ctx.rect(x - hw * 0.8, y - hh * 0.55, hw * 1.6, hh * 1.1);
        else ctx.rect(x + f * hw * 0.25 - (f < 0 ? hw * 0.35 : 0), y - hh * 0.7, hw * 0.35, hh * 1.4);
      } else {
        const f = v < 0.5 ? 1 : -1;
        ctx.rect(x - hw * 0.7, y + f * hh * 0.25 - (f < 0 ? hh * 0.35 : 0), hw * 1.4, hh * 0.35);
      }
      ctx.fill();
      return;
    }
    case 'house': {
      // A gable roof: two halves in two shades of one color.
      const c = pickOf(P.roof, v);
      ctx.fillStyle = P.wall;
      ctx.roundRect(x - hw - 2, y - hh - 2, 2 * hw + 4, 2 * hh + 4, 3);
      ctx.fill();
      ctx.fillStyle = c;
      ctx.fillRect(x - hw, y - hh, 2 * hw, 2 * hh);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      if (hw > hh) ctx.fillRect(x - hw, y, 2 * hw, hh);
      else ctx.fillRect(x, y - hh, hw, 2 * hh);
      return;
    }
    case 'shop': {
      ctx.fillStyle = P.wall;
      ctx.roundRect(x - hw, y - hh, 2 * hw, 2 * hh, 3);
      ctx.fill();
      ctx.fillStyle = pickOf(P.roof, v);
      ctx.fillRect(x - hw, y - hh, 2 * hw, Math.min(8, hh * 0.3));
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 3; k++)
        ctx.fillRect(x - hw * 0.6 + k * hw * 0.45, y - hh * 0.1, hw * 0.25, hh * 0.25);
      return;
    }
    case 'tower': {
      const c = pickOf(P.tower, v);
      ctx.fillStyle = c;
      ctx.roundRect(x - hw, y - hh, 2 * hw, 2 * hh, 4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - hw * 0.72, y - hh * 0.72, hw * 1.44, hh * 1.44);
      // Rooftop: a helipad on the big ones, vents on the rest.
      if (hw > 45) {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, Math.min(hw, hh) * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        const q = Math.min(hw, hh) * 0.18;
        ctx.moveTo(x - q, y - q);
        ctx.lineTo(x - q, y + q);
        ctx.moveTo(x + q, y - q);
        ctx.lineTo(x + q, y + q);
        ctx.moveTo(x - q, y);
        ctx.lineTo(x + q, y);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(x - hw * 0.4, y - hh * 0.4, hw * 0.3, hh * 0.3);
        ctx.fillRect(x + hw * 0.1, y + hh * 0.05, hw * 0.3, hh * 0.3);
      }
      return;
    }
  }
}
