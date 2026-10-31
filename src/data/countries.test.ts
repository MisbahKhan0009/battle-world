import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_EXCLUDED, loadAllCountries, loadCountries, setExcludedCountries } from './countries';

describe('excluded countries', () => {
  afterEach(() => setExcludedCountries(DEFAULT_EXCLUDED));

  test('contested flags are left out of videos by default, and the list can change', async () => {
    const isos = (await loadCountries()).map((c) => c.iso2);
    for (const code of ['kp', 'il', 'ps', 'tw', 'ru']) expect(isos).not.toContain(code);
    expect((await loadAllCountries()).length).toBe(isos.length + DEFAULT_EXCLUDED.length);
    setExcludedCountries(['us']);
    const now = (await loadCountries()).map((c) => c.iso2);
    expect(now).toContain('il');
    expect(now).not.toContain('us');
  });
});
