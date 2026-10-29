/**
 * Small SVG charts for the dashboard: a line chart (with crosshair tooltip) for a total over
 * time, vertical bars (per-bar tooltip) and labelled horizontal bars. Thin marks, recessive grid,
 * one axis per chart, text in text colors (never the series color).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Rounded tick values covering [lo, hi]. */
function ticks(lo: number, hi: number, count = 4): number[] {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(v);
  return out;
}

/** Axis label with just enough decimals to tell neighbouring ticks apart. */
function tickLabel(v: number, step: number): string {
  const unit = Math.abs(v) >= 1e6 ? 1e6 : Math.abs(v) >= 1e3 ? 1e3 : 1;
  const suffix = unit === 1e6 ? 'M' : unit === 1e3 ? 'K' : '';
  const decimals = Math.max(0, Math.min(2, Math.ceil(Math.log10(unit / step) - 1e-9)));
  return `${(v / unit).toFixed(decimals)}${suffix}`;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(8, x - 90), width - 188);
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 w-[180px] rounded-lg bg-surface-3 px-3 py-2 text-xs shadow-xl ring-1 ring-line-strong"
      style={{ left, top: Math.max(0, y - 64) }}
    >
      {children}
    </div>
  );
}

export function LineChart({
  points,
  height = 200,
  color = 'var(--color-accent)',
  format,
  label,
}: {
  points: { t: number; v: number }[];
  height?: number;
  color?: string;
  format: (v: number) => string;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 52;
  const padR = 12;
  const padT = 10;
  const padB = 26;
  const t0 = points[0]?.t ?? 0;
  const t1 = points[points.length - 1]?.t ?? 1;
  const vals = points.map((p) => p.v);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || Math.max(1, hi * 0.05);
  const yt = ticks(lo - span * 0.1, hi + span * 0.1);
  const y0 = yt[0];
  const y1 = yt[yt.length - 1];
  const X = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (width - padL - padR);
  const Y = (v: number) => padT + (1 - (v - y0) / Math.max(1e-9, y1 - y0)) * (height - padT - padB);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const day = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const h = hover !== null ? points[hover] : null;
  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label}: from ${format(points[0]?.v ?? 0)} to ${format(points[points.length - 1]?.v ?? 0)}`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left;
          let best = 0;
          points.forEach((p, i) => {
            if (Math.abs(X(p.t) - x) < Math.abs(X(points[best].t) - x)) best = i;
          });
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {yt.map((v) => (
          <g key={v}>
            <line x1={padL} x2={width - padR} y1={Y(v)} y2={Y(v)} stroke="var(--color-line)" />
            <text
              x={padL - 8}
              y={Y(v)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted text-[11px] tabular"
            >
              {tickLabel(v, yt.length > 1 ? yt[1] - yt[0] : 1)}
            </text>
          </g>
        ))}
        {[t0, (t0 + t1) / 2, t1].map((t, i) => (
          <text
            key={i}
            x={X(t)}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            className="fill-muted text-[11px]"
          >
            {day(t)}
          </text>
        ))}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {h && (
          <>
            <line x1={X(h.t)} x2={X(h.t)} y1={padT} y2={height - padB} stroke="var(--color-line-strong)" />
            <circle
              cx={X(h.t)}
              cy={Y(h.v)}
              r={4.5}
              fill={color}
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
          </>
        )}
      </svg>
      {h && (
        <Tooltip x={X(h.t)} y={Y(h.v)} width={width}>
          <div className="text-muted">
            {new Date(h.t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
          <div className="mt-0.5 font-medium tabular text-text">
            {label}: {format(h.v)}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

export type Bar = {
  key: string;
  label: string;
  value: number;
  color?: string;
  dim?: boolean;
  tip: ReactNode;
};

export function BarChart({
  bars,
  height = 200,
  label,
  reference,
  labelEvery = 1,
}: {
  bars: Bar[];
  height?: number;
  label: string;
  /** Optional dashed reference line (e.g. the typical value). */
  reference?: { value: number; label: string };
  labelEvery?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 52;
  const padR = 8;
  const padT = 10;
  const padB = 26;
  const max = Math.max(1, ...bars.map((b) => b.value), reference?.value ?? 0);
  const yt = ticks(0, max * 1.05);
  const top = yt[yt.length - 1];
  const Y = (v: number) => padT + (1 - v / top) * (height - padT - padB);
  const slot = (width - padL - padR) / Math.max(1, bars.length);
  const bw = Math.max(3, slot - 2);
  return (
    <div ref={ref} className="relative">
      <svg width={width} height={height} role="img" aria-label={label} onPointerLeave={() => setHover(null)}>
        {yt.map((v) => (
          <g key={v}>
            <line x1={padL} x2={width - padR} y1={Y(v)} y2={Y(v)} stroke="var(--color-line)" />
            <text
              x={padL - 8}
              y={Y(v)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted text-[11px] tabular"
            >
              {tickLabel(v, yt.length > 1 ? yt[1] - yt[0] : 1)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = padL + i * slot + (slot - bw) / 2;
          const y = Y(b.value);
          const hgt = Math.max(0, height - padB - y);
          const r = Math.min(4, bw / 2, hgt);
          return (
            <g key={b.key}>
              {/* Rounded top, square base on the axis. */}
              <path
                d={`M${x},${height - padB}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${height - padB}Z`}
                fill={b.color ?? 'var(--color-accent)'}
                opacity={hover === null ? (b.dim ? 0.45 : 1) : hover === i ? 1 : 0.4}
              />
              <rect
                x={padL + i * slot}
                y={padT}
                width={slot}
                height={height - padT - padB}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
              />
              {i % labelEvery === 0 && (
                <text x={x + bw / 2} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
        {reference && reference.value > 0 && (
          <g>
            <line
              x1={padL}
              x2={width - padR}
              y1={Y(reference.value)}
              y2={Y(reference.value)}
              stroke="var(--color-text)"
              strokeDasharray="4 4"
              opacity={0.6}
            />
            <text
              x={width - padR}
              y={Y(reference.value) - 5}
              textAnchor="end"
              className="fill-muted text-[11px]"
            >
              {reference.label}
            </text>
          </g>
        )}
      </svg>
      {hover !== null && bars[hover] && (
        <Tooltip x={padL + hover * slot + slot / 2} y={Y(bars[hover].value)} width={width}>
          {bars[hover].tip}
        </Tooltip>
      )}
    </div>
  );
}

/** Horizontal bars with direct labels (a few rows, e.g. one per game). */
export function HBars({
  rows,
  format,
}: {
  rows: { key: string; label: ReactNode; value: number; color: string; note?: string }[];
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 tabular text-text">
              {format(r.value)}
              {r.note && <span className="ml-2 text-xs text-muted">{r.note}</span>}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-surface-3">
            <div
              className={cn('h-full rounded-full')}
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
