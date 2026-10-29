import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dayKey, parseDayKey, planDay, type PlannedSlot } from '../../autopilot/planner';
import type { AutopilotState, Slot } from '../../autopilot/types';
import { Button } from '../../components/ui/Button';
import { isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { cn } from '../../lib/utils';
import { MODULES, moduleById, readyModuleIds } from '../../modules/registry';
import { Card, DesktopLayout, DesktopOnly } from './Layout';
import { FormatChip, PostDetail, STATUS_STYLE, fmtTime, isScheduledOnYouTube, statusLabel } from './posts';

type Entry = { kind: 'slot'; slot: Slot } | { kind: 'preview'; slot: PlannedSlot };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Plan previews for days that are not queued yet (the autopilot queues a week ahead). */
function previews(state: AutopilotState, from: Date, to: Date): Entry[] {
  const out: Entry[] = [];
  if (state.running) {
    const ready = new Set(readyModuleIds());
    const modules = Object.entries(state.modules)
      .filter(([id, on]) => on && ready.has(id))
      .map(([id]) => id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const ch of state.channels) {
      if (!ch.enabled) continue;
      const planned = new Set(state.plannedDays[ch.id] ?? []);
      for (let d = new Date(Math.max(from.getTime(), today.getTime())); d < to; d.setDate(d.getDate() + 1)) {
        const key = dayKey(d);
        if (planned.has(key)) continue;
        for (const p of planDay(ch.id, new Date(d), state.schedule, modules))
          out.push({ kind: 'preview', slot: p });
      }
    }
  }
  return out;
}

/** Posts per local day: real ones from the autopilot plus the previews. */
function groupByDay(state: AutopilotState, extra: Entry[], from: Date, to: Date): Map<string, Entry[]> {
  const map = new Map<string, Entry[]>();
  const add = (e: Entry) => {
    const key = dayKey(new Date(e.slot.at));
    map.set(key, [...(map.get(key) ?? []), e]);
  };
  for (const s of state.slots)
    if (s.at >= from.getTime() && s.at < to.getTime()) add({ kind: 'slot', slot: s });
  const real = new Set(state.slots.map((s) => s.id));
  for (const e of extra) if (!real.has(e.slot.id)) add(e);
  for (const list of map.values()) list.sort((a, b) => a.slot.at - b.slot.at);
  return map;
}

function entryTone(e: Entry): string {
  if (e.kind === 'preview') return 'border-dashed border-line-strong text-muted';
  const s = e.slot;
  if (s.status === 'posted')
    return isScheduledOnYouTube(s)
      ? 'border-[#3DDCFF]/50 text-text'
      : 'border-hp-high/50 bg-hp-high/10 text-text';
  if (s.status === 'failed') return 'border-danger/50 bg-danger/10 text-danger';
  if (s.status === 'skipped') return 'border-line text-muted/60 line-through';
  if (s.status === 'rendering' || s.status === 'uploading')
    return 'border-accent/60 bg-accent/10 text-accent';
  return 'border-line-strong text-text';
}

/** Game color; a dot for a Short, a small square for a long video. */
function GameMark({ moduleId, format }: { moduleId: string; format: Slot['format'] }) {
  return (
    <span
      aria-hidden
      className={cn('h-2 w-2 shrink-0', format === 'short' ? 'rounded-full' : 'rounded-[2px]')}
      style={{ background: moduleById(moduleId)?.accent ?? '#888' }}
    />
  );
}

function EntryButton({ e, onOpen, compact }: { e: Entry; onOpen: (e: Entry) => void; compact?: boolean }) {
  const s = e.slot;
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen(e);
      }}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md border px-1.5 text-left transition-colors hover:bg-surface-3',
        compact ? 'h-6 text-[11px]' : 'h-9 text-[13px]',
        entryTone(e),
      )}
    >
      <GameMark moduleId={s.moduleId} format={s.format} />
      <span className="tabular">{fmtTime(s.at)}</span>
      {!compact && <FormatChip format={s.format} className="h-5" />}
      {!compact && (
        <span className="shrink-0 text-xs" style={{ color: moduleById(s.moduleId)?.accent }}>
          {moduleById(s.moduleId)?.name}
        </span>
      )}
      {!compact && (
        <span className="min-w-0 flex-1 truncate text-muted">
          {e.kind === 'preview'
            ? 'In the plan'
            : (e.slot.title ??
              (e.slot.status === 'rendering'
                ? 'Rendering now…'
                : e.slot.status === 'planned'
                  ? 'Renders before it goes live'
                  : ''))}
        </span>
      )}
      {!compact && (
        <span className={cn('text-xs', e.kind === 'slot' ? STATUS_STYLE[e.slot.status] : 'text-muted')}>
          {e.kind === 'slot' ? statusLabel(e.slot) : 'Planned'}
        </span>
      )}
    </button>
  );
}

