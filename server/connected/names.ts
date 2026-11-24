// «Names hidden» for mail the server reads (10 Nov 2026). The browser's finder (src/data/privacy.ts) works on texts it
// has in full; a connected agent reads its mail one tool call at a time. This keeps ONE list for the whole run, so a
// person who appears in three messages is [PERSON 1] in all three, and a new name gets the next number of its kind.
// The answer comes back with the placeholders, and the server puts the names back before the owner reads it.
import { findPrivate, foldName, makeMasker, type HiddenItem } from '../../src/data/privacy.ts';

export type NameList = { on: boolean; mask(text: string): string; restore(text: string): string; readonly count: number };

export function createNameList(on: boolean): NameList {
  const items: HiddenItem[] = [];
  const byForm = new Map<string, HiddenItem>();
  const counts = new Map<string, number>();
  let masker = makeMasker([]);
  return {
    on,
    get count() { return items.length; },
    mask(text) {
      if (!on || !text) return text;
      let grew = false;
      for (const found of findPrivate([text])) {
        const forms = [found.text, ...found.aliases];
        const known = forms.map(form => byForm.get(foldName(form))).find(Boolean);
        if (known) { for (const form of forms) if (!byForm.has(foldName(form))) { known.aliases.push(form); byForm.set(foldName(form), known); grew = true; } continue; }
        const label = found.placeholder.replace(/ \d+\]$/, '');
        const n = (counts.get(label) ?? 0) + 1; counts.set(label, n);
        const item: HiddenItem = { ...found, aliases: [...found.aliases], placeholder: `${label} ${n}]` };
        items.push(item); for (const form of forms) byForm.set(foldName(form), item); grew = true;
      }
      if (grew) masker = makeMasker(items);
      return masker.mask(text);
    },
    restore: text => masker.restore(text),
  };
}
