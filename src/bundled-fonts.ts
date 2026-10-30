import manifest from '../assets/fonts/liberation-sans-2.1.5/manifest.json' with { type: 'json' };

/** Private URLs are answered by DeckFontSession, never by the network or an installed face. */
export const BUNDLED_FONT_ORIGIN = 'https://bundled-fonts.deckflip.invalid';
export const BUNDLED_STYLESHEET_URL = `${BUNDLED_FONT_ORIGIN}/default.css`;
export const BUNDLED_FONT_MANIFEST = manifest;

export function bundledFontUrl(file: string): string {
  return `${BUNDLED_FONT_ORIGIN}/liberation-sans-${manifest.version}/${file}`;
}

/** This module lives one directory below the package root, in both source and bundled CLI builds. */
export function bundledFontFile(file: string): URL {
  return new URL(`../assets/fonts/liberation-sans-${manifest.version}/${file}`, import.meta.url);
}

/** The first anonymous layer cannot be reopened by author CSS; every later author layer outranks it. */
export function bundledFontStylesheet(): string {
  const faces = manifest.fonts.map((face) => `@font-face {
  font-family: "${manifest.family}";
  font-weight: ${face.weight};
  font-style: ${face.italic ? 'italic' : 'normal'};
  src: url("${bundledFontUrl(face.file)}") format("truetype");
}`).join('\n');
  return `@layer {\n${faces}\n:root { font-family: "${manifest.family}"; }\n}`;
}
