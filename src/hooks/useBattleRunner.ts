import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimResult } from '../engine/types';
import { loadSceneFighters } from '../lib/battle';
import { loadFlagSafe, WINNER_RASTER } from '../lib/flags';
import { SimClient } from '../lib/simClient';
import { buildScene, type SceneFighter } from '../render/scene';
import { simFighters, useApp } from '../store/app';
import { useBattle } from '../store/battle';

/**
 * Keeps the shared battle (tuned sim + scene) in sync with the setup. Mounted once at the app
 * root. Simulation inputs are debounced and run in a worker; look-only changes rebuild the scene
 * without re-simulating.
 */
export function useBattleRunner(): void {
  const fighters = useApp((s) => s.fighters);
  const rules = useApp((s) => s.rules);
  const balanced = useApp((s) => s.balanced);
  const look = useApp((s) => s.look);
  const client = useRef<SimClient | null>(null);
  const reqSeq = useRef(0);
  const pending = useRef(false);
  const [sim, setSim] = useState<{ result: SimResult; tuneMs: number; error: number } | null>(null);
  const [assets, setAssets] = useState<Map<string, SceneFighter> | null>(null);
  const [winner, setWinner] = useState<{ id: string; image: ImageBitmap } | null>(null);

  const simInput = useMemo(
    () => ({ fighters: simFighters(fighters, balanced), rules, intro: look.intro, outro: look.outro }),
    [fighters, balanced, rules, look.intro, look.outro],
  );
  const simKey = JSON.stringify(simInput);

  useEffect(() => {
    client.current = new SimClient();
    return () => client.current?.dispose();
  }, []);

  // Simulation (debounced).
  useEffect(() => {
    if (simInput.fighters.length < 2) {
      useBattle.setState({ status: 'idle', scene: null, config: null, error: null });
      setSim(null);
      return;
    }
    useBattle.setState({ status: 'tuning' });
    pending.current = true;
    const seq = ++reqSeq.current;
    const timer = setTimeout(() => {
      const c = client.current;
      if (!c) return;
      c.run(simInput)
        .then((res) => {
          if (seq !== reqSeq.current) return; // superseded
          pending.current = false;
          setSim({ result: res.result, tuneMs: res.tuneMs, error: res.error });
        })
        .catch((err: Error) => {
          if (seq !== reqSeq.current) return;
          pending.current = false;
          useBattle.setState({ status: 'error', error: err.message });
        });
    }, 220);
    return () => clearTimeout(timer);
    // simKey captures every input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simKey]);

  // Flag assets.
  const assetKey = JSON.stringify(fighters.map((f) => [f.id, f.name, f.imageSrc, f.accent, f.kind]));
  useEffect(() => {
    let live = true;
    loadSceneFighters(fighters).then((list) => {
      if (live) setAssets(new Map(list.map((f) => [f.id, f])));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetKey]);

  // High-resolution winner flag.
  const winnerId =
    sim && sim.result.winnerIndex >= 0 ? sim.result.config.fighters[sim.result.winnerIndex].id : null;
  const winnerSrc = winnerId ? fighters.find((f) => f.id === winnerId)?.imageSrc : undefined;
  useEffect(() => {
    if (!winnerId || !winnerSrc) return;
    let live = true;
    loadFlagSafe(winnerSrc, WINNER_RASTER).then((a) => live && setWinner({ id: winnerId, image: a.bitmap }));
    return () => {
      live = false;
    };
  }, [winnerId, winnerSrc]);

  // Scene assembly.
  useEffect(() => {
    if (!sim || !assets) return;
    const list = sim.result.config.fighters.map((f) => assets.get(f.id));
    if (list.some((f) => !f)) return; // roster changed; a new sim is on its way
    const sceneFighters = list as SceneFighter[];
    const winnerImage = winner && winner.id === winnerId ? winner.image : null;
    const scene = buildScene({ result: sim.result, look, fighters: sceneFighters, winnerImage });
    useBattle.setState(() => ({
      status: pending.current ? 'tuning' : 'ready',
      error: null,
      scene,
      config: sim.result.config,
      fighters: sceneFighters,
      winnerImage,
      tuneMs: sim.tuneMs,
      tuneError: sim.error,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, assets, look, winner]);
}
