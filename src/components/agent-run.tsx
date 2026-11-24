// An agent at work (reference agent-studio.tsx, AgentRunPage + AgentConversation + AgentHomePanels + AgentHistoryMenu):
// its home with the composer and starters, its conversations with their documents, answers with their official
// sources, and the official page beside the conversation. Also the editor's test.
import React, { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, ChevronLeft, ChevronRight, FileSpreadsheet, GraduationCap, Mail, Wand2, ArrowRight, ArrowUp, ArrowUpRight, AtSign, Check, ChevronDown, Clock, Copy, FileText, Globe, Heart, History, Loader2, MessageSquare, MessageSquareText, Paperclip, Pencil, Plus, ShieldCheck, ShieldOff, Send, Sparkles, Square, Trash2, X } from 'lucide-react';
import { MailPanel, mailHue, splitSender, type MailTarget } from './mail-panel.tsx';
import { readSites } from '../../shared/routine-sentence.ts';
import { askReply, isAskStarting, parseAsk, type AskQuestion } from '../../shared/ask-block.ts';
import { assistantParts, isAssistant } from '../../shared/assistant.ts';
import { routineOffer, withoutRoutineBlock, type RoutineOffer } from '../../shared/routine-offer.ts';
import { eventEnd, readAction, unseenAddresses, type AppAction } from '../../shared/app-actions.ts';
import { carryOut } from '../data/app-action.ts';
import { BRIEFS } from '../../shared/briefs.ts';
import { feedHost, scheduleLabel, siteDomain, type RoutineInput } from '../../shared/routines.ts';
import { listRoutines, runRoutineNow, saveRoutine } from '../data/routines.ts';
import { ConnectionLogo } from './connection-logos.tsx';
import { CONNECTOR_BY_ID, type ConnectorId } from '../../shared/connections.ts';
import { connectService, disconnectService, listConnections, watchConnection, ConnectionsError } from '../data/connections.ts';
import { AGENT_LIMITS, isMailAgent, type AgentDefinition, type AgentRunRequest } from '../../shared/agents.ts';
import { placeName, sourceHost } from '../../shared/official-sources.ts';
import { buildAgentDesign, RunError, runAgentTurn, teachLessons } from '../data/api.ts';
import { LESSON_LIMITS, redoMessage, type Lesson } from '../../shared/teach.ts';
import { agentChats, agentTurns, deleteChat, findAgent, findChat, fitDocuments, houseForRun, readHouse, addHouseRule, addLessons, readLessons, saveLessons, saveAgent, useStoreVersion, newChat, readChats, readFavourites, readMyAgents, readyAgents, restoreChat, saveChat, type AgentChat, type ChatDocument, type ChatMessage, type Citation, type Settings } from '../data/store.ts';
import { findPrivate, makeMasker, maskRunRequest, type PrivacyChoice } from '../data/privacy.ts';
import { isPhoto, PHOTO_LIMIT, readPhoto, type Photo } from '../data/photos.ts';
import { AnswerActions, readableAnswer } from './answer-actions.tsx';
import { BatchPanel, batchSources, batchSummary, type BatchSource } from './batch-panel.tsx';
import { pastedTable, sheetCsvUrl } from '../../shared/table-rows.ts';
import { linksIn, pageDocument } from '../data/page-links.ts';
import { PrivacyPanel } from './privacy-panel.tsx';
import { SlashMenu, slashItems, slashToken, type SlashItem } from './slash-menu.tsx';
import { fieldById } from '../../shared/fields.ts';
import { AgentExplain, categoryLabel } from './library.tsx';
import { jurisdictionName, readFiles, searchablePlaces, ToolBar, whenLabel } from './nomos-chrome.tsx';
import { OfficialPageReader, OfficialSourcesList, SourcesSummary } from './official-sources-list.tsx';
import { OfficialWebsiteViewer } from './official-website-viewer.tsx';
import { keepFile, keptFile } from '../data/file-store.ts';
import { DocumentPassageReader } from './document-passage.tsx';
import { openProof, ProofAnswer } from './proof-view.tsx';

/** The agent's history and documents under its composer, drawn as the chat home's two panels. */
/** A conversation's title from its first question (13 Nov 2026: «…CFO of Helios Freight (240 staff, L» was cut mid-word,
 *  and links filled the list): links shown as their site, cut at a word, with «…» when shortened. */
