// Linear-time HTML helpers (13 Nov 2026, code review): a lazy «<script>…</script>» pattern runs in quadratic time on a
// page full of unclosed tags (a hostile 2 MB page would hold the server for minutes). These scan once with indexOf.
// Same meaning as the patterns they replace: the first closing tag of the same name ends a block; no nesting.

const opener = (names: string[]) => new RegExp(`<(${names.join('|')})\\b`, 'g');

/** Every <name>…</name> block removed (replaced), for the names given; an unclosed block runs to the end of the text. */
export function stripBlocks(html: string, names: string[], replacement = ' '): string {
  const lower = html.toLowerCase(); const open = opener(names);
  let out = ''; let at = 0; let match: RegExpExecArray | null;
  while ((match = open.exec(lower))) {
    out += html.slice(at, match.index) + replacement;
    const close = lower.indexOf(`</${match[1]}`, open.lastIndex);
    if (close < 0) { at = html.length; break; }
    const end = lower.indexOf('>', close);
    at = end < 0 ? html.length : end + 1; open.lastIndex = at;
  }
  return out + html.slice(at);
}

/** HTML comments removed; an unclosed one runs to the end. */
export function stripComments(html: string, replacement = ' '): string {
  let out = ''; let at = 0;
  for (;;) {
    const start = html.indexOf('<!--', at); if (start < 0) break;
    out += html.slice(at, start) + replacement;
    const end = html.indexOf('-->', start + 4); if (end < 0) { at = html.length; break; }
    at = end + 3;
  }
  return out + html.slice(at);
}

/** The inside of each <name …>…</name> block, in order (feed items); an unclosed one ends the list. */
export function innerBlocks(text: string, names: string[], max = Infinity): string[] {
  const lower = text.toLowerCase(); const open = opener(names); const found: string[] = []; let match: RegExpExecArray | null;
  while (found.length < max && (match = open.exec(lower))) {
    const start = lower.indexOf('>', open.lastIndex); if (start < 0) break;
    const close = lower.indexOf(`</${match[1]}`, start + 1); if (close < 0) break;
    found.push(text.slice(start + 1, close)); open.lastIndex = close;
  }
  return found;
}
