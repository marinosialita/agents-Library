// The app (reference App.tsx + agent-studio.tsx AgentStudioPages): the rail, and one page at a time — the library,
// an agent at work, the builder, the editor, and the rail's other pages. The URL follows the page, so Back/Forward
// follow the intended navigation, and the library keeps its browsing context across every visit to an agent.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wand2 } from 'lucide-react';
import type { AgentDefinition } from '../shared/agents.ts';
import { PRODUCT_NAME } from '../shared/product.ts';
import { ASSISTANT_ID } from '../shared/assistant.ts';
import { AgentRunPage } from './components/agent-run.tsx';
import { AgentBuilder } from './components/builder.tsx';
import { ToastHost, useToast } from './components/chrome.tsx';
import { AgentEditor } from './components/editor.tsx';
import { INITIAL_LIBRARY, LibraryPage, type LibraryState } from './components/library.tsx';
import { ConversationsPage, KnowledgePage, SettingsPage } from './components/pages.tsx';
import { ChainsPage } from './components/chains.tsx';
import { CommandPalette, type PaletteTarget } from './components/command-palette.tsx';
import { HouseStylePage } from './components/house-style.tsx';
import { AccountPage } from './components/account-page.tsx';
import { TodayPage } from './components/today-page.tsx';
import { LearnPage } from './components/learn-page.tsx';
import { PrivacyPage } from './components/privacy-page.tsx';
import { ConnectionsPage } from './components/connections-page.tsx';
import { RoutinesPage } from './components/routines-page.tsx';
import { OfficialWebsiteViewer } from './components/official-website-viewer.tsx';
import { Rail, type Section } from './components/rail.tsx';
import { fieldById, isFieldId, type FieldId } from '../shared/fields.ts';
import { takeShared, type Shared } from './data/shared.ts';
import { panelUrl } from './data/link-rules.ts';
import { addLessons, readLessons, workingField, blankAgent, clearAgentDraft, copyAgent, findAgent, findChat, readAgentDraft, readChats, readFavourites, readMyAgents, readSettings, readyAgents, toggleFavourite, updateSettings, useStoreVersion } from './data/store.ts';

type View = { kind: 'library' } | { kind: 'build'; /** A task from «Tell me the task» that no agent does, and the field of its nearest agent. */ prefill?: string; field?: FieldId; /** Offered by the assistant: starts at once. */ auto?: boolean } | { kind: 'run'; agentId: string; chatId?: string; /** The task from «Tell me the task», waiting in the box, and files shared from another app. */ prefill?: string; files?: File[]; /** Sent at once (the assistant, asked from Today). */ auto?: boolean } | { kind: 'edit'; agentId?: string; agent?: AgentDefinition; isNew: boolean; built?: string; restored?: boolean; /** A draft continued from a customised library agent: whose lessons it keeps. */ lessonsFrom?: string; /** Where the editor was opened from: the agent's page, or one of its conversations. */ from?: { agentId: string; chatId?: string } }
  | { kind: 'conversations' } | { kind: 'knowledge' } | { kind: 'settings' } | { kind: 'profile' }
  | { kind: 'house' } | { kind: 'chains'; chainId?: string } | { kind: 'privacy' } | { kind: 'connections' } | { kind: 'today' } | { kind: 'learn' } | { kind: 'routines' };

