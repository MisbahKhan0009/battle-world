// Copies the square (1x1) flag SVGs used by the dataset into public/flags.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const countries = JSON.parse(readFileSync(new URL('src/data/countries.json', root), 'utf8'));
const out = new URL('public/flags/', root);
mkdirSync(out, { recursive: true });
let n = 0;
for (const { iso2 } of countries) {
  const src = new URL(`node_modules/flag-icons/flags/1x1/${iso2}.svg`, root);
  const dst = new URL(`${iso2}.svg`, out);
  if (!existsSync(src)) throw new Error(`missing flag ${iso2}`);
  if (!existsSync(dst)) {
    copyFileSync(src, dst);
    n++;
  }
}
console.log(`flags ready (${n} copied)`);
