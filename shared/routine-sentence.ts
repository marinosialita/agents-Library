// «Describe your routine» (11 Nov 2026, from the Lindy study): one sentence becomes a filled routine to review —
// «Every weekday at 9, summarise my Slack and email me». Read on the device, by rule, so it works without the AI key and
// never guesses silently: what it could not read keeps the brief's suggested value and is listed in `unread`.
import { BRIEFS, type BriefId } from './briefs.ts';
import { EVERY_HOURS, siteDomain, type EveryHours, type RoutineTrigger } from './routines.ts';
import { PUBLISHER_FEEDS, publishersIn } from './publishers.ts';

export type SentenceRoutine = { brief: BriefId; name: string; days: number[]; time: string; viaEmail: boolean; viaWhatsapp: boolean; viaTelegram: boolean; unread: ('days' | 'time')[] };

const DAY_WORDS: [RegExp, number][] = [[/\bsun(day)?s?\b/, 0], [/\bmon(day)?s?\b/, 1], [/\btue(s|sday)?s?\b/, 2], [/\bwed(nesday)?s?\b/, 3], [/\bthu(rs|rsday)?s?\b/, 4], [/\bfri(day)?s?\b/, 5], [/\bsat(urday)?s?\b/, 6]];

/** Which brief the words point to; the morning brief when nothing more specific is named. */
export function briefFor(text: string): BriefId {
  if (/\bweek(ly)?\b|\bfriday wrap|\bwrap[- ]?up\b/.test(text) && !/\bevery (week)?day\b/.test(text)) return 'weekly-wrap';
  if (/\b(end of (the )?day|evening|close (of|the) day|tonight|eod)\b/.test(text)) return 'end-of-day-review';
  if (/\b(meeting prep|prepare me for|before (my |each |every )?meetings?|prep(are)? (for )?(my )?meetings?)\b/.test(text)) return 'meeting-prep';
  if (/\b(invoice|payment|overdue|money|deadline|due date)s?\b/.test(text)) return 'money-and-deadlines';
  if (/\b(slack|teams|github|gitlab|jira|trello|notion|drive|dropbox|figma|linear|asana|mentions?|pull requests?|prs?|tickets?|digest)\b/.test(text) && !/\b(e-?mail|inbox|gmail|outlook)\b(?! me)/.test(text)) return 'updates-digest';
  return 'morning-inbox-brief';
}

export function readTime(text: string): string | null {
  if (/\bnoon\b|\bmidday\b/.test(text)) return '12:00';
  const match = /\b(?:at|@|by|around)?\s*(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?![\d%€$])/.exec(text.replace(/\b(\d+)\s*(minutes?|hours?|days?|weeks?)\b/g, ''));
  if (!match || (!match[2] && !match[3] && !/\b(at|@|around)\s*\d/.test(text))) return null;
  let hour = Number(match[1]); const minute = Number(match[2] ?? 0); const half = match[3]?.[0];
  if (half === 'p' && hour < 12) hour += 12; if (half === 'a' && hour === 12) hour = 0;
  if (!half && hour >= 1 && hour <= 6 && /\b(evening|afternoon|tonight)\b/.test(text)) hour += 12;
  return hour <= 23 && minute <= 59 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : null;
}

export function readDays(text: string): number[] | null {
  if (/\b(every ?day|daily|each day|7 days)\b/.test(text)) return [0, 1, 2, 3, 4, 5, 6];
  if (/\b(weekdays?|working days?|work days?|business days?|monday to friday|mon[- ]fri)\b/.test(text)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/.test(text)) return [0, 6];
  const named = DAY_WORDS.filter(([pattern]) => pattern.test(text)).map(([, day]) => day);
  return named.length ? named.sort((a, b) => a - b) : null;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, an: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, twelve: 12 };
/** «every 6 hours», «every hour», «hourly», «every 1 hr» → the nearest repeat the schedule offers (11 Nov 2026). */
export function readEvery(text: string): EveryHours | null {
  const lower = text.toLowerCase();
  if (/\bhourly\b/.test(lower)) return 1;
  const match = /\bevery\s+(\d{1,2}|one|an|a|two|three|four|five|six|eight|twelve)?\s*(?:hrs?|hours?)\b/.exec(lower);
  if (!match) return null;
  const n = match[1] ? Number(match[1]) || NUMBER_WORDS[match[1]] || 1 : 1;
  return [...EVERY_HOURS].reduce((best, item) => Math.abs(item - n) < Math.abs(best - n) ? item : best, EVERY_HOURS[0]);
}

/** Cyprus's main newspapers and news agency (11 Nov 2026, his «my newspaper» for Cyprus criminal news). Shown in the
 *  routine, where the person can change them; never searched unless the routine names them. */
export const CYPRUS_NEWS = ['philenews.com', 'cyprus-mail.com', 'politis.com.cy', 'kathimerini.com.cy', 'sigmalive.com', 'reporter.com.cy',
  'alphanews.live', 'omegalive.com.cy', 'dialogos.com.cy', 'cna.org.cy', 'in-cyprus.philenews.com'];

