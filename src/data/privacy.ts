// «Names hidden» (7 Nov 2026, his request): before a question leaves the browser, the names and identifiers in it —
// in the documents, the conversation and the agent's reference material — are replaced by placeholders such as
// [PERSON 1] or [COMPANY 2]. The AI never sees them, and the answer shows the real names again when it comes back.
// Everything is found here, in the browser, by patterns (no service reads the text first): titles and party
// definitions for people, legal-form suffixes for companies, the shapes of e-mail addresses and of phone, IBAN, card
// and identity numbers, street addresses, and runs of capitalised words inside a sentence. The user sees the list,
// can keep any item visible and can add their own.
import { AGENT_LIMITS, type AgentRunRequest } from '../../shared/agents.ts';

export type HiddenKind = 'person' | 'company' | 'email' | 'phone' | 'iban' | 'card' | 'id' | 'address' | 'custom';
export type HiddenItem = { text: string; kind: HiddenKind; placeholder: string; aliases: string[] };
/** A conversation's choice: on or off (unset: the workspace setting), words the user always hides, items kept visible. */
export type PrivacyChoice = { on?: boolean; hide?: string[]; keep?: string[]; /** Photos may go to the AI though names in them cannot be hidden. */ photos?: boolean };

const LABEL: Record<HiddenKind, string> = { person: 'PERSON', company: 'COMPANY', email: 'EMAIL', phone: 'PHONE', iban: 'IBAN', card: 'CARD', id: 'ID NUMBER', address: 'ADDRESS', custom: 'HIDDEN' };
export const KIND_NAME: Record<HiddenKind, string> = { person: 'Name', company: 'Company', email: 'E-mail', phone: 'Phone', iban: 'IBAN', card: 'Card number', id: 'ID number', address: 'Address', custom: 'Added by you' };
const PLACEHOLDER = /\[(PERSON|COMPANY|EMAIL|PHONE|IBAN|CARD|ID NUMBER|ADDRESS|HIDDEN) (\d{1,4})\]/gi;

/** Lower case, no accents, single spaces: how two spellings of one name are compared. */
export const foldName = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

