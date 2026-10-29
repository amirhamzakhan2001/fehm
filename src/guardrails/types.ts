export type CheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'skipped' | 'inconclusive' | 'stale';
export type Phase = 'baseline' | 'red' | 'green' | 'refactor';
export interface GuardCheck { id: string; category: 'unit' | 'integration' | 'regression' | 'build' | 'lint'; argv: string[]; cwd: string; required: boolean; }
export interface Requirement { id: string; text: string; origin: 'user' | 'inferred'; confirmed: boolean; checks: string[]; }
export interface GuardPolicy {
  checks: GuardCheck[]; requiredCategories: GuardCheck['category'][];
  tdd: boolean; security: boolean; maxAttempts: number; timeoutMs: number;
  /** Host execution cannot enforce filesystem or network isolation. */
  execution: 'host-approved' | 'isolated';
}
export interface Snapshot { fingerprint: string; files: Record<string, string>; tests: Record<string, string>; implementation: string; incomplete: string[]; }
export interface CheckEvidence {
  id: string; checkId: string; phase: Phase; status: CheckStatus; fingerprint: string;
  started: string; durationMs: number; exitCode: number | null; output: string;
  approved: boolean; argv: string[]; cwd: string; policyHash: string;
  testOutcomes?: import('./test-outcomes.js').TestOutcomes;
  testFingerprint?: string;
  expectedTest?: string; validRed?: boolean; baselineFailure?: boolean;
}
export interface GuardRun {
  version: 1; id: string; task: string; mode: 'agent-integration' | 'fehm-directed' | 'verification-only';
  created: string; policy: GuardPolicy; policyHash: string; requirements: Requirement[];
  change?: import('./change.js').ChangeAnalysis;
  base: Snapshot; evidence: CheckEvidence[];
  security?: { fingerprint: string; at: string; findings: { id: string; severity: string; title: string; confidence: string; action: string; file?: string; line?: number }[]; limitations: string[] };
  securityHistory?: NonNullable<GuardRun['security']>[];
  red?: { tests: Record<string, string>; checkId: string; evidenceId: string };
  exception?: { reason: string; at: string };
  review?: { fingerprint: string; reason: string };
  attempts: { at: string; reason: string; before: string; after?: string; outcome: string }[];
  timeline: { at: string; event: string; detail: string }[];
}
