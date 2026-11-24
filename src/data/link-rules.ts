// Which links the app keeps (12 Nov 2026, his «all web opens in the app, in the right panel») and which leave it.
// A link whose whole purpose is to leave — «Open on the site», «Open in Gmail», «Original» — is marked data-new-tab
// and goes to the person's own browser. The same day the viewer's own «Open on the site» icon was not marked: the
// catcher took it and opened another panel instead of the browser. This one rule is tested (tests/link-rules.mjs).
export type LinkFacts = { href: string; newTab: boolean; download: boolean; ownLinks: boolean };

/** The address to open in the right panel, or null when the link is left to the browser. */
export function panelUrl(link: LinkFacts, origin: string): string | null {
  if (link.newTab || link.download || link.ownLinks) return null;
  let target: URL; try { target = new URL(link.href); } catch { return null; }
  if (!/^https?:$/.test(target.protocol) || target.origin === origin) return null;
  return target.href;
}
