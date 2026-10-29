import { ImageUp, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { flagUrl, loadCountries, type Country } from '../data/countries';
import type { Fighter } from '../engine/types';
import { loadFlagSafe } from '../lib/flags';
import { saveBlob } from '../lib/images';
import { useApp } from '../store/app';
import { FlagDisc } from './FlagDisc';
import { ImageCropper } from './ImageCropper';
import { Button } from './ui/Button';
import { Field, Slider, inputClass } from './ui/controls';
import { Dialog } from './ui/Dialog';

const ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp';

export function EditFighterDialog({
  fighterId,
  onClose,
  isNew = false,
}: {
  fighterId: string | null;
  onClose: () => void;
  isNew?: boolean;
}) {
  const fighter = useApp((s) => s.fighters.find((f) => f.id === fighterId) ?? null);
  const update = useApp((s) => s.updateFighter);
  const balanced = useApp((s) => s.balanced);
  const escapeMode = useApp((s) => s.rules.mode === 'escape');
  const [file, setFile] = useState<File | null>(null);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFile(null);
    setPicking(false);
  }, [fighterId]);

  if (!fighter) return null;
  const set = (patch: Partial<Fighter>) => update(fighter.id, patch);

  return (
    <Dialog
      open={!!fighterId}
      onOpenChange={(o) => !o && onClose()}
      title={file ? 'Crop image' : isNew ? 'New custom fighter' : `Edit ${fighter.name}`}
      description={file ? 'Drag to position, zoom to fit. The flag is shown as a circle.' : undefined}
      className="max-w-md"
    >
      {file ? (
        <ImageCropper
          file={file}
          onCancel={() => setFile(null)}
          onDone={async (blob) => {
            const key = await saveBlob('img', blob);
            set({ imageSrc: `idb:${key}`, accent: '' });
            setFile(null);
            toast.success('Image updated');
          }}
        />
      ) : picking ? (
        <FlagLibraryPicker
          onCancel={() => setPicking(false)}
          onPick={(c) => {
            set({ imageSrc: flagUrl(c.iso2), iso2: c.iso2, kind: 'country', accent: '' });
            setPicking(false);
          }}
        />
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <FlagDisc src={fighter.imageSrc} size={64} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <ImageUp size={14} /> Upload image
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
                Pick from library
              </Button>
              {fighter.iso2 && fighter.imageSrc !== flagUrl(fighter.iso2) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => set({ imageSrc: flagUrl(fighter.iso2!), accent: '' })}
                >
                  <RotateCcw size={13} /> Original flag
                </Button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFile(f);
                e.target.value = '';
              }}
            />
          </div>

          <Field label="Display name" htmlFor="fighter-name">
            <input
              id="fighter-name"
              value={fighter.name}
              maxLength={32}
              onChange={(e) => set({ name: e.target.value })}
              onBlur={(e) => !e.target.value.trim() && set({ name: 'Unnamed' })}
              className={inputClass}
              autoComplete="off"
            />
          </Field>

          <div className="space-y-5">
            {balanced && (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                Balanced mode is on, so stats below are ignored in battle.
              </p>
            )}
            {!balanced && escapeMode && (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                In Escape the circle only size and speed matter. HP and attack apply to Battle royale.
              </p>
            )}
            <Slider
              label="HP"
              value={fighter.hp}
              min={50}
              max={500}
              step={10}
              onChange={(hp) => set({ hp })}
              disabled={balanced || escapeMode}
            />
            <Slider
              label="Size"
              value={fighter.size}
              min={0.6}
              max={1.6}
              step={0.05}
              onChange={(size) => set({ size })}
              format={(v) => `${v.toFixed(2)}×`}
              disabled={balanced}
            />
            <Slider
              label="Speed"
              value={fighter.speed}
              min={0.5}
              max={2}
              step={0.05}
              onChange={(speed) => set({ speed })}
              format={(v) => `${v.toFixed(2)}×`}
              disabled={balanced}
            />
            <Slider
              label="Attack"
              value={fighter.attack}
              min={0.5}
              max={2}
              step={0.05}
              onChange={(attack) => set({ attack })}
              format={(v) => `${v.toFixed(2)}×`}
              disabled={balanced || escapeMode}
            />
          </div>

          <AccentField fighter={fighter} onChange={(accent) => set({ accent })} />

          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function AccentField({ fighter, onChange }: { fighter: Fighter; onChange: (hex: string) => void }) {
  const [auto, setAuto] = useState('#C6FF3D');
  useEffect(() => {
    let live = true;
    loadFlagSafe(fighter.imageSrc).then((a) => live && setAuto(a.colors.accent));
    return () => {
      live = false;
    };
  }, [fighter.imageSrc]);
  const value = fighter.accent || auto;
  return (
    <Field label="Accent color" hint={fighter.accent ? 'Custom' : 'Auto from flag'} htmlFor="fighter-accent">
      <div className="flex items-center gap-2">
        <input
          id="fighter-accent"
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 cursor-pointer rounded-xl border border-line-strong bg-bg/60 p-1"
        />
        <span className="flex-1 font-mono text-xs text-muted uppercase">{value}</span>
        {fighter.accent && (
          <Button size="sm" variant="ghost" onClick={() => onChange('')}>
            Use auto
          </Button>
        )}
      </div>
    </Field>
  );
}

function FlagLibraryPicker({ onPick, onCancel }: { onPick: (c: Country) => void; onCancel: () => void }) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    loadCountries().then(setCountries);
  }, []);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return countries
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.iso2 === needle)
      .slice(0, 60);
  }, [countries, q]);
  return (
    <div className="space-y-3">
      <label htmlFor="flag-search" className="sr-only">
        Search flags
      </label>
      <input
        id="flag-search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search flags"
        className={inputClass}
      />
      <ul className="grid max-h-[320px] grid-cols-2 gap-1 overflow-y-auto scrollbar-thin">
        {list.map((c) => (
          <li key={c.iso2}>
            <button
              type="button"
              onClick={() => onPick(c)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-2"
            >
              <FlagDisc src={flagUrl(c.iso2)} size={22} ring={false} />
              <span className="truncate">{c.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  );
}