export function CalendarPage() {
  const { ap, state } = useAutopilot();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const [open, setOpen] = useState<Entry | null>(null);
  const [game, setGame] = useState<string>('all');

  // Grid: whole weeks (Monday first) covering the month.
  const gridStart = useMemo(() => {
    const d = new Date(month);
    d.setDate(1 - ((d.getDay() + 6) % 7));
    return d;
  }, [month]);
  const days = useMemo(
    () =>
      Array.from(
        { length: 42 },
        (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i),
      ),
    [gridStart],
  );
  const end = useMemo(
    () => new Date(days[41].getFullYear(), days[41].getMonth(), days[41].getDate() + 1),
    [days],
  );
  // The autopilot mutates its state in place, so key the (relatively costly) previews on the
  // inputs that change them rather than on the state object.
  const previewKey = state
    ? JSON.stringify([
        state.running,
        state.schedule,
        state.plannedDays,
        state.modules,
        state.channels.map((c) => [c.id, c.enabled]),
      ])
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extra = useMemo(() => (state ? previews(state, days[0], end) : []), [previewKey, days, end]);
  const byDayAll = state ? groupByDay(state, extra, days[0], end) : new Map<string, Entry[]>();
  const byDay =
    game === 'all'
      ? byDayAll
      : new Map([...byDayAll].map(([k, list]) => [k, list.filter((e) => e.slot.moduleId === game)]));
  const games = MODULES.filter((m) => m.status === 'ready');

  if (!isDesktop()) {
    return (
      <DesktopLayout title="Calendar">
        <DesktopOnly feature="The posting calendar" />
      </DesktopLayout>
    );
  }
  if (!ap || !state) {
    return (
      <DesktopLayout title="Calendar">
        <p className="text-sm text-muted">Starting…</p>
      </DesktopLayout>
    );
  }

  const todayKey = dayKey(new Date());
  const dayEntries = byDay.get(selected) ?? [];
  const monthEntries = days
    .filter((d) => d.getMonth() === month.getMonth())
    .flatMap((d) => byDay.get(dayKey(d)) ?? []);
  const count = (pred: (e: Entry) => boolean) => monthEntries.filter(pred).length;
  const live = count((e) => e.kind === 'slot' && e.slot.status === 'posted' && !isScheduledOnYouTube(e.slot));
  const upcoming = count(
    (e) =>
      e.kind === 'preview' ||
      ['planned', 'rendering', 'rendered', 'uploading'].includes(e.slot.status) ||
      isScheduledOnYouTube(e.slot),
  );

  return (
    <DesktopLayout
      title="Calendar"
      actions={
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Previous month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            <ChevronLeft size={17} />
          </Button>
          <span className="w-[150px] text-center text-sm font-medium">
            {month.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Next month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            <ChevronRight size={17} />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const d = new Date();
              setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
              setSelected(dayKey(d));
            }}
          >
            Today
          </Button>
        </div>
      }
    >
      <div className="mx-auto grid max-w-[1400px] gap-5 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
            <span>
              <span className="text-text tabular">{live}</span> live this month
            </span>
            <span>
              <span className="text-text tabular">{upcoming}</span> coming up
            </span>
            <div
              className="ml-auto flex items-center gap-1 rounded-lg bg-surface-2/60 p-0.5 ring-1 ring-line"
              role="group"
              aria-label="Show games"
            >
              {[{ id: 'all', name: 'All games', accent: '' }, ...games].map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={game === g.id}
                  onClick={() => setGame(g.id)}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
                    game === g.id ? 'bg-surface-3 text-text' : 'text-muted hover:text-text',
                  )}
                >
                  {g.accent && <span className="h-2 w-2 rounded-full" style={{ background: g.accent }} />}
                  {g.name}
                </button>
              ))}
            </div>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-muted" /> Short
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px] bg-muted" /> Video
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-4 rounded-sm border border-hp-high/50 bg-hp-high/10" /> Live
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-4 rounded-sm border border-[#3DDCFF]/50" /> Scheduled
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-4 rounded-sm border border-dashed border-line-strong" /> Planned
            </span>
          </div>
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-2">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const key = dayKey(d);
                const list = byDay.get(key) ?? [];
                const inMonth = d.getMonth() === month.getMonth();
                const isSel = key === selected;
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}, ${list.length} posts`}
                    aria-pressed={isSel}
                    onClick={() => setSelected(key)}
                    onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && setSelected(key)}
                    className={cn(
                      'min-h-[118px] cursor-pointer space-y-1 border-r border-b border-line p-1.5 text-left transition-colors [&:nth-child(7n)]:border-r-0',
                      !inMonth && 'bg-bg/40 opacity-50',
                      isSel ? 'bg-surface-2' : 'hover:bg-surface-2/50',
                    )}
                  >
                    <div className="flex items-center justify-between px-0.5">
                      <span
                        className={cn(
                          'grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs tabular',
                          key === todayKey ? 'bg-accent font-semibold text-accent-ink' : 'text-muted',
                        )}
                      >
                        {d.getDate()}
                      </span>
                    </div>
                    {list.slice(0, 4).map((e) => (
                      <EntryButton key={e.slot.id} e={e} onOpen={setOpen} compact />
                    ))}
                    {list.length > 4 && (
                      <div className="px-1 text-[11px] text-muted">+{list.length - 4} more</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <Card
          title={parseDayKey(selected).toLocaleDateString([], {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
          note={
            dayEntries.length
              ? `${plural(dayEntries.filter((e) => e.slot.format === 'short').length, 'Short')}, ${plural(dayEntries.filter((e) => e.slot.format === 'video').length, 'long video')}. Click a post to follow it.`
              : undefined
          }
        >
          {dayEntries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              {state.running || selected < todayKey
                ? 'No posts on this day.'
                : 'Start the autopilot to see its plan.'}
            </p>
          ) : (
            <div className="space-y-1.5">
              {dayEntries.map((e) => (
                <EntryButton key={e.slot.id} e={e} onOpen={setOpen} />
              ))}
            </div>
          )}
        </Card>
      </div>
      <PostDetail
        ap={ap}
        slotId={open?.slot.id ?? null}
        preview={open?.kind === 'preview' ? open.slot : null}
        onClose={() => setOpen(null)}
      />
    </DesktopLayout>
  );
}