function chatTitle(question: string): string {
  const clean = question.replace(/https?:\/\/(?:www\.)?([^/\s?#]+)\S*/g, '($1)').replace(/\s+/g, ' ').trim();
  if (clean.length <= 80) return clean;
  const cut = clean.slice(0, 78); const at = cut.lastIndexOf(' ');
  return `${(at > 40 ? cut.slice(0, at) : cut).replace(/[\s,;:(–-]+$/, '')}…`;
}

function AgentHomePanels({ chats, onOpen, onDelete, deleted, onUndo, built, onOpenAgent }: { chats: AgentChat[]; onOpen(id: string): void; onDelete(id: string): void; deleted?: AgentChat | null; onUndo?(): void; /** Ask Agents' page: the agents the person built, newest first. */ built?: AgentDefinition[]; onOpenAgent?(id: string): void }) {
  const [allBuilt, setAllBuilt] = useState(false);
  const [all, setAll] = useState(false);
  const rows = all ? chats : chats.slice(0, 3);
  // The documents given to this agent, newest first, each with the chat it was given in.
  const documents = useMemo(() => {
    const seen = new Set<string>(); const out: { name: string; chatId: string; chat: string; when: number }[] = [];
    for (const chat of chats) for (const message of [...chat.messages].reverse()) for (const name of message.documents ?? []) {
      if (seen.has(name)) continue; seen.add(name); out.push({ name, chatId: chat.id, chat: chat.title, when: chat.updatedAt });
    }
    return out;
  }, [chats]);
  const [allDocs, setAllDocs] = useState(false);
  return <div className={`nomos-home-continue mn-agent-home-panels${built ? ' has-agents' : ''}`}>
    {built && <section className="nomos-home-panel" aria-label="Your agents">
      <h2><span>Your agents</span><small>{built.length ? `${built.length} built` : 'None yet'}</small></h2>
      {built.length ? <ul>{(allBuilt ? built : built.slice(0, 3)).map(item => <li key={item.id}>
        <button type="button" onClick={() => onOpenAgent?.(item.id)}>
          <span className="nomos-home-panel-icon"><Sparkles size={14} aria-hidden="true" /></span>
          <span className="nomos-home-panel-text"><b>{item.name}</b><span>{item.description}</span></span>
          <span className="nomos-home-panel-when">{whenLabel(item.updatedAt || item.createdAt)}</span>
        </button></li>)}</ul> : <p className="nomos-home-panel-empty">Agents you build from here will appear here.</p>}
      {built.length > 3 && <button type="button" className="nomos-home-panel-all" onClick={() => setAllBuilt(value => !value)}>{allBuilt ? 'Fewer' : 'All your agents'}<ArrowRight size={13} aria-hidden="true" /></button>}
    </section>}
    <section className="nomos-home-panel" aria-label="History">
      <h2><span>History</span><small>{chats.length ? `${rows.length} of ${chats.length} conversation${chats.length === 1 ? '' : 's'}` : 'No conversations yet'}</small></h2>
      {chats.length ? <ul>{rows.map(chat => <li key={chat.id} className="mn-agent-panel-row">
        <button type="button" onClick={() => onOpen(chat.id)}>
          <span className="nomos-home-panel-icon"><MessageSquareText size={14} aria-hidden="true" /></span>
          <span className="nomos-home-panel-text"><b>{chat.title}</b><span>{(asked => `${asked} ${asked === 1 ? 'question' : 'questions'}`)(chat.messages.filter(message => message.role === 'user').length)}</span></span>
          <span className="nomos-home-panel-when">{whenLabel(chat.updatedAt)}</span>
        </button>
        <button type="button" className="mn-agent-panel-delete" onClick={() => onDelete(chat.id)} aria-label={`Delete ${chat.title}`}><Trash2 size={13} aria-hidden="true" /></button>
      </li>)}</ul> : <p className="nomos-home-panel-empty">Your conversations with this agent will appear here.</p>}
      {deleted && onUndo && <p className="mn-agent-panel-undo" role="status">Deleted: {deleted.title}<button type="button" onClick={onUndo}>Undo</button></p>}
      {chats.length > 3 && <button type="button" className="nomos-home-panel-all" onClick={() => setAll(value => !value)}>{all ? 'Fewer' : 'All conversations'}<ArrowRight size={13} aria-hidden="true" /></button>}
    </section>
    <section className="nomos-home-panel" aria-label="Documents">
      <h2><span>Documents</span><small>Given to this agent</small></h2>
      {documents.length ? <ul>{(allDocs ? documents : documents.slice(0, 3)).map(doc => <li key={doc.name}>
        <button type="button" onClick={() => onOpen(doc.chatId)}>
          <span className="nomos-home-panel-icon is-document"><FileText size={14} aria-hidden="true" /></span>
          <span className="nomos-home-panel-text"><b>{doc.name}</b><span>{doc.chat}</span></span>
          <span className="nomos-home-panel-when">{whenLabel(doc.when)}</span>
        </button></li>)}</ul> : <p className="nomos-home-panel-empty">Documents you give the agent will appear here.</p>}
      {documents.length > 3 && <button type="button" className="nomos-home-panel-all" onClick={() => setAllDocs(value => !value)}>{allDocs ? 'Fewer' : 'All documents'}<ArrowRight size={13} aria-hidden="true" /></button>}
    </section>
  </div>;
}

/** Inside a chat, the top bar's «History»: another chat is one click away, without going back to the agent's home. */
function AgentHistoryMenu({ chats, active, onOpen }: { chats: AgentChat[]; active?: string; onOpen(id: string): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  // The top bar scrolls sideways (overflow-x), which clips anything below it: the list is placed against the window.
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const toggle = () => {
    const rect = root.current?.getBoundingClientRect();
    if (!open && rect) setPlace({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('resize', close); return () => window.removeEventListener('resize', close);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return <span ref={root} className="mn-agent-history-menu">
    <button type="button" className="nomos-btn" aria-haspopup="menu" aria-expanded={open} aria-label="History" onClick={toggle}><History size={14} aria-hidden="true" /><span>History</span><ChevronDown size={13} aria-hidden="true" /></button>
    {open && <span className="mn-agent-history-list" role="menu" style={place ? { position: 'fixed', top: place.top, right: place.right } : undefined}>{chats.slice(0, 30).map(chat => <button key={chat.id} type="button" role="menuitem" aria-current={chat.id === active ? 'true' : undefined} onClick={() => { onOpen(chat.id); setOpen(false); }}>
      <MessageSquareText size={14} aria-hidden="true" /><span>{chat.title}</span><small>{whenLabel(chat.updatedAt)}</small></button>)}</span>}
  </span>;
}

/** «Teach it» (12 Nov 2026, his «where can I find the lessons»): the button on an agent's page that opens its lessons
 *  in the right panel (13 Nov: a small drop-down that scrolled was not liked). Shown only when there are some. */
function AgentLessonsButton({ agentId, onOpen }: { agentId: string; onOpen(): void }) {
  useStoreVersion();
  const count = readLessons(agentId).length;
  if (!count) return null;
  return <button type="button" className="nomos-btn" onClick={onOpen} title="What this agent learned from your feedback">
    <GraduationCap size={14} aria-hidden="true" /><span>Lessons</span><b className="mn-lessons-count">{count}</b></button>;
}

/** The lessons in the right panel, at reading width: numbered, each with Forget, and a line to add one by hand. */
function LessonsPanel({ agentId, agentName, onClose }: { agentId: string; agentName: string; onClose(): void }) {
  useStoreVersion();
  const lessons = readLessons(agentId);
  const [text, setText] = useState('');
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  const add = () => { const line = text.trim(); if (!line) return; if (addLessons(agentId, [line])) setText(''); };
  return <aside ref={panel} tabIndex={-1} className="mn-document-source-reader mn-run-panel mn-lessons-panel" aria-label={`Lessons of ${agentName}`}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <header className="mn-run-head">
      <div><h2>Lessons</h2><p>{agentName} follows {lessons.length === 1 ? 'this' : `these ${lessons.length}`} in every chat and checks each answer against {lessons.length === 1 ? 'it' : 'them'}.</p></div>
      <button type="button" className="nomos-gov-uk-web-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="mn-run-body">
      {lessons.length ? <ol className="mn-hs-rules">{lessons.map(lesson => <li key={lesson}><span>{lesson}</span>
        <button type="button" onClick={() => saveLessons(agentId, lessons.filter(other => other !== lesson))} aria-label={`Forget: ${lesson}`} title="Forget"><X size={14} aria-hidden="true" /></button></li>)}</ol>
        : <p className="mn-lessons-empty">No lessons left. Press «Teach it» under an answer to teach it again.</p>}
      <form className="mn-lessons-add" onSubmit={event => { event.preventDefault(); add(); }}>
        <input value={text} onChange={event => setText(event.target.value)} maxLength={LESSON_LIMITS.chars} placeholder="Add a lesson, e.g. Always give a 14-day deadline" aria-label="A new lesson" />
        <button type="submit" className="nomos-btn is-primary" disabled={!text.trim() || lessons.length >= LESSON_LIMITS.perAgent}><Plus size={14} aria-hidden="true" /><span>Add</span></button>
      </form>
      <p className="mn-lessons-panel-note">Lessons for every agent are in House style, in the left bar.</p>
    </div>
  </aside>;
}

type RunProps = { agent: AgentDefinition; chatId?: string; favourite: boolean; settings: Settings; onBack(): void; onEdit(): void; onFavourite(): void; onOpenChat(id: string): void; onNewChat(): void; onJurisdiction?(code: string): void; /** A conversation started on this page was saved for the first time. */ onSavedChat?(id: string): void;
  /** A task brought from the library's «Tell me the task»: it waits in the box of the first new conversation. */ prefill?: string; files?: File[]; onOpenAgent?(id: string): void; onPrivacy?(): void;
  /** The assistant's page: the prefill is sent at once; an agent it picked opens with the task; an agent it offers is built. */ autoSend?: boolean; onUseAgent?(id: string, task: string, files?: File[]): void; onBuild?(description: string): void };

/** The conversation's files (11 Nov 2026): tick the ones the next question takes; the rest stay for later questions. */
function FilesMenu({ documents, off, onToggle, onAll, onRemove, onAttach, onClose, disabled }: { documents: ChatDocument[]; off: Set<string>; onToggle(id: string): void; onAll(on: boolean): void; onRemove(id: string): void; onAttach(): void; onClose(): void; disabled: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node) && !(event.target as Element).closest?.('.mn-files-pill')) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', away); window.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', key); };
  }, [onClose]);
  const size = (file: ChatDocument) => file.pages ? `${file.pages} page${file.pages === 1 ? '' : 's'}` : `${Math.max(1, Math.round(file.text.length / 1000))}k characters`;
  const on = documents.filter(file => !off.has(file.id)).length;
  return <div ref={box} className="mn-files-menu" role="dialog" aria-label="Files in this conversation">
    <p className="mn-files-head"><b>Files in this conversation</b><span>{on} of {documents.length} go with your next question</span></p>
    <ul>{documents.map(file => <li key={file.id} data-off={off.has(file.id)}>
      <label><input type="checkbox" checked={!off.has(file.id)} onChange={() => onToggle(file.id)} disabled={disabled} />
        <FileText size={14} aria-hidden="true" /><span><b title={file.name}>{file.name}</b><small>{size(file)}{file.truncated ? ' · only the first part is read' : ''}</small></span></label>
      <button type="button" onClick={() => onRemove(file.id)} disabled={disabled} aria-label={`Remove ${file.name}`} title="Remove from the conversation"><X size={13} aria-hidden="true" /></button></li>)}</ul>
    <p className="mn-files-foot">
      <button type="button" onClick={() => onAll(true)} disabled={disabled || on === documents.length}>All</button>
      <button type="button" onClick={() => onAll(false)} disabled={disabled || on === 0}>None</button>
      <button type="button" className="is-attach" onClick={onAttach} disabled={disabled}><Plus size={13} aria-hidden="true" />Attach more</button></p>
  </div>;
}

/** «Thinking · 1:20» (11 Nov 2026): the stage and the time so far, so a long review never looks frozen. */
function ThinkingLine({ status, since, long }: { status: string; since: number; long: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const seconds = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  return <p className="mn-agent-thinking" role="status"><Loader2 size={14} className="is-spinning" aria-hidden="true" />
    <span>{status}… <time>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</time></span>
    {seconds >= 45 && <small>{long ? 'A full review of a long document takes 1–4 minutes. The answer appears as soon as it starts writing.' : 'Still working. The answer appears as soon as it starts writing.'}</small>}</p>;
}

export function AgentRunPage({ agent, chatId, favourite, settings, onEdit, onFavourite, onOpenChat, onNewChat, onJurisdiction, onSavedChat, prefill, files, onOpenAgent, onPrivacy, autoSend, onUseAgent, onBuild }: RunProps) {
  const own = isAssistant(agent);
  const [chats, setChats] = useState<AgentChat[]>(() => agentChats(agent.id));
  // The chat in the URL, or the one this page saved; a new chat is always a fresh page, even when the last was never saved.
  const [savedHere, setSavedHere] = useState<string | undefined>();
  const [fresh, setFresh] = useState(0);
  const active = chatId ?? savedHere;
  const chat = chats.find(item => item.id === active);
  // The page's key changes only when another chat or a new one opens: the first save of a new chat must not remount it,
  // or the documents attached to it were lost before the follow-up question.
  const page = chatId ?? `new-${fresh}`;
  const newChatPage = () => { setSavedHere(undefined); setFresh(value => value + 1); onNewChat(); };
  // The page now shown: a conversation that finishes after the user moved to another one must not take it over.
  const shownPage = useRef(page); shownPage.current = page;
  const conversationPage = page;
  // A deleted conversation can be brought back for a few seconds.
  const [deleted, setDeleted] = useState<AgentChat | null>(null);
  useEffect(() => { if (!deleted) return; const timer = window.setTimeout(() => setDeleted(null), 8000); return () => window.clearTimeout(timer); }, [deleted]);
  const remove = (id: string) => { setDeleted(deleteChat(id) ?? null); setChats(agentChats(agent.id)); if (active === id) newChatPage(); };
  const undo = () => { if (!deleted) return; restoreChat(deleted); setChats(agentChats(agent.id)); setDeleted(null); };
  /** «Lessons» pressed: the conversation opens them in its right panel (each press counts, so it opens again after a close). */
  const [lessonsAsk, setLessonsAsk] = useState(0);
  return <div className="nomos-tool-scroll mn-agents is-run">
    {/* No back arrow on an agent's page (12 Nov 2026, his request): the library is one click away in the side menu. */}
    <ToolBar icon={Sparkles} title={agent.name}
      end={<span className="mn-agents-bar-actions">
        {!own && <button type="button" className="nomos-btn mn-agent-heart-btn" aria-pressed={favourite} onClick={onFavourite} title={favourite ? 'Remove from favourites' : 'Add to favourites'} aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}><Heart size={14} aria-hidden="true" fill={favourite ? 'currentColor' : 'none'} /></button>}
        <AgentLessonsButton agentId={agent.id} onOpen={() => setLessonsAsk(n => n + 1)} />
        {chats.length > 0 && <AgentHistoryMenu chats={chats} active={active} onOpen={onOpenChat} />}
        <button type="button" className="nomos-btn" aria-label="New chat" onClick={newChatPage}><Plus size={15} aria-hidden="true" /><span>New chat</span></button>
        {!own && <button type="button" className="nomos-btn" aria-label={agent.origin === 'ready' ? 'Customise' : 'Edit'} onClick={onEdit}>{agent.origin === 'ready' ? <><Copy size={14} aria-hidden="true" /><span>Customise</span></> : <><Pencil size={14} aria-hidden="true" /><span>Edit</span></>}</button>}
      </span>} />
    <AgentConversation key={page} agent={agent} chat={chat} settings={settings} openLessons={lessonsAsk} onJurisdiction={onJurisdiction} initialDraft={!chatId && fresh === 0 ? prefill : undefined} initialFiles={!chatId && fresh === 0 ? files : undefined} onNewChat={newChatPage} onOpenAgent={onOpenAgent} onPrivacy={onPrivacy}
      autoSend={autoSend && !chatId && fresh === 0} onUseAgent={onUseAgent} onBuild={onBuild}
      onSaved={saved => { setChats(agentChats(agent.id)); if (shownPage.current === conversationPage && !chatId && savedHere !== saved.id) { setSavedHere(saved.id); onSavedChat?.(saved.id); } }}
      home={<AgentHomePanels chats={chats} onOpen={onOpenChat} onDelete={remove} deleted={deleted} onUndo={undo}
        {...(own ? { built: readMyAgents().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), onOpenAgent } : {})} />} />
  </div>;
}

/** The websites an agent searches besides the official ones: its own list, or, for an agent made before the list
 *  existed, the ones its name and description call for («Cyprus crime news» → the Cyprus newspapers). */
const sitesOf = (agent: Pick<AgentDefinition, 'name' | 'description' | 'sites'>): string[] => agent.sites ?? readSites(`${agent.name}. ${agent.description}`);

type Reader = { kind: 'official'; source: Citation; /** A proof's quote: the page opens at those words. */ quote?: string }
  | { kind: 'document'; name: string; text: string; start: number; end: number; exact: boolean }
  | { kind: 'mail'; mail: MailTarget }
  | { kind: 'lessons' }
  | { kind: 'batch'; link?: string };
const NOTICES: Record<string, string> = {
  not_configured: 'The AI connection is not configured: put OPENAI_API_KEY in .env.local and restart the server.',
  no_server: 'The server routes did not answer (run the app with npm run dev or deploy the api/ routes).',
  jurisdiction_unknown: 'The agent refused the request: its jurisdiction is not in the catalogue.',
  invalid_input: 'The agent refused the request. Check its settings (name, instructions, jurisdiction) and try again.',
  request_too_large: 'The documents or reference material are too large for one question. Remove one and try again.',
  agent_unavailable: 'AI is not connected on this server yet. Settings → AI connection shows what is missing.',
};

/** Space kept above a question the view stops at while its answer is written. */
const FOLLOW_GAP = 16;
/** The box that scrolls a message: the nearest parent that scrolls, else the page. */
function scrollBox(from: HTMLElement): HTMLElement {
  for (let node = from.parentElement; node; node = node.parentElement) { if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node; }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** An agent's conversation: the empty page with its starters, the messages, documents and the composer. Also the editor's test. */
export function AgentConversation({ agent, chat, settings, onSaved, onJurisdiction, test = false, home, initialDraft, initialFiles, onNewChat, onOpenAgent, onPrivacy, autoSend, onUseAgent, onBuild, openLessons = 0 }: { /** Counts the page's «Lessons» presses: each opens the lessons in the right panel. */ openLessons?: number; autoSend?: boolean; onUseAgent?(id: string, task: string, files?: File[]): void; onBuild?(description: string): void; onPrivacy?(): void; initialFiles?: File[]; agent: AgentDefinition; chat?: AgentChat; settings: Settings; onSaved?(chat: AgentChat): void; onJurisdiction?(code: string): void; test?: boolean; home?: React.ReactNode; initialDraft?: string; onNewChat?(): void; onOpenAgent?(id: string): void }) {
  const [base] = useState<AgentChat>(() => chat ?? newChat(agent));
  const own = isAssistant(agent);
  const [messages, setMessages] = useState<ChatMessage[]>(chat?.messages ?? []);
  const [documents, setDocuments] = useState<ChatDocument[]>(chat?.documents ?? []);
  // The documents as they are now, for a save that happens after a long answer (one attached meanwhile is kept).
  const docsNow = useRef(documents); docsNow.current = documents;
  // The messages as they are now, for work that ends later (13 Nov 2026, code review: «Every row» finishing wrote over a
  // question asked while it ran).
  const messagesNow = useRef(messages); messagesNow.current = messages;
  const lastQuestion = messages.map(message => message.role).lastIndexOf('user');
  /** The list with the «done» marks of action cards as they are now (a card can finish while an answer runs). */
  const withDone = (list: ChatMessage[]) => { const done = new Map(messagesNow.current.filter(item => item.actions?.some(action => action.done)).map(item => [item.at, item.actions])); return done.size ? list.map(item => item.actions && done.has(item.at) ? { ...item, actions: done.get(item.at) } : item) : list; };
  // Files kept in the conversation but left out of the next question (11 Nov 2026, his «select or deselect some of them»).
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [filesOpen, setFilesOpen] = useState(false);
  const ticked = documents.filter(file => !off.has(file.id));
  // The document a «Tracked changes» file is made from: the Word file attached last, else the last document.
  const markedUp = [...documents].reverse().find(file => /\.docx$/i.test(file.name)) ?? documents.at(-1);
  // Photos travel with the next question only (they are not kept with the conversation: a phone's storage is small).
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoWarning, setPhotoWarning] = useState(false);
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // When this answer started, for the honest timer under «Thinking» (11 Nov 2026, his «5 minutes didn't answer yet»).
  const [since, setSince] = useState(0);
  const [notice, setNotice] = useState('');
  /** 12 Nov 2026 (a new user's dead end): the question waits for a place, and the place is picked right in the notice. */
  const [placeNeeded, setPlaceNeeded] = useState(false);
  // ✦ «How it works»: the steps for this agent's page — what to upload, what to ask, what comes back.
  const [guide, setGuide] = useState(false);
  const [reader, setReader] = useState<Reader | null>(null);
  // «Lessons» on the page's bar (a press made before this conversation mounted does not open it again).
  const lessonsSeen = useRef(openLessons);
  useEffect(() => { if (openLessons !== lessonsSeen.current) { lessonsSeen.current = openLessons; setReader({ kind: 'lessons' }); } }, [openLessons]);
  // The fade under the fifth starter while more are below; gone once the list is scrolled to its end.
  const [starterFade, setStarterFade] = useState(agent.starters.length > 5);
  // The conversation's jurisdiction: the agent's, else the workspace's; never a default — an unset one is asked for first.
  const [jurisdiction, setJurisdiction] = useState(chat?.jurisdiction || agent.jurisdiction || settings.jurisdiction || '');
  // The editor's test follows the form: change the jurisdiction there and the test runs with it at once.
  useEffect(() => { if (test) setJurisdiction(agent.jurisdiction || settings.jurisdiction || ''); }, [test, agent.jurisdiction, settings.jurisdiction]);
  const abort = useRef<AbortController | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // A task brought from the library («Tell me the task») waits in the box, the caret at its end.
  useEffect(() => { const box = input.current; if (initialDraft && box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } }, []);
  // «Names hidden» (7 Nov 2026): this conversation's choice, else the workspace setting; what would be hidden now.
  const [privacy, setPrivacy] = useState<PrivacyChoice>(chat?.privacy ?? {});
  const hiding = privacy.on ?? settings.hideNames;
  const [privacyOpen, setPrivacyOpen] = useState(false);
  // «/»: a picked agent answers the next question in this conversation; the rest of the page stays this agent's.
  const [called, setCalled] = useState<AgentDefinition | null>(null);
  const runner = called ?? agent;
  const typed = useDeferredValue(draft);
  const hiddenNow = useMemo(() => hiding ? findPrivate([...runner.knowledge.flatMap(file => [file.name, file.text]), ...documents.flatMap(file => [file.name, file.text]), ...messages.map(message => message.content), typed], privacy) : [],
    [hiding, privacy, runner, documents, messages.length, typed]);
  const changePrivacy = (next: PrivacyChoice) => {
    setPrivacy(next);
    // A conversation already saved keeps the choice at once, without waiting for its next question.
    const stored = test ? undefined : findChat(base.id);
    if (stored) saveChat({ ...stored, privacy: next });
  };
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const token = slashToken(draft, caret);
  const slashKey = token ? `${token.start}:${draft.slice(0, token.start)}` : '';
  const others = useMemo(() => test ? [] : [...readMyAgents(), ...readyAgents()], [test]);
  const slash = useMemo(() => token ? slashItems(token.query, { agent, agents: others, favourites: readFavourites(), recent: [...new Set(readChats().map(item => item.agentId))], test, hiding, mention: token.mention }) : [],
    [token?.query, token?.start, token?.mention, others, hiding, agent, test]);
  useEffect(() => setActive(0), [token?.query, token?.start]);
  useEffect(() => () => abort.current?.abort(), []);
  // Only a conversation follows its newest message; the agent's home opens at its top.
  useEffect(() => { if (messages.length) end.current?.scrollIntoView?.({ block: 'end' }); }, [messages.length]);
  // 13 Nov 2026 (his «I ask, it answers, and then my question disappears»): the view jumped to the end of every finished
  // answer, so a long one pushed the question off the top. While an answer is written the view follows it only until
  // the question reaches the top; nothing moves when it ends, and a scroll by the person stops the following.
  const lastAsked = useRef<HTMLDivElement>(null);
  const follow = useRef<{ top: number | null; off: boolean }>({ top: null, off: false });
  useEffect(() => { if (busy) follow.current = { top: null, off: false }; }, [busy]);
  useLayoutEffect(() => {
    const question = lastAsked.current, tail = end.current, state = follow.current;
    if (!busy || state.off || !question || !tail) return;
    const box = scrollBox(question);
    if (state.top !== null && Math.abs(box.scrollTop - state.top) > 2) { state.off = true; return; }
    const whole = box === document.scrollingElement; const frame = box.getBoundingClientRect();
    const by = Math.min(tail.getBoundingClientRect().bottom - (whole ? window.innerHeight : frame.bottom), question.getBoundingClientRect().top - (whole ? 0 : frame.top) - FOLLOW_GAP);
    if (by > 1) box.scrollTop += by;
    state.top = box.scrollTop;
  }, [messages, busy]);
  const place = jurisdictionName(jurisdiction);
  const language = chat?.language ?? settings.language;
  // The material an answer's «ref» proofs quote: the answering agent's reference files and the house templates.
  const referenceOf = (message: ChatMessage) => [...((message.agent ? findAgent(message.agent.id)?.knowledge : agent.knowledge) ?? []), ...readHouse().files];
  const openLink = (event: React.MouseEvent, message: ChatMessage) => {
    // A proof mark opens its source at the quoted words.
    const proof = event.target instanceof Element ? event.target.closest<HTMLElement>('.mn-proof-mark[data-proof]') : null;
    if (proof) {
      event.preventDefault(); event.stopPropagation();
      const target = openProof(message.content, Number(proof.dataset.proof), documents, referenceOf(message));
      opener.current = proof;
      if (target?.kind === 'document') setReader(target);
      else if (target?.kind === 'page') setReader({ kind: 'official', source: { title: sourceHost(target.url) ?? target.url, url: target.url, site: sourceHost(target.url) ?? '' }, quote: target.quote });
      else if (target?.kind === 'missing') setNotice(target.text);
      return;
    }
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || !/^https?:\/\//i.test(link.href) || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();
    const href = link.href;
    // Every website opens beside the answer (12 Nov 2026): official sources as before, any other public page in the
    // same viewer for a signed-in person; the viewer offers «Open on the site» when a page will not show inside.
    const cited = [...message.sources ?? [], ...message.consulted ?? []].find(source => source.url === href);
    opener.current = link;
    setReader({ kind: 'official', source: cited ?? { title: link.textContent?.trim() || href, url: href, site: sourceHost(href) ?? new URL(href).hostname.replace(/^www\./, '') } });
  };
  // The citation that opened the reader gets the focus back when it closes, so the keyboard stays where it was.
  const opener = useRef<HTMLElement | null>(null);
  const closeReader = () => { setReader(null); const back = opener.current; opener.current = null; if (back?.isConnected) back.focus(); };
  // While documents are being read the question waits: sent earlier, it went without them.
  const [reading, setReading] = useState(0);
  const attach = async (all: File[]) => {
    if (!all.length) return;
    setNotice('Reading documents…'); setReading(count => count + 1);
    try {
      // Photos are scaled down here and go to the AI as images; everything else is read as a document.
      const pictures = all.filter(isPhoto); const files = all.filter(file => !isPhoto(file));
      if (pictures.length) {
        const read = (await Promise.all(pictures.map(file => readPhoto(file).catch(() => null)))).filter((photo): photo is Photo => !!photo);
        setPhotos(current => [...current, ...read].slice(0, PHOTO_LIMIT));
        if (!files.length) { setNotice(read.length < pictures.length ? 'Some photos could not be read (JPEG, PNG or WebP).' : photos.length + read.length > PHOTO_LIMIT ? `At most ${PHOTO_LIMIT} photos with one question.` : ''); return; }
      }
      const read = await readFiles(files);
      // The original of each file, for the right panel's true view of it (src/data/file-store.ts).
      for (const doc of read) { const original = files.find(file => file.name === doc.name); if (original) void keepFile(doc.id, original); }
      // The same file attached again replaces its earlier copy rather than doubling it; beyond the cap, the rest are
      // not attached and the notice says so.
      const next = [...docsNow.current];
      for (const doc of read) { const at = next.findIndex(item => item.name === doc.name); if (at >= 0) next[at] = doc; else next.push(doc); }
      const over = Math.max(0, next.length - AGENT_LIMITS.documents);
      setDocuments(next.slice(0, AGENT_LIMITS.documents));
      setNotice(read.length < files.length ? 'Some files could not be read (PDF, Word, Excel or text).'
        : over ? `At most ${AGENT_LIMITS.documents} documents in one conversation: ${over === 1 ? 'the last one was' : `the last ${over} were`} not attached.` : '');
    } finally { setReading(count => count - 1); }
  };
  const menuOpen = !!token && slash.length > 0 && dismissed !== slashKey && !busy;
  const place_caret = (at: number) => window.requestAnimationFrame(() => { const box = input.current; if (box) { box.focus(); box.setSelectionRange(at, at); setCaret(at); } });
  const pick = (item: SlashItem | undefined) => {
    if (!item || !token) return;
    const before = draft.slice(0, token.start); const rest = `${before}${draft.slice(caret).replace(/^\s+/, before && !/\s$/.test(before) ? ' ' : '')}`;
    if (item.kind === 'starter') { setDraft(item.text); place_caret(item.text.length); return; }
    setDraft(rest); place_caret(before.length);
    if (item.kind === 'agent') { setCalled(item.agent); setNotice(''); return; }
    if (item.id === 'documents') picker.current?.click();
    else if (item.id === 'names') changePrivacy({ ...privacy, on: !hiding });
    else if (item.id === 'guide') setGuide(true);
    else if (item.id === 'new') onNewChat?.();
  };
  const keyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (menuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : slash.length - 1)) % slash.length); return; }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') { event.preventDefault(); pick(slash[active]); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(slashKey); return; }
    }
    if (event.key === 'Backspace' && called && !draft && event.currentTarget.selectionStart === 0) { setCalled(null); return; }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(draft); }
  };
  // A question brought to the assistant (Today's box) is asked at once. On a timer: React's development StrictMode
  // runs effects twice, and the first run's clean-up cancels its timer.
  // With files (an agent opened by Ask Agents' «Use»), the files are read first, then the task is asked.
  // 13 Nov 2026: never into a conversation that already has messages (a remount had sent the task a second time and
  // swallowed the answer being typed).
  useEffect(() => { if (!autoSend || !initialDraft?.trim() || initialFiles?.length || (chat?.messages.length ?? 0) > 0) return; const timer = window.setTimeout(() => { void sendNow.current(initialDraft); }, 0); return () => window.clearTimeout(timer); }, []);
  // Files shared from another app («Share to Agents») are attached as the page opens.
  useEffect(() => {
    if (!initialFiles?.length || (chat?.messages.length ?? 0) > 0) return;
    let live = true;
    const timer = window.setTimeout(() => { void attach(initialFiles).then(() => { if (live && autoSend && initialDraft?.trim()) window.setTimeout(() => { if (live) void sendNow.current(initialDraft); }, 50); }); }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, []);
  // A second Enter before React re-renders must not send the question twice: the ref changes at once, the state later.
  const sending = useRef(false);
  const send = async (text: string, options: { search?: boolean } = {}) => {
    const question = text.trim(); if (!question || busy || reading || sending.current) return;
    // «Turn on live search» (13 Nov 2026) sends its check before the saved agent comes back through the page.
    const searchNow = runner.officialSearch || !!options.search;
    // Only an agent that researches needs a place: it searches that place's official sources and nothing else. An
    // agent asked with «/» works in this conversation's place, else its own.
    // A country named in the question wins over the one the conversation started with (12 Nov 2026: «a tenancy in
    // Cyprus» ran on Australia's sources, left over from an earlier pick).
    const placeNamed = namedPlace(question);
    if (placeNamed && placeNamed !== jurisdiction) { setJurisdiction(placeNamed); setPlaceNeeded(false); }
    const code = placeNamed || jurisdiction || (called?.jurisdiction ?? '');
    const where = jurisdictionName(code);
    if (!code && searchNow) { setPlaceNeeded(true); setNotice(`Choose where: ${called ? `«${called.name}»` : 'the agent'} researches only that place’s official sources.`); return; }
    // Names cannot be hidden inside a photo: the user says once per conversation that photos may go as they are.
    if (photos.length && hiding && !privacy.photos) { setPhotoWarning(true); return; }
    sending.current = true;
    // «Paste a link» (13 Nov 2026): a link in the question is read first and joins the conversation's files.
    const links = linksIn(question).filter(link => !documents.some(file => file.text.includes(link)));
    let pageFiles: ChatDocument[] = [];
    // 13 Nov 2026 (code review): reading a linked page showed nothing and could not be stopped for up to 45 s. The answer
    // starts at once, with Stop; a stop while the page is read leaves the question in the box.
    const controller = new AbortController(); abort.current = controller;
    if (links.length) {
      setMessages([...messages, { role: 'user', content: question, at: Date.now() }, { role: 'assistant', content: '', at: Date.now() }]); setDraft(''); setBusy(true); setSince(Date.now()); setNotice('');
      setStatus(links.length === 1 ? 'Reading the page you linked' : 'Reading the pages you linked');
      pageFiles = await Promise.all(links.map(async link => {
        const read = await fetch(`/api/official-page?url=${encodeURIComponent(link)}&open=1`, { signal: controller.signal }).then(response => response.ok && /json/.test(response.headers.get('content-type') ?? '') ? response.json() : null).catch(() => null);
        // Never stuck: a page that fails to convert is attached as «not readable» (13 Nov 2026, code review).
        let page: { name: string; text: string }; try { page = pageDocument(link, read && typeof read.html === 'string' ? read : null); } catch { page = pageDocument(link, null); }
        return { id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: page.name, text: page.text, truncated: page.text.length >= 60_000, size: page.text.length };
      }));
      if (controller.signal.aborted) { setMessages(messages); setDraft(question); setBusy(false); setStatus(''); abort.current = null; sending.current = false; return; }
      setDocuments(current => { const next = [...current, ...pageFiles]; docsNow.current = next; return next; });
    }
    const sentPhotos = photos;
    const by = called ? { agent: { id: called.id, name: called.name } } : {};
    const named = [...ticked.map(file => file.name), ...pageFiles.map(file => file.name), ...sentPhotos.map(photo => photo.name)];
    const asked: ChatMessage = { role: 'user', content: question, at: Date.now(), ...(named.length ? { documents: named } : {}), ...by };
    // A question left without an answer (a chat saved before failed turns were dropped) is replaced, not repeated.
    const history = [...(messages.at(-1)?.role === 'user' ? messages.slice(0, -1) : messages), asked];
    setMessages([...history, { role: 'assistant', content: '', at: Date.now() }]); setDraft(''); setBusy(true); setStatus(ticked.length || pageFiles.length ? 'Reading your documents and the question' : 'Reading your question'); if (!links.length) setSince(Date.now()); setNotice('');
    let answer = ''; let final: ChatMessage | null = null; let restore = (value: string) => value;
    try {
      // Names hidden: everything the AI reads goes through the same placeholders, numbered for this request; the
      // answer is shown with the real names put back.
      // The house style (7 Nov 2026) goes with every question; it is masked with everything else.
      const house = houseForRun();
      const masked = maskRunRequest({ agent: { name: runner.name, instructions: runner.instructions, jurisdiction: code, officialSearch: searchNow, mode: runner.mode, knowledge: runner.knowledge, ...(runner.needs.trim() ? { needs: runner.needs.slice(0, AGENT_LIMITS.needs) } : {}), ...(sitesOf(runner).length ? { sites: sitesOf(runner) } : {}), ...(lessonsOf(runner.id).length ? { lessons: lessonsOf(runner.id) } : {}) },
        messages: agentTurns(history), documents: fitDocuments([...ticked, ...pageFiles], question), language, model: settings.model, ask: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(house ? { house } : {}),
        ...(sentPhotos.length ? { images: sentPhotos.map(photo => ({ name: photo.name, dataUrl: photo.dataUrl })) } : {}) }, hiding ? privacy : null);
      // The app's assistant also gets the person's own agents (they live in this browser), to pick from.
      const request: AgentRunRequest = own && !called ? { ...masked.request, assistant: true, mine: readMyAgents().slice(0, 100).map(item => ({ id: item.id, name: item.name, description: item.description.slice(0, 600) })) } : masked.request; restore = masked.restore;
      const done = await runAgentTurn(request, {
        onDelta: delta => { answer += delta; setMessages([...history, { role: 'assistant', content: restore(answer), at: Date.now(), ...by }]); },
        onReset: () => { answer = ''; setMessages([...history, { role: 'assistant', content: '', at: Date.now(), ...by }]); },
        // Honest stages: searching, then thinking (the model reasons before its first word), then the text itself.
        onStatus: event => setStatus(current => event.text === 'planning' ? 'Working out what this needs' : event.text === 'checking' ? 'Checking the answer' : event.text === 'revising' ? 'Improving the answer'
          : event.text === 'searching' ? `Searching the official sources · ${where.name}`
          : event.text === 'searched' ? 'Thinking it through with the sources'
          // Your apps (11 Nov 2026): what is being read, live, then the writing.
          : event.text === 'reading' && event.app ? (event.count !== undefined ? `Read ${event.count} item${event.count === 1 ? '' : 's'} in ${event.app}` : `Reading ${event.app}`)
          : event.text === 'writing' ? 'Writing the answer from your apps' : current),
      }, controller.signal);
      const gaps = done.gaps.map(restore);
      // An answer with no text (the search found nothing, the model stopped) is not kept as an empty bubble.
      if (!(done.answer || answer).trim()) { setNotice(gaps.join(' ') || 'The agent gave no answer. Please try again.'); throw new RunError('empty_answer'); }
      final = { role: 'assistant', content: restore(done.answer || answer), at: Date.now(), ...(done.sources.length ? { sources: done.sources } : {}), ...(done.consulted.length ? { consulted: done.consulted } : {}), ...(gaps.length ? { gaps } : {}), ...(done.searches ? { searches: done.searches } : {}), ...(done.apps?.length ? { apps: done.apps } : {}), ...(done.mails?.length ? { mails: done.mails } : {}), ...(done.actions?.length ? { actions: done.actions } : {}), ...by };
    } catch (error) {
      const reason = error instanceof RunError ? error.code : '';
      final = answer.trim() ? { role: 'assistant', content: restore(answer), at: Date.now(), gaps: ['The answer was interrupted.'], ...by } : null;
      if (!answer && reason !== 'empty_answer') setNotice(controller.signal.aborted ? 'Stopped.'
        : reason === 'jurisdiction_unsupported' ? `No official sources are catalogued for ${where.name}: research there is unsupported. Choose another jurisdiction.`
        : NOTICES[reason] ?? 'The agent did not answer. Please try again.');
    } finally {
      // A question that got no answer is not kept (a lone question broke every later turn): it goes back into the box.
      // 13 Nov 2026 (code review): a card sent or added while this answer ran keeps its «done» mark (it showed «Send» again).
      const next = withDone(final ? [...history, final] : history.slice(0, -1));
      if (!final) setDraft(current => current || question);
      setMessages(next); setBusy(false); setStatus(''); abort.current = null; sending.current = false;
      // The agent asked with «/» answers one question; a question that got no answer keeps it for the retry.
      if (final) { setCalled(null); setPhotos(current => current.filter(photo => !sentPhotos.includes(photo))); }
      if (!test && final) {
        const saved: AgentChat = { ...base, title: (chat?.title || base.title || chatTitle(question)).slice(0, 80), messages: next, documents: docsNow.current, jurisdiction: code || jurisdiction, language, updatedAt: Date.now(), privacy };
        if (saveChat(saved)) onSaved?.(saved); else setNotice('This conversation could not be saved: the browser storage is full. Delete old conversations or agents.');
      }
    }
  };
  const sendNow = useRef(send); sendNow.current = send;
  // «Teach it» (12 Nov 2026, shared/teach.ts): the feedback redoes the answer at once, and the lessons in it are worked
  // out beside it and offered above the box; nothing is kept without the person's click.
  const [lessonCard, setLessonCard] = useState<LessonCardState | null>(null);
  const teachAbort = useRef<AbortController | null>(null);
  useEffect(() => () => teachAbort.current?.abort(), []);
  const teach = (feedback: string, answer: string) => {
    const said = feedback.trim(); if (!said || busy) return;
    void send(redoMessage(said));
    if (test) return;
    teachAbort.current?.abort(); const controller = new AbortController(); teachAbort.current = controller;
    setLessonCard({ agentId: agent.id, agentName: agent.name, status: 'learning', lessons: [] });
    // Names hidden: the answer and the feedback go through placeholders like every question; the lessons come back with the names restored.
    let output = readableAnswer(answer).slice(0, LESSON_LIMITS.output); let words = said.slice(0, LESSON_LIMITS.feedback); let restore = (text: string) => text;
    if (hiding) { const masker = makeMasker(findPrivate([output, words], privacy)); output = masker.mask(output).slice(0, LESSON_LIMITS.output); words = masker.mask(words).slice(0, LESSON_LIMITS.feedback); restore = masker.restore; }
    void teachLessons({ agent: agent.name.slice(0, LESSON_LIMITS.agent), output: output || '(empty)', feedback: words, language }, controller.signal).then(
      lessons => { if (!controller.signal.aborted) setLessonCard(card => card && card.status === 'learning' ? { ...card, status: lessons.length ? 'ready' : 'none', lessons: lessons.map(lesson => ({ text: restore(lesson.text), every: lesson.every, keep: true })) } : card); },
      () => { if (!controller.signal.aborted) setLessonCard(card => card && card.status === 'learning' ? { ...card, status: 'failed' } : card); });
  };
  const keepLessons = (card: LessonCardState) => {
    const kept = card.lessons.filter(lesson => lesson.keep && lesson.text.trim());
    const mine = kept.filter(lesson => !lesson.every).map(lesson => lesson.text); const every = kept.filter(lesson => lesson.every).map(lesson => lesson.text);
    const ok = (!mine.length || addLessons(card.agentId, mine)) && every.every(rule => addHouseRule(rule));
    if (!ok) { setNotice('The lessons were not saved: the browser storage is full.'); return; }
    setLessonCard({ ...card, status: 'kept', kept: { mine: mine.length, every: every.length } });
  };
  // «Every row» (13 Nov 2026): the tables among the conversation's files, a request for one row, and the results back in the chat.
  // 13 Nov 2026: rows pasted into the box from Excel or Google Sheets count too; kept as they were when «Every row» opened.
  const pasted = useMemo(() => own ? null : pastedTable(draft), [own, draft]);
  const [pastedKept, setPastedKept] = useState<BatchSource | null>(null);
  const pastedSource = pastedKept ?? (pasted ? { id: 'pasted', label: 'the table you pasted', table: pasted.table } : null);
  const tables = useMemo(() => own ? [] : [...(pastedSource ? [pastedSource] : []), ...batchSources(ticked)], [own, ticked.map(file => file.id).join(','), pastedSource?.table]);
  const [batchHidden, setBatchHidden] = useState('');
  const [batchOpen, setBatchOpen] = useState<{ link?: string } | null>(null);
  useEffect(() => { if (reader?.kind === 'batch') setBatchOpen(current => current ?? { ...(reader.link ? { link: reader.link } : {}) }); }, [reader]);
  const sheetLink = /https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,100}[^\s)]*/.exec(draft)?.[0] ?? '';
  const batchPlace = jurisdiction || (called?.jurisdiction ?? '');
  const batchRequest = (content: string) => {
    const house = houseForRun();
    const others = ticked.filter(file => !tables.some(item => item.id.startsWith(`${file.id}:`)));
    return maskRunRequest({ agent: { name: runner.name, instructions: runner.instructions, jurisdiction: batchPlace, officialSearch: runner.officialSearch, mode: 'fast', knowledge: runner.knowledge,
      ...(sitesOf(runner).length ? { sites: sitesOf(runner) } : {}), ...(lessonsOf(runner.id).length ? { lessons: lessonsOf(runner.id) } : {}) },
      messages: [{ role: 'user', content }], documents: fitDocuments(others, content), language, model: settings.model, ask: false, batch: true,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(house ? { house } : {}) }, hiding ? privacy : null);
  };
  const batchDone = (task: string, label: string, runs: { index: number; key: string; status: string; answer?: string }[], again = false) => {
    const current = messagesNow.current; const asked = `Every row of ${label}: ${task}`;
    const summary: ChatMessage = { role: 'assistant', content: batchSummary(task, label, runs as never), at: Date.now() };
    // A retry of the same run updates its summary instead of adding a second one.
    const at = again ? current.map(message => message.content).lastIndexOf(asked) : -1;
    const next: ChatMessage[] = at >= 0 && current[at + 1]?.role === 'assistant' ? current.map((message, index) => index === at + 1 ? summary : message)
      : [...current, { role: 'user', content: asked, at: Date.now() }, summary];
    messagesNow.current = next; setMessages(next);
    // The task (and a pasted sheet link or table) came from the box: it is done, so the box is cleared.
    const fromPaste = !!pastedKept; setPastedKept(null);
    setDraft(current => fromPaste || (current.trim() && (task.startsWith(current.replace(/https:\/\/docs\.google\.com\/spreadsheets\/\S+/g, '').trim().slice(0, 40)) || /docs\.google\.com\/spreadsheets/.test(current))) ? '' : current);
    if (!test) { const saved: AgentChat = { ...base, title: (chat?.title || base.title || `Every row of ${label}`).slice(0, 80), messages: next, documents: docsNow.current, jurisdiction: batchPlace || jurisdiction, language, updatedAt: Date.now(), privacy };
      if (saveChat(saved)) onSaved?.(saved); }
  };
  const choose = (code: string) => { if (!code) return; setJurisdiction(code); setNotice(''); setPlaceNeeded(false); onJurisdiction?.(code); };
  // The agent's open questions: the last message, when it is an «ask» block.
  const lastMessage = messages.at(-1);
  const asking = lastMessage?.role === 'assistant' ? parseAsk(lastMessage.content) : null;
  // «Every row»: the offer sits right above the box, on the agent's home and in a conversation alike.
  const batchOffer = !own && !test && !busy && reader?.kind !== 'batch' && (tables.some(item => item.table.rows.length >= 2) || sheetLink) && batchHidden !== (sheetLink || tables.map(item => item.id).join(','))
      ? <div className="mn-batch-offer" role="note"><FileSpreadsheet size={16} aria-hidden="true" />
          <span>{sheetLink && !tables.length ? 'Run this agent on every row of the Google Sheet you pasted.' : (best => <>{best.id === 'pasted' ? 'The table you pasted' : `«${best.label}»`} has {best.table.rows.length.toLocaleString('en-GB')} rows. Run «{runner.name}» on every row.</>)(tables.slice().sort((a, b) => b.table.rows.length - a.table.rows.length)[0])}</span>
          <button type="button" className="nomos-btn is-primary" onClick={() => { setPastedKept(pastedSource); setReader({ kind: 'batch', ...(sheetLink ? { link: sheetLink } : {}) }); }}>Every row</button>
          <button type="button" className="mn-batch-offer-x" aria-label="Not now" title="Not now" onClick={() => setBatchHidden(sheetLink || tables.map(item => item.id).join(','))}><X size={14} /></button>
        </div> : null;
  const composer = <form className="mn-agent-composer" onSubmit={event => { event.preventDefault(); void send(draft); }}>
      {guide && <AgentExplain agent={runner} language={language} kind="steps" onClose={() => setGuide(false)} />}
      {privacyOpen && <PrivacyPanel on={hiding} items={hiddenNow} choice={privacy} onChange={changePrivacy} onClose={() => setPrivacyOpen(false)} onPrivacy={onPrivacy} />}
      {called && <span className="mn-agent-called"><AtSign size={12} aria-hidden="true" /><span>This question goes to <b>{called.name}</b></span>
        <button type="button" onClick={() => setCalled(null)} aria-label={`Ask ${agent.name} instead`} title={`Ask ${agent.name} instead`}><X size={11} aria-hidden="true" /></button></span>}
      {menuOpen && <SlashMenu id={`slash-${base.id}`} items={slash} active={active} query={token?.query ?? ''} hiding={hiding} test={test} onPick={pick} onHover={setActive} />}
      {photos.length > 0 && <span className="mn-agent-docs mn-agent-photos">{photos.map(photo => <span key={photo.id}><img src={photo.dataUrl} alt="" />{photo.name}
        <button type="button" aria-label={`Remove ${photo.name}`} onClick={() => setPhotos(current => current.filter(item => item.id !== photo.id))}><X size={11} aria-hidden="true" /></button></span>)}</span>}
      {photoWarning && <p className="mn-agent-notice mn-agent-photo-warning" role="alert">Names in photos cannot be hidden: the AI reads a photo as it is.
        <button type="button" onClick={() => { setPhotoWarning(false); changePrivacy({ ...privacy, photos: true }); window.setTimeout(() => input.current?.form?.requestSubmit(), 0); }}>Send the photos</button>
        <button type="button" onClick={() => setPhotoWarning(false)}>Not now</button></p>}
      {notice && <p className="mn-agent-notice" role="status">{notice}
        {placeNeeded && <select className="mn-agent-notice-place" defaultValue="" autoFocus aria-label="Choose jurisdiction"
          onChange={event => { const code = event.target.value; if (!code) return; choose(code); window.setTimeout(() => input.current?.form?.requestSubmit(), 0); }}>
          <option value="" disabled>Choose a country or place…</option>
          {searchablePlaces().map(item => <option key={item.code} value={item.code}>{item.flag} {placeName(item, true)}</option>)}
        </select>}</p>}
      <span className="mn-agent-input">
      <textarea ref={input} value={draft} onChange={event => { setDraft(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); }} rows={test ? 2 : 3} maxLength={AGENT_LIMITS.messageChars}
        onSelect={event => setCaret(event.currentTarget.selectionStart ?? 0)}
        role="combobox" aria-autocomplete="list" aria-expanded={menuOpen} aria-controls={menuOpen ? `slash-${base.id}` : undefined} aria-activedescendant={menuOpen ? `slash-${base.id}-${active}` : undefined}
        placeholder={called ? `Your question for ${called.name}…` : isMailAgent(agent) ? 'Ask about your inbox, e.g. which e-mails need my reply first?' : agent.needs || 'Write your question or attach documents…'} aria-label="Message to the agent"
        onKeyDown={keyDown} />
      {!draft && !called && <span className="mn-agent-slash-hint" aria-hidden="true"><kbd>/</kbd> commands · <kbd>@</kbd> agents</span>}</span>
      {/* One compact row (11 Nov 2026, his «buttons flying … jurisdiction a circle with the flag»): round icons, labels as tooltips. */}
      <span className="mn-agent-composer-row is-compact">
        <button type="button" className="mn-cmp-icon" onClick={() => picker.current?.click()} disabled={busy} aria-label="Attach documents" title="Attach documents (PDF, Word, Excel, images)"><Paperclip size={15} aria-hidden="true" /></button>
        <button type="button" className="mn-cmp-icon" aria-pressed={guide} onClick={() => setGuide(value => !value)} aria-label="How it works" title="How it works (AI)"><Sparkles size={15} aria-hidden="true" /></button>
        <button type="button" className="mn-cmp-icon" aria-pressed={privacyOpen} onClick={() => setPrivacyOpen(value => !value)} aria-label={hiding ? `Names hidden${hiddenNow.length ? `: ${hiddenNow.length}` : ''}` : 'Names shown'}
          title={hiding ? 'Names hidden: names and numbers become placeholders before the AI sees anything' : 'Names are shown to the AI in this conversation'} data-off={!hiding}>
          {hiding ? <ShieldCheck size={15} aria-hidden="true" /> : <ShieldOff size={15} aria-hidden="true" />}{hiding && hiddenNow.length > 0 && <small className="mn-cmp-badge">{hiddenNow.length}</small>}</button>
        {documents.length > 0 && <span className="mn-files">
          <button type="button" className="mn-files-pill" aria-expanded={filesOpen} aria-haspopup="dialog" onClick={() => setFilesOpen(value => !value)}
            title={`${ticked.length} of ${documents.length} file${documents.length === 1 ? '' : 's'} go with your next question`}>
            <FileText size={14} aria-hidden="true" /><span>Files</span><b>{ticked.length === documents.length ? documents.length : `${ticked.length}/${documents.length}`}</b><ChevronDown size={13} aria-hidden="true" /></button>
          {filesOpen && <FilesMenu documents={documents} off={off} onToggle={id => setOff(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
            onAll={on => setOff(on ? new Set() : new Set(documents.map(file => file.id)))} onRemove={id => { setDocuments(current => current.filter(file => file.id !== id)); setOff(current => { const next = new Set(current); next.delete(id); return next; }); }}
            onAttach={() => { setFilesOpen(false); picker.current?.click(); }} onClose={() => setFilesOpen(false)} disabled={busy} />}
        </span>}
        <input ref={picker} type="file" hidden multiple accept=".pdf,.docx,.xlsx,.xlsm,.txt,.md,.csv,.jpg,.jpeg,.png,.webp" onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; void attach(files); }} />
        <span className="mn-cmp-end">
          {!own && !(isMailAgent(runner) && !runner.officialSearch) && <label className={`mn-cmp-icon mn-cmp-place${jurisdiction ? ' is-set' : runner.officialSearch ? ' is-needed' : ''}`}
            title={`${jurisdiction ? place.name : 'Choose jurisdiction'}${runner.officialSearch ? ' · searches its official sources for every answer' : jurisdiction ? ' · searches its official sources when an answer needs current law, rates or figures' : ''}`}>
            {jurisdiction ? <span className="mn-cmp-flag" aria-hidden="true">{place.flag}</span> : <Globe size={15} aria-hidden="true" />}
            {runner.officialSearch && <i className="mn-cmp-dot" aria-hidden="true" />}
            <select value={jurisdiction || ''} onChange={event => choose(event.target.value)} aria-label={jurisdiction ? `Jurisdiction: ${place.name}` : 'Choose jurisdiction'}>
              <option value="" disabled>Choose jurisdiction</option>
              {searchablePlaces().map(item => <option key={item.code} value={item.code}>{item.flag} {placeName(item, true)}</option>)}
            </select></label>}
          {runner.mode === 'deep' && <span className="mn-cmp-icon is-static" title="Deep research: takes a few minutes" aria-label="Deep research, a few minutes"><Clock size={15} aria-hidden="true" /></span>}
          {busy ? <button type="button" className="mn-agent-send" onClick={() => abort.current?.abort()} aria-label="Stop"><Square size={14} aria-hidden="true" /></button>
          : <button type="submit" className="mn-agent-send" disabled={!draft.trim() || reading > 0} aria-label="Send">{reading > 0 ? <Loader2 size={15} className="is-spinning" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}</button>}
        </span>
      </span>
    </form>;
  // Beside the conversation; the editor's narrow test keeps official pages in the overlay reader.
  const docked = reader && (!test || reader.kind === 'document') ? reader : null;
  const conversation = <section className={`mn-agent-chat${test ? ' is-test' : ''}${!messages.length && !test ? ' is-home' : ''}`} aria-label={agent.name}
    onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) event.preventDefault(); }}
    onDrop={event => { event.preventDefault(); if (!busy) void attach([...event.dataTransfer.files]); }}>
    <div className="mn-agent-chat-scroll">
      {!messages.length ? (test ? <div className="mn-agent-intro">
        <span className="mn-agent-intro-icon" aria-hidden="true"><Sparkles size={22} /></span>
        <h2>{agent.name || 'New agent'}</h2>
        {agent.description && <p>{agent.description}</p>}
        {agent.starters.length > 0 && <span className="mn-agent-starters">{agent.starters.map((starter, index) => <button key={index} type="button" onClick={() => void send(starter)} disabled={busy}>{starter}</button>)}</span>}
      </div> : <div className="mn-agent-home">
        {/* The agent's own home: one centred column — a small line, the name, what it does, the composer right under it, then its starters. */}
        {!own && <span className="mn-agent-home-eyebrow">{`${fieldById(agent.field)?.name ?? 'Legal'} Agents · ${categoryLabel(agent.category)}`}</span>}
        <h1 className="mn-agent-home-title">{(words => words.length > 1 ? <>{words.slice(0, -1).join(' ')} <em>{words.at(-1)}</em></> : <em>{agent.name}</em>)(agent.name.trim().split(/\s+/))}</h1>
        {agent.description && <p className="mn-agent-home-text">{agent.description}</p>}
        {batchOffer}{composer}
        {agent.starters.length > 0 && <div className={`mn-agent-home-starters${starterFade ? ' has-more' : ''}`} role="group" aria-label="Suggestions"
          onScroll={event => { const list = event.currentTarget; setStarterFade(list.scrollTop + list.clientHeight < list.scrollHeight - 4); }}>
          {agent.starters.map((starter, index) => <button key={index} type="button" onClick={() => void send(starter)} disabled={busy}>
            <span className="mn-agent-home-starter-icon" aria-hidden="true"><MessageSquare size={12} /></span><span>{starter}</span><ArrowUpRight size={13} aria-hidden="true" /></button>)}
        </div>}
      </div>)
      : messages.map((message, index) => message.role === 'user'
        ? <div key={index} className="mn-agent-msg is-user" ref={index === lastQuestion ? lastAsked : undefined}><p>{message.content}</p>{message.agent ? <small><AtSign size={11} aria-hidden="true" />{message.agent.name}</small> : null}{message.documents?.length ? <small className="mn-agent-msg-files"><Paperclip size={11} aria-hidden="true" />{message.documents.map((docName, at) => { const doc = documents.find(file => file.name === docName);
          // A file the person attached opens beside the chat as itself (12 Nov 2026).
          // 13 Nov 2026: a linked web page opens as the page itself in the website viewer, not as its extracted text.
          const pageUrl = /^Web page · /.test(doc?.name ?? '') ? /^https?:\/\/\S+$/m.exec(doc!.text.slice(0, 2_000))?.[0] : undefined;
          return doc ? <button key={at} type="button" title={`Open ${docName}`} onClick={event => { opener.current = event.currentTarget;
            if (pageUrl) setReader({ kind: 'official', source: { title: doc.name.replace(/^Web page · /, ''), url: pageUrl } as Citation });
            else setReader({ kind: 'document', name: doc.name, text: doc.text, start: 0, end: 0, exact: true }); }}>{docName}</button> : <span key={at}>{docName}</span>; })}</small> : null}</div>
        // An answered question needs no line of its own: the person's reply below it carries the question.
        : parseAsk(message.content) && index < messages.length - 1 ? null
        : <div key={index} className="mn-agent-msg is-agent" onClick={event => openLink(event, message)}>
          {message.agent && <button type="button" className="mn-agent-by" onClick={() => onOpenAgent?.(message.agent!.id)} disabled={!onOpenAgent} title={onOpenAgent ? `Open ${message.agent.name}` : undefined}><AtSign size={12} aria-hidden="true" />{message.agent.name}</button>}
          {/* The agent's questions (an «ask» block) show above the input, never as chat text: here only a quiet line. */}
          {parseAsk(message.content) ? <p className="mn-agent-asked"><CircleHelp size={14} aria-hidden="true" />{index === messages.length - 1 ? 'The agent has a quick question for you, just above the box.' : `Asked: ${parseAsk(message.content)!.map(item => item.question).join(' · ')}`}</p>
            : message.content && busy && index === messages.length - 1 && isAskStarting(message.content) ? <ThinkingLine status="Reading your question…" since={since} long={false} />
            // Ask Agents routes and explains: no proof bar under its answers (12 Nov 2026: «1 claim without a source» under a hand-off).
            : message.content ? <ProofAnswer content={own && !message.agent ? withoutRoutineBlock(assistantParts(message.content).text) || (busy && index === messages.length - 1 ? '…' : '') : withoutRoutineBlock(message.content)} streaming={busy && index === messages.length - 1} documents={own && !message.agent ? [] : documents} reference={referenceOf(message)} language={language} researched={!!message.searches || !!message.sources?.length} />
            : <ThinkingLine status={status || 'The agent is working'} since={since} long={documents.length > 0 || runner.mode === 'deep'} />}
          {busy && index === messages.length - 1 && message.content && /^(Checking|Improving)/.test(status) && <p className="mn-agent-checking" role="status"><Loader2 size={13} className="is-spinning" aria-hidden="true" />{status}…</p>}
          {!busy && (offer => offer ? <RoutineOfferCard offer={offer} agent={(message.agent ? findAgent(message.agent.id) : undefined) ?? agent} build={own && !message.agent} jurisdiction={jurisdiction} settings={settings} hiding={hiding} /> : null)(routineOffer(message.content))}
          {own && !message.agent && <AssistantCards content={message.content} task={messages[index - 1]?.content ?? ''} files={documents} onUse={onUseAgent} onBuild={onBuild} />}
          {message.mails?.length ? <div className="mn-mail-chips" role="group" aria-label="E-mails in this answer">{message.mails.map(mail => { const who = splitSender(mail.from).name || 'Unknown sender';
            return <button key={mail.id} type="button" className={reader?.kind === 'mail' && reader.mail.id === mail.id ? 'is-open' : ''} onClick={event => { opener.current = event.currentTarget; setReader({ kind: 'mail', mail }); }} title={`Open: ${mail.subject || 'no subject'}`}>
              <span className="mn-mail-chip-avatar" style={{ '--mail-hue': mailHue(who) } as React.CSSProperties} aria-hidden="true">{(who.match(/\p{L}|\p{N}/u)?.[0] ?? '?').toUpperCase()}</span>
              <span className="mn-mail-chip-text"><b>{who}</b><small>{mail.subject || '(no subject)'}</small></span><Mail size={14} aria-hidden="true" /></button>; })}</div> : null}
          {!busy && message.actions?.length ? <div className="mn-actions">{message.actions.map((action, at) => <ActionCard key={at} action={action}
            typed={messages.filter(item => item.role === 'user').map(item => item.content).join('\n')}
            onDone={done => { const next = messagesNow.current.map(item => item.at === message.at && item.actions ? { ...item, actions: item.actions.map((one, j) => j === at ? { ...one, ...done } : one) } : item); messagesNow.current = next; setMessages(next);
              const stored = test ? undefined : findChat(base.id); if (stored) saveChat({ ...stored, messages: next, updatedAt: Date.now() }); }} />)}</div> : null}
          {message.apps?.length ? <p className="mn-apps-used"><span>Read live from</span>{message.apps.map(app => <b key={app}>{app}</b>)}</p> : null}
          {parseAsk(message.content) ? null : message.sources?.length || message.consulted?.length ? <SourcesSummary cited={message.sources ?? []} consulted={message.consulted ?? []} onOpen={source => setReader({ kind: 'official', source })} /> : null}
          {message.gaps?.length && !parseAsk(message.content) ? <ul className="mn-agent-gaps">{message.gaps.map((gap, at) => <li key={at}>{gap}</li>)}</ul> : null}
          {/* 13 Nov 2026: a question about current law or figures answered without any search says so plainly. */}
          {message.role === 'assistant' && message.content && !own && !(busy && index === messages.length - 1) && !parseAsk(message.content) && !message.sources?.length && !message.searches && !message.apps?.length
            && messages[index - 1]?.role === 'user' && !messages[index - 1].documents?.length && FACTS.test(messages[index - 1].content)
            // 13 Nov 2026: not under the results table of «Every row» (each row is its own answer).
            && !messages[index - 1].content.startsWith('Every row of ')
            ? <p className="mn-agent-unchecked" role="note"><Globe size={13} aria-hidden="true" />Not checked online: this answer comes from the AI’s own knowledge.</p> : null}
          {/* The buttons come as soon as the words people read are done (12 Nov 2026: they came ~10 s later, while the
              hidden proof list and the assistant's cards were still being written). */}
          {message.content && (!busy || (index === messages.length - 1 && visibleDone(message.content, own && !message.agent))) && !parseAsk(message.content) && <AnswerActions title={message.agent?.name ?? agent.name} content={own && !message.agent ? withoutRoutineBlock(assistantParts(message.content).text) : withoutRoutineBlock(message.content)} sources={message.sources} original={markedUp} onNotice={setNotice}
            {...(!message.agent && !busy && index === messages.length - 1 ? { onTeach: (feedback: string) => teach(feedback, message.content) } : { noTeach: true })} />}
        </div>)}
      {/* «Turn on live search» (13 Nov 2026, his «activate real time web, edit your own agent»): asked to go online, an
          agent of his own without live search offers the switch; one press saves it and checks the last answer. */}
      {!busy && !test && !own && !called && !agent.officialSearch && messages.at(-1)?.role === 'assistant' && !messages.at(-1)?.searches && WEB_ASK.test(messages.at(-2)?.content ?? '')
        ? <p className="mn-agent-search-offer" role="note"><Globe size={15} aria-hidden="true" /><span>Live search is off for «{agent.name}».{agent.origin === 'mine'
            ? (jurisdiction ? ` Turn it on and it checks ${place.name}’s official sources for every answer.` : ' Turn it on, choose a country below, and it checks that country’s official sources for every answer.')
            : (jurisdiction ? ` Check this answer in ${place.name}’s official sources now.` : ' Choose a country below, then check this answer in its official sources.')}</span>
          <button type="button" className="nomos-btn is-primary" onClick={() => {
            // His own agent keeps live search on; a library agent checks once (Customise keeps it on for good).
            if (agent.origin === 'mine' && !saveAgent({ ...agent, officialSearch: true, updatedAt: Date.now() })) { setNotice('The agent could not be saved: the browser storage is full.'); return; }
            void send('Check your last answer online in the official sources and correct it where they say otherwise.', { search: true });
          }}>{agent.origin === 'mine' ? 'Turn on live search' : 'Check online now'}</button></p> : null}
      {!busy && messages.length > 0 && messages.at(-1)!.role === 'user' && <p className="mn-agent-unanswered" role="note">This question got no answer.
        <button type="button" onClick={() => void send(messages.at(-1)!.content)} disabled={reading > 0}>Send again</button></p>}
      {/* The panels at the chat home's own width (1080 px), outside the 820 px column. */}
      {!messages.length && !test ? home : null}
      <div ref={end} />
    </div>
    {messages.length > 0 ? batchOffer : null}
    {lessonCard && !test ? <LessonsCard card={lessonCard} onChange={setLessonCard} onKeep={keepLessons} onClose={() => { teachAbort.current?.abort(); setLessonCard(null); }} /> : null}
    {asking && !busy && !test ? <AskPanel key={messages.length} questions={asking} onAnswer={answers => void send(askReply(asking, answers))} onSkip={() => void send('Answer with your best assumptions; do not ask me again.')} onAttach={() => picker.current?.click()} /> : null}
    {messages.length > 0 || test ? composer : null}
  </section>;
  return <div className={`mn-agent-split${docked ? ' has-reader' : ''}${docked?.kind === 'mail' ? ' is-mail' : ''}`}>
    {conversation}
    {docked?.kind === 'official' && <OfficialWebsiteViewer key={`${docked.source.url}:${docked.quote ?? ''}`} url={docked.source.url} title={docked.source.title} language={language} quote={docked.quote} onClose={closeReader} />}
    {docked?.kind === 'mail' && <MailPanel key={docked.mail.id} target={docked.mail} onClose={closeReader} />}
    {/* 13 Nov 2026 (code review): opening a source or «Lessons» during a run used to unmount the panel and throw the run
        away. It stays mounted, hidden, until it is closed; «Every row» brings it back as it was. */}
    {batchOpen && <div style={{ display: docked?.kind === 'batch' ? 'contents' : 'none' }}>
      <BatchPanel key={batchOpen.link ?? 'files'} agentName={runner.name} sources={tables} initialLink={batchOpen.link} needsPlace={runner.officialSearch && !batchPlace}
      initialTask={(pasted ? pasted.rest : draft).replace(/https:\/\/docs\.google\.com\/spreadsheets\/\S+/g, '').trim() || ''} makeRequest={batchRequest} onClose={() => { setPastedKept(null); setBatchOpen(null); closeReader(); }} onFinished={(task, label, _table, runs, again) => batchDone(task, label, runs, again)} /></div>}
    {docked?.kind === 'lessons' && <LessonsPanel agentId={agent.id} agentName={agent.name} onClose={closeReader} />}
    {docked?.kind === 'document' && <DocumentPassageReader key={`${docked.name}:${docked.start}`} name={docked.name} text={docked.text} start={docked.start} end={docked.end} exact={docked.exact} fileId={documents.find(file => file.name === docked.name)?.id} onClose={closeReader} />}
    {test && reader?.kind === 'official' && <OfficialPageReader source={reader.source} language={language} onClose={closeReader} />}
  </div>;
}


