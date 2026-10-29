import * as RadixTooltip from '@radix-ui/react-tooltip';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { webCodecsAvailable } from '../export/exporter';
import { isDesktop } from '../desktop/bridge';
import { useAutopilot } from '../desktop/runtime';
import { useRoute } from './router';

const AutopilotPage = lazy(() =>
  import('./desktop/AutopilotPage').then((m) => ({ default: m.AutopilotPage })),
);
const VideosPage = lazy(() => import('./desktop/VideosPage').then((m) => ({ default: m.VideosPage })));
const PowerCountdown = lazy(() =>
  import('./desktop/PowerCountdown').then((m) => ({ default: m.PowerCountdown })),
);
const CalendarPage = lazy(() => import('./desktop/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const DashboardPage = lazy(() =>
  import('./desktop/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const BattlePage = lazy(() => import('./desktop/PreviewPage').then((m) => ({ default: m.BattlePage })));
const RacePage = lazy(() => import('./desktop/PreviewPage').then((m) => ({ default: m.RacePage })));
const RingsPage = lazy(() => import('./desktop/PreviewPage').then((m) => ({ default: m.RingsPage })));
const GrowPage = lazy(() => import('./desktop/PreviewPage').then((m) => ({ default: m.GrowPage })));
const PaperPage = lazy(() => import('./desktop/PreviewPage').then((m) => ({ default: m.PaperPage })));
const ModulesPage = lazy(() => import('./desktop/ModulesPage').then((m) => ({ default: m.ModulesPage })));
const ChannelsPage = lazy(() => import('./desktop/ChannelsPage').then((m) => ({ default: m.ChannelsPage })));
const SetupWizard = lazy(() => import('./desktop/SetupWizard').then((m) => ({ default: m.SetupWizard })));
const SettingsPage = lazy(() => import('./desktop/SettingsPage').then((m) => ({ default: m.SettingsPage })));

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

export function App() {
  const raw = useRoute();
  const { state: autopilot } = useAutopilot();
  // The desktop app opens on the setup wizard until a channel is connected, then on the dashboard.
  const route =
    raw === 'home'
      ? isDesktop()
        ? autopilot && !autopilot.setupDone && !autopilot.channels.length
          ? 'setup'
          : 'autopilot'
        : 'modules'
      : raw;

  useEffect(() => {
    if (isDesktop()) void import('../desktop/runtime').then((m) => m.startAutopilot());
  }, []);
  const fontsReady = useFontsReady();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  return (
    <RadixTooltip.Provider>
      <div className="flex min-h-full flex-col">
        <BrowserBanner />
        {fontsReady && (
          <Suspense fallback={<div className="flex-1" />}>
            {route === 'autopilot' && <AutopilotPage />}
            {route === 'calendar' && <CalendarPage />}
            {route === 'videos' && <VideosPage />}
            {route === 'battle' && <BattlePage />}
            {route === 'race' && <RacePage />}
            {route === 'rings' && <RingsPage />}
            {route === 'grow' && <GrowPage />}
            {route === 'paper' && <PaperPage />}
            {route === 'dashboard' && <DashboardPage />}
            {route === 'modules' && <ModulesPage />}
            {route === 'channels' && <ChannelsPage />}
            {route === 'settings' && <SettingsPage />}
            {route === 'setup' && <SetupWizard />}
          </Suspense>
        )}
      </div>
      {isDesktop() && (
        <Suspense fallback={null}>
          <PowerCountdown />
        </Suspense>
      )}
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
