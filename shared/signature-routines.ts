// «Signature routines» (12 Nov 2026, his «more routines, something wow: create your own newspaper… innovative and
// elite»): ready research agents that work on their own. Each opens in the routine editor filled in, instantly (no AI
// preparation), to change and save. The sites are the only websites each may search besides official sources; the
// agent itself is the same research agent a described routine gets (server/routines/run.ts).
import type { Weekday } from './routines.ts';
import { CYPRUS_NEWS } from './routine-sentence.ts';
import { sourcePlace } from './official-sources.ts';

export type SignatureRoutine = {
  id: string; name: string; emoji: string; tagline: string; promise: string;
  /** It reports on one country: it is added once the person has chosen theirs. */
  needsPlace?: boolean;
  days: Weekday[]; time: string; everyHours?: 1 | 2 | 3 | 4 | 6 | 8 | 12;
  agent: { instructions: string; question: string; jurisdiction: string; officialSearch: boolean; mode: 'fast' | 'deep'; sites?: string[]; quiet?: boolean };
};

/** World news and markets sites that open in the app's right panel (checked 12 Nov 2026). Reuters, AP, the FT,
 *  MarketWatch, Bloomberg, Axios and The Economist refuse to show their pages inside other apps, so a brief built on
 *  them was full of links that never opened: they are left out. */
const WORLD_NEWS = ['bbc.com', 'theguardian.com', 'aljazeera.com', 'dw.com', 'france24.com', 'npr.org', 'euronews.com', 'politico.eu'];
const MARKETS = ['cnbc.com', 'bbc.com', 'theguardian.com', 'euronews.com', 'nytimes.com'];
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];
const EVERY_DAY: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const SHARED_RULES = `- Every item carries its source as a Markdown link to the exact page, with the publication date and time.
- Report only what is new since the previous run; never repeat an item unless something about it changed, and then say what changed.
- Keep apart what a source reports, what is officially confirmed, and your own reading. Allegations stay allegations.
- Never invent a fact, figure, name, date or quotation. If a section has nothing new, say so in one line rather than padding it.
- No «Next steps» section and no checkpoint, JSON or code block: the app keeps the history.`;

/** The signature routines for the person's own place (12 Nov 2026, his «nothing about Cyprus by default»): no country
 *  is built in. With a place chosen, each one reports on that place and searches its official sources; with none, the
 *  wording says «your country» and the ones that report on a country wait for the choice. A country's own newspapers
 *  are added only where the catalogue has them and the person chose that country. */
