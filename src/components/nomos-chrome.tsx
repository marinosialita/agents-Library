// The reference's shared chrome (nomos-chrome.tsx, home-continue-panels.tsx): the 44 px tool bar with its back button,
// the relative time of a row, and the jurisdiction helpers the agent screens share.
import React from 'react';
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import { AGENT_LIMITS } from '../../shared/agents.ts';
import { OFFICIAL_SOURCE_PLACES, placeName, sourcePlace, type SourcePlace } from '../../shared/official-sources.ts';
import type { ChatDocument } from '../data/store.ts';

export function ToolBar({ icon: Icon, title, onBack, backLabel, backDisabled, children, end, className }: { icon?: LucideIcon; title: React.ReactNode; onBack?(): void; backLabel?: string; backDisabled?: boolean; children?: React.ReactNode; end?: React.ReactNode; className?: string }) {
  return <header className={`nomos-bar${className ? ` ${className}` : ''}`}>
    {onBack ? <button type="button" className="nomos-bar-back" aria-label={backLabel} title={backLabel} disabled={backDisabled} onClick={onBack}><ChevronLeft size={17} aria-hidden="true" /></button> : null}
    <span className="nomos-bar-title">{Icon ? <Icon size={16} aria-hidden="true" /> : null}<span>{title}</span></span>
    {children}
    {end ? <div className="nomos-bar-end">{end}</div> : null}
  </header>;
}

/** «4 min ago», «3 h ago», «Yesterday», «Tue», «3 Nov». */
export function whenLabel(ts: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((now - ts) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(ts).toLocaleDateString('en-GB', { weekday: 'short' });
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** A jurisdiction code as its flag and name; an unset one says so, and is never replaced by a default. */
export function jurisdictionName(code: string | null | undefined): { flag: string; name: string; supported: boolean } {
  const place = code ? sourcePlace(code) : undefined;
  if (!place) return { flag: '🌐', name: 'Choose jurisdiction', supported: false };
  return { flag: place.flag, name: placeName(place, true), supported: place.sources.length > 0 };
}
let searchable: SourcePlace[] | null = null;
/** The places whose official websites are catalogued, by name: the only ones an agent can research. */
export function searchablePlaces(): SourcePlace[] {
  return searchable ??= OFFICIAL_SOURCE_PLACES.filter(place => place.sources.length > 0).sort((a, b) => placeName(a, true).localeCompare(placeName(b, true), 'en'));
}

/** A Word, PDF or text file read in this browser, for an agent's documents or reference material. Unreadable files are skipped. */
export async function readFiles(files: File[]): Promise<ChatDocument[]> {
  const { extractDocumentText } = await import('../data/document-text.ts');
  const out: ChatDocument[] = [];
  for (const file of files) {
    try {
      const read = await extractDocumentText(file, AGENT_LIMITS.documentChars);
      if (read.text.trim()) out.push({ id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: file.name, text: read.text, ...(read.pages ? { pages: read.pages } : {}), truncated: read.truncated, size: file.size });
    } catch { /* unreadable files are skipped and said by the caller */ }
  }
  return out;
}
