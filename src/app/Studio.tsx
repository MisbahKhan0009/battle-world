import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, Download, FolderOpen, Play, Save, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { BattlePlayer } from '../components/BattlePlayer';
import { CountryPalette } from '../components/CountryPalette';
import { RosterTab } from '../components/RosterTab';
import { LookTab, RulesTab } from '../components/SettingsTabs';
import { Button } from '../components/ui/Button';
import { Kbd, Tip } from '../components/ui/controls';
import { cn, formatTime } from '../lib/utils';
import { useApp } from '../store/app';
import { useBattle } from '../store/battle';
import { useUi } from '../store/ui';
import { Logo } from './Home';
import { navigate } from './router';

export function BattleStatus({ className }: { className?: string }) {
  const scene = useBattle((s) => s.scene);
  const status = useBattle((s) => s.status);
  const error = useBattle((s) => s.error);
  const aspect = useApp((s) => s.look.aspect);
  const setRules = useApp((s) => s.setRules);
  const count = useApp((s) => s.fighters.length);
  const total = scene?.timeline.total ?? 0;
  const tooLong = aspect === '9:16' && total > 60 && status !== 'tuning';

  if (count < 2)
    return <p className={cn('text-[13px] text-muted', className)}>Add at least 2 countries to start.</p>;
  if (status === 'error')
    return <p className={cn('text-[13px] text-danger', className)}>Simulation failed: {error}</p>;
  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted', className)}
      aria-live="polite"
    >
      <span className="tabular">
        {status === 'tuning'
          ? 'Tuning battle…'
          : scene
            ? `${formatTime(total)} video, ${scene.fighters.length} flags, seed ${scene.seed}`
            : 'Preparing…'}
      </span>
      {tooLong && (
        <span className="flex items-center gap-2 rounded-lg bg-hp-mid/12 px-2.5 py-1 text-hp-mid">
          <TriangleAlert size={14} /> Over 60s, too long for a Short.
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => setRules({ targetDurationSec: 58 })}
          >
            Auto-fit to 58s
          </button>
        </span>
      )}
    </div>
  );
}

export function Studio() {
  const [tab, setTab] = useState('roster');
  const scene = useBattle((s) => s.scene);
  const status = useBattle((s) => s.status);
  const count = useApp((s) => s.fighters.length);
  const savePreset = useApp((s) => s.savePreset);
  const pushRecent = useApp((s) => s.pushRecent);
  const setUi = useUi((s) => s.set);
  const canRun = count >= 2;

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3 sm:px-5">
        <button
          type="button"
          onClick={() => navigate('home')}
          className="flex items-center gap-2.5 rounded-lg pr-2"
          aria-label="Back to home"
        >
          <ArrowLeft size={16} className="text-muted" />
          <Logo size={24} />
          <span className="hidden font-display text-xl leading-none sm:inline">Flag Clash</span>
        </button>
        <span className="text-muted/50">/</span>
        <h1 className="text-sm font-medium">Studio</h1>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setUi({ presetsOpen: true })}>
            <FolderOpen size={14} /> Presets
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        <Tabs.Root
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col border-line bg-surface/60 lg:w-[400px] lg:flex-none lg:border-r xl:w-[440px]"
        >
          <Tabs.List
            aria-label="Battle settings"
            className="flex shrink-0 gap-1 border-b border-line px-3 pt-2"
          >
            {[
              ['roster', 'Roster'],
              ['rules', 'Rules'],
              ['look', 'Look'],
            ].map(([v, label]) => (
              <Tabs.Trigger
                key={v}
                value={v}
                className="relative h-10 px-3 text-sm text-muted transition-colors hover:text-text data-[state=active]:text-text data-[state=active]:after:absolute data-[state=active]:after:inset-x-3 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-accent"
              >
                {label}
                {v === 'roster' && <span className="ml-1.5 text-xs text-muted tabular">{count}</span>}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 scrollbar-thin sm:px-5">
            <Tabs.Content value="roster" className="focus:outline-none">
              <RosterTab />
            </Tabs.Content>
            <Tabs.Content value="rules" className="focus:outline-none">
              <RulesTab />
            </Tabs.Content>
            <Tabs.Content value="look" className="focus:outline-none">
              <LookTab />
            </Tabs.Content>
          </div>
        </Tabs.Root>

        <section
          aria-label="Live preview"
          className="flex h-[52dvh] shrink-0 flex-col p-3 sm:p-5 lg:h-auto lg:min-h-0 lg:flex-1"
        >
          <BattlePlayer
            scene={canRun ? scene : null}
            variant="compact"
            busy={status === 'tuning'}
            hotkeys
            className="min-h-0 flex-1"
          />
        </section>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-surface/80 px-3 py-3 sm:px-5">
        <BattleStatus className="mr-auto min-w-0" />
        <Tip content="Save the current setup">
          <Button
            variant="ghost"
            onClick={() => {
              const p = savePreset(`Battle of ${count}`);
              toast.success(`Saved preset "${p.name}"`, {
                action: { label: 'Rename', onClick: () => setUi({ presetsOpen: true }) },
              });
            }}
            disabled={!canRun}
          >
            <Save size={15} /> <span className="hidden sm:inline">Save preset</span>
          </Button>
        </Tip>
        <Button
          variant="secondary"
          onClick={() => {
            pushRecent();
            navigate('preview');
          }}
          disabled={!canRun}
        >
          <Play size={15} /> Preview
        </Button>
        <Tip
          content={
            <span className="flex items-center gap-1.5">
              Export video <Kbd>E</Kbd>
            </span>
          }
        >
          <Button variant="primary" onClick={() => setUi({ exportOpen: true })} disabled={!canRun || !scene}>
            <Download size={15} /> Export
          </Button>
        </Tip>
      </footer>
      <CountryPalette />
    </div>
  );
}
