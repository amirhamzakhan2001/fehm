import { join } from 'node:path';
import { readJson, writeJsonAtomic } from '../persistence.js';
import { redactLine } from '../security/secrets.js';
import { digest } from './discovery.js';
import type { PromptCandidate, PromptRecord } from './types.js';
const FILE = 'prompt-proposals.json';
export function savedProposals(state: string, prompt: PromptRecord): PromptCandidate[] {
  const stored = readJson<unknown>(join(state, FILE));
  if (!stored.ok) { if (stored.reason !== 'missing') throw new Error('Saved proposals could not be read; repair the proposal file before saving.'); return []; }
  if (!Array.isArray(stored.value) || stored.value.some(c => !c || typeof c !== 'object' || typeof c.id !== 'string' || typeof c.promptId !== 'string' || typeof c.text !== 'string')) throw new Error('Saved proposals have an invalid format');
  return stored.value.filter((c): c is PromptCandidate => !!c && typeof c === 'object' && c.promptId === prompt.id && typeof c.text === 'string' && typeof c.id === 'string');
}
export function saveProposal(state: string, prompt: PromptRecord, candidate: PromptCandidate): PromptCandidate {
  // Validate existing storage before writing; proposals are separate from source files.
  savedProposals(state, prompt);
  if (candidate.promptId !== prompt.id || candidate.originalDigest !== digest(prompt.text)) throw new Error('Stale or mismatched proposal');
  if (candidate.text.split('\n').map(redactLine).join('\n') !== candidate.text) throw new Error('Remove sensitive values before saving a proposal');
  const stored = readJson<PromptCandidate[]>(join(state, FILE));
  const previous = stored.ok ? stored.value : [];
  const next = previous.filter(c => c.id !== candidate.id);
  next.push(candidate);
  if (next.length > 1000 || Buffer.byteLength(JSON.stringify(next)) > 8_000_000) throw new Error('Proposal storage limit reached; export or remove old proposals before saving');
  writeJsonAtomic(join(state, FILE), next);
  return candidate;
}
