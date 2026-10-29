import { useSyncExternalStore } from 'react';

export type Route =
  | 'home'
  | 'studio'
  | 'preview'
  | 'autopilot'
  | 'calendar'
  | 'dashboard'
  | 'race'
  | 'modules'
  | 'channels'
  | 'settings'
  | 'setup';

const ROUTES: Route[] = [
  'studio',
  'preview',
  'autopilot',
  'dashboard',
  'race',
  'calendar',
  'modules',
  'channels',
  'settings',
  'setup',
];

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  return ROUTES.find((r) => h.startsWith(r)) ?? 'home';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

/** Hash routing keeps deep links working on any static host (GitHub Pages included). */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, parse, () => 'home');
}

export function navigate(route: Route): void {
  const next = route === 'home' ? '#/' : `#/${route}`;
  if (window.location.hash !== next) window.location.hash = next;
}
