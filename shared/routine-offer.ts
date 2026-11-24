// A routine offered from any chat (12 Nov 2026: an agent asked the day, time and zone for a weekly CySEC report, then
// said «no scheduling tool is available in this chat»). An agent ends its reply with a fenced «routine» block; the chat
// shows a card that starts the routine with one press, on this agent, with this question. The text never shows the block.
import { feedUrl, siteDomain, type Weekday } from './routines.ts';
import { BRIEF_BY_ID, isBriefId, type BriefId } from './briefs.ts';
import { PUBLISHER_FEEDS } from './publishers.ts';

export type RoutineOffer = { name: string; question: string; days: Weekday[]; time: string; timeZone: string;
  /** Websites the routine may search (shown on the card before it starts), and where its result should go. */ sites?: string[]; deliver?: 'email' | 'telegram' | 'app';
  /** 13 Nov 2026: it runs each time this feed or page has something new (instead of at a time), and each result waits for the person's OK. */ feed?: string; approve?: boolean;
  /** 13 Nov 2026 (his «do it for me» for a Telegram alert on one sender's e-mails): a brief on the person's own apps
   *  instead of a research agent. «mail» = it runs when a new e-mail matches these plain words ('' = any new e-mail);
   *  «brief» = which ready brief («New email alert» for a mail alert). */ mail?: string; brief?: BriefId };
const EVERY_DAY: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const DAY: Record<string, Weekday> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const zone = (value: string) => { try { new Intl.DateTimeFormat('en-GB', { timeZone: value }); return true; } catch { return false; } };

/** What every agent is told about routines; the user's own time zone is given so it is never asked. */
export const routineRule = (timeZone?: string) => `- The app can run work on a schedule (a «routine»): it runs this agent with a question at set times and leaves the result in the app. When the user wants something done regularly (every Monday, each morning, weekly), get the days and the time if they did not give them (ask with the question block). ${timeZone ? `The time zone is the user's own, ${timeZone}, unless they name another: do not ask it.` : 'Ask the time zone too, offering IANA names such as Europe/London or America/New_York.'} Then end your reply with this block, and say in one line that pressing «Start this routine» switches it on. Never say you cannot schedule.
\`\`\`routine
{"name":"Weekly report","question":"the full instruction for each run","days":["monday"],"time":"08:00","timeZone":"${timeZone || 'Europe/London'}"}
\`\`\``;

const BLOCK = /```routine[ \t]*\n([\s\S]*?)\n?```/;
/** The offer in an answer, or null; a damaged or partial block offers nothing. */
export function routineOffer(content: string): RoutineOffer | null {
  const match = BLOCK.exec(content); if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    const days = [...new Set((Array.isArray(value?.days) ? value.days : []).map((day: unknown) => DAY[String(day).toLowerCase().trim()]).filter((day: Weekday | undefined): day is Weekday => day !== undefined))] as Weekday[];
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value?.time ?? '')) ? String(value.time) : '';
    const timeZone = typeof value?.timeZone === 'string' && zone(value.timeZone) ? value.timeZone : '';
    const name = String(value?.name ?? '').trim().slice(0, 80), question = String(value?.question ?? '').trim().slice(0, 2_000);
    const sites = [...new Set((Array.isArray(value?.sites) ? value.sites : []).map((site: unknown) => siteDomain(String(site))).filter((site: string | null): site is string => !!site))].slice(0, 8) as string[];
    const deliver = value?.deliver === 'email' || value?.deliver === 'telegram' ? value.deliver : undefined;
    // «Every time the BBC posts…»: the feed of the page named, else the first site's own feed, else its front page.
    const feed = value?.trigger === 'feed' ? (typeof value?.url === 'string' && feedUrl(value.url)) || (sites[0] ? PUBLISHER_FEEDS[sites[0]] ?? `https://${sites[0]}/` : '') : '';
    const extra = { ...(sites.length ? { sites } : {}), ...(deliver ? { deliver } : {}), ...(value?.approve === true ? { approve: true } : {}) };
    // The person's own mail: an alert when a matching e-mail arrives, or a ready brief at set times. Never a website.
    const own = { ...(deliver ? { deliver } : {}), ...(value?.approve === true ? { approve: true } : {}) };
    if (value?.trigger === 'mail' && timeZone && name) { const mail = String(value?.filter ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
      return { name, question: question || mail || 'Every new e-mail', days: EVERY_DAY, time: '08:00', timeZone, mail, brief: 'new-mail-alert', ...own }; }
    const brief: unknown = value?.brief;
    if (isBriefId(brief) && days.length && time && timeZone && name) return { name, question: question || BRIEF_BY_ID[brief].name, days: days.sort(), time, timeZone, brief, ...own };
    if (feed && timeZone && name && question) return { name, question, days: days.length ? days.sort() : [0, 1, 2, 3, 4, 5, 6], time: time || '08:00', timeZone, feed, ...extra };
    return days.length && time && timeZone && name && question ? { name, question, days: days.sort(), time, timeZone, ...extra } : null;
  } catch { return null; }
}
/** The answer without its routine block (also one still streaming). */
export const withoutRoutineBlock = (content: string) => content.replace(BLOCK, '').replace(/```routine\b[\s\S]*$/, '').replace(/\n`{1,3}r?o?u?t?i?n?e?$/, '').trim();
