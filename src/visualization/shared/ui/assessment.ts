import type { DriftFinding } from '../../../drift/types.js';
import type { PromptRecord } from '../../../prompts/types.js';
import type { MemoryCommit } from '../../../git-memory/types.js';

/** Presentation derives only from supplied evidence; it never asserts runtime outcomes. */
export function driftPriority(findings: readonly DriftFinding[]): DriftFinding[] {
  const attention = { critical: 5, high: 4, moderate: 3, low: 2, informational: 1 };
  const confidence = { high: 3, medium: 2, low: 1 };
  return findings.filter(f => !f.decision && f.status !== 'resolved').slice().sort((a,b) => attention[b.attention] - attention[a.attention] || Number(b.basis === 'explicit-rule') - Number(a.basis === 'explicit-rule') || confidence[b.confidence] - confidence[a.confidence] || a.id.localeCompare(b.id));
}
export function driftBasis(f: DriftFinding): string {
  if (f.decision) return 'Reviewed exception — not a verified fix';
  return f.basis === 'explicit-rule' ? 'Deviation from a configured rule' : f.basis === 'approved-pattern' ? 'Deviation from an approved convention' : 'Inferred concern — review whether this convention applies';
}
export function promptPurpose(p: PromptRecord): string {
  const purposes = { generation: 'generate a response', classification: 'classify input', extraction: 'extract information', rag: 'answer using retrieved context', agent: 'guide an agent', code: 'work with code', guardrail: 'constrain model behavior', multimodal: 'process multiple input types' };
  return `The detected instructions appear to ${purposes[p.kind]}. ${p.call === 'template' ? 'This is a reusable definition; runtime use is not established by the definition alone.' : `The call site uses ${p.provider}${p.model ? ` with ${p.model}` : '; the model is unresolved'}.`} ${p.reconstruction === 'partial' ? 'Some content is assembled at runtime and could not be reconstructed.' : 'The indexed instruction text was reconstructed.'}`;
}
export function changeSummary(c: MemoryCommit): string {
  const categories = c.classifications.filter(x => x !== 'code').join(', ');
  return `${c.files.length} file${c.files.length === 1 ? '' : 's'} changed${categories ? ` across ${categories}` : ''}. ${c.revertOf ? 'The author identifies this as a revert.' : 'The commit message states the author’s intent; detected changes describe implementation evidence.'}`;
}