function viewFromUrl(path: string): View {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return { kind: 'library' };
  if (parts[0] === 'new') return parts[1] === 'edit' ? { kind: 'edit', isNew: true } : { kind: 'build' };
  if (parts[0] === 'conversations') return { kind: 'conversations' };
  if (parts[0] === 'knowledge') return { kind: 'knowledge' };
  if (parts[0] === 'settings') return { kind: 'settings' };
  if (parts[0] === 'profile') return { kind: 'profile' };
  if (parts[0] === 'house-style') return { kind: 'house' };
  if (parts[0] === 'privacy') return { kind: 'privacy' };
  if (parts[0] === 'connections') return { kind: 'connections' };
  if (parts[0] === 'today') return { kind: 'today' };
  if (parts[0] === 'ask') return parts[1] === 'chat' && parts[2] ? { kind: 'run', agentId: ASSISTANT_ID, chatId: decodeURIComponent(parts[2]) } : { kind: 'run', agentId: ASSISTANT_ID };
  if (parts[0] === 'learn') return { kind: 'learn' };
  if (parts[0] === 'routines') return { kind: 'routines' };
  if (parts[0] === 'chains') return { kind: 'chains', ...(parts[1] ? { chainId: decodeURIComponent(parts[1]) } : {}) };
  if (parts[0] === 'agents' && parts[1]) {
    const agentId = decodeURIComponent(parts[1]);
    if (parts[2] === 'edit') return { kind: 'edit', agentId, isNew: false };
    if (parts[2] === 'chat' && parts[3]) return { kind: 'run', agentId, chatId: decodeURIComponent(parts[3]) };
    return { kind: 'run', agentId };
  }
  return { kind: 'library' };
}
function urlFromView(view: View): string {
  switch (view.kind) {
    case 'house': return '/house-style'; case 'privacy': return '/privacy'; case 'connections': return '/connections'; case 'today': return '/today'; case 'learn': return '/learn'; case 'routines': return '/routines'; case 'chains': return `/chains${view.chainId ? `/${encodeURIComponent(view.chainId)}` : ''}`;
    case 'library': return '/'; case 'build': return '/new'; case 'conversations': return '/conversations'; case 'knowledge': return '/knowledge'; case 'settings': return '/settings'; case 'profile': return '/profile';
    case 'run': if (view.agentId === ASSISTANT_ID) return `/ask${view.chatId ? `/chat/${encodeURIComponent(view.chatId)}` : ''}`; return `/agents/${encodeURIComponent(view.agentId)}${view.chatId ? `/chat/${encodeURIComponent(view.chatId)}` : ''}`;
    case 'edit': return view.isNew ? '/new/edit' : `/agents/${encodeURIComponent(view.agentId ?? view.agent?.id ?? '')}/edit`;
  }
}

export function App() { return <ToastHost><Shell /></ToastHost>; }

