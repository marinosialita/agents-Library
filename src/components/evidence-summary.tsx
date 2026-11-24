import { ChevronDown, FileText, Landmark, Library, PenLine } from 'lucide-react';

/** The closed line of a source fold-out under an answer: icon, label, count and a chevron that turns when open. */
export function EvidenceSummary({ kind, label, count }: { kind: 'laws' | 'cases' | 'notes' | 'documents'; label: string; count: string }) {
  const Icon = kind === 'laws' ? Library : kind === 'cases' ? Landmark : kind === 'documents' ? FileText : PenLine;
  return <summary className="mn-evidence-summary">
    <Icon size={15} className="mn-evidence-icon" aria-hidden="true" />
    <span className="mn-evidence-label">{label}</span>
    <span className="mn-evidence-count">{count}</span>
    <ChevronDown size={15} className="mn-evidence-chevron" aria-hidden="true" />
  </summary>;
}
