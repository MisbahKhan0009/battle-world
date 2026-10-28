// One-off generator for src/data/countries.json (compact dataset).
// Run with: node scripts/build-countries.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const all = require('world-countries');

const EXTRA = new Set(['PS', 'XK', 'TW', 'VA', 'EH']);
const REGION = {
  Asia: 'Asia',
  Europe: 'Europe',
  Africa: 'Africa',
  Americas: 'Americas',
  Oceania: 'Oceania',
  Antarctic: 'Oceania',
};

const rows = all
  .filter((c) => c.independent || c.unMember || EXTRA.has(c.cca2))
  .map((c) => ({ iso2: c.cca2.toLowerCase(), name: c.name.common, region: REGION[c.region] ?? 'Asia' }));

// Home nations are popular in flag battles.
rows.push(
  { iso2: 'gb-eng', name: 'England', region: 'Europe' },
  { iso2: 'gb-sct', name: 'Scotland', region: 'Europe' },
  { iso2: 'gb-wls', name: 'Wales', region: 'Europe' },
);
rows.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(new URL('../src/data/countries.json', import.meta.url), JSON.stringify(rows));
console.log(`wrote ${rows.length} countries`);
