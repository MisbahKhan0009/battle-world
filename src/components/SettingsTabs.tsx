import { Circle, Dices, Lock, LockOpen, Square, SquareDashed } from 'lucide-react';
import { THEMES } from '../render/themes';
import type { Look, Rules } from '../engine/types';
import { cn } from '../lib/utils';
import { useApp } from '../store/app';
import { Button } from './ui/Button';
import { Field, Segmented, Slider, Tip, Toggle, inputClass } from './ui/controls';

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[13px] font-medium">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const DURATIONS: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '30', label: '30s' },
  { value: '45', label: '45s' },
  { value: '58', label: '58s' },
  { value: '120', label: '2m' },
  { value: '300', label: '5m' },
];

export function RulesTab() {
  const rules = useApp((s) => s.rules);
  const setRules = useApp((s) => s.setRules);
  const setShrink = useApp((s) => s.setShrink);
  const setGap = (patch: Partial<Rules['gap']>) => setRules({ gap: { ...rules.gap, ...patch } });
  const seedLocked = useApp((s) => s.seedLocked);
  const setSeedLocked = useApp((s) => s.setSeedLocked);
  const rerollSeed = useApp((s) => s.rerollSeed);

  return (
    <div className="space-y-7">
      <Section title="Mode">
        <Segmented<Rules['mode']>
          label="Game mode"
          value={rules.mode}
          onChange={(mode) => setRules({ mode })}
          options={[
            { value: 'escape', label: 'Escape the circle' },
            { value: 'royale', label: 'Battle royale' },
          ]}
        />
        <p className="text-xs text-muted">
          {rules.mode === 'escape'
            ? 'Flags bounce inside a fixed circle. Anyone who slips out through the rotating opening is out. The last flag inside wins.'
            : 'Flags lose HP when they collide. The last flag standing wins.'}
        </p>
      </Section>

      {rules.mode === 'escape' ? (
        <Section title="Opening" note="The circle stays fixed. Only the opening moves around the rim.">
          <Slider
            label="Opening size"
            value={rules.gap.size}
            min={1.3}
            max={4}
            step={0.1}
            onChange={(size) => setGap({ size })}
            format={(v) => `${v.toFixed(1)}× flag width`}
          />
          <Slider
            label="Rotation speed"
            value={rules.gap.speedDeg}
            min={0}
            max={180}
            step={5}
            onChange={(speedDeg) => setGap({ speedDeg })}
            format={(v) => (v === 0 ? 'Still' : `${v}° per second`)}
          />
          <Segmented<Rules['gap']['direction']>
            label="Rotation direction"
            value={rules.gap.direction}
            onChange={(direction) => setGap({ direction })}
            options={[
              { value: 'cw', label: 'Clockwise' },
              { value: 'ccw', label: 'Counterclockwise' },
            ]}
          />
          {rules.targetDurationSec !== 'auto' && (
            <p className="text-xs text-muted">
              To land on the target length the flags may speed up, and the opening may widen a little if that
              is not enough.
            </p>
          )}
        </Section>
      ) : (
        <>
          <Section title="Arena">
            <Segmented<Rules['arena']>
              label="Arena shape"
              value={rules.arena}
              onChange={(arena) => setRules({ arena })}
              options={[
                {
                  value: 'circle',
                  label: (
                    <>
                      <Circle size={14} /> Circle
                    </>
                  ),
                },
                {
                  value: 'square',
                  label: (
                    <>
                      <Square size={14} /> Square
                    </>
                  ),
                },
                {
                  value: 'rounded',
                  label: (
                    <>
                      <SquareDashed size={14} /> Rounded
                    </>
                  ),
                },
              ]}
            />
            <Toggle
              label="Shrinking arena"
              description="The wall closes in so the battle cannot stall."
              checked={rules.shrink.enabled}
              onChange={(enabled) => setShrink({ enabled })}
            />
            {rules.shrink.enabled && (
              <div className="space-y-5 rounded-xl bg-surface-2/50 p-4 ring-1 ring-line">
                <Slider
                  label="Starts at"
                  value={rules.shrink.startSec}
                  min={0}
                  max={60}
                  onChange={(startSec) => setShrink({ startSec })}
                  format={(v) => `${v}s`}
                />
                <Slider
                  label="Shrink speed"
                  value={rules.shrink.rate}
                  min={0.002}
                  max={0.03}
                  step={0.001}
                  onChange={(rate) => setShrink({ rate })}
                  format={(v) => `${(v * 100).toFixed(1)}% per second`}
                />
              </div>
            )}
          </Section>

          <Section title="Damage">
            <Segmented<Rules['damageModel']>
              label="Damage model"
              value={rules.damageModel}
              onChange={(damageModel) => setRules({ damageModel })}
              options={[
                { value: 'impact', label: 'By impact speed' },
                { value: 'fixed', label: 'Fixed per hit' },
              ]}
            />
            <Slider
              label="Damage ramp"
              value={rules.damageRamp}
              min={0}
              max={0.1}
              step={0.005}
              onChange={(damageRamp) => setRules({ damageRamp })}
              format={(v) => (v === 0 ? 'Off' : `+${(v * 100).toFixed(1)}% per second`)}
            />
          </Section>
        </>
      )}

      <Section
        title="Target length"
        note="The battle is auto-tuned to land close to this length, intro and outro included."
      >
        <Segmented
          label="Target duration"
          value={String(rules.targetDurationSec)}
          onChange={(v) => setRules({ targetDurationSec: v === 'auto' ? 'auto' : Number(v) })}
          options={DURATIONS.map((d) => ({
            value: d.value,
            label: d.label,
            title: d.value === '58' ? 'Fits YouTube Shorts' : undefined,
          }))}
        />
      </Section>

      <Section title="Seed" note="The same seed and roster always replay the same battle.">
        <div className="flex gap-2">
          <label htmlFor="seed" className="sr-only">
            Seed
          </label>
          <input
            id="seed"
            type="number"
            inputMode="numeric"
            min={1}
            max={999999}
            value={rules.seed}
            disabled={seedLocked}
            onChange={(e) => {
              const v = Math.floor(Number(e.target.value));
              if (Number.isFinite(v) && v >= 0) setRules({ seed: Math.min(999999, v) });
            }}
            className={cn(inputClass, 'tabular disabled:opacity-60')}
          />
          <Tip content="New random seed">
            <Button size="icon" onClick={rerollSeed} disabled={seedLocked} aria-label="Re-roll seed">
              <Dices size={17} />
            </Button>
          </Tip>
          <Tip content={seedLocked ? 'Unlock seed' : 'Lock seed'}>
            <Button
              size="icon"
              variant={seedLocked ? 'primary' : 'secondary'}
              onClick={() => setSeedLocked(!seedLocked)}
              aria-pressed={seedLocked}
              aria-label={seedLocked ? 'Unlock seed' : 'Lock seed'}
            >
              {seedLocked ? <Lock size={16} /> : <LockOpen size={16} />}
            </Button>
          </Tip>
        </div>
      </Section>
    </div>
  );
}

