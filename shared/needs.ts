// «Needs you today» (11 Nov 2026): the to-do list a brief opens with. Today's «Needs you» box shows it; the brief's own
// column on Today leaves it out (13 Nov 2026, his «why do these 2 boxes show the same thing?»).
const SECTION = /(^|\n)##\s*Needs you today\s*\n([\s\S]*?)(?=\n##\s|\s*$)/i;

/** The numbered items under «## Needs you today» in a brief (the morning brief's own heading). */
export function needsOf(answer: string): string[] {
  const section = SECTION.exec(answer)?.[2] ?? '';
  return section.split('\n').map(line => /^\s*\d+[.)]\s+(.*)$/.exec(line)?.[1]?.trim() ?? '').filter(Boolean).slice(0, 8);
}

/** The brief without its «Needs you today» section (heading and list), the rest as it was. */
export const withoutNeeds = (answer: string): string => answer.replace(SECTION, (_all, before: string) => before).replace(/\n{3,}/g, '\n\n').trim();
