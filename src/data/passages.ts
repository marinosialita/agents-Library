// A long document's share of one question: the passages that bear on it, in document order, within a budget.
const terms = (text: string) => text.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]{3,}/gu) ?? [];

export function relevantPassages(text: string, question: string, budget: number): string {
  if (text.length <= budget) return text;
  const passages: string[] = [];
  for (const paragraph of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (!paragraph) continue;
    for (let at = 0; at < paragraph.length; at += 1500) passages.push(paragraph.slice(at, at + 1500));
  }
  const words = new Set(terms(question));
  const score = passages.map(passage => {
    const seen = new Set(terms(passage)); let hits = 0;
    for (const word of words) if (seen.has(word)) hits++;
    return hits / Math.sqrt(seen.size + 4);
  });
  const gap = '\n[…]\n'; const chosen = new Set<number>(); let size = 0;
  const take = (index: number) => {
    if (index < 0 || index >= passages.length || chosen.has(index)) return true;
    if (size + passages[index].length + gap.length > budget) return false;
    chosen.add(index); size += passages[index].length + gap.length; return true;
  };
  for (let index = 0, opening = 0; index < passages.length && opening < Math.min(6_000, budget * 0.15); index++) { if (!take(index)) break; opening += passages[index].length; }
  const ranked = score.map((value, index) => ({ value, index })).filter(item => item.value > 0).sort((a, b) => b.value - a.value);
  for (const { index } of ranked) { if (!take(index)) break; take(index + 1); take(index - 1); }
  for (let index = 0; index < passages.length; index++) if (!chosen.has(index) && !take(index)) break;
  let result = ''; let last = -1;
  for (const index of [...chosen].sort((a, b) => a - b)) { if (last >= 0 && index !== last + 1) result += gap; result += passages[index]; last = index; }
  result = result.length > budget ? result.slice(0, budget) : result;
  return result.replace(/[\uD800-\uDBFF]$/, '');
}
