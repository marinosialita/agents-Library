// The side rail (reference nomos-navigation.tsx, in its look): collapsed to its icons, it peeks open on hover and
// pins open with the chevrons; on a phone it is a bar at the top and a drawer. Its destinations are this product's
// only: New agent, Library, Conversations, Knowledge, Chains, House style; the recent conversations; Settings
// and Profile.
import React, { useEffect, useRef, useState } from 'react';
import { CalendarClock, ChevronsLeft, ChevronsRight, LayoutGrid, Library, MessageSquare, Palette, Plug, Plus, Search, Settings, UserRound, Workflow, X, Sun } from 'lucide-react';
import { PRODUCT_NAME } from '../../shared/product.ts';
import type { AgentChat } from '../data/store.ts';

export type Section = 'today' | 'library' | 'favourites' | 'conversations' | 'knowledge' | 'chains' | 'house' | 'connections' | 'routines' | 'settings' | 'profile';
export type RailProps = { section: Section; title: string; recent: (AgentChat & { agentName: string })[]; activeChat?: string; onNew(): void; /** Opens «Search everything» (⌘K). */ onSearch(): void; onGo(section: Section): void; onOpenChat(agentId: string, chatId: string): void };

const ROWS: { id: Section; label: string; Icon: typeof LayoutGrid }[] = [
  // 11 Nov 2026 (after the Lindy study): the morning page first.
  { id: 'today', label: 'Today', Icon: Sun },
  { id: 'library', label: 'Library', Icon: LayoutGrid },
  { id: 'conversations', label: 'Conversations', Icon: MessageSquare }, { id: 'knowledge', label: 'Knowledge', Icon: Library },
  // 7 Nov 2026 (his request): agents one after another, and the house style every agent follows.
  { id: 'chains', label: 'Chain Agents', Icon: Workflow }, { id: 'house', label: 'House style', Icon: Palette },
  // 10 Nov 2026 (his «connect my gmail … a brief every morning»): the owner's apps and the first connected agent.
  { id: 'connections', label: 'Connections', Icon: Plug },
  { id: 'routines', label: 'Routines', Icon: CalendarClock },
];

/** The conversations by day, as the reference groups them: today, yesterday, the last week, earlier. */
function groups<T extends { updatedAt: number }>(chats: T[]): { label: string; chats: T[] }[] {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = start.getTime(), day = 86_400_000;
  const label = (at: number) => (at >= today ? 'Today' : at >= today - day ? 'Yesterday' : at >= today - 7 * day ? 'Previous 7 days' : 'Earlier');
  const out: { label: string; chats: T[] }[] = [];
  for (const chat of chats) { const name = label(chat.updatedAt); const last = out.at(-1); if (last && last.label === name) last.chats.push(chat); else out.push({ label: name, chats: [chat] }); }
  return out;
}