/** The conversation's files as files again, for the agent «Use» opens: the original the browser kept, else the text. */
async function filesFor(documents: ChatDocument[]): Promise<File[]> {
  return Promise.all(documents.map(async doc => { const kept = await keptFile(doc.id);
    return kept ? new File([kept.blob], kept.name, { type: kept.type }) : new File([doc.text], doc.name.replace(/\.[a-z0-9]+$/i, '') + '.txt', { type: 'text/plain' }); }));
}

/** The one country a message names («a tenancy in Cyprus», «under Greek law» is not caught: names only), or ''. When
 *  two places match and one name holds the other («Northern Ireland» and «Ireland»), the longer wins. */
export function namedPlace(text: string): string {
  const lower = ` ${text.toLowerCase()} `;
  const hits = searchablePlaces().filter(place => place.name.length >= 4 && new RegExp(`[^\\p{L}]${place.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\p{L}]`, 'u').test(lower));
  const kept = hits.filter(place => !hits.some(other => other !== place && other.name.length > place.name.length && other.name.toLowerCase().includes(place.name.toLowerCase())));
  const codes = [...new Set(kept.map(place => place.code))];
  return codes.length === 1 ? codes[0] : '';
}

/** One action an agent proposed (12 Nov 2026, shared/app-actions.ts): every detail shown and editable, and nothing
 *  happens until the person presses the button. An address the person never typed in this chat is pointed out. */
