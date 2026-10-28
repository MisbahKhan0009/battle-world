import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import {
  ChevronDown,
  Copy,
  GripVertical,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Shuffle,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { memo, useState } from 'react';
import { toast } from 'sonner';
import { GROUPS, loadCountries, REGIONS, type Country, type Region } from '../data/countries';
import type { Fighter } from '../engine/types';
import { cn, shuffle, uid } from '../lib/utils';
import { countryFighter, MAX_FIGHTERS, MIN_FIGHTERS, useApp } from '../store/app';
import { useUi } from '../store/ui';
import { EditFighterDialog } from './EditFighterDialog';
import { FlagDisc } from './FlagDisc';
import { Button } from './ui/Button';
import { Kbd, Slider, Toggle } from './ui/controls';

const CUSTOM_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C6FF3D"/><stop offset="1" stop-color="#3DDCFF"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="43" font-family="Arial" font-weight="700" font-size="30" text-anchor="middle" fill="#0B0D12">?</text></svg>`,
  );

export function RosterTab() {
  const fighters = useApp((s) => s.fighters);
  const setFighters = useApp((s) => s.setFighters);
  const addFighters = useApp((s) => s.addFighters);
  const moveFighter = useApp((s) => s.moveFighter);
  const balanced = useApp((s) => s.balanced);
  const setBalanced = useApp((s) => s.setBalanced);
  const setUi = useUi((s) => s.set);
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(null);
  const count = fighters.length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const setCount = async (n: number) => {
    const target = Math.max(MIN_FIGHTERS, Math.min(MAX_FIGHTERS, Math.round(n)));
    const all = await loadCountries();
    // Read state after the await so rapid slider changes never overshoot.
    const current = useApp.getState().fighters;
    if (target < current.length) setFighters(current.slice(0, target));
    else if (target > current.length) {
      const have = new Set(current.map((f) => f.iso2).filter(Boolean) as string[]);
      addFighters(
        shuffle(all.filter((c) => !have.has(c.iso2)))
          .slice(0, target - current.length)
          .map(countryFighter),
      );
    }
  };

  const fill = async (kind: 'random' | 'g20' | 'saarc' | 'population' | Region) => {
    const all = await loadCountries();
    const byIso = new Map(all.map((c) => [c.iso2, c]));
    let picks: Country[];
    if (kind === 'random') picks = shuffle(all).slice(0, Math.max(count, MIN_FIGHTERS));
    else if (kind === 'population')
      picks = GROUPS.population
        .slice(0, Math.max(count, 8))
        .map((i) => byIso.get(i)!)
        .filter(Boolean);
    else if (kind === 'g20' || kind === 'saarc')
      picks = GROUPS[kind].map((i) => byIso.get(i)!).filter(Boolean);
    else picks = all.filter((c) => c.region === kind).slice(0, MAX_FIGHTERS);
    setFighters(picks.map(countryFighter));
    toast(`Roster set to ${picks.length} countries`);
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = fighters.findIndex((f) => f.id === e.active.id);
    const to = fighters.findIndex((f) => f.id === e.over!.id);
    if (from >= 0 && to >= 0) moveFighter(from, to);
  };

  const addCustom = () => {
    if (count >= MAX_FIGHTERS) return toast.error(`The roster is full (${MAX_FIGHTERS} max).`);
    const f: Fighter = {
      id: uid(),
      kind: 'custom',
      name: 'Custom',
      imageSrc: CUSTOM_PLACEHOLDER,
      accent: '',
      hp: 100,
      size: 1,
      speed: 1,
      attack: 1,
    };
    addFighters([f]);
    setEditing({ id: f.id, isNew: true });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-medium">Fighters</h3>
          <div className="flex items-center gap-1 rounded-xl bg-bg/60 p-1 ring-1 ring-line">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Remove one fighter"
              onClick={() => setCount(count - 1)}
              disabled={count <= MIN_FIGHTERS}
            >
              <Minus size={14} />
            </Button>
            <span className="w-8 text-center font-display text-xl leading-none tabular" aria-live="polite">
              {count}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Add a random fighter"
              onClick={() => setCount(count + 1)}
              disabled={count >= MAX_FIGHTERS}
            >
              <Plus size={14} />
            </Button>
          </div>
        </div>
        <Slider
          label="Roster size"
          value={count}
          min={MIN_FIGHTERS}
          max={MAX_FIGHTERS}
          onChange={(v) => void setCount(v)}
          format={(v) => `${v} of ${MAX_FIGHTERS}`}
        />

        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => fill('random')}>
            <Shuffle size={13} /> Random
          </Button>
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button size="sm">
                By region <ChevronDown size={13} />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                sideOffset={6}
                align="start"
                className="z-50 grid w-44 gap-0.5 rounded-xl border border-line-strong bg-surface-2 p-1.5 shadow-xl"
              >
                {REGIONS.map((r) => (
                  <Popover.Close key={r} asChild>
                    <button
                      type="button"
                      onClick={() => fill(r)}
                      className="rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-3"
                    >
                      {r}
                    </button>
                  </Popover.Close>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button size="sm" onClick={() => fill('g20')}>
            G20
          </Button>
          <Button size="sm" onClick={() => fill('population')}>
            Top population
          </Button>
          <Button size="sm" onClick={() => fill('saarc')}>
            SAARC
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const prev = useApp.getState().fighters;
              setFighters([]);
              toast('Roster cleared', { action: { label: 'Undo', onClick: () => setFighters(prev) } });
            }}
          >
            Clear
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setUi({ paletteOpen: true })}
            className="flex h-10 flex-1 items-center gap-2.5 rounded-xl border border-line-strong bg-bg/60 px-3 text-left text-sm text-muted transition-colors hover:border-accent/50 hover:text-text"
          >
            <Search size={15} />
            <span className="flex-1">Add countries</span>
            <span className="hidden gap-1 sm:flex">
              <Kbd>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <Button variant="secondary" onClick={addCustom} aria-label="Add custom fighter">
            <UserPlus size={15} /> <span className="hidden sm:inline">Custom</span>
          </Button>
        </div>

        {count < MIN_FIGHTERS ? (
          <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
            <p className="text-sm">Add at least 2 countries to start.</p>
            <p className="mt-1 text-xs text-muted">Use a quick fill above, or search with the box.</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={fighters.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-1" aria-label="Roster">
                {fighters.map((f, i) => (
                  <RosterRow
                    key={f.id}
                    fighter={f}
                    index={i}
                    balanced={balanced}
                    onEdit={() => setEditing({ id: f.id, isNew: false })}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <section className="rounded-xl bg-surface-2/50 p-3 ring-1 ring-line">
        <Toggle
          label="Balanced"
          description="Everyone gets 100 HP and 1× size, speed and attack."
          checked={balanced}
          onChange={setBalanced}
        />
      </section>

      <EditFighterDialog
        fighterId={editing?.id ?? null}
        isNew={editing?.isNew}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

const RosterRow = memo(function RosterRow({
  fighter,
  index,
  balanced,
  onEdit,
}: {
  fighter: Fighter;
  index: number;
  balanced: boolean;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: fighter.id,
  });
  const removeFighter = useApp((s) => s.removeFighter);
  const duplicateFighter = useApp((s) => s.duplicateFighter);
  const addFighters = useApp((s) => s.addFighters);
  const modified =
    !balanced && (fighter.hp !== 100 || fighter.size !== 1 || fighter.speed !== 1 || fighter.attack !== 1);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group flex h-11 items-center gap-2 rounded-xl pr-1 pl-1 transition-colors hover:bg-surface-2',
        isDragging && 'relative z-10 bg-surface-3 shadow-xl ring-1 ring-line-strong',
      )}
    >
      <button
        type="button"
        className="grid h-8 w-6 cursor-grab place-items-center rounded text-muted/60 hover:text-text active:cursor-grabbing"
        aria-label={`Reorder ${fighter.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <span className="w-5 text-right text-[11px] text-muted/70 tabular">{index + 1}</span>
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <FlagDisc src={fighter.imageSrc} size={26} />
        <span className="truncate text-sm">{fighter.name}</span>
        {fighter.kind === 'custom' && (
          <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">Custom</span>
        )}
      </button>
      <span
        className={cn('text-xs tabular', modified ? 'text-accent' : 'text-muted')}
        title={modified ? 'Custom stats' : undefined}
      >
        {balanced ? 100 : fighter.hp} HP
      </span>
      <Menu.Root>
        <Menu.Trigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${fighter.name}`}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-3 hover:text-text"
          >
            <MoreHorizontal size={16} />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-40 rounded-xl border border-line-strong bg-surface-2 p-1.5 shadow-xl"
          >
            <Menu.Item
              onSelect={onEdit}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-3"
            >
              <Pencil size={14} /> Edit
            </Menu.Item>
            <Menu.Item
              onSelect={() => duplicateFighter(fighter.id)}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-3"
            >
              <Copy size={14} /> Duplicate
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-line" />
            <Menu.Item
              onSelect={() => {
                const snapshot = { ...fighter };
                const at = useApp.getState().fighters.findIndex((f) => f.id === fighter.id);
                removeFighter(fighter.id);
                toast(`Removed ${fighter.name}`, {
                  action: {
                    label: 'Undo',
                    onClick: () => {
                      addFighters([snapshot]);
                      const list = useApp.getState().fighters;
                      useApp.getState().moveFighter(list.length - 1, Math.min(at, list.length - 1));
                    },
                  },
                });
              }}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger/10"
            >
              <Trash2 size={14} /> Remove
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </li>
  );
});
