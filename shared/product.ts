// The product's working identity. The brand name has not been chosen (brief, 6 Nov 2026): change it here only.
export const PRODUCT_NAME = 'Agents';
export const PRODUCT_TAGLINE = 'Specialised agents for every field';
/** Output languages an agent can be asked to write in; the agent follows the user's own language when they switch. */
export const OUTPUT_LANGUAGES = ['en', 'el', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ro', 'sv', 'da', 'fi', 'cs', 'hu', 'tr', 'ar', 'he', 'zh', 'ja'] as const;
export type OutputLanguage = typeof OUTPUT_LANGUAGES[number];
export const isOutputLanguage = (value: unknown): value is OutputLanguage => typeof value === 'string' && (OUTPUT_LANGUAGES as readonly string[]).includes(value);
let names: Intl.DisplayNames | null | undefined;
export function languageName(code: string): string {
  if (names === undefined) { try { names = new Intl.DisplayNames(['en'], { type: 'language' }); } catch { names = null; } }
  return names?.of(code) ?? code;
}
