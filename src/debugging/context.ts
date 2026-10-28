import type { Investigation } from './types.js';
import { estimateTokens } from '../compression.js';
/** Export has a whole-packet estimated budget, including the truncation notice. */
export function investigationContext(report: Investigation, budget=4000) {
  if (!Number.isInteger(budget) || budget<256 || budget>16000) throw new Error('Context budget must be 256–16000 estimated tokens');
  const lines=[`Failure investigation ${report.id}`,`Freshness: ${report.stale ? 'stale':'current indexed source'}; failure revision: ${report.revisionStatus}`,report.summary,`Reproduction: ${report.reproduction.status}. ${report.reproduction.explanation}`];
  let truncated=false;
  const append=(s:string) => { if (estimateTokens([...lines,s,'[Context truncated; omitted evidence is not negative evidence.]'].join('\n\n'))<=budget) lines.push(s);else truncated=true; };
  for (const a of report.actions.slice(0,3)) append(`Next action: ${a.title}\n${a.reason}\nConfirm: ${a.confirms}\nReject: ${a.rejects}`);
  for (const h of report.hypotheses) append(`Hypothesis (${h.confidence}): ${h.cause}\nEvidence: ${h.evidenceIds.join(', ')}\nMissing: ${h.missing}`);
  // Anchored source before broad relationships; IDs survive omission, which is disclosed.
  const priority={observation:0,output:0,source:1,test:2,change:3,relationship:4};
  for (const e of [...report.evidence].sort((a,b)=>priority[a.kind]-priority[b.kind])) append(`[${e.id}] ${e.origin}/${e.kind} ${e.path ?? ''}${e.line ? `:${e.line}`:''}\n${e.text}`);
  for (const u of [...report.unknowns,...report.limitations]) append(`Unknown/limit: ${u}`);
  if (truncated) lines.push('[Context truncated; omitted evidence is not negative evidence.]');
  const text=lines.join('\n\n');
  if (estimateTokens(text)>budget) throw new Error('Context metadata exceeds budget');
  return {text,estimatedTokens:estimateTokens(text),budget,truncated};
}
