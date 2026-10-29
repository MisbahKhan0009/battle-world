import * as RadixTooltip from '@radix-ui/react-tooltip';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { PresetsDialog } from '../components/PresetsDialog';
import { webCodecsAvailable } from '../export/exporter';
import { isDesktop } from '../desktop/bridge';
import { useBattleRunner } from '../hooks/useBattleRunner';
import { useApp } from '../store/app';
import { useUi } from '../store/ui';
import { Home } from './Home';
import { useRoute } from './router';

const Studio = lazy(() => import('./Studio').then((m) => ({ default: m.Studio })));
const Preview = lazy(() => import('./Preview').then((m) => ({ default: m.Preview })));
const AutopilotPage = lazy(() =>
  import('./desktop/AutopilotPage').then((m) => ({ default: m.AutopilotPage })),
);
const ModulesPage = lazy(() => import('./desktop/ModulesPage').then((m) => ({ default: m.ModulesPage })));
const ChannelsPage = lazy(() => import('./desktop/ChannelsPage').then((m) => ({ default: m.ChannelsPage })));
const SettingsPage = lazy(() => import('./desktop/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ExportDialog = lazy(() =>
  import('../components/ExportDialog').then((m) => ({ default: m.ExportDialog })),
);

function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => setReady(true), 2000);
    Promise.all([
      document.fonts.load('400 40px "Bebas Neue"'),
      document.fonts.load('600 20px "Geist Variable"'),
    ])
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout);
        setReady(true);
      });
    return () => clearTimeout(timeout);
  }, []);
  return ready;
}

function BrowserBanner() {
  const [hidden, setHidden] = useState(false);
  if (hidden || webCodecsAvailable()) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 bg-hp-mid/15 px-4 py-2 text-center text-[13px] text-hp-mid"
    >
      <span>
        This browser cannot encode MP4 here, so export falls back to real-time WebM recording. For MP4, use
        the latest Chrome or Edge on desktop.
      </span>
      <button
        type="button"
        className="rounded px-1.5 underline underline-offset-2"
        onClick={() => setHidden(true)}
      >
        Dismiss
      </button>
    </div>
  );
}

function GlobalShortcuts() {
  const fighters = useApp((s) => s.fighters.length);
  const route = useRoute();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (route === 'studio') useUi.getState().set({ paletteOpen: true });
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      if ((e.key === 'e' || e.key === 'E') && route !== 'home' && fighters >= 2) {
        e.preventDefault();
        useUi.getState().set({ exportOpen: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, fighters]);
  return null;
}

export function App() {
  useBattleRunner();
  const raw = useRoute();
  // The desktop app opens on the autopilot dashboard instead of the web landing page.
  const route = raw === 'home' && isDesktop() ? 'autopilot' : raw;

  useEffect(() => {
    if (isDesktop()) void import('../desktop/runtime').then((m) => m.startAutopilot());
  }, []);
  const fontsReady = useFontsReady();
  const exportOpen = useUi((s) => s.exportOpen);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  return (
    <RadixTooltip.Provider>
      <div className="flex min-h-full flex-col">
        <BrowserBanner />
        {fontsReady && (
          <Suspense fallback={<div className="flex-1" />}>
            {route === 'home' && <Home />}
            {route === 'studio' && <Studio />}
            {route === 'preview' && <Preview />}
            {route === 'autopilot' && <AutopilotPage />}
            {route === 'modules' && <ModulesPage />}
            {route === 'channels' && <ChannelsPage />}
            {route === 'settings' && <SettingsPage />}
          </Suspense>
        )}
      </div>
      <PresetsDialog />
      {exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog />
        </Suspense>
      )}
      <GlobalShortcuts />
      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          style: {
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-line-strong)',
            color: 'var(--color-text)',
            fontFamily: 'var(--font-sans)',
          },
        }}
      />
    </RadixTooltip.Provider>
  );
}
