import { BarChart3, Bot, CalendarDays, Cog, LayoutGrid, MonitorDown, Youtube } from 'lucide-react';
import type { ReactNode } from 'react';
import { isDesktop } from '../../desktop/bridge';
import { statusText, useAutopilot } from '../../desktop/runtime';
import { cn } from '../../lib/utils';
import { Logo } from '../Home';
import { navigate, useRoute, type Route } from '../router';

export const REPO_URL = 'https://github.com/MisbahKhan0009/battle-world';

const NAV: { route: Route; label: string; icon: typeof Bot }[] = [
  { route: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { route: 'autopilot', label: 'Autopilot', icon: Bot },
  { route: 'calendar', label: 'Calendar', icon: CalendarDays },
  { route: 'modules', label: 'Modules', icon: LayoutGrid },
  { route: 'channels', label: 'Channels', icon: Youtube },
  { route: 'settings', label: 'Settings', icon: Cog },
];

function AutopilotBadge() {
  const { state, activity } = useAutopilot();
  if (!state) return null;
  const running = state.running;
  return (
    <div className="rounded-xl bg-surface-2/70 p-3 ring-1 ring-line">
      <div className="flex items-center gap-2 text-[13px]">
        <span className={cn('h-2 w-2 rounded-full', running ? 'animate-pulse bg-accent' : 'bg-muted/60')} />
        {running ? 'Autopilot on' : 'Autopilot paused'}
      </div>
      <p className="mt-1 text-xs text-muted first-letter:uppercase">{statusText(state, activity)}</p>
    </div>
  );
}

export function DesktopLayout({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const route = useRoute();
  const desktop = isDesktop();
  return (
    <div className="flex h-[100dvh] min-h-0">
      <nav
        aria-label="Main"
        className="hidden w-[232px] shrink-0 flex-col border-r border-line bg-surface/60 p-3 md:flex"
      >
        <button
          type="button"
          onClick={() => navigate(desktop ? 'autopilot' : 'home')}
          className="mb-5 flex items-center gap-2.5 rounded-lg px-2 py-2"
        >
          <Logo size={26} />
          <span className="font-display text-2xl leading-none">Flag Clash</span>
        </button>
        <ul className="space-y-0.5">
          {NAV.map(({ route: r, label, icon: Icon }) => {
            const active =
              route === r ||
              (r === 'autopilot' && route === 'home' && desktop) ||
              (r === 'modules' && (route === 'race' || route === 'rings' || route === 'grow'));
            return (
              <li key={r}>
                <button
                  type="button"
                  onClick={() => navigate(r)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors',
                    active ? 'bg-surface-3 text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
                  )}
                >
                  <Icon size={17} className={active ? 'text-accent' : undefined} />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto">
          {desktop ? (
            <AutopilotBadge />
          ) : (
            <a
              href={`${REPO_URL}#desktop-app`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-xl bg-surface-2/70 p-3 text-[13px] text-muted ring-1 ring-line hover:text-text"
            >
              <MonitorDown size={16} /> Get the desktop app
            </a>
          )}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5 sm:px-8">
          <h1 className="font-display text-3xl leading-none">{title}</h1>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
        {/* Compact nav on narrow windows. */}
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 md:hidden">
          {NAV.map(({ route: r, label }) => (
            <button
              key={r}
              type="button"
              onClick={() => navigate(r)}
              className={cn('rounded-lg px-3 py-1.5 text-sm', route === r ? 'bg-surface-3' : 'text-muted')}
            >
              {label}
            </button>
          ))}
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 scrollbar-thin sm:px-8">{children}</main>
      </div>
    </div>
  );
}

export function DesktopOnly({ feature }: { feature: string }) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-line-strong p-8 text-center">
      <MonitorDown className="mx-auto text-accent" size={28} />
      <h2 className="mt-4 text-lg font-medium">{feature} runs in the desktop app</h2>
      <p className="mt-2 text-sm text-muted">
        The Flag Clash desktop app for Windows, macOS and Linux renders videos on your computer and posts them
        to your YouTube channel on a schedule, even while it sits in the tray.
      </p>
      <a
        href={`${REPO_URL}#desktop-app`}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink"
      >
        <MonitorDown size={15} /> How to get it
      </a>
    </div>
  );
}

export function Card({
  title,
  children,
  className,
  note,
}: {
  title?: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('panel p-5', className)}>
      {title && (
        <div className="mb-4">
          <h2 className="text-[15px] font-medium">{title}</h2>
          {note && <p className="mt-1 text-xs text-muted">{note}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
