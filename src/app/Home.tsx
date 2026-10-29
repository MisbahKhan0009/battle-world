import { ArrowUpRight, FolderOpen, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BattlePlayer } from '../components/BattlePlayer';
import { PresetStack } from '../components/PresetsDialog';
import { Button } from '../components/ui/Button';
import { STARTER } from '../data/countries';
import { simulate } from '../engine/sim';
import { tune } from '../engine/tuning';
import { WINNER_HOLD_SEC } from '../engine/timeline';
import { Rng } from '../engine/rng';
import type { Fighter } from '../engine/types';
import { loadSceneFighters } from '../lib/battle';
import { buildScene, type Scene } from '../render/scene';
import { countryFighter, DEFAULT_LOOK, DEFAULT_RULES, useApp } from '../store/app';
import { useUi } from '../store/ui';
import { navigate } from './router';

/** A small, muted, self-looping battle for the hero. Runs on the main thread (it is tiny). */
function useAmbientScene(): [Scene | null, () => void] {
  const [round, setRound] = useState(1);
  const [scene, setScene] = useState<Scene | null>(null);
  useEffect(() => {
    let live = true;
    const rng = new Rng(round * 7919);
    const pool = [...STARTER];
    const picks: Fighter[] = [];
    while (picks.length < 10 && pool.length)
      picks.push(countryFighter(pool.splice(rng.int(pool.length), 1)[0]));
    const { config } = tune({
      fighters: picks.map((f) => ({ id: f.id, hp: 100, size: 1, speed: 1.1, attack: 1 })),
      rules: { ...DEFAULT_RULES, seed: round * 104729, targetDurationSec: 28 },
      intro: true,
      outro: false,
    });
    const result = simulate(config, { record: true, holdSec: WINNER_HOLD_SEC + 1 });
    loadSceneFighters(picks).then((fighters) => {
      if (!live) return;
      setScene(
        buildScene({
          result,
          fighters,
          look: { ...DEFAULT_LOOK, aspect: '9:16', outro: false, showDamageNumbers: false },
        }),
      );
    });
    return () => {
      live = false;
    };
  }, [round]);
  return [scene, () => setRound((r) => r + 1)];
}

function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function Home() {
  const [scene, next] = useAmbientScene();
  const recent = useApp((s) => s.recent);
  const applyPreset = useApp((s) => s.applyPreset);
  const newBattle = useApp((s) => s.newBattle);
  const fighters = useApp((s) => s.fighters);
  const setUi = useUi((s) => s.set);

  return (
    <main className="relative flex min-h-[100dvh] flex-col overflow-hidden">
      {/* Stadium light */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 75% 20%, rgb(198 255 61 / 0.09), transparent 70%), radial-gradient(50% 60% at 10% 100%, rgb(255 77 94 / 0.06), transparent 70%)',
        }}
      />
      <header className="relative z-10 mx-auto flex w-full max-w-[1240px] items-center justify-between px-5 py-5 sm:px-8">
        <span className="flex items-center gap-2.5">
          <Logo />
          <span className="font-display text-2xl leading-none">Flag Clash</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => navigate('studio')}>
          Open studio <ArrowUpRight size={14} />
        </Button>
      </header>

      <section className="relative z-10 mx-auto grid w-full max-w-[1240px] flex-1 items-center gap-10 px-5 pb-12 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-6">
        <div className="animate-[rise-in_500ms_var(--ease-spring)_both]">
          <h1 className="font-display text-[clamp(84px,15vw,208px)] leading-[0.82] tracking-[-0.01em]">
            Flag
            <br />
            Clash
          </h1>
          <p className="mt-6 max-w-[34ch] text-lg leading-relaxed text-muted sm:text-xl">
            Drop up to 64 countries into a circle with one rotating exit. The last flag inside wins. Export it
            as a Shorts-ready MP4 with sound.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              size="lg"
              variant="primary"
              onClick={() => {
                newBattle();
                navigate('studio');
              }}
            >
              <Plus size={18} /> New battle
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setUi({ presetsOpen: true })}>
              <FolderOpen size={17} /> Load preset
            </Button>
            {fighters.length >= 2 && (
              <Button size="lg" variant="ghost" onClick={() => navigate('studio')}>
                Continue editing
              </Button>
            )}
          </div>
          <p className="mt-5 text-[13px] text-muted/80">
            Free. No sign-up. Everything stays in your browser.
          </p>

          {recent.length > 0 && (
            <div className="mt-12 max-w-[560px]">
              <h2 className="mb-3 text-[13px] font-medium text-muted">Recent battles</h2>
              <ul className="space-y-2">
                {recent.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        applyPreset(r);
                        navigate('studio');
                      }}
                      className="flex w-full items-center gap-3 rounded-xl bg-surface/80 p-2.5 text-left ring-1 ring-line transition-colors hover:bg-surface-2"
                    >
                      <PresetStack srcs={r.fighters.map((f) => f.imageSrc)} size={24} />
                      <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                      <span className="shrink-0 text-xs text-muted tabular">
                        {r.look.aspect}, {timeAgo(r.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="relative mx-auto h-[min(78dvh,760px)] w-full max-w-[440px] lg:h-[min(84dvh,800px)]">
          <div className="absolute -inset-6 rounded-[48px] bg-accent/5 blur-3xl" aria-hidden />
          <div className="relative h-full rounded-[36px] bg-[#05060a] p-3 shadow-[0_40px_120px_-30px_rgb(0_0_0/0.9)] ring-1 ring-line-strong">
            <BattlePlayer
              scene={scene}
              variant="ambient"
              autoPlay
              onEnded={next}
              className="h-full overflow-hidden rounded-[26px]"
            />
          </div>
        </div>
      </section>
    </main>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="#1A1E27" />
      <circle cx="25" cy="32" r="14" fill="#C6FF3D" />
      <circle cx="41" cy="32" r="14" fill="none" stroke="#F2F4F8" strokeWidth="5" />
    </svg>
  );
}