function Shell() {
  const version = useStoreVersion();
  const toast = useToast();
  const settings = readSettings();
  const [view, setView] = useState<View>(() => viewFromUrl(location.pathname));
  // The library's filters and scroll survive a visit to an agent.
  const library = useRef<LibraryState>({ ...INITIAL_LIBRARY });
  const [, redraw] = useState(0);
  // An agent left unsaved (through the rail, a closed tab) is offered back in the library. The editor writes the
  // draft as it unmounts, in the same commit as the view change, so it is read on every render of the library
  // rather than kept in state: nothing in the store bumps the version for it.
  const draft = view.kind === 'library' || (view.kind === 'edit' && view.isNew && !view.agent) ? readAgentDraft() : null;
  const blankNew = useRef<AgentDefinition | null>(null);
  // A ready-made agent reached at «/agents/ready-…/edit» by its URL is customised, never edited in place.
  const customised = useRef<{ source: string; agent: AgentDefinition } | null>(null);
  // Both are for one visit to the editor; the next visit starts from a new agent and a new id.
  useEffect(() => { if (view.kind !== 'edit') { blankNew.current = null; customised.current = null; } }, [view]);
  // A conversation started on the agent's page and saved there: its id goes into the URL (for a reload, Back and the
  // rail's highlight) without remounting the page.
  const [liveChat, setLiveChat] = useState<string | undefined>();
  useEffect(() => setLiveChat(undefined), [view]);
  // A chat deleted elsewhere but still in the URL (Back after a delete) is not shown as an empty page under its id.
  useEffect(() => {
    // An address the app does not know («/nope») shows the library; the address bar says so too.
    if (view.kind === 'library' && location.pathname !== '/') history.replaceState(null, '', '/');
    if (view.kind === 'run' && view.chatId && findChat(view.chatId)?.agentId !== view.agentId) { history.replaceState(null, '', urlFromView({ kind: 'run', agentId: view.agentId })); setView({ kind: 'run', agentId: view.agentId }); }
  }, [view, version]);
  const mine = useMemo(() => readMyAgents(), [version]);
  const ready = useMemo(() => readyAgents(), [version]);
  const favourites = useMemo(() => readFavourites(), [version]);
  const recent = useMemo(() => readChats().filter(chat => chat.messages.length).slice(0, 30).map(chat => ({ ...chat, agentName: findAgent(chat.agentId)?.name ?? 'Deleted agent' })), [version]);
  // «All fields» shows every agent; a new agent is still made in one field (the first of «My fields»).
  const allFields = settings.field === 'all';
  const field = fieldById(workingField(settings)) ?? fieldById('legal')!;
  const libraryTitle = allFields ? 'All Agents' : `${field.name} Agents`;
  // The library shows one field at a time: its ready agents and the user's own agents made in it.
  const fieldReady = useMemo(() => allFields ? ready : ready.filter(agent => agent.field === field.id), [ready, field, allFields]);
  const fieldMine = useMemo(() => allFields ? mine : mine.filter(agent => agent.field === field.id), [mine, field, allFields]);
  const everyAgent = useMemo(() => [...mine, ...ready], [mine, ready]);
  // «Share to Agents»: files and text shared from another app open the library's «Tell me the task» with them.
  const [shared, setShared] = useState<Shared | null>(null);
  useEffect(() => {
    // A field tile on the welcome page («/?field=finance») opens the library on that field.
    const wanted = new URLSearchParams(location.search).get('field');
    if (wanted && isFieldId(wanted)) { history.replaceState(null, '', '/'); library.current = { ...library.current, category: '', scroll: 0 }; updateSettings({ field: wanted }); }
    if (!new URLSearchParams(location.search).has('shared')) return;
    history.replaceState(null, '', '/');
    void takeShared().then(found => { if (!found) return; setShared(found); library.current = { ...library.current, task: found.text, found: null }; setView({ kind: 'library' }); });
  }, []);

  const go = useCallback((next: View, replace = false) => {
    setView(next);
    const url = urlFromView(next);
    if (replace) history.replaceState(null, '', url); else if (location.pathname !== url) history.pushState(null, '', url);
  }, []);
  useEffect(() => {
    const pop = () => setView(viewFromUrl(location.pathname));
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, []);
  const agentName = (id?: string) => (id ? findAgent(id)?.name : undefined) ?? 'Agent';
  const title = view.kind === 'run' ? agentName(view.agentId) : view.kind === 'build' ? 'New agent'
    : view.kind === 'edit' ? (view.isNew ? `New agent${view.agent?.name ? ` · ${view.agent.name}` : ''}` : `Edit · ${view.agent?.name || agentName(view.agentId)}`)
    : view.kind === 'conversations' ? 'Conversations' : view.kind === 'knowledge' ? 'Knowledge' : view.kind === 'settings' ? 'Settings' : view.kind === 'profile' ? 'Profile' : view.kind === 'house' ? 'House style' : view.kind === 'chains' ? 'Chain Agents' : view.kind === 'privacy' ? 'Your privacy' : view.kind === 'connections' ? 'Connections' : view.kind === 'today' ? 'Today' : view.kind === 'learn' ? 'Watch and Learn' : view.kind === 'routines' ? 'Routines' : libraryTitle;
  useEffect(() => { document.title = view.kind === 'library' ? PRODUCT_NAME : `${title} · ${PRODUCT_NAME}`; }, [view, title]);
  // An agent opened from a link, a conversation or a search while another field is open: the library follows its field,
  // so «To the library» returns to where the agent lives (and the bar's Field picker says so).
  useEffect(() => {
    const id = view.kind === 'run' || (view.kind === 'edit' && !view.isNew) ? view.agentId : undefined;
    const opened = id ? findAgent(id) : undefined;
    if (opened && opened.id !== ASSISTANT_ID && readSettings().field !== 'all' && opened.field !== readSettings().field) { library.current = { ...library.current, category: '', scroll: 0 }; updateSettings({ field: opened.field }); }
  }, [view]);

  const section: Section = view.kind === 'conversations' ? 'conversations' : view.kind === 'knowledge' ? 'knowledge' : view.kind === 'settings' || view.kind === 'privacy' ? 'settings' : view.kind === 'profile' ? 'profile'
    : view.kind === 'house' ? 'house' : view.kind === 'chains' ? 'chains' : view.kind === 'connections' ? 'connections' : view.kind === 'today' ? 'today' : view.kind === 'learn' ? 'library' : view.kind === 'routines' ? 'routines'
    : view.kind === 'library' && library.current.owner === 'favourites' ? 'favourites' : 'library';
  const goSection = (id: Section) => {
    if (id === 'library') { if (library.current.owner === 'favourites') library.current = { ...library.current, owner: 'all', category: '', scroll: 0 }; go({ kind: 'library' }); }
    else if (id === 'favourites') { library.current = { ...library.current, owner: 'favourites', category: '', scroll: 0 }; go({ kind: 'library' }); }
    else go({ kind: id });
  };
  // «Cancel» in the editor returns where it was opened from: the agent's page, or the library.
  // A ready-made agent opens at «/agents/ready-…/edit» and is customised there (a copy, by the URL), so a reload keeps it.
  const edit = (agent: AgentDefinition, from?: { agentId: string; chatId?: string }) => go({ kind: 'edit', agentId: agent.id, isNew: false, from });
  const favourite = (id: string) => { const on = toggleFavourite(id); toast(on ? 'Added to favourites' : 'Removed from favourites'); };
  // «Search everything»: ⌘K or Ctrl+K from any page.
  const [palette, setPalette] = useState(false);
  // 13 Nov 2026 (code review): «Ask Agents» pressed while already in one of its chats starts a new chat (the page kept
  // its key, so the old conversation stayed on screen while the address said /ask).
  const [freshAsk, setFreshAsk] = useState(0);
  const askAgents = () => { setFreshAsk(n => n + 1); go({ kind: 'run', agentId: ASSISTANT_ID }); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(value => !value); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pick = (target: PaletteTarget) => {
    setPalette(false);
    if (target.kind === 'agent') go({ kind: 'run', agentId: target.id });
    else if (target.kind === 'chain') go({ kind: 'chains', chainId: target.id });
    else if (target.id === 'ask') askAgents();
    else if (target.id === 'build') go({ kind: 'build' });
    else if (target.id === 'learn') go({ kind: 'learn' });
    else goSection(target.id);
  };

  let page: React.ReactNode;
  if (view.kind === 'library') {
    page = <LibraryPage title={libraryTitle} settings={settings} state={library.current} onState={patch => { library.current = { ...library.current, ...patch }; redraw(n => n + 1); }} ready={fieldReady} mine={fieldMine} favourites={favourites} language={settings.language}
      draft={draft} onContinueDraft={() => { const kept = readAgentDraft(); if (!kept) return; clearAgentDraft(); go({ kind: 'edit', agent: kept.agent, isNew: kept.isNew, restored: true, ...(kept.from ? { lessonsFrom: kept.from } : {}) }); }} onDiscardDraft={() => { clearAgentDraft(); redraw(n => n + 1); }}
      onFavourite={favourite} onUse={agent => go({ kind: 'run', agentId: agent.id })} onEdit={agent => edit(agent)} onNew={() => go({ kind: 'build' })}
      everyAgent={everyAgent} allMine={mine} shared={shared} onDropShared={() => setShared(null)} onUseTask={(agent, task) => { const files = shared?.files; setShared(null); go({ kind: 'run', agentId: agent.id, prefill: task, ...(files?.length ? { files } : {}) }); }} onBuildTask={(task, taskField) => go({ kind: 'build', prefill: task, field: taskField })} />;
  } else if (view.kind === 'build') {
    page = <AgentBuilder key={view.auto ? `auto:${view.prefill}` : 'build'} settings={settings} initialDescription={view.prefill} initialField={view.field} autoStart={view.auto} onAsk={question => go({ kind: 'run', agentId: ASSISTANT_ID, prefill: question, auto: true })} onCancel={() => go({ kind: 'library' })} onBlank={() => go({ kind: 'edit', agent: blankAgent(view.field ?? field.id), isNew: true })}
      onBuilt={(agent, summary) => go({ kind: 'edit', agent, isNew: true, built: summary }, true)} />;
  } else if (view.kind === 'edit') {
    // «/new/edit» opened by its URL (a reload, a bookmark) is a blank agent, as «Start blank» gives.
    if (view.isNew && !view.agent && !draft) blankNew.current ??= blankAgent(field.id);
    const found = view.agent ?? (view.agentId ? findAgent(view.agentId) : undefined) ?? (view.isNew ? draft?.agent ?? blankNew.current ?? undefined : undefined);
    let agent = found, isNew = view.isNew;
    if (found && found.origin === 'ready' && !view.isNew) {
      if (customised.current?.source !== found.id) customised.current = { source: found.id, agent: copyAgent(found) };
      agent = customised.current.agent; isNew = true;
    }
    // «Customise» on a library agent: the copy shows and keeps the lessons taught to the original (12 Nov 2026).
    const lessonsFrom = (found && found.origin === 'ready' && !view.isNew ? found.id : undefined) ?? view.lessonsFrom;
    if (!agent) page = <Missing onBack={() => go({ kind: 'library' })} />;
    else page = <AgentEditor key={agent.id} agent={agent} isNew={isNew} built={view.built} restored={view.restored} settings={settings} lessonsFrom={lessonsFrom}
      onCancel={() => go(view.from ? { kind: 'run', agentId: view.from.agentId, chatId: view.from.chatId } : { kind: 'library' })}
      onSaved={saved => { if (lessonsFrom && readLessons(lessonsFrom).length) addLessons(saved.id, readLessons(lessonsFrom)); toast(isNew ? 'Agent saved to My agents' : 'Changes saved'); go({ kind: 'run', agentId: saved.id, ...(view.from?.agentId === saved.id && view.from.chatId ? { chatId: view.from.chatId } : {}) }); }}
      onDeleted={() => { toast('Agent deleted'); go({ kind: 'library' }); }} />;
  } else if (view.kind === 'run') {
    const agent = findAgent(view.agentId);
    // A conversation of another agent in the URL is not opened under this one.
    const chatId = view.chatId && agent && findChat(view.chatId)?.agentId === agent.id ? view.chatId : undefined;
    if (!agent) page = <Missing onBack={() => go({ kind: 'library' })} />;
    else page = <AgentRunPage key={`${agent.id}:${freshAsk}`} agent={agent} chatId={chatId} favourite={favourites.includes(agent.id)} settings={settings}
      onBack={() => go({ kind: 'library' })} onEdit={() => edit(agent, { agentId: agent.id, chatId })} onFavourite={() => favourite(agent.id)}
      onOpenChat={id => go({ kind: 'run', agentId: agent.id, chatId: id })} onNewChat={() => go({ kind: 'run', agentId: agent.id })}
      // A country picked in one conversation stays in that conversation (12 Nov 2026: one pick made Australia every agent's
      // country); the workspace's own is chosen only in Settings.
      onSavedChat={id => { setLiveChat(id); history.replaceState(null, '', urlFromView({ kind: 'run', agentId: agent.id, chatId: id })); }}
      prefill={view.prefill} files={view.files} onOpenAgent={id => go({ kind: 'run', agentId: id })} onPrivacy={() => go({ kind: 'privacy' })}
      autoSend={view.auto} onUseAgent={(id, task, files) => go({ kind: 'run', agentId: id, ...(task ? { prefill: task, auto: true } : {}), ...(files?.length ? { files } : {}) })} onBuild={description => go({ kind: 'build', prefill: description, auto: true })} />;
  } else if (view.kind === 'conversations') page = <ConversationsPage onOpen={(agentId, chatId) => go({ kind: 'run', agentId, chatId })} />;
  else if (view.kind === 'knowledge') page = <KnowledgePage onEdit={id => go({ kind: 'edit', agentId: id, isNew: false })} onNew={() => go({ kind: 'build' })} />;
  else if (view.kind === 'profile') page = <AccountPage settings={settings} />;
  else if (view.kind === 'house') page = <HouseStylePage />;
  else if (view.kind === 'chains') page = <ChainsPage chainId={view.chainId} settings={settings} onSelect={id => go({ kind: 'chains', ...(id ? { chainId: id } : {}) })} onOpenAgent={id => go({ kind: 'run', agentId: id })} />;
  else if (view.kind === 'privacy') page = <PrivacyPage settings={settings} />;
  else if (view.kind === 'learn') page = <LearnPage onBuild={task => go({ kind: 'build', prefill: task })} />;
  else if (view.kind === 'today') page = <TodayPage settings={settings} onGo={id => id === 'learn' ? go({ kind: 'learn' }) : goSection(id)} onTask={task => go({ kind: 'run', agentId: ASSISTANT_ID, prefill: task, auto: true })} />;
  else if (view.kind === 'connections') page = <ConnectionsPage settings={settings} onRoutines={() => go({ kind: 'routines' })} onProfile={() => go({ kind: 'profile' })} />;
  else if (view.kind === 'routines') page = <RoutinesPage settings={settings} onConnections={() => go({ kind: 'connections' })} onProfile={() => go({ kind: 'profile' })} />;
  else page = <SettingsPage settings={settings} onPrivacy={() => go({ kind: 'privacy' })} />;

  return <div className="nomos-shell">
    {palette && <CommandPalette agents={everyAgent} onPick={pick} onClose={() => setPalette(false)} />}
    <Rail onSearch={() => setPalette(true)} section={section} title={title} recent={recent} activeChat={view.kind === 'run' ? view.chatId ?? liveChat : undefined} onNew={askAgents} onGo={goSection} onOpenChat={(agentId, chatId) => go({ kind: 'run', agentId, chatId })} />
    <WebLinks view={view} page={page} />
  </div>;
}

/** Every web link in the app opens in the right panel, in the app (12 Nov 2026, his «all web opens in the app, in the
 *  right panel»): one catcher for pages that do not dock a reader of their own (Routines, Connections, Knowledge…).
 *  Pages that do (an agent's chat, Today) handle the click first and stop it. A link marked data-new-tab (Reply in
 *  Gmail) still leaves the app. */
function WebLinks({ view, page }: { view: View; page: React.ReactNode }) {
  const [url, setUrl] = useState<string | null>(null);
  const stage = useRef<HTMLElement>(null);
  useEffect(() => { setUrl(null); }, [view]);
  useEffect(() => {
    // On the document, not the stage: React runs a page's own click handlers at its root, which is below the document,
    // so a page that opens the link itself (an agent's chat, Today) has already stopped it when this runs. On the stage
    // this ran first and the chat then opened a second panel (12 Nov 2026).
    const click = (event: MouseEvent) => {
      if (!stage.current?.contains(event.target as Node)) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      // A panel that opens its own links (a routine run) is marked data-own-links; a link made to leave the app
      // («Open on the site») is marked data-new-tab (src/data/link-rules.ts).
      const href = link ? panelUrl({ href: link.href, newTab: link.hasAttribute('data-new-tab'), download: link.hasAttribute('download'), ownLinks: !!link.closest('[data-own-links]') }, window.location.origin) : null;
      if (!href) return;
      event.preventDefault(); setUrl(href);
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, []);
  const close = useCallback(() => setUrl(null), []);
  return <main ref={stage} className={`nomos-stage${url ? ' has-web' : ''}`}>
    {/* The same wrapper open or shut, so opening a link never remounts the page (its scroll, open runs). */}
    <div className="nomos-stage-split"><div className="nomos-stage-page">{page}</div>
      {url && <OfficialWebsiteViewer key={url} url={url} language="en" onClose={close} />}</div>
  </main>;
}

function Missing({ onBack }: { onBack(): void }) {
  return <div className="nomos-missing"><Wand2 size={26} /><b>This agent is not here</b><p>It may have been deleted, or the link belongs to another browser's agents.</p><button type="button" className="nomos-btn" onClick={onBack}>Back to the library</button></div>;
}