function Mark({ className, id }: { className?: string; id: string }) {
  return <svg className={className} viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#A58CFA" /><stop offset=".6" stopColor="#7352E8" /><stop offset="1" stopColor="#5B3DD1" /></linearGradient></defs>
    <rect width="32" height="32" rx="9" fill={`url(#${id})`} /><path d="M10 23.5 16 9l6 14.5M12.6 18.6h6.8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

export function Rail({ section, title, recent, activeChat, onNew, onSearch, onGo, onOpenChat }: RailProps) {
  const [mobileViewport, setMobileViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  // Each visit starts with the narrow rail, so the workspace opens with the most room.
  const [collapsed, setCollapsed] = useState(true);
  // Hovering the rail previews the menu over the page; it closes when the pointer leaves; the chevrons keep it open.
  const [peek, setPeek] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const rail = collapsed && !peek;
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => setMobileViewport(query.matches);
    update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update);
  }, []);
  const peekTimer = useRef<number | null>(null);
  const cancelPeekTimer = () => { if (peekTimer.current !== null) window.clearTimeout(peekTimer.current); peekTimer.current = null; };
  const closePeek = () => { cancelPeekTimer(); setPeek(false); };
  const openPeek = () => { if (!collapsed) return; cancelPeekTimer(); peekTimer.current = window.setTimeout(() => { peekTimer.current = null; setPeek(true); }, 160); };
  const leavePeek = () => { cancelPeekTimer(); peekTimer.current = window.setTimeout(() => { peekTimer.current = null; setPeek(false); }, 160); };
  useEffect(() => () => cancelPeekTimer(), []);
  useEffect(() => { if (mobileViewport) closePeek(); }, [mobileViewport]);
  const closeMobile = () => setMobileOpen(false);
  useEffect(() => {
    const element = drawer.current; if (!element) return;
    if (mobileOpen && mobileViewport) { element.inert = false; if (!element.open) element.showModal(); return; }
    if (element.open) element.close();
    element.inert = true;
  }, [mobileViewport, mobileOpen]);
  const act = (action: () => void) => { closePeek(); if (mobileOpen) closeMobile(); action(); };
  const content = (mobile: boolean) => { const tip = (label: string) => (!mobile && rail ? { 'data-tip': label, 'aria-label': label, title: label } : { title: label }); return <>
    <header className="nm-nav-brand">
      <Mark className="nm-nav-mark" id={mobile ? 'ap-mark-drawer' : 'ap-mark-rail'} />
      <span className="nm-nav-wordmark"><em>{PRODUCT_NAME}</em></span>
      <button type="button" className="nm-nav-icon-button nm-nav-collapse" onClick={mobile ? closeMobile : () => { closePeek(); setCollapsed(value => !value); }} aria-label={mobile ? 'Close menu' : collapsed ? 'Expand menu' : 'Collapse menu'} {...(!mobile && rail ? { 'data-tip': 'Expand menu' } : { title: mobile ? 'Close menu' : collapsed ? 'Pin menu' : 'Collapse menu' })} aria-expanded={mobile ? undefined : !collapsed}>
        {mobile ? <X size={18} /> : collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
      </button>
    </header>
    <nav className="nm-nav-actions" aria-label="Main navigation">
      <button type="button" className="nm-nav-row nm-nav-new" {...tip('Ask Agents: find, build, ask anything')} onClick={() => act(onNew)}><Plus size={18} aria-hidden="true" /><span>Ask Agents</span></button>
      <button type="button" className="nm-nav-row" {...tip('Search everything (⌘K)')} onClick={() => act(onSearch)}><Search size={18} aria-hidden="true" /><span>Search<kbd className="nm-nav-kbd">⌘K</kbd></span></button>
      {ROWS.map(({ id, label, Icon }) => <button key={id} type="button" className={`nm-nav-row${section === id ? ' is-active' : ''}`} aria-current={section === id ? 'page' : undefined} {...tip(label)} onClick={() => act(() => onGo(id))}><Icon size={17} aria-hidden="true" /><span>{label}</span></button>)}
    </nav>
    <div className="nm-nav-body">
      <section className="nm-nav-history" aria-label="Recent conversations">
        <h2 className="nm-nav-section-label">Your conversations</h2>
        {!recent.length ? <p className="nm-nav-empty">Your conversations will appear here.</p>
          : groups(recent).map(group => <section key={group.label} className="nm-nav-history-group"><h3>{group.label}</h3><ul>{group.chats.map(chat => <li key={chat.id} className="nm-nav-history-row">
            <button type="button" className={`nm-nav-history-item${chat.id === activeChat ? ' is-current' : ''}`} title={`${chat.title} · ${chat.agentName}`} aria-current={chat.id === activeChat ? 'true' : undefined} onClick={() => act(() => onOpenChat(chat.agentId, chat.id))}><span>{chat.title}</span></button>
          </li>)}</ul></section>)}
      </section>
    </div>
    <footer className="nm-nav-footer">
      <button type="button" className={`nm-nav-row nm-nav-settings${section === 'settings' ? ' is-active' : ''}`} {...tip('Settings')} onClick={() => act(() => onGo('settings'))}><Settings size={17} aria-hidden="true" /><span>Settings</span></button>
      <button type="button" className={`nm-nav-row nm-nav-profile${section === 'profile' ? ' is-active' : ''}`} {...tip('Profile')} onClick={() => act(() => onGo('profile'))}><span className="nm-nav-avatar"><UserRound size={16} aria-hidden="true" /></span><span>Profile</span></button>
    </footer>
  </>; };
  return <>
    {!mobileViewport ? <div className={`nm-navigation${rail ? ' is-collapsed' : collapsed ? ' is-peek' : ''}`} onMouseEnter={openPeek} onMouseLeave={leavePeek}>
      <aside className="nm-nav-sidebar" aria-label={PRODUCT_NAME}>{content(false)}</aside>
    </div> : null}
    <div className="nm-nav-mobile-bar">
      <button type="button" className="nm-nav-mobile-toggle" aria-label="Open menu" aria-expanded={mobileOpen} aria-controls="nm-mobile-navigation" onClick={() => setMobileOpen(true)}><Mark className="nm-nav-mobile-mark" id="ap-mark-bar" /></button>
      <span className="nm-nav-mobile-title" title={title}>{title}</span>
    </div>
    <dialog ref={drawer} id="nm-mobile-navigation" className="nm-nav-drawer" aria-label={`${PRODUCT_NAME} menu`} onCancel={event => { event.preventDefault(); closeMobile(); }} onClose={() => { if (mobileOpen) closeMobile(); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeMobile();
    }}>
      <div className="nm-nav-mobile-content">{content(true)}</div>
    </dialog>
  </>;
}
