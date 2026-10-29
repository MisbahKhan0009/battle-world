import { ArrowUpRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/controls';
import { isDesktop } from '../../desktop/bridge';
import { useAutopilot } from '../../desktop/runtime';
import { cn } from '../../lib/utils';
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
        Each module is a game that renders complete videos on its own. The autopilot picks from the modules
        you switch on, so your channel gets variety without any work.
      </p>
      <div className="grid max-w-[1200px] gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((m) => {
          const ready = m.status === 'ready';
          const enabled = !!state?.modules[m.id];
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
                {ready && (
                  <div className="mt-4 space-y-3 border-t border-line pt-4">
                    {desktop && ap && state && (
                      <Toggle
                        label="Use in autopilot"
                        checked={enabled}
                        onChange={(on) =>
                          void ap.update({ modules: { ...state.modules, [m.id]: on } }, { replan: true })
                        }
                      />
                    )}
                    {m.studioRoute && (
                      <Button variant="secondary" onClick={() => navigate(m.studioRoute!)}>
                        Open studio <ArrowUpRight size={14} />
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
