export type Region = 'Asia' | 'Europe' | 'Africa' | 'Americas' | 'Oceania';
export type Country = { iso2: string; name: string; region: Region };

let cache: Promise<Country[]> | null = null;

/** Every country in the dataset, lazy-loaded so it stays out of the initial bundle. */
export function loadAllCountries(): Promise<Country[]> {
  cache ??= import('./countries.json').then((m) => m.default as Country[]);
  return cache;
}

/**
 * Flags left out of every video by default: contested or politically charged ones (ISO codes).
 * The list is editable in Settings.
 */
export const DEFAULT_EXCLUDED = ['kp', 'il', 'ps', 'tw', 'xk', 'eh', 'ru', 'ir', 'af', 'sy'];

let excluded = new Set(DEFAULT_EXCLUDED);

/** Sets the countries left out of every video from now on. */
export function setExcludedCountries(codes: string[]): void {
  excluded = new Set(codes.map((c) => c.toLowerCase()));
}

/** The countries videos may use (the dataset without the excluded ones). */
export async function loadCountries(): Promise<Country[]> {
  return (await loadAllCountries()).filter((c) => !excluded.has(c.iso2));
}

export const REGIONS: Region[] = ['Asia', 'Europe', 'Africa', 'Americas', 'Oceania'];

export const GROUPS = {
  g20: [
    'ar',
    'au',
    'br',
    'ca',
    'cn',
    'fr',
    'de',
    'in',
    'id',
    'it',
    'jp',
    'mx',
    'ru',
    'sa',
    'za',
    'kr',
    'tr',
    'gb',
    'us',
  ],
  saarc: ['af', 'bd', 'bt', 'in', 'mv', 'np', 'pk', 'lk'],
  // Most populous countries (UN estimates), largest first.
  population: [
    'in',
    'cn',
    'us',
    'id',
    'pk',
    'ng',
    'br',
    'bd',
    'ru',
    'et',
    'mx',
    'jp',
    'eg',
    'ph',
    'cd',
    'vn',
    'ir',
    'tr',
    'de',
    'th',
    'gb',
    'tz',
    'fr',
    'za',
    'it',
    'ke',
    'mm',
    'co',
    'kr',
    'sd',
    'ug',
    'es',
    'dz',
    'iq',
    'ar',
    'af',
    'ye',
    'ca',
    'pl',
    'ma',
    'ao',
    'ua',
    'uz',
    'my',
    'mz',
    'gh',
    'pe',
    'sa',
    'mg',
    'ci',
    'np',
    'cm',
    've',
    'ne',
    'au',
    'kp',
    'sy',
    'ml',
    'bf',
    'tw',
    'lk',
    'mw',
    'zm',
    'cl',
  ],
} as const;

/** Starter roster shown on first launch (no dataset load needed). */
export const STARTER: Country[] = [
  { iso2: 'bd', name: 'Bangladesh', region: 'Asia' },
  { iso2: 'in', name: 'India', region: 'Asia' },
  { iso2: 'pk', name: 'Pakistan', region: 'Asia' },
  { iso2: 'us', name: 'United States', region: 'Americas' },
  { iso2: 'cn', name: 'China', region: 'Asia' },
  { iso2: 'jp', name: 'Japan', region: 'Asia' },
  { iso2: 'br', name: 'Brazil', region: 'Americas' },
  { iso2: 'de', name: 'Germany', region: 'Europe' },
  { iso2: 'fr', name: 'France', region: 'Europe' },
  { iso2: 'gb', name: 'United Kingdom', region: 'Europe' },
  { iso2: 'it', name: 'Italy', region: 'Europe' },
  { iso2: 'kr', name: 'South Korea', region: 'Asia' },
  { iso2: 'tr', name: 'Türkiye', region: 'Asia' },
  { iso2: 'sa', name: 'Saudi Arabia', region: 'Asia' },
  { iso2: 'ng', name: 'Nigeria', region: 'Africa' },
  { iso2: 'mx', name: 'Mexico', region: 'Americas' },
];

export function flagUrl(iso2: string): string {
  return `flags/${iso2}.svg`;
}