function ActionCard({ action, typed, onDone }: { action: AppAction & { done?: string }; typed: string; onDone(done: AppAction & { done: string }): void }) {
  const [draft, setDraft] = useState<AppAction>(action);
  // 13 Nov 2026 (code review): the rows are typed as text and read from it; rebuilding the text from the parsed rows on
  // every key lost a trailing space, Enter and «a|b».
  const [rowsText, setRowsText] = useState(() => action.kind === 'rows' ? action.values.map(row => row.join(' | ')).join('\n') : '');
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<'idle' | 'doing' | 'failed'>('idle');
  const [note, setNote] = useState('');
  const unseen = unseenAddresses(draft, typed);
  const isEvent = draft.kind === 'event';
  // 13 Nov 2026: a LinkedIn post and rows for a Google Sheet join the event, the e-mail and the reply.
  const label = isEvent ? 'Add to calendar' : draft.kind === 'reply' ? 'Send reply' : draft.kind === 'post' ? 'Post to LinkedIn' : draft.kind === 'rows' ? `Add ${draft.values.length === 1 ? 'the row' : `${draft.values.length} rows`}` : 'Send';
  const verb = isEvent || draft.kind === 'rows' ? 'added' : draft.kind === 'post' ? 'posted' : 'sent';
  const app = ({ googlecalendar: 'Google Calendar', outlook: 'Outlook', gmail: 'Gmail', linkedin: 'LinkedIn', googlesheets: 'Google Sheets' } as Record<string, string>)[draft.service] ?? draft.service;
  const when = (start: string, minutes: number) => { const [date, time] = start.split('T'); const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); return `${day}, ${time}–${eventEnd(start, minutes).slice(11)}`; };
  const go = async () => {
    const checked = readAction(draft);
    if (!checked) { setState('failed'); setNote(isEvent ? 'Check the date, the time and the length.' : draft.kind === 'post' ? 'Check the text: at most 3,000 characters.' : draft.kind === 'rows' ? 'Check the rows: at most 50, each with something in it.' : 'Check the addresses, the subject and the text.'); return; }
    setState('doing'); setNote('');
    try {
      const result = await carryOut(checked);
      const done = checked.kind === 'event' ? `Added to ${app}${checked.reminder !== null && !result.note ? `, reminder ${checked.reminder} min before` : ''}.${result.note ? ` ${result.note}` : ''}`
        : checked.kind === 'reply' ? `Reply sent from ${app} to ${result.to || checked.to}, in the same thread.`
        : checked.kind === 'post' ? `Posted on LinkedIn${checked.visibility === 'CONNECTIONS' ? ', for your connections' : ''}.`
        : checked.kind === 'rows' ? `Added ${checked.values.length === 1 ? 'one row' : `${checked.values.length} rows`} to «${checked.title}» · ${checked.sheet}.`
        : `Sent from ${app} to ${checked.to.join(', ')}.`;
      onDone({ ...checked, done: result.link ? `${done} ${result.link}` : done });
    } catch (error) {
      const code = error instanceof ConnectionsError ? error.code : '';
      setState('failed');
      setNote(code === 'sign_in' ? 'Sign in first (Profile, bottom left).' : code === 'not_connected' ? `Connect ${app} first, on Connections.`
        : code === 'message_not_found' ? 'That e-mail is no longer in your mailbox, so the reply was not sent.'
        : code === 'needs_permission' ? `${app} did not allow it: your connection may only allow reading. Disconnect and connect ${app} again on Connections, approving the change, then press ${label} again.`
        : `${app} refused it. Nothing was ${verb}. Try again.`);
    }
  };
  if (action.done) { const link = /https:\/\/\S+$/.exec(action.done)?.[0]; const open = action.kind === 'event' ? 'Open the event' : action.kind === 'post' ? 'Open the post' : action.kind === 'rows' ? 'Open the sheet' : 'Open';
    return <div className="mn-action is-done"><Check size={15} aria-hidden="true" /><span>{link ? action.done.replace(link, '').trim() : action.done}{link ? <> <a href={link} target="_blank" rel="noopener noreferrer" data-new-tab>{open}</a></> : null}</span></div>; }
  const field = (name: string, value: string, set: (value: string) => void, type = 'text') => <label className="mn-action-field"><span>{name}</span><input type={type} value={value} onChange={event => set(event.target.value)} /></label>;
  const icon = isEvent ? <Clock size={15} /> : draft.kind === 'post' ? <Send size={15} /> : draft.kind === 'rows' ? <FileSpreadsheet size={15} /> : <Mail size={15} />;
  const title = isEvent ? 'New event' : draft.kind === 'reply' ? 'Reply' : draft.kind === 'post' ? 'LinkedIn post' : draft.kind === 'rows' ? 'New rows' : 'New e-mail';
  return <div className="mn-action" data-state={state}>
    <header><span className="mn-asst-card-icon" aria-hidden="true">{icon}</span><b>{title}</b><small>{app}</small></header>
    {editing ? <div className="mn-action-edit">{draft.kind === 'event' ? <>
        {field('Title', draft.title, value => setDraft({ ...draft, title: value }))}
        {field('Starts', draft.start, value => setDraft({ ...draft, start: value }), 'datetime-local')}
        {field('Minutes', String(draft.minutes), value => setDraft({ ...draft, minutes: Number(value) || 0 }), 'number')}
        {field('Reminder (minutes before, empty for the usual)', draft.reminder === null ? '' : String(draft.reminder), value => setDraft({ ...draft, reminder: value.trim() === '' ? null : Number(value) }), 'number')}
        {field('Place', draft.location ?? '', value => setDraft({ ...draft, location: value }))}
        {field('Invite (addresses, comma-separated)', draft.attendees.join(', '), value => setDraft({ ...draft, attendees: value.split(/[\s,;]+/).filter(Boolean) }))}
      </> : draft.kind === 'reply' ? <>
        <label className="mn-action-field"><span>Text</span><textarea rows={8} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
      </> : draft.kind === 'post' ? <>
        <label className="mn-action-field"><span>Post ({draft.text.length.toLocaleString('en-GB')} / 3,000)</span><textarea rows={10} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
        <label className="mn-action-field"><span>Who sees it</span><select value={draft.visibility} onChange={event => setDraft({ ...draft, visibility: event.target.value === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC' })}><option value="PUBLIC">Anyone</option><option value="CONNECTIONS">Your connections</option></select></label>
      </> : draft.kind === 'rows' ? <>
        <label className="mn-action-field"><span>Rows (one per line, cells separated by a tab or |)</span><textarea rows={8} value={rowsText}
          onChange={event => { const text = event.target.value; setRowsText(text); setDraft({ ...draft, values: text.split('\n').filter(line => line.trim()).map(line => line.split(/\t|\|/).map(cell => cell.trim())) }); }} /></label>
      </> : <>
        {field('To', draft.to.join(', '), value => setDraft({ ...draft, to: value.split(/[\s,;]+/).filter(Boolean) }))}
        {field('Cc', draft.cc.join(', '), value => setDraft({ ...draft, cc: value.split(/[\s,;]+/).filter(Boolean) }))}
        {field('Subject', draft.subject, value => setDraft({ ...draft, subject: value }))}
        <label className="mn-action-field"><span>Text</span><textarea rows={8} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
      </>}</div>
      : draft.kind === 'event' ? <dl className="mn-action-facts">
        <div><dt>Title</dt><dd>{draft.title}</dd></div>
        <div><dt>When</dt><dd>{when(draft.start, draft.minutes)} · {draft.timeZone.replace(/_/g, ' ')}</dd></div>
        <div><dt>Reminder</dt><dd>{draft.reminder === null ? 'Your calendar\'s usual one' : `${draft.reminder} minutes before`}</dd></div>
        {draft.location ? <div><dt>Place</dt><dd>{draft.location}</dd></div> : null}
        {draft.attendees.length ? <div><dt>Invites</dt><dd>{draft.attendees.join(', ')} <small>(they get an invitation)</small></dd></div> : null}
        {draft.description ? <div><dt>Notes</dt><dd>{draft.description}</dd></div> : null}
      </dl> : draft.kind === 'reply' ? <dl className="mn-action-facts">
        <div><dt>To</dt><dd>{draft.to || 'The sender'} <small>(the sender, in the same thread)</small></dd></div>
        {draft.subject ? <div><dt>Subject</dt><dd>{draft.subject}</dd></div> : null}
        <div className="is-body"><dt>Text</dt><dd>{draft.body}</dd></div>
      </dl> : draft.kind === 'post' ? <dl className="mn-action-facts">
        <div><dt>Who sees it</dt><dd>{draft.visibility === 'CONNECTIONS' ? 'Your connections' : 'Anyone on LinkedIn'}</dd></div>
        <div className="is-body"><dt>Post</dt><dd>{draft.text}</dd></div>
      </dl> : draft.kind === 'rows' ? <div className="mn-action-rows">
        <p>Into <b>{draft.title}</b> · {draft.sheet}, after its last row:</p>
        <div className="mn-action-rows-scroll"><table><tbody>{draft.values.slice(0, 10).map((row, at) => <tr key={at}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>
        {draft.values.length > 10 ? <small>and {draft.values.length - 10} more</small> : null}
      </div> : <dl className="mn-action-facts">
        <div><dt>To</dt><dd>{draft.to.join(', ')}</dd></div>
        {draft.cc.length ? <div><dt>Cc</dt><dd>{draft.cc.join(', ')}</dd></div> : null}
        <div><dt>Subject</dt><dd>{draft.subject}</dd></div>
        <div className="is-body"><dt>Text</dt><dd>{draft.body}</dd></div>
      </dl>}
    {unseen.length ? <p className="mn-action-warn" role="note">Not an address you typed in this chat: <b>{unseen.join(', ')}</b>. Check it before you press {label}.</p> : null}
    {note && <p className="mn-action-note" role="alert">{note}</p>}
    <footer>
      <button type="button" className="nomos-btn" onClick={() => setEditing(value => !value)} disabled={state === 'doing'}><Pencil size={14} aria-hidden="true" /><span>{editing ? 'Done editing' : 'Edit'}</span></button>
      <button type="button" className="nomos-btn is-primary" onClick={() => void go()} disabled={state === 'doing'}>
        {state === 'doing' ? <Loader2 size={14} className="is-spinning" aria-hidden="true" /> : null}<span>{state === 'doing' ? (isEvent || draft.kind === 'rows' ? 'Adding…' : draft.kind === 'post' ? 'Posting…' : 'Sending…') : label}</span></button>
    </footer>
  </div>;
}

/** The part of an answer people read has ended: the proof list (or one of the assistant's blocks) has started. */
const visibleDone = (content: string, assistant: boolean) => /<proofs>/i.test(content) || /```routine\b/.test(content) || (assistant && /```(?:agents|build|connect)\b/.test(content));

/** A routine offered in the chat (12 Nov 2026): one press saves it, switches it on and writes its first result; from
 *  then on it runs on its schedule like any routine. In an agent's own chat it runs that agent. In Ask Agents (`build`)
 *  there is no agent yet, so the research agent is designed first from the offer's question and websites (his «remind me
 *  every week what is new on Netflix» had produced a plain agent that could neither run weekly nor look anything up).
 *  The result goes where the person asked when this server may send there, else it stays in the app, and the card says so. */
function RoutineOfferCard({ offer, agent, build, jurisdiction, settings, hiding }: { offer: RoutineOffer; agent: AgentDefinition; build: boolean; jurisdiction: string; settings: Settings; /** This conversation hides names from the AI. */ hiding: boolean }) {
  const [state, setState] = useState<'idle' | 'building' | 'saving' | 'running' | 'on' | 'failed'>('idle');
  const [note, setNote] = useState('');
  /** The routine this card started (or found already made), so «Open Routines» lands on it. */
  const [madeId, setMadeId] = useState<string | null>(null);
  // 13 Nov 2026: reopened later, the card offered «Start this routine» again for a routine already in the list (a second
  // press would make a twin). It says so instead.
  useEffect(() => { let live = true; listRoutines().then(reply => { const made = reply.routines.find(item => item.name === offer.name); if (live && made) { setMadeId(current => current ?? made.id); setState(current => current === 'idle' ? 'on' : current); setNote(current => current || 'Already in your routines.'); } }, () => undefined); return () => { live = false; }; }, [offer.name]);
  // 13 Nov 2026 (his «do it for me» for a Telegram alert on one sender's e-mails): a routine on his own mail too.
  const inbox = offer.mail !== undefined || !!offer.brief;
  const when = offer.mail !== undefined ? scheduleLabel({ days: offer.days, time: offer.time, trigger: { kind: 'mail', filter: offer.mail } })
    : offer.feed ? `Each time ${feedHost(offer.feed)} posts something new` : scheduleLabel({ days: offer.days, time: offer.time });
  const start = async () => {
    setNote('');
    try {
      setState(build && !inbox ? 'building' : 'saving');
      // Where it may be sent: only what this person is allowed (the server's own lists).
      const allowed = (await listRoutines()).delivery;
      const email = offer.deliver === 'email' ? allowed.email[0] ?? null : null;
      const telegram = offer.deliver === 'telegram' ? allowed.telegram[0] ?? null : null;
      const deliver: RoutineInput['deliver'] = { email, whatsapp: null, ...(telegram ? { telegram } : {}) };
      // An alert or a brief on the person's own mail: no agent to build, and the mail must be connected.
      if (inbox) {
        const saved = await saveRoutine({ name: offer.name, brief: offer.brief ?? 'new-mail-alert', source: 'mine', days: offer.days, time: offer.time, timeZone: offer.timeZone, deliver, namesHidden: hiding, language: settings.language, enabled: true,
          ...(offer.mail !== undefined ? { trigger: { kind: 'mail' as const, filter: offer.mail } } : {}), ...(offer.approve ? { approve: true } : {}) });
        setMadeId(saved.id);
        const mailOn = await listConnections().then(reply => reply.services.some(service => service.connected && CONNECTOR_BY_ID[service.id]?.reads.includes('mail')), () => true);
        const where = email ? `It is e-mailed to ${email}.` : telegram ? 'It is sent to your Telegram.'
          : offer.deliver === 'email' ? 'E-mail sending is not set up on this server yet, so it arrives in the app (Today and Routines).' : offer.deliver === 'telegram' ? 'Telegram is not set up on this server yet, so it arrives in the app (Today and Routines).' : 'It arrives in the app (Today and Routines).';
        const first = offer.mail !== undefined ? null : (setState('running'), await runRoutineNow(saved.id));
        setState('on');
        setNote(`${!mailOn ? 'On, but no mail is connected yet: connect Gmail or Outlook (Connections) so it has mail to read. ' : offer.mail !== undefined ? 'On: it checks your new mail every 5 minutes. ' : first?.status === 'done' ? 'On, and its first brief is ready. ' : 'On; its first run did not finish and it tries again at its next time. '}${where}${offer.approve && (email || telegram) ? ' Each result waits for your OK on Routines before it is sent.' : ''}`);
        return;
      }
      let runs: NonNullable<RoutineInput['agent']>;
      if (build) {
        // 13 Nov 2026 (code review): with names hidden, the design is asked with placeholders and the names put back after.
        const { mask, restore } = makeMasker(hiding ? findPrivate([offer.question]) : []);
        const ask = { description: `${mask(offer.question)}\n\nThis agent runs on its own ${offer.feed ? `each time ${feedHost(offer.feed)} publishes something new (the app watches it)` : `on a schedule (${when})`}; the app runs it and sends the answer. Each time it reports only what is new since its previous run, with a link to every source.${offer.sites?.length ? ` Besides any official sources it searches only these websites: ${offer.sites.join(', ')}.` : ''}`, language: settings.language };
        let result = await buildAgentDesign(ask);
        if (!result.agent && result.questions.length) result = await buildAgentDesign({ ...ask, answers: result.questions.map(item => ({ question: item.question, answer: item.options[0] ?? 'Use your best judgement' })) });
        const designed = result.agent; if (!designed) throw new Error('none');
        const sites = [...new Set([...(offer.sites ?? []), ...(designed.sites ?? [])].map(site => siteDomain(site)).filter((site): site is string => !!site))].slice(0, 12);
        runs = { name: restore(designed.name).slice(0, 120), instructions: restore(designed.instructions), question: offer.question, jurisdiction: designed.jurisdiction ?? '', officialSearch: designed.officialSearch && !!designed.jurisdiction, mode: designed.mode, ...(sites.length ? { sites } : {}) };
        setState('saving');
      } else {
        const place = jurisdiction || agent.jurisdiction || '';
        const sites = [...new Set([...(agent.sites ?? []), ...(offer.sites ?? [])].map(site => siteDomain(site)).filter((site): site is string => !!site))].slice(0, 12);
        runs = { name: agent.name, instructions: agent.instructions, question: offer.question, jurisdiction: place, officialSearch: agent.officialSearch && !!place, mode: agent.mode, ...(sites.length ? { sites } : {}) };
      }
      const saved = await saveRoutine({ name: offer.name, brief: BRIEFS[0].id, source: 'mine', days: offer.days, time: offer.time, timeZone: offer.timeZone, deliver, namesHidden: hiding, language: settings.language, enabled: true, agent: runs,
        ...(offer.feed ? { trigger: { kind: 'feed' as const, url: offer.feed } } : {}), ...(offer.approve ? { approve: true } : {}) });
      setMadeId(saved.id); setState('running');
      const run = await runRoutineNow(saved.id);
      const where = email ? `It is e-mailed to ${email}.` : telegram ? 'It is sent to your Telegram.'
        : offer.deliver === 'email' ? 'E-mail sending is not set up on this server yet, so it arrives in the app (Today and Routines).' : offer.deliver === 'telegram' ? 'Telegram is not set up on this server yet, so it arrives in the app (Today and Routines).' : 'It arrives in the app (Today and Routines).';
      setState('on'); setNote(`${run.status === 'done' ? 'On, and its first result is ready.' : 'On; its first run did not finish and it tries again at its next time.'} ${where}${offer.approve && (email || telegram) ? ' Each result waits for your OK on Routines before it is sent.' : ''}`);
    } catch (error) {
      setState('failed');
      setNote(error instanceof ConnectionsError && (error.code === 'sign_in' || error.code.startsWith('owner_code')) ? 'Sign in first (Profile, bottom left), then press Start again.'
        : error instanceof ConnectionsError && error.code === 'too_many' ? 'You have reached the number of routines one account can have. Delete one first.' : 'It could not be started. Please try again.');
    }
  };
  // 13 Nov 2026 (his request): Open Routines lands on the routine just made, which glows for two seconds.
  const openRoutines = () => { history.pushState(null, '', `/routines${madeId ? `#routine-${madeId}` : ''}`); window.dispatchEvent(new PopStateEvent('popstate')); };
  const working = state === 'building' || state === 'saving' || state === 'running';
  return <div className="mn-routine-offer" data-state={state}>
    <span className="mn-asst-card-icon" aria-hidden="true"><Clock size={15} /></span>
    <span className="mn-asst-card-text"><b>{offer.name}</b><small>{when}{offer.feed || offer.mail !== undefined ? '' : ` · ${offer.timeZone.replace(/_/g, ' ')}`}{offer.approve ? ' · waits for your OK' : ''}</small>
      {offer.sites?.length ? <small>Searches only: {offer.sites.join(', ')}</small> : null}{note && <i>{note}</i>}</span>
    {state === 'on' ? <button type="button" className="nomos-btn" onClick={openRoutines}>Open Routines</button>
      : <button type="button" className="nomos-btn is-primary" disabled={working} onClick={() => void start()}>
          {working ? <Loader2 size={14} className="is-spinning" aria-hidden="true" /> : null}<span>{state === 'building' ? 'Building its agent… half a minute' : state === 'saving' ? 'Starting…' : state === 'running' ? 'Writing the first result…' : 'Start this routine'}</span></button>}
  </div>;
}

/** Apps connected right in the chat (12 Nov 2026, his «give me the Gmail connector here to link, not a button that
 *  takes me to Connections»): each app with its live state and its own Connect / Disconnect; the provider's sign-in
 *  opens in its own small window, as on the Connections page, and the card turns green when it reports back. */
function ConnectHere({ apps }: { apps: ConnectorId[] }) {
  const [state, setState] = useState<Record<string, boolean> | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState<ConnectorId | null>(null);
  const [asking, setAsking] = useState<ConnectorId | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  /** 13 Nov 2026: an app whose sign-in is not set up on the server yet (Google Sheets, LinkedIn…) offered «Connect», which could only fail. */
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const load = async () => {
    try { const reply = await listConnections(); setState(Object.fromEntries(reply.services.map(item => [item.id, item.connected]))); setReady(Object.fromEntries(reply.services.map(item => [item.id, item.ready !== false]))); setProblem(reply.available ? '' : 'Connections are not set up on this server yet.'); }
    catch (error) { setState({}); setProblem(error instanceof ConnectionsError && (error.code === 'sign_in' || error.code.startsWith('owner_code')) ? 'Sign in first (Profile, bottom left), then press Connect.' : 'The apps could not be checked just now.'); }
  };
  useEffect(() => { void load(); }, []);
  const watching = useRef<AbortController | null>(null);
  useEffect(() => () => watching.current?.abort(), []);
  const connect = async (id: ConnectorId) => {
    setBusy(id); setNote(current => ({ ...current, [id]: '' }));
    try {
      const outcome = await connectService(id);
      if (outcome === 'unknown') { const controller = new AbortController(); watching.current?.abort(); watching.current = controller; await watchConnection(id, controller.signal, 3000, 90_000); }
      await load();
      if (outcome === 'failed') setNote(current => ({ ...current, [id]: 'It was not connected. Try again.' }));
    } catch { setNote(current => ({ ...current, [id]: 'The sign-in could not start. Try again shortly.' })); }
    finally { setBusy(null); }
  };
  const disconnect = async (id: ConnectorId) => {
    setAsking(null); setBusy(id);
    try { await disconnectService(id); await load(); } catch { setNote(current => ({ ...current, [id]: 'It could not be disconnected. Try again.' })); } finally { setBusy(null); }
  };
  return <ul className="mn-asst-connect" aria-label="Connect your apps">
    {apps.map(id => { const on = state?.[id] === true; const name = CONNECTOR_BY_ID[id].name;
      return <li key={id} data-on={on}>
        <ConnectionLogo id={id} size={30} />
        <span className="mn-asst-connect-name"><b>{name}</b>
          <small>{on && !note[id] && busy !== id && <i className="mn-asst-connect-dot" aria-hidden="true" />}{state === null ? 'Checking…' : busy === id ? 'Finish signing in in the window that opened…' : note[id] || (on ? 'Connected · your agents can read it' : problem || (ready[id] === false ? 'Needs one setup step on the server first' : 'Not connected yet'))}</small></span>
        {asking === id
          ? <span className="mn-ask-inline" role="alert">Disconnect {name}?
              <button type="button" className="nomos-btn mn-ask-yes" onClick={() => void disconnect(id)}>Disconnect</button>
              <button type="button" className="nomos-btn" onClick={() => setAsking(null)} autoFocus>Cancel</button></span>
          : on ? <button type="button" className="mn-asst-connect-off" onClick={() => setAsking(id)} disabled={!!busy}>Disconnect</button>
          : ready[id] === false ? <button type="button" className="mn-asst-connect-off" onClick={() => { history.pushState(null, '', `/connections#app-${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }}>How to set it up</button>
          : <button type="button" className="nomos-btn is-primary" onClick={() => void connect(id)} disabled={!!busy || state === null || !!problem}>
              {busy === id ? <Loader2 size={14} className="is-spinning" aria-hidden="true" /> : null}<span>{busy === id ? 'Connecting…' : `Connect ${name}`}</span></button>}
      </li>; })}
  </ul>;
}

/** Under the assistant's answer: the agents it picked, each one click from use, and the agent it offers to build. */
function AssistantCards({ content, task, files, onUse, onBuild }: { content: string; task: string; files: ChatDocument[]; onUse?(id: string, task: string, files?: File[]): void; onBuild?(description: string): void }) {
  // «Use» gives the agent the task and the conversation's files, as they were attached (12 Nov 2026).
  const use = async (id: string, text: string) => { onUse?.(id, text, await filesFor(files)); };
  const { picks, build, connect } = useMemo(() => assistantParts(content), [content]);
  const found = picks.map(pick => ({ pick, agent: findAgent(pick.id) })).filter((item): item is { pick: typeof item.pick; agent: AgentDefinition } => !!item.agent);
  if (!found.length && !build && !connect.length) return null;
  return <div className="mn-asst-cards">
    {connect.length > 0 && <ConnectHere apps={connect} />}
    {found.length > 0 && <ul aria-label="Agents for this">{found.map(({ pick, agent }) => <li key={agent.id}>
      <button type="button" onClick={() => void use(agent.id, pick.task || task)} disabled={!onUse} title={`${agent.name} starts on this${files.length ? `, with your ${files.length === 1 ? 'file' : `${files.length} files`}` : ''}`}>
        <span className="mn-asst-card-icon" aria-hidden="true"><Sparkles size={15} /></span>
        <span className="mn-asst-card-text"><b>{agent.name}</b><small>{pick.reason || agent.description}</small>
          <i>{agent.origin === 'mine' ? 'Your agent' : `${fieldById(agent.field)?.name ?? ''} · ${categoryLabel(agent.category)}`}</i></span>
        <span className="mn-asst-card-go">Use<ArrowRight size={14} aria-hidden="true" /></span>
      </button></li>)}</ul>}
    {build && <div className="mn-asst-build">
      <span className="mn-asst-card-icon" aria-hidden="true"><Wand2 size={15} /></span>
      <span className="mn-asst-card-text"><b>Build a new agent for this</b><small>{build}</small></span>
      <button type="button" className="nomos-btn is-primary" onClick={() => onBuild?.(build)} disabled={!onBuild}><Wand2 size={14} aria-hidden="true" /><span>Build this agent</span></button>
    </div>}
  </div>;
}

/** The agent's questions, above the input box (12 Nov 2026), in Nomos's question sheet (his «like Nomos, not this kids
 *  design»): one question at a time, «1 of 3», a quiet radio list with «Something else…», Skip and Continue; the last
 *  question's button sends every answer; × answers without the questions. */
function AskPanel({ questions, onAnswer, onSkip, onAttach }: { questions: AskQuestion[]; onAnswer(answers: string[]): void; onSkip(): void; /** Opens the box's file picker: a question asking for a document gets the button itself (13 Nov 2026). */ onAttach?(): void }) {
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string[]>(() => questions.map(() => ''));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''));
  // A question with no ready answers is typed: its text box is open from the start.
  const [otherOn, setOtherOn] = useState<boolean[]>(() => questions.map(item => !item.options.length));
  const [collapsed, setCollapsed] = useState(false);
  const otherInput = useRef<HTMLInputElement>(null);
  const question = questions[index];
  const last = index >= questions.length - 1;
  const answerOf = (at: number) => otherOn[at] ? other[at].trim() : chosen[at];
  useEffect(() => { if (otherOn[index]) otherInput.current?.focus(); }, [index, otherOn]);
  const next = () => { if (!last) { setIndex(index + 1); return; } onAnswer(questions.map((_, at) => answerOf(at) || 'No preference: use your judgement')); };
  const pick = (option: string) => { setChosen(current => current.map((value, at) => at === index ? option : value)); setOtherOn(current => current.map((value, at) => at === index ? false : value)); };
  return <section className={`mn-qsheet${collapsed ? ' is-collapsed' : ''}`} role="group" aria-label="Questions before the answer">
    <header className="mn-qsheet-head">
      <button type="button" className="mn-qsheet-icon" aria-expanded={!collapsed} aria-label={collapsed ? 'Show questions' : 'Hide questions'} onClick={() => setCollapsed(value => !value)}><ChevronDown size={15} style={collapsed ? { transform: 'rotate(-90deg)' } : undefined} /></button>
      <span className="mn-qsheet-title">Questions</span>
      <span className="mn-qsheet-count">{questions.length > 1 ? `${index + 1} of ${questions.length}` : ''}</span>
      {questions.length > 1 && <>
        <button type="button" className="mn-qsheet-icon" disabled={index === 0} aria-label="Previous question" onClick={() => setIndex(index - 1)}><ChevronLeft size={15} /></button>
        <button type="button" className="mn-qsheet-icon" disabled={last} aria-label="Next question" onClick={() => setIndex(index + 1)}><ChevronRight size={15} /></button>
      </>}
      <button type="button" className="mn-qsheet-icon" aria-label="Answer without the questions" title="Answer without the questions" onClick={onSkip}><X size={15} /></button>
    </header>
    {!collapsed && <div className="mn-qsheet-body">
      <p className="mn-qsheet-question">{question.question}</p>
      <div className="mn-qsheet-options" role="radiogroup">
        {question.options.map(option => { const on = !otherOn[index] && chosen[index] === option;
          return <button key={option} type="button" className={`mn-qsheet-option${on ? ' is-on' : ''}`} role="radio" aria-checked={on} onClick={() => pick(option)}><span className="mn-qsheet-mark" aria-hidden="true" />{option}</button>; })}
        {question.options.length > 0 && <button type="button" className={`mn-qsheet-option is-other${otherOn[index] ? ' is-on' : ''}`} role="radio" aria-checked={otherOn[index]}
          onClick={() => setOtherOn(current => current.map((value, at) => at === index ? !value : value))}><span className="mn-qsheet-mark" aria-hidden="true" />Something else…</button>}
        {otherOn[index] && <input ref={otherInput} className={`mn-qsheet-other${question.options.length ? '' : ' is-typed'}`} type="text" maxLength={200} value={other[index]} placeholder="Write your answer"
          onChange={event => { const value = event.target.value; setOther(current => current.map((item, at) => at === index ? value : item)); }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && other[index].trim()) { event.preventDefault(); next(); } }} />}
      </div>
      <footer className="mn-qsheet-actions">
        {onAttach && /\b(?:attach|upload)\b|επισυν[άα]ψ|ανεβ[άα]σ|επισ[υύ]ναψ/i.test(question.question) && <button type="button" className="mn-qsheet-attach" onClick={() => { onAttach(); setOtherOn(current => current.map((value, at) => at === index ? true : value)); setOther(current => current.map((value, at) => at === index && !value.trim() ? 'I attached them.' : value)); }}><Paperclip size={14} aria-hidden="true" /><span>Attach files</span></button>}
        <button type="button" className="mn-qsheet-skip" onClick={next}>Skip</button>
        <button type="button" className="mn-qsheet-go" disabled={!answerOf(index)} onClick={next}>{last ? 'Answer' : 'Continue'}</button>
      </footer>
    </div>}
  </section>;
}

/** A question about current law, rates, figures or news (13 Nov 2026): answered without a search, it says so. */
const FACTS = /\b(tax|taxes|vat|rates?|laws?|legal|statutes?|regulations?|deadlines?|fines?|penalt(?:y|ies)|wages?|salary|thresholds?|fees?|prices?|inflation|interest|news|latest|current(?:ly)?|today|this year|20\d\d)\b|φόρ|ΦΠΑ|νόμ|συντελεστ|προθεσμ|πρόστιμ/i;
/** The person asks the agent to go online (13 Nov 2026: «confirm online», «activate real time web»). */
const WEB_ASK = /\b(search|check|confirm|verify|look\s*(?:it\s*)?up|activate|enable|turn on|browse|google)\b[^.?!]{0,40}\b(online|on-line|internet|web|real[- ]?time)\b|\b(online|on-line|internet|web|real[- ]?time)\b[^.?!]{0,30}\b(search|check|access|confirm|verify)|διαδίκτυ|ίντερνετ|ψάξ/i;

/** The lessons kept for an agent, within what a request carries. */
const lessonsOf = (agentId: string) => readLessons(agentId).slice(-LESSON_LIMITS.perAgent);

type LessonCardState = { agentId: string; agentName: string; status: 'learning' | 'ready' | 'none' | 'failed' | 'kept'; lessons: (Lesson & { keep: boolean })[]; kept?: { mine: number; every: number } };
/** «Teach it»: the lessons found in the person's feedback, above the box, in the questions' sheet (12 Nov 2026). Each can
 *  be unticked, reworded, and kept for this agent or for every agent; nothing is kept until «Keep». */
function LessonsCard({ card, onChange, onKeep, onClose }: { card: LessonCardState; onChange(card: LessonCardState): void; onKeep(card: LessonCardState): void; onClose(): void }) {
  const closing = card.status === 'none' || card.status === 'kept';
  useEffect(() => { if (!closing) return; const timer = window.setTimeout(onClose, 7_000); return () => window.clearTimeout(timer); }, [closing]);
  const set = (at: number, patch: Partial<Lesson & { keep: boolean }>) => onChange({ ...card, lessons: card.lessons.map((lesson, index) => index === at ? { ...lesson, ...patch } : lesson) });
  const keeping = card.lessons.filter(lesson => lesson.keep && lesson.text.trim()).length;
  const kept = card.kept ? [card.kept.mine ? `${card.kept.mine} for «${card.agentName}»` : '', card.kept.every ? `${card.kept.every} for every agent` : ''].filter(Boolean).join(' and ') : '';
  return <section className="mn-qsheet mn-lessons" role="group" aria-label="Lessons from your feedback" aria-live="polite">
    <header className="mn-qsheet-head">
      <span className="mn-qsheet-icon is-static" aria-hidden="true">{card.status === 'learning' ? <Loader2 size={15} className="is-spinning" /> : <Check size={15} />}</span>
      <span className="mn-qsheet-title">Lessons from your feedback</span>
      <span className="mn-qsheet-count">{card.status === 'ready' ? `${card.lessons.length} found` : ''}</span>
      <button type="button" className="mn-qsheet-icon" aria-label="Close" title="Close" onClick={onClose}><X size={15} /></button>
    </header>
    <div className="mn-qsheet-body">
      {card.status === 'learning' && <p className="mn-lessons-note">The answer is being redone. Working out what to remember for next time…</p>}
      {card.status === 'none' && <p className="mn-lessons-note">Nothing general to remember: only this answer is redone.</p>}
      {card.status === 'failed' && <p className="mn-lessons-note">The lessons could not be worked out this time. The answer is still redone.</p>}
      {card.status === 'kept' && <p className="mn-lessons-note">Kept {kept}. {card.kept?.mine ? 'See them under «Lessons» at the top of this page' : 'See them in House style'}{card.kept?.mine && card.kept?.every ? ' and House style' : ''}; the agent checks every answer against them.</p>}
      {card.status === 'ready' && <>
        <p className="mn-qsheet-question">Keep these for next time?</p>
        <ul className="mn-lessons-list">
          {card.lessons.map((lesson, at) => <li key={at} className={lesson.keep ? 'is-on' : ''}>
            <button type="button" className="mn-lessons-tick" role="checkbox" aria-checked={lesson.keep} aria-label={lesson.keep ? 'Do not keep this lesson' : 'Keep this lesson'} onClick={() => set(at, { keep: !lesson.keep })}>{lesson.keep ? <Check size={11} strokeWidth={3} /> : null}</button>
            {/* 13 Nov 2026: a long lesson was cut off in a one-line box; it wraps and grows. */}
            <textarea className="mn-lessons-text" rows={1} value={lesson.text} maxLength={LESSON_LIMITS.chars} aria-label="Lesson" onChange={event => set(at, { text: event.target.value.replace(/\n/g, ' ') })} />
            <span className="mn-lessons-scope" role="radiogroup" aria-label="Who follows it">
              <button type="button" role="radio" aria-checked={!lesson.every} className={!lesson.every ? 'is-on' : ''} onClick={() => set(at, { every: false })}>This agent</button>
              <button type="button" role="radio" aria-checked={lesson.every} className={lesson.every ? 'is-on' : ''} onClick={() => set(at, { every: true })}>Every agent</button>
            </span>
          </li>)}
        </ul>
        <footer className="mn-qsheet-actions">
          <button type="button" className="mn-qsheet-skip" onClick={onClose}>Not now</button>
          <button type="button" className="mn-qsheet-go" disabled={!keeping} onClick={() => onKeep(card)}>{keeping === 1 ? 'Keep 1 lesson' : `Keep ${keeping} lessons`}</button>
        </footer>
      </>}
    </div>
  </section>;
}
