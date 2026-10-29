export interface FailureInput {
  text?: string;
  location?: { path: string; line: number };
  runId?: string;
  evidenceId?: string;
  failureRevision?: string;
}
export interface FailureFrame {
  raw: string;
  inputLine: number;
  path: string;
  line: number;
  column?: number;
  status: 'resolved' | 'ambiguous' | 'unresolved' | 'invalid';
  candidates: string[];
  resolvedPath?: string;
  nodeId?: string;
  mapping?: 'exact' | 'suffix';
}
export interface InvestigationEvidence {
  id: string;
  origin: 'user-input' | 'repository' | 'git' | 'execution';
  kind: 'observation' | 'source' | 'relationship' | 'change' | 'test' | 'output';
  text: string;
  path?: string;
  line?: number;
  endLine?: number;
  sourceHash?: string;
  nodeId?: string;
  edgeId?: string;
  provenance?: string;
  commit?: string;
}
export interface DiagnosticAction {
  id: string;
  kind: 'inspect' | 'supply-observation' | 'run-check' | 'compare-change';
  title: string;
  reason: string;
  confirms: string;
  rejects: string;
  evidenceIds: string[];
  runId?: string;
  checkId?: string;
  argv?: string[];
  cwd?: string;
}
export interface Hypothesis {
  id: string;
  cause: string;
  confidence: 'tentative';
  rationale: string;
  status: 'proposed';
  evidenceIds: string[];
  alternatives: string[];
  missing: string;
  actionId: string;
}
export interface Reproduction {
  status: 'not attempted' | 'reproduced' | 'original test passed' | 'blocked' | 'inconclusive' | 'stale';
  explanation: string;
  runId?: string;
  checkId?: string;
  beforeEvidenceId?: string;
  afterEvidenceId?: string;
  tests: string[];
}
export interface Investigation {
  schemaVersion: 1;
  analysisVersion: 1;
  id: string;
  root: string;
  created: string;
  input: FailureInput;
  head: string | null;
  indexDigest: string;
  stale: boolean;
  revisionStatus: 'unknown' | 'matches HEAD' | 'different or unavailable';
  summary: string;
  frames: FailureFrame[];
  evidence: InvestigationEvidence[];
  hypotheses: Hypothesis[];
  actions: DiagnosticAction[];
  reproduction: Reproduction;
  unknowns: string[];
  limitations: string[];
  bounds: { files: number; nodes: number; evidence: number; truncated: boolean };
}
