import { ArrowLeft, Dices, Download, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { BattlePlayer, type FrameInfo } from '../components/BattlePlayer';
import { FlagDisc } from '../components/FlagDisc';
import { Button } from '../components/ui/Button';
import { Kbd } from '../components/ui/controls';
import { formatTime } from '../lib/utils';
import { useApp } from '../store/app';
import { useBattle } from '../store/battle';
import { useUi } from '../store/ui';
import { BattleStatus } from './Studio';
import { navigate } from './router';

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2/60 p-4 ring-1 ring-line">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-display text-4xl leading-none tabular">{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Preview() {
  const scene = useBattle((s) => s.scene);
  const status = useBattle((s) => s.status);
  const fighters = useApp((s) => s.fighters);
  const seed = useApp((s) => s.rules.seed);
  const seedLocked = useApp((s) => s.seedLocked);
  const rerollSeed = useApp((s) => s.rerollSeed);
  const spoiler = useApp((s) => s.ui.spoiler);
  const setUi = useApp((s) => s.setUi);
  const openUi = useUi((s) => s.set);
  const [info, setInfo] = useState<FrameInfo | null>(null);

  if (fighters.length < 2) {
    return (
      <main className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <p className="text-lg">Add at least 2 countries to start.</p>
          <Button className="mt-4" variant="primary" onClick={() => navigate('studio')}>
            Go to the studio
          </Button>
        </div>
      </main>
    );
  }

  const finished = info ? info.phase === 'winner' || info.phase === 'outro' : false;
  const winner = scene ? scene.fighters[scene.result.winnerIndex] : null;
  const winnerFighter = winner ? fighters.find((f) => f.id === winner.id) : null;
  const reveal = finished || spoiler;

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-3 sm:px-5">
        <Button size="sm" variant="ghost" onClick={() => navigate('studio')}>
          <ArrowLeft size={15} /> Studio
        </Button>
        <h1 className="text-sm font-medium">Preview</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={rerollSeed}
            disabled={seedLocked}
            title={seedLocked ? 'The seed is locked in Rules' : undefined}
          >
            <Dices size={14} /> Re-roll seed
          </Button>
          <Button size="sm" variant="primary" onClick={() => openUi({ exportOpen: true })} disabled={!scene}>
            <Download size={14} /> Export
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] lg:grid-cols-[1fr_300px] lg:grid-rows-1">
        <section aria-label="Battle" className="flex min-h-0 flex-col p-3 sm:p-5">
          <BattlePlayer
            scene={scene}
            variant="full"
            busy={status === 'tuning'}
            hotkeys
            className="min-h-0 flex-1"
            onFrame={setInfo}
          />
        </section>

        <aside className="space-y-3 overflow-y-auto border-t border-line p-4 scrollbar-thin lg:border-t-0 lg:border-l">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <Stat
              label="Alive"
              value={info ? info.alive : fighters.length}
              sub={`of ${fighters.length} flags`}
            />
            <Stat
              label="Elapsed"
              value={formatTime(info?.v ?? 0)}
              sub={scene ? `Video length ${formatTime(scene.timeline.total)}` : 'Tuning…'}
            />
          </div>

          <div className="rounded-xl bg-surface-2/60 p-4 ring-1 ring-line">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Winner</span>
              {!finished && (
                <button
                  type="button"
                  onClick={() => setUi({ spoiler: !spoiler })}
                  aria-pressed={spoiler}
                  className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted hover:text-text"
                >
                  {spoiler ? <EyeOff size={13} /> : <Eye size={13} />} {spoiler ? 'Hide' : 'Spoiler'}
                </button>
              )}
            </div>
            {reveal && winner && winnerFighter ? (
              <div className="mt-3 flex items-center gap-3">
                <FlagDisc src={winnerFighter.imageSrc} size={44} />
                <div className="min-w-0">
                  <div className="truncate font-display text-3xl leading-none">{winner.name}</div>
                  <div className="mt-1 text-xs text-muted tabular">
                    {scene!.result.kills[scene!.result.winnerIndex]} eliminations
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">Revealed when the battle ends.</p>
            )}
          </div>

          <div className="rounded-xl bg-surface-2/60 p-4 text-xs text-muted ring-1 ring-line">
            <div className="flex items-center justify-between">
              <span>Seed</span>
              <span className="text-text tabular">{seed}</span>
            </div>
            <BattleStatus className="mt-3" />
          </div>

          <div className="hidden space-y-2 rounded-xl p-1 text-xs text-muted lg:block">
            <p className="flex items-center gap-2">
              <Kbd>Space</Kbd> play or pause
            </p>
            <p className="flex items-center gap-2">
              <Kbd>R</Kbd> restart
            </p>
            <p className="flex items-center gap-2">
              <Kbd>←</Kbd>
              <Kbd>→</Kbd> skip 2 seconds
            </p>
            <p className="flex items-center gap-2">
              <Kbd>E</Kbd> export
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