/** The Studio makes Flag Battles, so it offers Flag Battle's themes (the other games have their own). */
const THEME_LABELS: Partial<Record<Look['theme'], string>> = {
  night: 'Night Arena',
  neon: 'Neon',
  paper: 'Paper',
  space: 'Space',
};

export function LookTab() {
  const look = useApp((s) => s.look);
  const setLook = useApp((s) => s.setLook);

  return (
    <div className="space-y-7">
      <Section title="Format">
        <Segmented<Look['aspect']>
          label="Aspect ratio"
          value={look.aspect}
          onChange={(aspect) => setLook({ aspect })}
          options={[
            { value: '9:16', label: 'Shorts 9:16' },
            { value: '16:9', label: 'Video 16:9' },
            { value: '1:1', label: 'Square 1:1' },
          ]}
        />
      </Section>

      <Section title="Arena theme">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Arena theme">
          {(Object.keys(THEME_LABELS) as Look['theme'][]).map((key) => {
            const t = THEMES[key];
            const active = look.theme === key;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setLook({ theme: key })}
                className={cn(
                  'group relative h-16 overflow-hidden rounded-xl text-left ring-1 transition-shadow',
                  active ? 'ring-2 ring-accent' : 'ring-line-strong hover:ring-white/30',
                )}
                style={{ background: `radial-gradient(120% 120% at 50% 0%, ${t.bgInner}, ${t.bgOuter})` }}
              >
                <span
                  className="absolute top-1/2 right-3 h-8 w-8 -translate-y-1/2 rounded-full border-[3px]"
                  style={{ borderColor: t.border, background: t.floorInner }}
                />
                <span className="absolute bottom-2 left-3 text-[13px] font-medium" style={{ color: t.text }}>
                  {THEME_LABELS[key]}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Title">
        <Field label="Title" htmlFor="look-title">
          <input
            id="look-title"
            value={look.title}
            maxLength={60}
            onChange={(e) => setLook({ title: e.target.value })}
            className={inputClass}
            placeholder="Which country wins?"
          />
        </Field>
        <Field label="Subtitle" htmlFor="look-subtitle">
          <input
            id="look-subtitle"
            value={look.subtitle}
            maxLength={80}
            onChange={(e) => setLook({ subtitle: e.target.value })}
            className={inputClass}
            placeholder="Comment your country"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Segmented<Look['titleFont']>
            label="Title font"
            value={look.titleFont}
            onChange={(titleFont) => setLook({ titleFont })}
            options={[
              {
                value: 'display',
                label: <span className="font-display text-base leading-none">Display</span>,
              },
              { value: 'sans', label: <span className="font-bold">Sans</span> },
            ]}
          />
          <Segmented<Look['titleSize']>
            label="Title size"
            value={look.titleSize}
            onChange={(titleSize) => setLook({ titleSize })}
            options={[
              { value: 'S', label: 'S' },
              { value: 'M', label: 'M' },
              { value: 'L', label: 'L' },
            ]}
          />
        </div>
        <Segmented<Look['titlePosition']>
          label="Title position"
          value={look.titlePosition}
          onChange={(titlePosition) => setLook({ titlePosition })}
          options={[
            { value: 'safe', label: 'Below YouTube UI' },
            { value: 'edge', label: 'Top edge' },
          ]}
        />
      </Section>

      <Section title="On screen">
        <div className="space-y-1.5">
          <Toggle
            label="HP numbers"
            checked={look.showHpNumbers}
            onChange={(showHpNumbers) => setLook({ showHpNumbers })}
          />
          <Toggle
            label="Kill feed"
            checked={look.showKillFeed}
            onChange={(showKillFeed) => setLook({ showKillFeed })}
          />
          <Toggle
            label="Alive counter"
            checked={look.showCounter}
            onChange={(showCounter) => setLook({ showCounter })}
          />
          <Toggle
            label="Damage numbers"
            checked={look.showDamageNumbers}
            onChange={(showDamageNumbers) => setLook({ showDamageNumbers })}
          />
          <Toggle
            label="Particles"
            checked={look.particles}
            onChange={(particles) => setLook({ particles })}
          />
          <Toggle
            label="Screen shake"
            checked={look.screenShake}
            onChange={(screenShake) => setLook({ screenShake })}
          />
        </div>
      </Section>

      <Section title="Intro and outro">
        <Toggle
          label="Intro card"
          description="2 seconds: every flag, then FIGHT."
          checked={look.intro}
          onChange={(intro) => setLook({ intro })}
        />
        <Toggle
          label="Outro card"
          description="3 seconds: the winner and your call to action."
          checked={look.outro}
          onChange={(outro) => setLook({ outro })}
        />
        {look.outro && (
          <Field label="Call to action" htmlFor="look-cta">
            <input
              id="look-cta"
              value={look.outroCta}
              maxLength={90}
              onChange={(e) => setLook({ outroCta: e.target.value })}
              className={inputClass}
            />
          </Field>
        )}
      </Section>
    </div>
  );
}
