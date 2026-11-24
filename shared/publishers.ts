// The news publishers a routine knows by name (13 Nov 2026): «whenever the Cyprus Mail posts…» became a morning inbox
// brief because the sentence named no web address. Their public feeds, checked by hand on 13 Nov 2026, are read by
// server/routines/publisher-feeds.ts; AP, Reuters, In-Cyprus and Kathimerini refuse automated readers, so they have no
// feed here and are never read that way (their sites can still be searched).

export const PUBLISHER_FEEDS: Record<string, string> = {
  'bbc.com': 'https://feeds.bbci.co.uk/news/world/rss.xml', 'bbc.co.uk': 'https://feeds.bbci.co.uk/news/world/rss.xml',
  'theguardian.com': 'https://www.theguardian.com/world/rss', 'euronews.com': 'https://www.euronews.com/rss', 'cyprus-mail.com': 'https://cyprus-mail.com/feed/',
  'politico.eu': 'https://www.politico.eu/feed/', 'philenews.com': 'https://www.philenews.com/feed/', 'aljazeera.com': 'https://www.aljazeera.com/xml/rss/all.xml',
  'nytimes.com': 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', 'ft.com': 'https://www.ft.com/rss/home', 'cnn.com': 'http://rss.cnn.com/rss/edition_world.rss',
  'dw.com': 'https://rss.dw.com/rdf/rss-en-world', 'france24.com': 'https://www.france24.com/en/rss', 'techcrunch.com': 'https://techcrunch.com/feed/', 'theverge.com': 'https://www.theverge.com/rss/index.xml',
};

/** Publishers by the names people use («the Cyprus Mail», «BBC», «Φιλελεύθερος») → their site. */
export const PUBLISHER_NAMES: [RegExp, string][] = [
  [/\bbbc\b/i, 'bbc.com'], [/\bguardian\b/i, 'theguardian.com'], [/\beuronews\b/i, 'euronews.com'], [/\bcyprus[- ]mail\b/i, 'cyprus-mail.com'],
  [/\bpolitico\b/i, 'politico.eu'], [/\bphile(?:leftheros|news)\b|φιλελεύθερ/i, 'philenews.com'], [/\bal[- ]?jazeera\b/i, 'aljazeera.com'],
  [/\bnew york times\b|\bnyt\b/i, 'nytimes.com'], [/\bfinancial times\b/i, 'ft.com'], [/\bcnn\b/i, 'cnn.com'], [/\bdeutsche welle\b|\bdw news\b/i, 'dw.com'],
  [/\bfrance ?24\b/i, 'france24.com'], [/\btechcrunch\b/i, 'techcrunch.com'], [/\bthe verge\b/i, 'theverge.com'], [/\bpolitis\b/i, 'politis.com.cy'],
  [/\bsigmalive\b/i, 'sigmalive.com'], [/\breuters\b/i, 'reuters.com'], [/\bassociated press\b|\bap news\b/i, 'apnews.com'],
];

export const publishersIn = (sentence: string) => PUBLISHER_NAMES.filter(([pattern]) => pattern.test(sentence)).map(([, site]) => site);
