import { ArrowUpRight, Check, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { isDesktop } from '../../desktop/bridge';
import { DEFAULT_PACE } from '../../autopilot/types';
import { useAutopilot } from '../../desktop/runtime';
import { cn } from '../../lib/utils';
import { PLANS } from '../../modules/plans';
import { MODULES, type ContentModule } from '../../modules/registry';
import { navigate } from '../router';
import { DesktopLayout } from './Layout';

/** Small abstract artwork per module, drawn with SVG so each card reads at a glance. */
function ModuleArt({ m }: { m: ContentModule }) {
  const c = m.accent;
  return (
    <svg viewBox="0 0 160 90" className="h-full w-full" aria-hidden>
      <rect width="160" height="90" fill="#0E1119" />
      {m.id === 'flag-battle' && (
        <>
          <path
            d="M80 12 a33 33 0 1 1 -23.3 9.7"
            fill="none"
            stroke={c}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="70" cy="48" r="9" fill="#FF4D5E" stroke="#fff" strokeWidth="2" />
          <circle cx="92" cy="40" r="9" fill="#3DDCFF" stroke="#fff" strokeWidth="2" />
          <circle cx="84" cy="62" r="9" fill="#FFB23D" stroke="#fff" strokeWidth="2" />
          <circle cx="55" cy="16" r="7" fill="#C6FF3D" stroke="#fff" strokeWidth="2" opacity="0.7" />
        </>
      )}
      {m.id === 'marble-race' && (
        <>
          <path
            d="M10 20 L70 34 L20 52 L90 68 L150 60"
            fill="none"
            stroke="#2A3040"
            strokeWidth="8"
            strokeLinejoin="round"
          />
          {[30, 52, 74].map((x, i) => (
            <circle
              key={x}
              cx={x}
              cy={26 + i * 8}
              r="6"
              fill={[c, '#FF4D5E', '#C6FF3D'][i]}
              stroke="#fff"
              strokeWidth="1.5"
            />
          ))}
          <rect x="140" y="50" width="4" height="22" fill="#fff" />
        </>
      )}
      {m.id === 'ring-escape' &&
        [34, 26, 18, 10].map((r, i) => (
          <circle
            key={r}
            cx="80"
            cy="45"
            r={r}
            fill="none"
            stroke={c}
            strokeWidth="2.5"
            strokeDasharray={`${r * 5.2} ${r * 1.1}`}
            transform={`rotate(${i * 50} 80 45)`}
            opacity={1 - i * 0.15}
          />
        ))}
      {m.id === 'ring-escape' && <circle cx="80" cy="45" r="4" fill="#fff" />}
      {m.id === 'territory-wars' &&
        Array.from({ length: 8 * 14 }, (_, i) => {
          const x = i % 14;
          const y = Math.floor(i / 14);
          const owner = (x * 7 + y * 13 + ((x * y) % 5)) % 4;
          return (
            <rect
              key={i}
              x={10 + x * 10.2}
              y={6 + y * 10}
              width="9"
              height="9"
              rx="1.5"
              fill={[c, '#3DDCFF', '#FF4D5E', '#C6FF3D'][owner]}
              opacity={0.35 + (owner === 0 ? 0.5 : 0.2)}
            />
          );
        })}
      {m.id === 'black-hole' && (
        <>
          {[
            [30, 22, 10, 6],
            [118, 20, 8, 9],
            [128, 66, 12, 7],
            [22, 64, 9, 10],
            [60, 76, 6, 8],
          ].map(([x, y, w, h], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} rx="1.5" fill="#2A3040" />
          ))}
          <ellipse cx="80" cy="48" rx="26" ry="20" fill="#05060A" stroke={c} strokeWidth="3" />
          <ellipse cx="80" cy="48" rx="17" ry="12" fill="#000" />
          <rect x="74" y="34" width="9" height="9" rx="1.5" fill="#3A4258" transform="rotate(25 78 38)" />
          <ellipse cx="128" cy="40" rx="11" ry="8" fill="#05060A" stroke="#FF4D5E" strokeWidth="2" />
          <ellipse cx="36" cy="44" rx="8" ry="6" fill="#05060A" stroke="#3DDCFF" strokeWidth="2" />
        </>
      )}
      {m.id === 'paper-land' && (
        <>
          <path d="M18 18h44v30h-20v22H18z" fill={c} opacity="0.55" />
          <path d="M96 20h46v46h-30v-16H96z" fill="#FF4D5E" opacity="0.5" />
          <path d="M62 34 h22 v26 h-24" fill="none" stroke={c} strokeWidth="3" strokeDasharray="4 3" />
          <circle cx="60" cy="60" r="5" fill={c} stroke="#fff" strokeWidth="1.5" />
          <path d="M112 50 v18 h-20" fill="none" stroke="#FF4D5E" strokeWidth="3" strokeDasharray="4 3" />
          <circle cx="92" cy="68" r="5" fill="#FF4D5E" stroke="#fff" strokeWidth="1.5" />
        </>
      )}
      {m.id === 'growing-ball' && (
        <>
          <circle cx="80" cy="45" r="38" fill="none" stroke="#2A3040" strokeWidth="3" />
          <circle cx="68" cy="52" r="20" fill={c} stroke="#fff" strokeWidth="2" />
          <circle cx="98" cy="30" r="8" fill="#3DDCFF" stroke="#fff" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

export function ModulesPage() {
  const { ap, state } = useAutopilot();
  const desktop = isDesktop();
  return (
    <DesktopLayout title="Modules">
      <p className="mb-6 max-w-[64ch] text-sm text-muted">
        Each module is a game that renders complete videos on its own. Every channel posts its own games (two
        per channel works best); pick which channels a game posts on here or on the Channels page.
      </p>
      <div className="grid max-w-[1200px] items-start gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((m) => {
          const ready = m.status === 'ready';
          const onChannels = state?.channels.filter((c) => m.id in (c.games ?? {})) ?? [];
          return (
            <article key={m.id} className={cn('panel flex flex-col overflow-hidden', !ready && 'opacity-80')}>
              <div className="relative aspect-[16/9]">
                <ModuleArt m={m} />
                {!ready && (
                  <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-text backdrop-blur">
                    Coming next
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h2
                  className="font-display text-3xl leading-none"
                  style={{ color: ready ? m.accent : undefined }}
                >
                  {m.name}
                </h2>
                <p className="mt-1 text-sm text-text">{m.tagline}</p>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted">{m.description}</p>
                <p className="mt-3 text-xs text-muted">
                  {m.formats.map((f) => (f === 'short' ? 'Shorts' : 'Long videos')).join(' and ')}
                </p>
                {!ready && PLANS[m.id] && (
                  <details className="group mt-4 border-t border-line pt-4 text-[13px]">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-text">
                      <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
                      See the plan
                    </summary>
                    <div className="mt-3 space-y-3 text-muted">
                      <p className="text-text">{PLANS[m.id].pitch}</p>
                      {(
                        [
                          ['How it plays', PLANS[m.id].howItPlays],
                          ['Simulation', PLANS[m.id].simulation],
                          ['Videos', PLANS[m.id].video],
                          ['Build steps', PLANS[m.id].steps],
                        ] as const
                      ).map(([title, items]) => (
                        <div key={title}>
                          <div className="mb-1 text-xs font-medium tracking-wide text-text uppercase">
                            {title}
                          </div>
                          <ul className="list-disc space-y-1 pl-4 leading-relaxed">
                            {items.map((it) => (
                              <li key={it}>{it}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {ready && (
                  <div className="mt-4 space-y-3 border-t border-line pt-4">
                    {desktop && ap && state && state.channels.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[13px] font-medium">Posts on</div>
                        <div className="flex flex-wrap gap-1.5">
                          {state.channels.map((c) => {
                            const on = m.id in (c.games ?? {});
                            return (
                              <button
                                key={c.id}
                                type="button"
                                aria-pressed={on}
                                onClick={() => {
                                  const games = { ...(c.games ?? {}) };
                                  if (on) delete games[m.id];
                                  else
                                    games[m.id] = {
                                      ...(DEFAULT_PACE[m.id] ?? { shortsPerDay: 2, videosPerWeek: 2 }),
                                    };
                                  void ap.update(
                                    {
                                      channels: state.channels.map((x) =>
                                        x.id === c.id ? { ...c, games } : x,
                                      ),
                                    },
                                    { replan: true },
                                  );
                                }}
                                className={cn(
                                  'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs ring-1 transition-colors',
                                  on ? 'bg-surface-3 text-text' : 'text-muted ring-line hover:text-text',
                                )}
                                style={on ? { boxShadow: `inset 0 0 0 1.5px ${m.accent}` } : undefined}
                              >
                                {on && <Check size={12} />}
                                {c.title}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-muted">
                          {onChannels.length
                            ? onChannels
                                .map(
                                  (c) =>
                                    `${c.title}: ${c.games[m.id].shortsPerDay} Shorts a day, ${c.games[m.id].videosPerWeek} long videos a week`,
                                )
                                .join('. ') + '. Change the pace on the Autopilot page.'
                            : 'Not on any channel yet. Pick a channel above.'}
                        </p>
                      </div>
                    )}
                    {m.studioRoute && (
                      <Button variant="secondary" onClick={() => navigate(m.studioRoute!)}>
                        Open studio <ArrowUpRight size={14} />
                      </Button>
                    )}
                    {m.previewRoute && (
                      <Button variant="secondary" onClick={() => navigate(m.previewRoute!)}>
                        Watch a sample race <ArrowUpRight size={14} />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </DesktopLayout>
  );
}
