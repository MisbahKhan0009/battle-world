import * as RadixDialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Check, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { flagUrl, loadCountries, type Country } from '../data/countries';
import { countryFighter, MAX_FIGHTERS, useApp } from '../store/app';
import { useUi } from '../store/ui';
import { FlagDisc } from './FlagDisc';
import { Kbd } from './ui/controls';

/**
 * Command-palette country picker (Cmd/Ctrl+K). Selecting a country adds it; selecting one already
 * in the roster removes it.
 */
export function CountryPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setUi = useUi((s) => s.set);
  const fighters = useApp((s) => s.fighters);
  const addFighters = useApp((s) => s.addFighters);
  const removeFighter = useApp((s) => s.removeFighter);
  const [countries, setCountries] = useState<Country[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) loadCountries().then(setCountries);
    else setQuery('');
  }, [open]);

  const inRoster = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fighters) if (f.iso2) m.set(f.iso2, f.id);
    return m;
  }, [fighters]);

  const toggle = (c: Country) => {
    const existing = inRoster.get(c.iso2);
    if (existing) {
      removeFighter(existing);
      return;
    }
    if (fighters.length >= MAX_FIGHTERS) {
      toast.error(`The roster is full (${MAX_FIGHTERS} max).`);
      return;
    }
    addFighters([countryFighter(c)]);
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => setUi({ paletteOpen: o })}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="panel fixed top-[12dvh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 overflow-hidden shadow-2xl focus:outline-none"
        >
          <RadixDialog.Title className="sr-only">Add countries</RadixDialog.Title>
          <Command label="Add countries" loop>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={17} className="shrink-0 text-muted" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search 200+ countries"
                className="h-14 flex-1 bg-transparent text-[15px] text-text placeholder:text-muted focus:outline-none"
              />
              <span className="text-xs text-muted tabular">
                {fighters.length}/{MAX_FIGHTERS}
              </span>
            </div>
            {countries.length === 0 && <p className="p-4 text-sm text-muted">Loading countries…</p>}
            <Command.List className="max-h-[min(60dvh,440px)] overflow-y-auto p-2 scrollbar-thin">
              <Command.Empty className="p-6 text-center text-sm text-muted">
                No country matches "{query}".
              </Command.Empty>
              {countries.map((c) => {
                const added = inRoster.has(c.iso2);
                return (
                  <Command.Item
                    key={c.iso2}
                    value={`${c.name} ${c.iso2} ${c.region}`}
                    onSelect={() => toggle(c)}
                    className="flex h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm data-[selected=true]:bg-surface-2"
                  >
                    <FlagDisc src={flagUrl(c.iso2)} size={24} ring={false} />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted">{c.region}</span>
                    <span
                      className={added ? 'text-accent' : 'invisible'}
                      aria-label={added ? 'In roster' : undefined}
                    >
                      <Check size={16} />
                    </span>
                  </Command.Item>
                );
              })}
            </Command.List>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd> add or remove
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>esc</Kbd> close
              </span>
            </div>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