// Capitalised words that are not names: the vocabulary of contracts, reports and official documents, places that are
// not private, months and days. A run of capitalised words is split at them (English and Greek, compared folded).
const STOP = new Set(`
the this that these those a an and or nor of in on at to for by with from under over into onto between among upon
any all each every both either neither no not if as is are was were be been being will shall may must should would
could can it its our we us you your their they them he she him his her hers i my me mine who whom which what where
when why how here there than then so such per via also only same other another new old dear yours sincerely regards
january february march april may june july august september october november december jan feb mar apr jun jul aug
sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun
agreement agreements contract contracts deed deeds lease leases licence license policy policies schedule schedules
appendix appendices annex annexes exhibit exhibits clause clauses section sections article articles part parts chapter
paragraph paragraphs subsection regulation regulations directive directives decision act acts law laws code codes
rule rules order orders statute statutes bill treaty convention protocol constitution charter guidance guidelines
court courts tribunal judge judges justice supreme high district appeal appeals administrative family criminal civil
commercial labour labor employment industrial disputes ministry minister department office authority authorities
commission commissioner council committee board bank central european union republic kingdom united states state
government national federal international general annual extraordinary ordinary meeting meetings resolution resolutions
shareholder shareholders director directors company companies limited ltd group holding holdings partner partners
partnership services service solutions systems technologies technology trust fund funds foundation association society
institute university school college hospital clinic centre center party parties seller sellers buyer buyers purchaser
vendor landlord tenant lessor lessee employer employee employees contractor subcontractor client clients customer
customers supplier suppliers licensor licensee borrower lender lenders guarantor beneficiary trustee trustees executor
plaintiff defendant applicant respondent claimant appellant complainant accused prosecution police data protection
privacy personal information terms term conditions condition notice notices letter memo memorandum report reports
summary table figure note notes item items list date dates effective commencement completion period payment payments
price prices fee fees total amount tax taxes vat income revenue profit loss balance sheet statement statements account
accounts invoice receipt budget forecast plan plans strategy project projects product products team teams manager
management executive chief officer officers ceo cfo coo cto head senior junior lead human resources finance financial
marketing sales operations legal compliance risk risks health safety quality security support care north south east
west northern southern eastern western great saint st street road avenue lane house building floor suite unit block
tower plaza square park city town county region province island islands page pages version draft final copy signed
signature signatures witness whereas now therefore recitals recital definitions definition interpretation governing
jurisdiction dispute arbitration confidentiality termination liability indemnity warranties warranty representations
force majeure assignment miscellaneous entire severability waiver counterparts amendment amendments background
introduction conclusion conclusions recommendation recommendations purchase sale supply services loan facility
framework master distribution agency franchise consultancy joint venture share shares capital equity debt credit
interest principal security guarantee mortgage charge pledge insurance policyholder insurer insured claim claims
premium cover risk audit auditor auditors review analysis assessment overview objective objectives scope method
methodology results findings key performance indicator indicators next steps action actions owner owners status
executive summary appendix question questions answer answers yes contents index glossary reference references
cyprus greece england wales scotland ireland britain france germany italy spain portugal netherlands belgium austria
switzerland europe european america american british greek cypriot english french german italian spanish russian
nicosia limassol larnaca paphos famagusta kyrenia athens thessaloniki london paris berlin brussels luxembourg york
email e-mail tel telephone phone mobile fax website web online internet google microsoft apple amazon linkedin
mr mrs ms miss mx dr prof sir dame lord lady κος κα κυριος κυρια δρ
ο η το οι τα του της των τον την τους τις και ή σε στο στη στην στον στα στις από για με κατά ως προς υπό επί δια
νομος νομου νομων αρθρο αρθρου αρθρα κεφαλαιο εδαφιο παραγραφος δικαστηριο δικαστηριου ανωτατο ανωτατου επαρχιακο
επαρχιακου εφετειο διοικητικο δημοκρατια δημοκρατιας κυπριακη κυπριακης κυπρος κυπρου ελλαδα ελλαδας ελληνικη
εταιρεια εταιρειας συμφωνια συμφωνιας συμβαση συμβασης μερος μερη πωλητης αγοραστης εκμισθωτης μισθωτης εργοδοτης
εργοδοτουμενος εναγων εναγομενος αιτητης αιτητρια υπουργειο υπουργος τμημα αρχη επιτροπη συμβουλιο γενικη συνελευση
λευκωσια λεμεσος λαρνακα παφος αμμοχωστος κερυνεια αθηνα ευρωπαικη ενωση ευρωπαικης ενωσης κανονισμος οδηγια
ιανουαριου φεβρουαριου μαρτιου απριλιου μαιου ιουνιου ιουλιου αυγουστου σεπτεμβριου οκτωβριου νοεμβριου δεκεμβριου
ιανουαριος φεβρουαριος μαρτιος απριλιος μαιος ιουνιος ιουλιος αυγουστος σεπτεμβριος οκτωβριος νοεμβριος δεκεμβριος
δευτερα τριτη τεταρτη πεμπτη παρασκευη σαββατο κυριακη
`.trim().split(/\s+/));
const isStop = (word: string) => STOP.has(foldName(word.replace(/[.'’-]+$/, '')));

const NAME_PART = String.raw`(?:[\p{Lu}][\p{Ll}'’-]+|[\p{Lu}]\.)`;
const PARTICLE = String.raw`(?:of|de|del|della|der|den|van|von|da|di|du|la|le|bin|ibn|του|της)`;
const SUFFIX = String.raw`(?:Ltd|LTD|Limited|LIMITED|LLC|L\.L\.C\.|Inc|INC|Incorporated|PLC|Plc|plc|LLP|L\.P\.|GmbH|GMBH|AG|S\.A\.|SA|SAS|SARL|S\.r\.l\.|Srl|SpA|S\.p\.A\.|B\.V\.|BV|N\.V\.|NV|Pty|Corp|Corporation|Co\.|ΛΤΔ|Λτδ|Λίμιτεδ|Α\.Ε\.|ΑΕ|Ε\.Π\.Ε\.|ΕΠΕ|Ι\.Κ\.Ε\.|ΙΚΕ)`;
const ENDS_WITH_SUFFIX = new RegExp(String.raw`[ \t,]${SUFFIX}\.?$`, 'u');

const EMAIL = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
const IBAN = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])/g;
const CARD = /(?<![\d-])[2-6]\d{3}(?:[ -]?\d{4}){2}[ -]?\d{1,7}(?![\d])/g;
const PHONE_INTL = /(?<![\p{L}\p{N}+])(?:\+|00)[1-9]\d{0,2}(?:[ .-]?\(?\d{1,4}\)?){2,5}(?![\p{N}])/gu;
const PHONE_SAID = /(?:(?<![\p{L}])(?:tel|telephone|phone|mobile|mob|cell|fax)|τηλ(?:έφωνο)?|κιν(?:ητό)?)\.?[ \t]*(?:no\.?|number|αρ\.?)?[ \t]*[:.]?[ \t]*(\+?\(?\d[\d \t().-]{5,18}\d)/giu;
const ID_SAID = /(?:(?<![\p{L}])(?:passport(?: no| number)?|identity card(?: no| number)?|id card(?: no| number)?|id no|id number|identity no|identity number|national id(?: no| number)?|tax id(?: no| number)?|tin|tic|vat no|vat number|vat reg(?:istration)? no|social security(?: no| number)?|ssn|national insurance(?: no| number)?|ni no|ni number|registration no|registration number|reg\. no)|α\.?[ \t]?δ\.?[ \t]?τ\.?|αρ(?:ιθμός|ιθμ\.|\.)?[ \t]*(?:δελτίου[ \t]+)?ταυτότητας|ταυτότητα|διαβατήριο|α\.?[ \t]?φ\.?[ \t]?μ\.?|αρ\.?[ \t]*φορολογικ\S*|αρ\.?[ \t]*εγγραφής)[ \t]*(?:no\.?|number|αρ\.?|#)?[ \t]*[:.]?[ \t]*((?:[A-ZΑ-Ω]{1,4}[ -]?)?\d[\dA-Z -]{2,16}[\dA-Z])/giu;
const COMPANY_REG = /(?<![\p{L}\p{N}])(?:HE|ΗΕ)[ \t]?\d{3,7}(?![\p{N}])/gu;
const NI_NUMBER = /(?<![A-Za-z0-9])[A-CEGHJ-PR-TW-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D](?![A-Za-z0-9])/g;
const SSN = /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g;
const ADDRESS_NUMBER_FIRST = /(?<![\p{L}\p{N}])\d{1,5}[A-Za-z]?,?[ \t]+(?:[\p{Lu}][\p{L}'’.-]*[ \t]+){0,3}(?:Street|St\.|Road|Rd\.|Avenue|Ave\.|Lane|Drive|Boulevard|Blvd\.|Close|Crescent|Square|Terrace|Place|Way|Gardens|Grove|Mews|Row)(?![\p{L}])/gu;
const ADDRESS_NAME_FIRST = /(?<![\p{L}\p{N}])(?:[\p{Lu}][\p{L}'’.-]*[ \t]+){1,3}(?:Street|Road|Avenue|Lane|Boulevard|Οδός|Λεωφόρος)[ \t]+\d{1,5}[A-Za-z]?(?![\p{N}])/gu;
const ADDRESS_GREEK = /(?:Οδός|Οδ\.|Λεωφόρος|Λεωφ\.|Πλατεία)[ \t]+(?:[\p{Lu}][\p{L}'’.-]*[ \t]*){1,4}\d{1,4}[\p{L}]?/gu;
const ADDRESS_POSTCODE = /(?<![\p{L}\p{N}])(?:[\p{Lu}][\p{L}'’.-]+[ \t]+){1,3}\d{1,4}[A-Za-z]?,[ \t]*\d{4,5}[ \t]+[\p{Lu}][\p{L}-]+/gu;
const COMPANY = new RegExp(String.raw`(?<![\p{L}\p{N}])((?:(?:[\p{Lu}\p{N}][\p{L}\p{N}&'’.-]*|&)[ \t]+){1,5}${SUFFIX})(?![\p{L}])`, 'gu');
const TITLED = new RegExp(String.raw`(?:(?<![\p{L}])(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Sir|Dame|Lord|Lady)\.?|(?<![\p{L}])(?:κ\.|κος|κα|Κος|Κα|Κύριος|Κυρία|κύριος|κυρία|Δρ\.?))[ \t]+(${NAME_PART}(?:[ \t]+(?:${NAME_PART}|${PARTICLE})){0,3})`, 'gu');
const PARTY = new RegExp(String.raw`(${NAME_PART}(?:[ \t]+(?:${NAME_PART}|${PARTICLE})){1,5})[ \t]*(?:,[^()\n]{0,100}?)?\([ \t]*(?:hereinafter[ \t]+(?:referred[ \t]+to[ \t]+as[ \t]+|called[ \t]+)?|εφεξής[ \t]+|στο εξής[ \t]+|καλούμενος[ \t]+|καλούμενη[ \t]+)?(?:the[ \t]+|ο[ \t]+|η[ \t]+|το[ \t]+)?["“'‘«]`, 'gu');
const RUN = new RegExp(String.raw`(?<![\p{L}\p{N}])${NAME_PART}(?:[ \t]+(?:${NAME_PART}|${PARTICLE}))*[ \t]+${NAME_PART}(?![\p{L}\p{N}])`, 'gu');

const digits = (value: string) => value.replace(/\D/g, '');
function ibanValid(value: string): boolean {
  const code = value.replace(/\s/g, ''); if (code.length < 15 || code.length > 34) return false;
  let rest = 0;
  for (const char of code.slice(4) + code.slice(0, 4)) { const n = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55); for (const d of n) rest = (rest * 10 + Number(d)) % 97; }
  return rest === 1;
}
function luhn(value: string): boolean {
  const ds = digits(value); if (ds.length < 13 || ds.length > 19 || /^(\d)\1+$/.test(ds)) return false;
  let sum = 0; for (let i = 0; i < ds.length; i++) { let d = Number(ds[ds.length - 1 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}

type Found = { text: string; kind: HiddenKind; at: number };
/** A run of capitalised words is a name only inside a sentence: a heading (the run alone on its line), a case name
 *  («Smith v Jones») and the vocabulary of documents are not. The run is split at stop words; a part of two or more
 *  words remains a name. */
function nameRuns(text: string, out: Found[]) {
  for (const match of text.matchAll(RUN)) {
    const at = match.index ?? 0; const run = match[0];
    const lineStart = text.lastIndexOf('\n', at - 1) + 1; const lineEnd = (end => end < 0 ? text.length : end)(text.indexOf('\n', at + run.length));
    const before = text.slice(lineStart, at); const after = text.slice(at + run.length, lineEnd);
    if (/^[\s\d.)(•*–#-]*$/.test(before) && /^[\s:.–-]*$/.test(after)) continue;
    if (/^\s+(?:v|vs|κατά)\.?\s/u.test(after) || /\s(?:v|vs|κατά)\.?\s+$/u.test(before)) continue;
    let part: string[] = []; let offset = at; let cursor = at;
    const flush = () => { const words = part.filter(word => !/^(?:of|de|del|della|der|den|van|von|da|di|du|la|le|bin|ibn|του|της)$/.test(word)); if (words.length >= 2 && !words.every(word => /^\p{Lu}\.$/u.test(word))) out.push({ text: part.join(' '), kind: 'person', at: offset }); part = []; };
    for (const word of run.split(/[ \t]+/)) {
      const here = text.indexOf(word, cursor); cursor = here + word.length;
      if (isStop(word)) { flush(); continue; }
      if (!part.length) offset = here;
      part.push(word);
    }
    flush();
  }
}

function detect(text: string): Found[] {
  const out: Found[] = [];
  const add = (kind: HiddenKind, value: string | undefined, at: number) => { const clean = value?.trim().replace(/[.,;:]+$/, ''); if (clean && clean.length > 1) out.push({ text: clean, kind, at }); };
  for (const m of text.matchAll(EMAIL)) add('email', m[0], m.index ?? 0);
  for (const m of text.matchAll(IBAN)) if (ibanValid(m[0])) add('iban', m[0], m.index ?? 0);
  for (const m of text.matchAll(CARD)) if (luhn(m[0])) add('card', m[0], m.index ?? 0);
  for (const m of text.matchAll(PHONE_INTL)) { const n = digits(m[0]).length; if (n >= 8 && n <= 15) add('phone', m[0], m.index ?? 0); }
  for (const m of text.matchAll(PHONE_SAID)) { const n = digits(m[1]).length; if (n >= 7 && n <= 15) add('phone', m[1], (m.index ?? 0) + m[0].indexOf(m[1])); }
  for (const m of text.matchAll(ID_SAID)) if (digits(m[1]).length >= 4) add('id', m[1], (m.index ?? 0) + m[0].indexOf(m[1]));
  for (const pattern of [COMPANY_REG, NI_NUMBER, SSN]) for (const m of text.matchAll(pattern)) add('id', m[0], m.index ?? 0);
  for (const pattern of [ADDRESS_NUMBER_FIRST, ADDRESS_NAME_FIRST, ADDRESS_GREEK, ADDRESS_POSTCODE]) for (const m of text.matchAll(pattern)) add('address', m[0], m.index ?? 0);
  for (const m of text.matchAll(COMPANY)) {
    // «The Alpha Trading Ltd», «Between Alpha Ltd»: the sentence's own words before the name are not part of it.
    const words = m[1].split(/[ \t]+/); while (words.length > 1 && isStop(words[0]) && !ENDS_WITH_SUFFIX.test(` ${words[0]}`)) words.shift();
    if (words.length >= 2) add('company', words.join(' '), (m.index ?? 0) + m[1].indexOf(words[0]));
  }
  for (const m of text.matchAll(PARTY)) {
    const words = m[1].split(/[ \t]+/); while (words.length && isStop(words[0])) words.shift();
    const name = words.join(' ');
    if (words.length && !words.every(isStop)) add(ENDS_WITH_SUFFIX.test(` ${name}`) ? 'company' : 'person', name, (m.index ?? 0) + m[0].indexOf(words[0]));
  }
  for (const m of text.matchAll(TITLED)) { const words = m[1].split(/[ \t]+/); while (words.length && isStop(words.at(-1)!)) words.pop(); if (words.length && !isStop(words[0])) add('person', words.join(' '), (m.index ?? 0) + m[0].indexOf(m[1])); }
  nameRuns(text, out);
  return out;
}
// The same document is read on every question and on every change of the list: its findings are kept.
const detected = new Map<string, Found[]>();
function detectKept(text: string): Found[] {
  const kept = detected.get(text); if (kept) return kept;
  const found = detect(text);
  if (detected.size > 60) detected.delete(detected.keys().next().value!);
  detected.set(text, found); return found;
}

/** Everything to hide in these texts, numbered by kind in the order it first appears. The texts are given in the
 *  order the AI reads them (reference material, documents, conversation), so the numbering is stable per request. */
export function findPrivate(texts: string[], choice: PrivacyChoice = {}): HiddenItem[] {
  const keep = new Set((choice.keep ?? []).map(foldName));
  const found: (Found & { order: number })[] = [];
  texts.forEach((text, index) => { if (text) for (const item of detectKept(text)) found.push({ ...item, order: index * 1e9 + item.at }); });
  for (const word of choice.hide ?? []) if (word.trim()) found.push({ text: word.trim(), kind: 'custom', at: 0, order: -1 });
  // Companies before people (a company's name without its suffix is not a person), full names before single words.
  const rank: Record<HiddenKind, number> = { custom: 0, email: 1, iban: 1, card: 1, phone: 1, id: 1, address: 2, company: 3, person: 4 };
  found.sort((a, b) => rank[a.kind] - rank[b.kind] || b.text.split(/\s+/).length - a.text.split(/\s+/).length || a.order - b.order);
  const items: (HiddenItem & { order: number })[] = []; const taken = new Map<string, HiddenItem & { order: number }>();
  for (const item of found) {
    const key = foldName(item.text);
    if (keep.has(key)) continue;
    const already = taken.get(key);
    if (already) { already.order = Math.min(already.order, item.order); continue; }
    // A name inside a hidden company, address or e-mail is hidden with it.
    if (item.kind === 'person' && items.some(other => other.kind !== 'person' && other.kind !== 'custom' && ` ${foldName(other.text)} `.includes(` ${key} `))) continue;
    const aliases: string[] = [];
    if (item.kind === 'company') { const bare = item.text.replace(new RegExp(String.raw`,?[ \t]+${SUFFIX}\.?$`, 'u'), ''); if (bare !== item.text && bare.split(/\s+/).length >= 2) aliases.push(bare); }
    if (item.kind === 'person') { const words = item.text.split(/\s+/); const last = words.at(-1)!; if (words.length >= 2 && last.length >= 3 && !isStop(last)) aliases.push(last); if (words.length >= 3) aliases.push(`${words[0]} ${last}`); }
    const entry = { text: item.text, kind: item.kind, placeholder: '', aliases: aliases.filter(alias => !keep.has(foldName(alias)) && !taken.has(foldName(alias))), order: item.order };
    items.push(entry); taken.set(key, entry); for (const alias of entry.aliases) taken.set(foldName(alias), entry);
  }
  items.sort((a, b) => a.order - b.order);
  const counts: Partial<Record<HiddenKind, number>> = {};
  return items.map(({ order: _order, ...item }) => ({ ...item, placeholder: `[${LABEL[item.kind]} ${(counts[item.kind] = (counts[item.kind] ?? 0) + 1)}]` }));
}

const escape = (value: string) => value.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&').replace(/\s+/g, String.raw`\s+`);
/** The two directions: what the AI is sent, and the answer as the user reads it. */
export function makeMasker(items: HiddenItem[]): { mask(text: string): string; restore(text: string): string; count: number } {
  const forms = new Map<string, string>();
  for (const item of items) for (const form of [item.text, ...item.aliases]) { const key = foldName(form); if (!forms.has(key)) forms.set(key, form); }
  const placeholderOf = new Map<string, string>();
  for (const item of items) for (const form of [item.text, ...item.aliases]) { const key = foldName(form); if (!placeholderOf.has(key)) placeholderOf.set(key, item.placeholder); }
  const back = new Map(items.map(item => [item.placeholder.toUpperCase(), item.text]));
  const pattern = forms.size ? new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${[...forms.values()].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\p{L}\p{N}])`, 'giu') : null;
  return {
    count: items.length,
    mask: text => pattern && text ? text.replace(pattern, match => placeholderOf.get(foldName(match)) ?? match) : text,
    restore: text => text ? text.replace(PLACEHOLDER, (match, kind: string, n: string) => back.get(`[${kind.toUpperCase()} ${n}]`) ?? match) : text,
  };
}

/** Texts within a total budget (a placeholder can be a little longer than the name it replaces); empty ones go. */
function within<T extends { name: string; text: string }>(files: T[], limit: number): T[] {
  let left = limit;
  return files.map(file => { const text = file.text.slice(0, Math.max(0, left)); left -= text.length; return { ...file, name: file.name.slice(0, 200), text }; }).filter(file => file.text.trim());
}
/** A run request as the AI may see it: every name and number of the reference material, the documents and the
 *  conversation replaced by the same placeholders, the limits kept, and the flag that tells the server so. Without a
 *  choice (names shown) the request goes as it is. `restore` puts the names back into what comes back. */
export function maskRunRequest(request: AgentRunRequest, choice: PrivacyChoice | null): { request: AgentRunRequest; restore(text: string): string; count: number } {
  if (!choice) return { request, restore: text => text, count: 0 };
  const { agent, messages, documents, house } = request;
  const houseTexts = house ? [house.tone, house.positions, ...house.rules, ...house.files.flatMap(file => [file.name, file.text])] : [];
  const masker = makeMasker(findPrivate([...houseTexts, ...(agent.lessons ?? []), ...agent.knowledge.flatMap(file => [file.name, file.text]), ...documents.flatMap(file => [file.name, file.text]), ...messages.map(message => message.content)], choice));
  if (!masker.count) return { request, restore: masker.restore, count: 0 };
  const { mask } = masker;
  return { count: masker.count, restore: masker.restore, request: { ...request, anonymised: true,
    agent: { ...agent, ...(agent.lessons ? { lessons: agent.lessons.map(lesson => mask(lesson).slice(0, AGENT_LIMITS.houseRule)) } : {}), knowledge: within(agent.knowledge.map(file => ({ name: mask(file.name), text: mask(file.text) })), AGENT_LIMITS.knowledgeChars) },
    messages: messages.map(message => ({ ...message, content: mask(message.content).slice(0, AGENT_LIMITS.messageChars) })),
    documents: within(documents.map(file => ({ name: mask(file.name), text: mask(file.text) })), AGENT_LIMITS.documentChars),
    ...(house ? { house: { tone: mask(house.tone).slice(0, AGENT_LIMITS.houseTone), positions: mask(house.positions).slice(0, AGENT_LIMITS.housePositions),
      rules: house.rules.map(rule => mask(rule).slice(0, AGENT_LIMITS.houseRule)), files: within(house.files.map(file => ({ name: mask(file.name), text: mask(file.text) })), AGENT_LIMITS.houseFileChars) } } : {}) } };
}
