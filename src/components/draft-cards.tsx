// The replies an agent proposed (11 Nov 2026, «approve and send»): read, edit, then Send — which asks once more,
// naming the recipient, before anything leaves. The demo inbox shows them but never sends.
import React, { useState } from 'react';
import { Check, Loader2, Pencil, Send, X } from 'lucide-react';
import { CONNECTOR_BY_ID, isConnectorId } from '../../shared/connections.ts';
import { ConnectionsError } from '../data/connections.ts';
import { sendReply, type Draft } from '../data/send-reply.ts';

const FAILURES: Record<string, string> = { sign_in: 'Sign in first.', not_configured: 'Connections are not switched on.', message_not_found: 'The original message is no longer in your mailbox.', send_failed: 'Your mail service refused it. Nothing was sent.', invalid_input: 'The reply is empty or too long (5,000 characters at most).' };

function DraftCard({ draft, demo }: { draft: Draft; demo: boolean }) {
  const [text, setText] = useState(draft.body);
  const [state, setState] = useState<'edit' | 'confirm' | 'sending' | 'sent'>('edit');
  const [error, setError] = useState('');
  const [to, setTo] = useState('');
  const service = isConnectorId(draft.service) ? CONNECTOR_BY_ID[draft.service].name : draft.service;
  const send = async () => {
    setState('sending'); setError('');
    try { setTo((await sendReply(draft, text)).to); setState('sent'); }
    catch (failure) { setError(failure instanceof ConnectionsError ? FAILURES[failure.code] ?? 'It could not be sent. Nothing was sent.' : 'It could not be sent.'); setState('edit'); }
  };
  return <li className="mn-draft" data-state={state}>
    <p className="mn-draft-head"><b>Reply to {draft.to || 'the sender'}</b><small>Re: {draft.subject || '(no subject)'} · {service}</small></p>
    {state === 'sent' ? <p className="mn-draft-sent"><Check size={14} aria-hidden="true" />Sent from your {service} to {to || draft.to}.</p>
    : <>
      <textarea value={text} onChange={event => setText(event.target.value)} rows={Math.min(10, Math.max(3, text.split('\n').length + 1))} maxLength={5000} disabled={state !== 'edit'} aria-label={`Reply to ${draft.to}`} />
      {error && <p className="mn-draft-error" role="alert">{error}</p>}
      {state === 'confirm' ? <p className="mn-draft-confirm"><span>Send this reply from your {service} to <b>{draft.to}</b>? It cannot be taken back.</span>
          <button type="button" className="nomos-btn" onClick={() => setState('edit')}><X size={13} aria-hidden="true" />Not yet</button>
          <button type="button" className="nomos-btn is-primary" onClick={() => void send()}><Send size={13} aria-hidden="true" />Yes, send</button></p>
      : <p className="mn-draft-actions">{demo ? <small>Demo inbox: invented message, nothing to send.</small> : <small><Pencil size={12} aria-hidden="true" />Edit freely. Nothing is sent until you confirm.</small>}
          <button type="button" className="nomos-btn is-primary" disabled={demo || !text.trim() || state === 'sending'} onClick={() => setState('confirm')}>
            {state === 'sending' ? <Loader2 size={13} className="mn-conn-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}Send</button></p>}
    </>}
  </li>;
}

export function DraftCards({ drafts, demo }: { drafts: Draft[]; demo: boolean }) {
  if (!drafts.length) return null;
  return <section className="mn-drafts" aria-label="Replies ready to send"><h3>Replies ready for you<small>{drafts.length}</small></h3>
    <ul>{drafts.map(draft => <DraftCard key={`${draft.service}:${draft.messageId}`} draft={draft} demo={demo} />)}</ul></section>;
}
