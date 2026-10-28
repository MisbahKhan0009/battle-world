import { useSyncExternalStore } from 'react';

export type Route = 'home' | 'studio' | 'preview';

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h.startsWith('studio')) return 'studio';
  if (h.startsWith('preview')) return 'preview';
  return 'home';
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
