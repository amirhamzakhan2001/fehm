import { Guardrails } from '../guardrails/workflow.js';
import { digest, snapshot } from '../guardrails/snapshot.js';
import type { CheckEvidence } from '../guardrails/types.js';
import type { Reproduction } from './types.js';

export function compareReproduction(before: CheckEvidence, after: CheckEvidence | undefined, fingerprint: string): Reproduction {
  const failed = before.testOutcomes?.complete ? before.testOutcomes.tests.filter(t=>t.status === 'failed').map(t=>t.name) : [];
  const base = {beforeEvidenceId:before.id,checkId:before.checkId,tests:failed};
  if (!after || after.id === before.id) return {...base,status:before.fingerprint !== fingerprint ? 'stale' : before.status === 'failed' ? 'reproduced' : before.status === 'blocked' ? 'blocked' : 'inconclusive',explanation:before.status === 'failed' ? 'This command failed in the recorded run. The cause is not established.' : 'The selected command does not establish reproduction of a failure.'};
  const pair = {...base,afterEvidenceId:after.id};
  if (after.fingerprint !== fingerprint || after.status === 'stale') return {...pair,status:'stale',explanation:'The later execution does not apply to the current source state.'};
  if (after.status === 'blocked') return {...pair,status:'blocked',explanation:'The later command could not complete; it provides no passing evidence.'};
  const compatible = before.status === 'failed' && before.testFingerprint && before.testFingerprint === after.testFingerprint && before.policyHash === after.policyHash && before.cwd === after.cwd && digest(before.argv) === digest(after.argv);
  if (!compatible || !failed.length || !after.testOutcomes?.complete) return {...pair,status:'inconclusive',explanation:'Comparable complete test identities and unchanged test files are required. A passing suite alone does not establish resolution.'};
  const matched = failed.map(name=>after.testOutcomes!.tests.find(t=>t.name === name));
  if (matched.some(t=>t?.status === 'failed')) return {...pair,status:'reproduced',explanation:'At least one original named test failed again. Other results remain visible in verification.'};
  if (after.status === 'passed' && matched.every(t=>t?.status === 'passed')) return {...pair,status:'original test passed',explanation:'The original named test(s) passed with unchanged test files. This is an observed outcome, not proof of the cause or complete correctness; environment changes are not attested.'};
  return {...pair,status:'inconclusive',explanation:'The original failing test was missing, skipped, or the later suite did not pass.'};
}
export function failureRecord(root: string, runId: string, evidenceId: string) {
  const run = new Guardrails(root).load(runId);
  const before = run.evidence.find(e=>e.id === evidenceId);
  if (!before) throw new Error('Execution evidence is unavailable');
  const current = snapshot(root);
  const next = run.evidence.slice(run.evidence.indexOf(before) + 1).filter(e=>e.checkId === before.checkId && e.phase !== 'baseline');
  const reproduction = compareReproduction(before,next.at(-1),current.fingerprint);
  if (current.incomplete.length) { reproduction.status='inconclusive'; reproduction.explanation='Current snapshot is incomplete; execution freshness cannot be established.'; }
  return {run,before,reproduction:{...reproduction,runId},snapshot:current};
}
