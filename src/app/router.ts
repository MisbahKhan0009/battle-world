import { useSyncExternalStore } from 'react';

export type Route =
  | 'home'
  | 'studio'
  | 'preview'
  | 'autopilot'
  | 'calendar'
  | 'dashboard'
  | 'race'
  | 'rings'
  | 'grow'
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
  'rings',
  'grow',
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

/** The part after the screen name in the hash (`#/autopilot/UC123` gives `UC123`). */
export function routeParam(): string | undefined {
  const part = window.location.hash.replace(/^#\/?/, '').split('/')[1];
  return part ? decodeURIComponent(part) : undefined;
}

/** Hash routing keeps deep links working on any static host (GitHub Pages included). */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, parse, () => 'home');
}

/** Goes to a screen; `sub` picks something on it (like a channel on the Autopilot page). */
export function navigate(route: Route, sub?: string): void {
  const next = route === 'home' ? '#/' : `#/${route}${sub ? `/${encodeURIComponent(sub)}` : ''}`;
  if (window.location.hash !== next) window.location.hash = next;
}
