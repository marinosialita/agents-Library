// The e-mail reading panel (12 Nov 2026, his «press and open the emails in the right panel, 50-50, the same interface as
// Gmail»): a mail client's reading view, the subject on top, the sender row with a round initial, the date on the right,
// the text below and Reply / Forward at the end. Read only: the buttons open the message in the mail app itself.
// The text is shown as text (never as HTML), so nothing in a message can run or restyle the app.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, FileText, Forward, Loader2, Reply, X } from 'lucide-react';
import { loadMail, type OpenMail } from '../data/today.ts';

export type MailTarget = { service: string; id: string; from: string; subject: string; date: string };
const APP: Record<string, string> = { gmail: 'Gmail', outlook: 'Outlook' };
const HUES = [4, 24, 145, 175, 200, 220, 262, 290, 330];

export function splitSender(from: string): { name: string; address: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  if (match) return { name: match[1].trim() || match[2].trim(), address: match[2].trim() };
  return { name: from.trim(), address: /@/.test(from) ? from.trim() : '' };
}
export const mailHue = (text: string) => HUES[[...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % HUES.length];
function when(value: string): string {
  const at = Date.parse(value); if (Number.isNaN(at)) return value;
  const date = new Date(at), today = new Date().toDateString() === date.toDateString();
  const clock = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const minutes = Math.round((Date.now() - at) / 60_000);
  const ago = minutes < 60 ? `${Math.max(1, minutes)} minutes ago` : minutes < 1440 ? `${Math.round(minutes / 60)} hours ago` : `${Math.round(minutes / 1440)} days ago`;
  return `${today ? clock : `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${clock}`} (${ago})`;
}
/** Links in the text become links (http and https only); everything else stays text. */
function linked(text: string) {
  return text.split(/(https?:\/\/[^\s<>"')\]]+)/g).map((part, index) => index % 2
    ? <a key={index} href={part} target="_blank" rel="noopener noreferrer">{part.length > 70 ? `${part.slice(0, 67)}…` : part}</a> : part);
}

// The message's own HTML, as the sender designed it (Gmail shows it so). It sits in a sandbox with no scripts: nothing in it
// can run, reach the app or open anything but a new tab, and the page's own rules allow only pictures and styles to load.
const FRAME_HEAD = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:"><base target="_blank">
<style>html,body{margin:0;padding:0;background:#fff}body{color:#222;font:small/1.5 Arial,Helvetica,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>`;
function MailFrame({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const fit = () => { const doc = frame.current?.contentDocument; if (doc?.documentElement) setHeight(Math.max(80, doc.documentElement.scrollHeight)); };
  useEffect(() => { const timers = [300, 1000, 2500].map(ms => window.setTimeout(fit, ms)); return () => timers.forEach(clearTimeout); }, [html]);
  return <iframe ref={frame} className="mn-mail-frame" title={title} style={{ height }} onLoad={fit}
    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
    srcDoc={`<!doctype html><html><head>${FRAME_HEAD}</head><body>${html}</body></html>`} />;
}

export function MailPanel({ target, onClose }: { target: MailTarget; onClose(): void }) {
  const [mail, setMail] = useState<OpenMail | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    setMail(null); setFailed('');
    const controller = new AbortController();
    loadMail(target.service, target.id, controller.signal).then(setMail, error => { if (!controller.signal.aborted) setFailed(String(error?.message ?? '')); });
    return () => controller.abort();
  }, [target.service, target.id]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);

  // What the brief already knew fills any field the mail app left out.
  const shown = { ...target, to: '', body: '', link: '', ...Object.fromEntries(Object.entries(mail ?? {}).filter(([, value]) => value)) } as OpenMail;
  const sender = splitSender(shown.from);
  const app = APP[target.service] ?? 'mail app';
  return <aside className="mn-mail" aria-label={`E-mail: ${shown.subject || '(no subject)'}`}>
    <div className="mn-mail-bar">
      <button type="button" className="mn-mail-icon" onClick={onClose} aria-label="Back"><ArrowLeft size={18} aria-hidden="true" /></button>
      {mail?.link && <a className="mn-mail-open" href={mail.link} target="_blank" rel="noopener noreferrer" data-new-tab><ExternalLink size={14} aria-hidden="true" />Open in {app}</a>}
      <button type="button" className="mn-mail-icon" onClick={onClose} aria-label="Close"><X size={18} aria-hidden="true" /></button>
    </div>
    <div className="mn-mail-scroll">
      <h2 className="mn-mail-subject">{shown.subject || '(no subject)'}<span className="mn-mail-label">Inbox</span></h2>
      <div className="mn-mail-head">
        <span className="mn-mail-avatar" style={{ '--mail-hue': mailHue(sender.name || '?') } as React.CSSProperties} aria-hidden="true">{(sender.name.match(/\p{L}|\p{N}/u)?.[0] ?? '?').toUpperCase()}</span>
        <div className="mn-mail-who">
          <p><b>{sender.name || 'Unknown sender'}</b>{sender.address && sender.address !== sender.name && <span>&lt;{sender.address}&gt;</span>}</p>
          <small>{shown.to ? `to ${splitSender(shown.to.split(',')[0]).name}${shown.to.includes(',') ? ' and others' : ''}` : 'to me'}</small>
        </div>
        <div className="mn-mail-meta"><time className="mn-mail-date">{when(shown.date)}</time>
          {mail?.link && <a className="mn-mail-icon is-small" data-new-tab href={mail.link} target="_blank" rel="noopener noreferrer" aria-label={`Reply in ${app}`} title="Reply"><Reply size={18} aria-hidden="true" /></a>}</div>
      </div>
      <div className={`mn-mail-body${mail?.html ? ' is-html' : ''}`}>
        {mail ? (mail.html ? <MailFrame html={mail.html} title={`The e-mail «${shown.subject || 'no subject'}»`} /> : mail.body ? linked(mail.body) : <em>This message has no text.</em>)
        : failed ? <p className="mn-mail-error" role="alert">{failed === 'mail_401' ? 'Sign in to open your e-mail.' : failed === 'mail_404' ? 'This message is no longer in your mailbox.' : `The message could not be opened just now. Try again, or open it in ${app}.`}</p>
        : <p className="mn-mail-loading"><Loader2 size={15} className="mn-conn-spin" aria-hidden="true" />Opening the message…</p>}
      </div>
      {!!mail?.attachments?.length && <div className="mn-mail-files">
        <p>{mail.attachments.length === 1 ? 'One attachment' : `${mail.attachments.length} attachments`}</p>
        <ul>{mail.attachments.map((name, index) => <li key={index} title={name}><FileText size={16} aria-hidden="true" /><span>{name}</span></li>)}</ul>
      </div>}
      {mail?.link && <div className="mn-mail-actions">
        <a data-new-tab href={mail.link} target="_blank" rel="noopener noreferrer"><Reply size={16} aria-hidden="true" />Reply</a>
        <a data-new-tab href={mail.link} target="_blank" rel="noopener noreferrer"><Forward size={16} aria-hidden="true" />Forward</a>
      </div>}
    </div>
  </aside>;
}
