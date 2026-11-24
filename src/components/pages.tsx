// The rail's other destinations, in the agents' own chrome: Conversations (every chat, searchable), Knowledge (the
// reference material of the user's agents), Settings (jurisdiction, language, model, the AI connection as the server
// reports it) and Profile.
import React, { useEffect, useState } from 'react';
import { BookOpen, FileText, MessageSquareText, Pencil, Search, Settings2, Trash2, UserRound, X } from 'lucide-react';
import { placeName } from '../../shared/official-sources.ts';
import { languageName, OUTPUT_LANGUAGES, type OutputLanguage } from '../../shared/product.ts';
import { serverStatus, type ServerStatus } from '../data/api.ts';
import { FIELDS } from '../../shared/fields.ts';
import { deleteChat, findAgent, readChats, readMyAgents, restoreChat, updateSettings, useStoreVersion, type Settings } from '../data/store.ts';
import { kchars, useToast } from './chrome.tsx';
import { jurisdictionName, searchablePlaces, ToolBar, whenLabel } from './nomos-chrome.tsx';

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

export function ConversationsPage({ onOpen }: { onOpen(agentId: string, chatId: string): void }) {
  useStoreVersion(); const toast = useToast();
  const [query, setQuery] = useState('');
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  const chats = readChats().filter(chat => chat.messages.length).filter(chat => { const text = fold(`${chat.title} ${findAgent(chat.agentId)?.name ?? ''} ${chat.messages.map(message => message.content).join(' ')}`); return words.every(word => text.includes(word)); });
  return <div className="nomos-tool-scroll mn-agents">
    <ToolBar icon={MessageSquareText} title="Conversations" end={<span className="mn-agents-bar-end">
      <label className="mn-agents-search"><Search size={14} aria-hidden="true" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear"><X size={13} aria-hidden="true" /></button>}</label></span>} />
    <div className="mn-pages-body">
      {!chats.length ? <div className="mn-pages-empty"><MessageSquareText size={26} /><b>{query ? 'Nothing matches' : 'No conversations yet'}</b><p className="mn-pages-lead">{query ? 'Try another word.' : 'Open an agent in the library and ask it something; every conversation is kept here, with its documents.'}</p></div>
      : <div className="nomos-external-cases">{chats.map(chat => { const agent = findAgent(chat.agentId); const place = jurisdictionName(chat.jurisdiction);
        const remove = () => { const gone = deleteChat(chat.id); if (gone) toast('Conversation deleted', { label: 'Undo', run: () => restoreChat(gone) }); };
        return <div key={chat.id} className="mn-pages-row">
        <button type="button" onClick={() => onOpen(chat.agentId, chat.id)}>
          <span><span className="nomos-home-panel-icon"><MessageSquareText size={14} aria-hidden="true" /></span><span><b>{chat.title}</b><small>{agent?.name ?? 'Deleted agent'} · {plural(chat.messages.filter(message => message.role === 'user').length, 'question')}{chat.documents.length ? ` · ${plural(chat.documents.length, 'document')}` : ''}{chat.jurisdiction ? <> · {place.flag} {place.name}</> : null}</small></span></span>
          <span className="mn-pages-row-end">{whenLabel(chat.updatedAt)}</span>
        </button>
        <button type="button" className="mn-pages-row-delete" aria-label={`Delete ${chat.title}`} title="Delete" onClick={remove}><Trash2 size={14} aria-hidden="true" /></button>
      </div>; })}</div>}
    </div>
  </div>;
}

export function KnowledgePage({ onEdit, onNew }: { onEdit(agentId: string): void; onNew(): void }) {
  useStoreVersion();
  const agents = readMyAgents();
  const withKnowledge = agents.filter(agent => agent.knowledge.length);
  return <div className="nomos-tool-scroll mn-agents">
    <ToolBar icon={BookOpen} title="Knowledge" />
    <div className="mn-pages-body">
      <p className="mn-pages-lead">Reference material is attached to an agent and read on every run: your standard positions, templates, past examples. It stays in this browser. Documents attached inside a conversation belong to that conversation.</p>
      {!withKnowledge.length ? <div className="mn-pages-empty"><BookOpen size={26} /><b>No reference material yet</b><p className="mn-pages-lead">{agents.length ? 'Open one of your agents and add files under «Reference material».' : 'Build an agent of your own first; ready-made agents carry no private material.'}</p>{!agents.length && <button type="button" className="nomos-btn is-primary" onClick={onNew}>New agent</button>}
        {/* 13 Nov 2026: the empty page said what to do but gave nothing to press. */}
        {agents.length > 0 && <span className="mn-pages-picks">{agents.slice(0, 6).map(agent => <button key={agent.id} type="button" className="nomos-btn" onClick={() => onEdit(agent.id)}><Pencil size={13} aria-hidden="true" /><span>{agent.name}</span></button>)}</span>}</div>
      : <div className="nomos-external-cases">{withKnowledge.map(agent => <button key={agent.id} type="button" onClick={() => onEdit(agent.id)}>
        <span><span className="nomos-home-panel-icon is-document"><FileText size={14} aria-hidden="true" /></span><span><b>{agent.name}</b><small>{agent.knowledge.map(file => file.name).join(' · ')}</small></span></span>
        <span className="mn-pages-row-end">{kchars(agent.knowledge.reduce((sum, file) => sum + file.text.length, 0))}<Pencil size={14} aria-hidden="true" /></span>
      </button>)}</div>}
    </div>
  </div>;
}

export function SettingsPage({ settings, onPrivacy }: { settings: Settings; onPrivacy?(): void }) {
  const [status, setStatus] = useState<ServerStatus | null | 'loading'>('loading');
  useEffect(() => { serverStatus().then(setStatus); }, []);
  const place = jurisdictionName(settings.jurisdiction);
  return <div className="nomos-tool-scroll mn-agents">
    <ToolBar icon={Settings2} title="Settings" />
    <div className="mn-pages-body">
      {/* 13 Nov 2026: the one main page without a heading. */}
      <header className="mn-hs-hero"><h1>Settings</h1><p>Where agents research, the language they write in, the AI they use, and what leaves this browser.</p></header>
      <form className="mn-agents-form" onSubmit={event => event.preventDefault()}>
      <label><span>Research jurisdiction</span>
        <select value={settings.jurisdiction ?? ''} onChange={event => updateSettings({ jurisdiction: event.target.value || null })} aria-label="Research jurisdiction">
          <option value="">Choose jurisdiction</option>
          <optgroup label="Official sources">{searchablePlaces().map(item => <option key={item.code} value={item.code}>{item.flag} {placeName(item, true)}</option>)}</optgroup>
        </select>
        <small className="mn-agents-hint">The place whose official sources agents research when they have none of their own. Agents built for one place keep theirs. Nothing is chosen for you{place.supported ? '' : ' — none is chosen now'}.</small></label>
      <div className="mn-agents-form-row">
        <label><span>Answer language</span><select value={settings.language} onChange={event => updateSettings({ language: event.target.value as OutputLanguage })} aria-label="Answer language">{OUTPUT_LANGUAGES.map(code => <option key={code} value={code}>{languageName(code)}</option>)}</select>
          <small className="mn-agents-hint">Agents write in this language unless you write to them in another.</small></label>
        <div><span style={{ display: 'block', marginBottom: 8, color: 'var(--brand-ink-soft)', font: '600 12px/1.3 var(--brand-font-sans)' }}>Model</span>
          <div className="mn-agents-mode" role="radiogroup" aria-label="Model">
            {(['quality', 'balanced'] as const).map(model => <button key={model} type="button" role="radio" aria-checked={settings.model === model} onClick={() => updateSettings({ model })}>
              <b>{model === 'quality' ? 'Quality' : 'Balanced'}</b><small>{model === 'quality' ? 'The best answer, a little slower' : 'Faster, for quick everyday questions'}</small></button>)}
          </div></div>
      </div>
      <fieldset><legend>Privacy</legend>
        <label className="mn-agents-toggle"><input type="checkbox" checked={settings.hideNames} onChange={event => updateSettings({ hideNames: event.target.checked })} />
          <span><b>Hide names from the AI</b><small>Before a question leaves this browser, names, companies, e-mail addresses, phone, ID and bank numbers and street addresses in the documents and messages are replaced with placeholders such as [PERSON 1]; the answer shows the real names again. Each conversation can turn it off, keep an item visible or hide more.</small></span></label>
        {onPrivacy && <button type="button" className="mn-agents-task-build" onClick={onPrivacy}>How your data is protected, item by item</button>}</fieldset>
      <fieldset><legend>My fields</legend>
        <span className="mn-pages-fields">{FIELDS.map(field => <button key={field.id} type="button" className="nomos-btn" aria-pressed={settings.fields.includes(field.id)} style={settings.fields.includes(field.id) ? { borderColor: 'var(--brand-gold)', background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-hover)' } : undefined}
          onClick={() => { const rest = settings.fields.filter(id => id !== field.id); if (settings.fields.includes(field.id) && !rest.length) return; updateSettings({ fields: settings.fields.includes(field.id) ? rest : [...settings.fields, field.id] }); }}>{field.name}</button>)}</span>
        <small className="mn-agents-hint">The fields you work in: they come first in the bar's Field picker, after «All fields», and a new agent made under «All fields» starts in the first of them.</small></fieldset>
      <fieldset><legend>AI connection</legend>
        <span className="mn-pages-status"><i className={status === 'loading' ? '' : status?.configured ? 'is-on' : 'is-off'} />{status === 'loading' ? 'Checking…' : status?.configured ? 'Connected' : 'Not connected'}</span>
        <small className="mn-agents-hint">{status === 'loading' ? 'Checking the server…' : status === null ? 'The server routes did not answer (run the app with npm run dev or deploy the api/ routes).' : status.configured ? <>Quality model: {status.models.quality === 'configured' ? 'configured on the server' : 'the server default'} · Balanced model: {status.models.balanced === 'configured' ? 'configured on the server' : 'the server default'} · Official-site search {status.search ? 'on' : 'off'}.</> : <>Put <code>OPENAI_API_KEY</code> in <code>.env.local</code> and restart the server. Nothing is simulated meanwhile.</>}</small></fieldset>
      <fieldset><legend>E-mail, WhatsApp and Telegram</legend>
        <span className="mn-pages-fields">{(['email', 'whatsapp', 'telegram'] as const).map(channel => <span key={channel} className="mn-pages-status"><i className={status === 'loading' ? '' : status?.channels?.[channel] ? 'is-on' : 'is-off'} />{channel === 'email' ? 'E-mail' : channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'}: {status === 'loading' ? 'checking…' : status?.channels?.[channel] ? 'connected' : 'not set up'}</span>)}</span>
        <small className="mn-agents-hint">Forward an e-mail, or send a WhatsApp or Telegram message, and the answer comes back on the same channel with the Word file. Each is off until the owner sets it up on the server (docs/smart-features.md lists the settings; Telegram needs TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHATS); only the addresses, numbers and chats on the server's list are ever answered.</small></fieldset>
      <fieldset><legend>Official sources</legend>
        <small className="mn-agents-hint">Live research is limited to the catalogue's official websites of the chosen jurisdiction (at most 100 hosts), plus any websites set on an agent (a newspaper, for example); never the open web. A place without sources is unsupported and never searched.</small></fieldset>
    </form></div>
  </div>;
}

export function ProfilePage({ settings }: { settings: Settings }) {
  return <div className="nomos-tool-scroll mn-agents">
    <ToolBar icon={UserRound} title="Profile" />
    <div className="mn-pages-body"><form className="mn-agents-form" onSubmit={event => event.preventDefault()}>
      <label><span>Your name</span><input value={settings.name} maxLength={80} onChange={event => updateSettings({ name: event.target.value })} placeholder="Name" />
        <small className="mn-agents-hint">Kept in this browser; nothing else uses it. Accounts and sign-in are not part of this build.</small></label>
      <fieldset><legend>About</legend>
        <a className="mn-agents-task-build" href="/welcome">What Agents is and how it works: the welcome page</a></fieldset>
    </form></div>
  </div>;
}

/** «1 question», «2 questions» (12 Nov 2026: the list said «1 questions»). */
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
