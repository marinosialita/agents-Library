// «/» in the chat box (7 Nov 2026, his request): a short menu at the caret. Commands (attach documents, hide or show
// names, how it works, a new conversation), this agent's own suggestions, and every other agent of the platform: a
// picked agent answers the next question here, in this conversation, with the same documents.
import React from 'react';
import { AtSign, CircleHelp, Paperclip, Plus, ShieldCheck, ShieldOff } from 'lucide-react';
import { fieldById } from '../../shared/fields.ts';
import type { SlashCommand, SlashItem } from '../data/slash.ts';
import { categoryLabel } from './library.tsx';

export { slashItems, slashToken, type SlashCommand, type SlashItem } from '../data/slash.ts';

const ICON: Record<SlashCommand, typeof Plus> = { documents: Paperclip, names: ShieldCheck, guide: CircleHelp, new: Plus };

export function SlashMenu({ id, items, active, query, hiding, test, onPick, onHover }: { id: string; items: SlashItem[]; active: number; query: string; hiding: boolean; test: boolean; onPick(item: SlashItem): void; onHover(index: number): void }) {
  const head = (kind: SlashItem['kind'], index: number) => index === items.findIndex(item => item.kind === kind)
    ? <li role="presentation" className="mn-agent-slash-head">{kind === 'command' ? 'Commands' : kind === 'starter' ? 'Suggestions' : 'Ask another agent'}</li> : null;
  return <ul id={id} className="mn-agent-slash" role="listbox" aria-label="Commands and agents">
    {items.map((item, index) => <React.Fragment key={item.kind === 'agent' ? item.agent.id : item.kind === 'command' ? item.id : `s-${item.text}`}>
      {head(item.kind, index)}
      <li role="option" id={`${id}-${index}`} aria-selected={index === active}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => onPick(item)}>
        {item.kind === 'command' ? <>{(Icon => <Icon size={14} aria-hidden="true" />)(item.id === 'names' && hiding ? ShieldOff : ICON[item.id])}<span><b>{item.label}</b><small>{item.hint}</small></span></>
          : item.kind === 'starter' ? <><CircleHelp size={14} aria-hidden="true" /><span><b>{item.text}</b></span></>
          : <><AtSign size={14} aria-hidden="true" /><span><b>{item.agent.name}</b><small>{fieldById(item.agent.field)?.name} · {categoryLabel(item.agent.category)}</small></span></>}
      </li>
    </React.Fragment>)}
    {!test && !query && !items.some(item => item.kind === 'agent') && <li role="presentation" className="mn-agent-slash-foot">Type a name after «/» to ask another agent.</li>}
  </ul>;
}
