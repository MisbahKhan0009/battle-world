import bebasUrl from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url';
import bebasExtUrl from '@fontsource/bebas-neue/files/bebas-neue-latin-ext-400-normal.woff2?url';
import geistUrl from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
import geistExtUrl from '@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2?url';

/** Absolute font URLs for FontFace loading inside the export worker. */
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

export type FontSpec = { family: string; url: string; descriptors: FontFaceDescriptors };

/** Absolute font URLs for FontFace loading inside the export worker. */
export function exportFonts(): FontSpec[] {
  const abs = (u: string) => new URL(u, document.baseURI).href;
  return [
    { family: 'Bebas Neue', url: abs(bebasUrl), descriptors: { unicodeRange: LATIN } },
    { family: 'Bebas Neue', url: abs(bebasExtUrl), descriptors: { unicodeRange: LATIN_EXT } },
    { family: 'Geist Variable', url: abs(geistUrl), descriptors: { weight: '100 900', unicodeRange: LATIN } },
    {
      family: 'Geist Variable',
      url: abs(geistExtUrl),
      descriptors: { weight: '100 900', unicodeRange: LATIN_EXT },
    },
  ];
}
