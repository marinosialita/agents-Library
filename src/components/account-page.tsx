// «Profile» with accounts (11 Nov 2026): sign in, create an account, or see who is signed in and sign out. Without
// accounts on the server, the page says why and keeps the name used in this browser.
import React, { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Loader2, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { accountStatus, AccountError, signIn, signOut, signUp, type AccountStatus } from '../data/account.ts';
import { updateSettings, type Settings } from '../data/store.ts';
import { ToolBar } from './nomos-chrome.tsx';

const REASONS: Record<string, string> = {
  no_database: 'This server has no lasting database for accounts yet.',
  no_secret: 'This server has no BETTER_AUTH_SECRET yet.',
  weak_secret: 'BETTER_AUTH_SECRET is shorter than 32 characters.',
  no_server: 'The app server is not running.',
};

export function AccountPage({ settings }: { settings: Settings }) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState(settings.name);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = (signal?: AbortSignal) => accountStatus(signal).then(setStatus, () => setStatus({ available: false, reason: 'no_server', user: null, signup: 'closed' }));
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, []);
  useEffect(() => { if (status?.user?.name && status.user.name !== settings.name) updateSettings({ name: status.user.name }); }, [status?.user?.name]);
  const canJoin = status?.signup !== 'closed';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      if (mode === 'up') await signUp(name.trim() || email.split('@')[0], email.trim(), password); else await signIn(email.trim(), password);
      setPassword(''); await load();
    } catch (failure) { setError(failure instanceof AccountError ? failure.message : 'That did not work. Try again.'); }
    finally { setBusy(false); }
  };
  const leave = async () => { setBusy(true); try { await signOut(); } catch { /* the cookie may already be gone */ } finally { setBusy(false); await load(); } };

  return <div className="nomos-tool-scroll mn-acct">
    <ToolBar icon={UserRound} title="Profile" />
    <div className="mn-acct-page">
      {!status ? <p className="mn-acct-loading"><Loader2 size={15} className="mn-conn-spin" aria-hidden="true" />Checking your account…</p>
      : status.user ? <section className="mn-acct-card">
          <span className="mn-acct-avatar" aria-hidden="true">{(status.user.name || status.user.email).trim()[0]?.toUpperCase()}</span>
          <h1>{status.user.name || 'Your account'}</h1>
          <p className="mn-acct-mail"><Mail size={14} aria-hidden="true" />{status.user.email}</p>
          <ul className="mn-acct-facts">
            <li><ShieldCheck size={15} aria-hidden="true" /><span><b>Signed in on this browser</b><small>The session is a secure cookie that lasts 30 days. Nothing about it is kept in the page.</small></span></li>
            <li><KeyRound size={15} aria-hidden="true" /><span><b>Your own connections and routines</b><small>Apps you connect and routines you make belong to this account.</small></span></li>
          </ul>
          <button type="button" className="nomos-btn" onClick={() => void leave()} disabled={busy}><LogOut size={14} aria-hidden="true" /><span>Sign out</span></button>
        </section>
      : !status.available ? <section className="mn-acct-card">
          <span className="mn-acct-avatar is-off" aria-hidden="true"><UserRound size={22} /></span>
          <h1>Accounts are not switched on here</h1>
          <p className="mn-acct-lead">{REASONS[status.reason ?? ''] ?? 'Accounts are off on this server.'} Until then the app works without signing in, and this name stays in this browser.</p>
          <label className="mn-acct-field"><span>Your name</span><input value={settings.name} maxLength={80} onChange={event => updateSettings({ name: event.target.value })} placeholder="Name" /></label>
        </section>
      : <section className="mn-acct-card">
          <h1>{mode === 'in' ? 'Sign in to Agents' : 'Create your account'}</h1>
          <p className="mn-acct-lead">{mode === 'in' ? 'Your connections, routines and agents, on every device.' : status.signup === 'list' ? 'Accounts are by invitation: use the address the owner added.' : 'An e-mail and a password of at least 10 characters.'}</p>
          {canJoin && <div className="mn-brief-source mn-acct-switch" role="radiogroup" aria-label="Sign in or create an account">
            <button type="button" role="radio" aria-checked={mode === 'in'} onClick={() => { setMode('in'); setError(''); }}>Sign in</button>
            <button type="button" role="radio" aria-checked={mode === 'up'} onClick={() => { setMode('up'); setError(''); }}>Create account</button></div>}
          <form className="mn-acct-form" onSubmit={event => void submit(event)}>
            {mode === 'up' && <label className="mn-acct-field"><span>Name</span><input value={name} onChange={event => setName(event.target.value)} maxLength={80} autoComplete="name" placeholder="Your name" /></label>}
            <label className="mn-acct-field"><span>E-mail</span><input type="email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" /></label>
            <label className="mn-acct-field"><span>Password</span><input type="password" required minLength={mode === 'up' ? 10 : 1} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} placeholder={mode === 'up' ? 'At least 10 characters' : 'Your password'} /></label>
            {error && <p className="mn-conn-banner is-warn" role="alert">{error}</p>}
            <button type="submit" className="nomos-btn is-primary mn-acct-submit" disabled={busy || !email.trim() || !password}>{busy ? <Loader2 size={15} className="mn-conn-spin" aria-hidden="true" /> : null}<span>{mode === 'in' ? 'Sign in' : 'Create account'}</span>{!busy && <ArrowRight size={15} aria-hidden="true" />}</button>
          </form>
          {!canJoin && <p className="mn-acct-note">New accounts are closed here. Ask the owner for an invitation.</p>}
        </section>}
      <p className="mn-acct-note"><a href="/welcome">What Agents is and how it works</a></p>
    </div>
  </div>;
}