/** Websites named in the sentence (a link or a domain), and Cyprus's newspapers when it asks for Cyprus news. */
export function readSites(sentence: string): string[] {
  const named = [...sentence.matchAll(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|eu|gov|cy|gr|uk|io|co|info|news|live|law)(?:\.[a-z]{2})?(?:\/[^\s,;]*)?/gi)]
    .map(match => siteDomain(match[0])).filter((site): site is string => !!site);
  // A publisher named in words («the Cyprus Mail») counts as its site, and then it alone is followed (13 Nov 2026).
  const publishers = publishersIn(sentence);
  const news = !publishers.length && /\b(news(?:papers?)?|press|media|headlines?|journalists?|newspaper)\b|ειδήσεις|εφημερίδ/i.test(sentence) && /\bcyprus|cypriot|κύπρ|κυπρ/i.test(sentence);
  return [...new Set([...named, ...publishers, ...(news ? CYPRUS_NEWS : [])])].slice(0, 12);
}

/** «keep me updated», «tell me if anyone asks», hourly → only tell when something is new. */
export function wantsQuiet(sentence: string): boolean {
  return /\b(keep me (?:up ?dated|posted|informed)|tell me (?:if|when)|let me know (?:if|when)|alert me|notify me|only (?:if|when) (?:there is |there's )?(?:something|anything) new|if anyone)\b/i.test(sentence) || readEvery(sentence) !== null;
}

export function readSentence(sentence: string): SentenceRoutine {
  const text = ` ${sentence.toLowerCase().replace(/[’']/g, "'")} `;
  const brief = briefFor(text);
  const base = BRIEFS.find(item => item.id === brief)!;
  const days = readDays(text), time = readTime(text);
  return { brief, name: base.name, days: days ?? [...base.suggested.days], time: time ?? base.suggested.time,
    // 13 Nov 2026 (code review): a sending verb is needed («came into my inbox», «replies to my email campaign» are not delivery).
    viaEmail: /\b(e-?mail (?:it |them |this )?(?:to )?me|(?:send|sending|deliver|delivering|forward|forwarding|put|post)\b[^.,;]{0,40}?\b(?:to|into) (?:my )?(?:e-?mail|inbox)|by e-?mail)\b/.test(text), viaWhatsapp: /\bwhats ?app\b/.test(text), viaTelegram: /\btelegram\b/.test(text),
    unread: [...(days ? [] : ['days' as const]), ...(time ? [] : ['time' as const])] };
}

/** Whether the sentence is about the person's own mail, calendar or work apps (a brief), or a research job for an
 *  agent (11 Nov 2026: «every Monday give me the new cases on CyLaw» is research). */
export function wantsBrief(sentence: string): boolean {
  // Where the result goes («…and send it to my email») is not what the routine reads (13 Nov 2026: «whenever the
  // Cyprus Mail posts… send it to my email» became a morning inbox brief).
  const text = ` ${sentence.toLowerCase().replace(/[’']/g, "'").replace(DELIVERY_WORDS, ' ')} `;
  if (readSites(sentence).length) return false;
  const research = /\b(cases?|judgments?|judgements?|decisions?|rulings?|case[- ]law|cylaw|eur-?lex|legislation|laws?|regulations?|directives?|gazette|court|tribunal|official|new (?:rules|acts?)|amendments?|consultations?|circulars?|guidance|announcements?|publications?|notices?|tax|vat|news|articles?|stor(?:y|ies)|headlines?|blogs?|feeds?|websites?|press releases?|listings?|tenders?)\b/.test(text);
  const mine = /\b(my (?:e-?mail|inbox|mail|calendar|meetings|day|slack|teams|github|jira|tasks)|e-?mails?|inbox|gmail|outlook|calendar|meetings?|slack|teams|github|gitlab|jira|trello|asana|notion|drive|dropbox|invoices?|deadlines and money|weekly wrap|end of (?:the )?day)\b/.test(text);
  if (/\bmy (?:e-?mails?|inbox|mail|calendar|meetings|slack|teams|github|gitlab|jira|tasks|apps|drive)\b/.test(text)) return true;
  return mine && !research ? true : !research;
}

/** «…and send it to my email», «e-mail it to me», «on my WhatsApp»: where the result goes, not what is read. */
const DELIVERY_WORDS = /\b(?:and\s+)?(?:send|sending|sent|deliver|delivering|forward|forwarding|post|posting|e-?mail|e-?mailing|put|putting)\b(?:\s+(?:it|this|them|that|the (?:summary|brief|result|results|report)))?\s+(?:to|on|by|via|into)\s+my\s+(?:e-?mail|inbox|mail|whatsapp|telegram|slack|teams)(?: account)?\b|\b(?:and\s+)?(?:to|on|via)\s+my\s+(?:whatsapp|telegram)\b|\b(?:and\s+)?e-?mail (?:it |them |this )?(?:to )?me\b(?!\s+[a-z])/gi;

/** «ask me before sending», «check with me first», «wait for my OK»: the result waits for the person's approval. */
export function wantsApproval(sentence: string): boolean {
  return /\b(ask me (?:first|before)|check with me|let me (?:approve|check|see|review|ok|okay)(?: it| them)?(?: first| before)|(?:with|after|for) my (?:ok|okay|approval|go[- ]ahead)|wait (?:for|until) (?:my|i) (?:ok|okay|approv\w*|say)|approve (?:it |them )?(?:first|before)|(?:only )?(?:after|once) i (?:approve|confirm|say (?:so|yes|ok)))\b/i.test(sentence.replace(/[’']/g, "'"));
}

/** «Whenever the Cyprus Mail posts…», «as soon as this page changes»: the routine runs when the site has something new,
 *  not on a clock. Only where a site is named and no days, time or «every N hours» are: then it follows that
 *  publisher's own feed, a link named in the sentence, or the site's front page. */
export function readTrigger(sentence: string): Extract<RoutineTrigger, { kind: 'feed' }> | null {
  const lower = ` ${sentence.toLowerCase().replace(/[’']/g, "'")} `;
  if (readDays(lower) || readTime(lower) || readEvery(lower)) return null;
  // 13 Nov 2026 (code review): «every morning…», «once a month…» are schedules, not «on each new post».
  if (/\b(?:every|each) (?:day|morning|evening|night|week|weekday|month|year)s?\b|\b(?:daily|weekly|monthly|nightly|yearly)\b|\bonce a (?:day|week|month|year)\b|\b(?:in the )?(?:mornings?|evenings?)\b|\btonight\b/.test(lower)) return null;
  if (!/\b(?:whenever|every time|each time|as soon as|the moment|when|if)\b.{0,100}?\b(?:posts?|posted|publish(?:es|ed)?|puts? (?:up|out)|adds?|added|uploads?|uploaded|releases?|released|announces?|announced|changes?|changed|updates?|updated|listed|has (?:a |any )?new|there(?:'s| is| are) (?:a |any )?new|something new|anything new)\b/.test(lower)
    && !/\bnew (?:articles?|posts?|stor(?:y|ies)|items?|headlines?|episodes?|listings?|jobs?|tenders?|releases?)\b.{0,40}\b(?:as soon as|the moment|when(?:ever)? (?:they|it) (?:appear|come|go))/.test(lower)) return null;
  const link = /\bhttps?:\/\/[^\s,;]+/i.exec(sentence)?.[0];
  if (link) return { kind: 'feed', url: link.replace(/[.)]+$/, '') };
  const site = readSites(sentence)[0];
  if (!site) return null;
  return { kind: 'feed', url: PUBLISHER_FEEDS[site] ?? `https://${site}/` };
}

/** The task without the schedule words: «every Monday at 9 give me the new cases on CyLaw» → «Give me the new cases on CyLaw». */
export function taskOf(sentence: string): string {
  const day = '(?:mon|tues|wednes|thurs|fri|satur|sun)day';
  const cleaned = sentence
    .replace(new RegExp(`\\b(?:every|each|on)\\s+(?:(?:${day}|weekday|working day|day|morning|evening|week|month)s?(?:\\s*(?:,|and|&)\\s*${day}s?)*)\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b${day}s?\\b`, 'gi'), ' ')
    .replace(/\b(?:daily|weekly|weekdays|weekends?|every day|hourly)\b/gi, ' ')
    .replace(/\bevery\s+(?:\d{1,2}|one|an|a|two|three|four|five|six|eight|twelve)?\s*(?:hrs?|hours?)\b/gi, ' ')
    .replace(/\b(?:at|by|around)\s+\d{1,2}(?:[:.h]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?/gi, ' ')
    .replace(/\b\d{1,2}(?:[:.]\d{2})\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm)\b/gi, ' ')
    .replace(/\b(?:morning|evening)\b/gi, ' ')
    // 13 Nov 2026: «…and ask me before sending it to my email» is the app's job (approval, delivery), not the agent's task.
    .replace(/\s*,?\s*(?:and\s+)?(?:ask me (?:first|before)[^,.;]*|check with me(?: first)?|let me (?:approve|check|see|review)(?: it| them)?(?: first| before)[^,.;]*|wait (?:for|until) (?:my|i) (?:ok|okay|approv\w*|say)[^,.;]*)/gi, ' ')
    .replace(/\b(?:and\s+)?e-?mail (?:it |them |this )?(?:to )?me\b(?=\s+[a-z])/gi, ' and give me')
    .replace(DELIVERY_WORDS, ' ')
    .replace(/^[\s,;:-]*(?:and|then|please)?[\s,;:-]*/i, '')
    .replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim().replace(/^[,;:\s-]+|[,;:\s-]+$/g, '');
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : sentence.trim();
}