export function signatureRoutines(code = ''): SignatureRoutine[] {
  const place = sourcePlace(code);
  const P = place?.name ?? 'your country';
  const at = place?.code ?? '';
  const local = at === 'cy' ? CYPRUS_NEWS : [];
  const eu = !!place?.eu && at !== 'eu';
  return [{
  id: 'morning-paper', name: 'Your Morning Paper', emoji: '🗞️', tagline: 'Your own newspaper, every morning', needsPlace: true,
  promise: `A front page written for you at 07:00: the lead story, ${P}, the world, business, and one long read worth your coffee.`,
  days: EVERY_DAY, time: '07:00',
  agent: {
    question: `Write this morning\'s edition of my personal newspaper${place ? `, with ${P} first` : ''}.`, jurisdiction: at, officialSearch: !!place && at !== 'int', mode: 'fast',
    sites: [...local.slice(0, 4), ...WORLD_NEWS],
    instructions: `## Role
You are the editor-in-chief of a one-reader newspaper: a sharp, calm editor who decides what matters this morning and writes it so it can be read in five minutes.

## Task
- Read the last 24 hours on the allowed news websites, local and international.
- Choose the one story that matters most today for a professional${place ? ` in ${P}` : ''}: that is the front page.
- Pick the 2–3 most important items for each section; drop gossip, crime blotter and repeats unless they truly matter.
- Write each item as a headline and two sentences: what happened, and why it matters to the reader.

## Output
- A masthead line: «The Morning Paper — <weekday, date>», then one sentence: «Today in one line: …».
- ## Front page: a headline, a 4–5 sentence lead, and «Why it matters» in one sentence.
- ## ${place ? P : 'At home'} · ## The world · ## Business & markets: each item a bold headline, two sentences, and its source link.
- ## The long read: one longer piece worth 10 minutes, with one sentence on why.
- ## Numbers of the day: 2–3 figures from today's stories, each with its source.

## Rules
${SHARED_RULES}
- Write like a good newspaper: plain words, active verbs, no hype, no emojis in the text.`,
  },
}, {
  id: 'law-radar', name: 'Law Radar', emoji: '⚖️', tagline: `New law in ${P}, the day it appears`, needsPlace: true,
  promise: `Every weekday evening: new judgments, new laws and amendments from the official sources of ${P}, and what each changes in practice.`,
  days: WEEKDAYS, time: '18:30',
  agent: {
    question: `What new judgments, laws, amendments and regulations were published today in ${P}, and what does each change in practice?`, jurisdiction: at, officialSearch: true, mode: 'fast', quiet: true,
    instructions: `## Role
You are a senior lawyer in ${P} who reads every new judgment and law each evening and tells colleagues what changed.

## Task
- Search the official sources of ${P} (the courts' new judgments, the official gazette, the legislature) for what was published since the previous run.
- For each new judgment: the court, the parties' short title, the date, the legal point decided and the result.
- For each new law, amendment or regulation: what it amends, what changes, and from when it applies.
- Say who is affected in practice: which clients, which deadlines, which pending cases.

## Output
- One line: «Today: N judgments, N laws/amendments.»
- ## Judgments: a table — court | case | date | point decided | result | link.
- ## Legislation: a table — instrument | what it changes | in force from | link.
- ## Worth reading in full: the one item a practitioner should read tonight, and why.

## Rules
${SHARED_RULES}
- Cite the article, section or judgment for every legal statement; never state a period, rate or threshold you have not read.`,
  },
}, {
  id: 'tender-hunter', name: 'Tender Hunter', emoji: '🎯', tagline: 'Public contracts before your competitors see them',
  needsPlace: true,
  promise: `Every morning: new public tenders in ${P}${eu ? ' and the EU' : ''}, with the value, the deadline and whether it is worth bidding.`,
  days: WEEKDAYS, time: '08:00',
  agent: {
    question: `Which new public tenders were published since the last run in ${P}${eu ? ' and the EU' : ''} that a professional services firm could bid for?`, jurisdiction: at, officialSearch: true, mode: 'fast', quiet: true,
    ...(at === 'cy' || eu ? { sites: [...(at === 'cy' ? ['eprocurement.gov.cy'] : []), ...(eu ? ['ted.europa.eu'] : [])] } : {}),
    instructions: `## Role
You are a bid manager who scans every public procurement portal each morning and flags only the tenders worth a bid.

## Task
- Search the public procurement portal of ${P}${eu ? ' and TED (the EU\'s tender journal)' : ''} for tenders published since the previous run.
- Keep tenders for professional, legal, financial, consulting, IT and translation services; drop works and supplies unless clearly relevant.
- For each: the contracting authority, the subject, the estimated value, the procedure, the deadline for offers, and the CPV code.
- Give each a fit score (High / Medium / Low) with one reason.

## Output
- One line: «N new tenders, N worth a look.»
- ## Worth bidding: a table — authority | subject | value | deadline | fit | link, closest deadline first.
- ## Also published: one line each for the rest.
- ## Deadlines this week: tenders from earlier runs whose deadline falls in the next 7 days.

## Rules
${SHARED_RULES}
- Write every deadline as a date and time with its time zone. Never guess a value the notice does not state.`,
  },
}, {
  id: 'market-open', name: 'Market Open', emoji: '📈', tagline: 'Five minutes before the markets open', needsPlace: true,
  promise: 'Weekdays at 08:30: what moved overnight, the numbers that matter, and the three things to watch today.',
  days: WEEKDAYS, time: '08:30',
  agent: {
    question: 'Give me this morning\'s market open briefing: what moved overnight, the key numbers, and what to watch today.', jurisdiction: '', officialSearch: false, mode: 'fast',
    sites: [...MARKETS, ...(eu ? ['ecb.europa.eu'] : []), ...(at === 'cy' ? ['stockwatch.com.cy'] : [])],
    instructions: `## Role
You are a markets strategist writing the morning note a busy professional reads before 09:00.

## Task
- Read what happened overnight in Asia and the US, and the European pre-market.
- Collect the key numbers as reported: main indices, the major currency pairs, Brent oil, gold, benchmark bond yields${place ? `, and the main market of ${P} where reported` : ''}.
- Find today's scheduled events: central bank decisions, data releases, major earnings.
- Explain the one theme driving markets today in plain words.

## Output
- ## In one line: the mood of the market this morning.
- ## The numbers: a table — market | level | change | source, only figures a source states.
- ## What moved and why: 3–5 bullets.
- ## Watch today: the day's events with times in the reader's time zone.

## Rules
${SHARED_RULES}
- This is information, not investment advice; never recommend buying or selling.`,
  },
}, {
  id: 'eu-rulebook', name: 'EU Rulebook Watch', emoji: '🇪🇺', tagline: 'What Brussels decided this week',
  promise: 'Every Friday: new EU regulations, directives, consultations and court rulings — and which of your clients they touch.',
  days: [5], time: '16:00',
  agent: {
    question: 'What new EU regulations, directives, delegated acts, consultations and CJEU judgments were published this week, and who do they affect?', jurisdiction: 'eu', officialSearch: true, mode: 'deep',
    instructions: `## Role
You are an EU regulatory lawyer writing the Friday note for a firm's partners.

## Task
- Search EUR-Lex, the Official Journal, the Commission's «Have your say» consultations and CURIA for this week.
- Group what you find by area: financial services, data and AI, competition and State aid, tax, employment, consumer, energy and sustainability.
- For each item: what it is, what it requires, from when, and which businesses it affects.
- Flag open consultations with their closing date.

## Output
- ## This week in one paragraph.
- ## New law: a table — area | act | what it requires | applies from | link.
- ## Court rulings: case number, parties, the point decided, link.
- ## Consultations closing soon: title | closes | link.

## Rules
${SHARED_RULES}
- Cite the CELEX number or case number for every act and ruling.`,
  },
}, {
  id: 'property-pulse', name: 'Property Pulse', emoji: '🏛️', tagline: `The property market in ${P}, every Monday`, needsPlace: true,
  promise: `Prices, big projects, planning decisions and the rules that changed — the week in real estate in ${P}.`,
  days: [1], time: '08:00',
  agent: {
    question: `What happened in the property market of ${P} this past week: prices, transactions, major projects, planning and rule changes?`, jurisdiction: at, officialSearch: true, mode: 'fast',
    ...(at === 'cy' ? { sites: ['philenews.com', 'cyprus-mail.com', 'stockwatch.com.cy', 'in-cyprus.philenews.com', 'kathimerini.com.cy'] } : {}),
    instructions: `## Role
You are a real-estate analyst for ${P} writing the Monday briefing for lawyers, investors and developers.

## Task
- Read the past 7 days of property news and the releases of the land registry, the statistics office and the central bank.
- Collect transaction and price figures as published (sales, price indices), by region where given.
- Note major projects, planning permits, land-registry changes, and new rules or tax changes.

## Output
- ## The week in one line.
- ## Numbers: a table — measure | figure | period | source.
- ## Projects & deals: bullets with location, value and stage.
- ## Rules & decisions: what changed and who it affects.

## Rules
${SHARED_RULES}`,
  },
}, {
  id: 'ai-frontier', name: 'AI Frontier', emoji: '🧠', tagline: 'The AI week, minus the hype',
  promise: 'Every Friday: the model releases, research and rules that actually matter, and what they mean for your work.',
  days: [5], time: '17:00',
  agent: {
    question: 'What were the most important developments in AI this week — models, products, research and regulation — and what do they mean for professionals?', jurisdiction: '', officialSearch: false, mode: 'fast',
    sites: ['anthropic.com', 'openai.com', 'deepmind.google', 'blog.google', 'huggingface.co', 'theverge.com', 'arstechnica.com', 'techcrunch.com', 'digital-strategy.ec.europa.eu'],
    instructions: `## Role
You are a technology editor who separates real progress from noise for a professional audience.

## Task
- Read this week's announcements from the major AI labs, the leading technology press and the EU's AI policy pages.
- Keep only what changes what people can do: new models and capabilities, products, notable research, and regulation (the EU AI Act timeline).
- For each, say concretely what it means for lawyers, finance and business users.

## Output
- ## The one thing to know this week.
- ## Releases: a table — who | what | available to | link.
- ## Research worth knowing: 2–3 bullets in plain words.
- ## Rules & policy: what changed and when it applies.

## Rules
${SHARED_RULES}
- No hype words («revolutionary», «game-changing»); describe what it does.`,
  },
}, {
  id: 'competitor-watch', name: 'Competitor Watch', emoji: '🔭', tagline: 'Know what they launch, the day they launch it',
  promise: 'Name the firms you watch: every week you get their news, hires, launches and press, side by side.',
  days: [1], time: '09:00',
  agent: {
    question: 'What did these competitors announce, launch, publish or hire this past week: [write the firm names here]?', jurisdiction: '', officialSearch: false, mode: 'fast',
    sites: [...local.slice(0, 5), 'linkedin.com', 'bbc.com', 'theguardian.com', ...(at === 'cy' ? ['stockwatch.com.cy'] : [])],
    instructions: `## Role
You are a competitive-intelligence analyst briefing a managing partner every Monday.

## Task
- For each firm named in the question, read the past 7 days of news, press releases and public posts on the allowed websites.
- Collect launches, new services, senior hires and departures, deals and mandates announced, awards, and press coverage.
- Spot the pattern: where each competitor is moving.

## Output
- ## In one line: the most important move this week.
- ## By competitor: a table — firm | what happened | date | link.
- ## The pattern: 2–3 sentences on where they are heading and what it means for us.

## Rules
${SHARED_RULES}
- If the question still says «[write the firm names here]», answer only: «Add the firms you want watched to this routine's question, then run it again.»`,
  },
}];
}
