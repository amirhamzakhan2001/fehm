export const GRAPH_SCHEMA_VERSION = "0.2.0";

export type NodeKind =
  | "repository"
  | "directory"
  | "file"
  | "package"
  | "class"
  | "interface"
  | "function"
  | "method"
  | "variable"
  | "type";

export type EdgeKind =
  | "contains"
  | "defines"
  | "imports"
  | "calls"
  | "references"
  | "uses"
  | "extends"
  | "implements";

export type Provenance = "filesystem" | "ast" | "type-checker" | "heuristic";

export interface SourceLocation {
  path: string;
  line: number;
  column: number;
  endLine?: number;
}

export interface Evidence {
  provenance: Provenance;
  confidence: number;
  location?: SourceLocation;
  detail?: string;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  qualifiedName: string;
  path?: string;
  location?: SourceLocation;
  language?: string;
  exported?: boolean;
  test?: boolean;
  summary?: string;
  summaryStatus?: "fresh" | "stale" | "not-generated" | "failed";
  summarySource?: "deterministic" | "semantic";
  metadata?: Record<string, string | number | boolean | null>;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  evidence: Evidence;
}

export interface RepositoryChanges {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
}

export interface GraphStats {
  nodes: number;
  edges: number;
  files: number;
  symbols: number;
  calls: number;
  imports: number;
  tests: number;
  unresolvedCalls: number;
}

export interface CodeGraph {
  schemaVersion: string;
  generatedAt: string;
  repository: {
    name: string;
    root: string;
    fingerprint: string;
  };
  changes: RepositoryChanges;
  stats: GraphStats;
  nodes: GraphNode[];
  edges: GraphEdge[];
  fileHashes: Record<string, string>;
  synchronization?: IndexSynchronization;
}

export interface IndexSynchronization {
  mode: "full" | "incremental" | "cache-hit";
  lastSyncAt: string;
  analyzedFiles: string[];
  reusedFiles: string[];
  invalidatedFiles: string[];
  changedSymbols: number;
  changedRelationships: number;
  summaryFreshness: {
    fresh: number;
    stale: number;
    notGenerated: number;
    failed: number;
    percent: number;
  };
}

export interface FocusResult {
  matches: GraphNode[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface RelationshipExplorerItem {
  node: GraphNode;
  distance: number;
  via: EdgeKind;
  path: string[];
  confidence: number;
}

export interface RelationshipExplorerReport {
  query: string;
  direction: "callers" | "dependencies" | "both";
  root?: GraphNode;
  related: RelationshipExplorerItem[];
  edges: GraphEdge[];
  truncated: boolean;
}

export type RetrievalIntent = "locate" | "explain" | "change" | "debug" | "test" | "architecture";

export interface RetrievalScores {
  lexical: number;
  symbol: number;
  semantic: number;
  graph: number;
  intent: number;
  final: number;
}

export interface RetrievalHit {
  node: GraphNode;
  scores: RetrievalScores;
  reasons: string[];
  graphDistance?: number;
  matchedLines?: number[];
}

export interface ContextExcerpt {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  nodeIds: string[];
  score: number;
  estimatedTokens: number;
}

export interface ContextQuality {
  score: number;
  queryCoverage: number;
  exactSymbolMatch: boolean;
  evidenceConfidence: number;
  graphConnectivity: number;
  architectureCoverage: number;
  dependencyCoverage: number;
  testCoverage: number;
  historyCoverage: number;
}

export interface SemanticSummaryResult {
  generatedAt: string;
  model?: string;
  updated: number;
  failed: Array<{ nodeId: string; error: string }>;
  graph: CodeGraph;
}

export interface ApiConsumer {
  path: string;
  line: number;
  method: string;
  endpoint: string;
  matchedEndpointId?: string;
  requestSignals?: string[];
  expectedResponseSignals?: string[];
}

export interface ApiEndpointContract {
  id: string;
  method: string;
  route: string;
  path: string;
  line: number;
  node?: GraphNode;
  consumers: ApiConsumer[];
  requestSignals: string[];
  responseSignals: string[];
  framework?: "express" | "fastify" | "nest" | "next" | "openapi" | "unknown";
}

export interface ApiContractReport {
  generatedAt?: string;
  repositoryFingerprint?: string;
  endpoints: ApiEndpointContract[];
  consumers: ApiConsumer[];
  mismatches: Array<{ kind: "missing-endpoint" | "method-mismatch" | "unused-endpoint" | "dynamic-contract" | "request-schema-mismatch"; detail: string; path: string; line: number }>;
  breakingChanges: Array<{ kind: "removed-endpoint" | "method-changed"; detail: string }>;
  confidence: number;
}

export interface InfrastructureNode {
  id: string;
  kind: "environment" | "service" | "database" | "queue" | "cloud" | "container" | "kubernetes" | "terraform" | "external-api";
  name: string;
  path?: string;
  evidence: string[];
}

export interface InfrastructureGraph {
  nodes: InfrastructureNode[];
  edges: Array<{ source: string; target: string; relation: "uses" | "declares" | "depends-on" | "connects-to"; evidence: string }>;
  unknowns: string[];
}

export interface SecurityFlowNode {
  id: string;
  kind: "source" | "transform" | "sanitizer" | "sink";
  label: string;
  path: string;
  line: number;
  symbol?: GraphNode;
  confidence: number;
}

export interface SecurityFlowReport {
  nodes: SecurityFlowNode[];
  edges: Array<{ source: string; target: string; relation: "data-flow" | "call-flow"; confidence: number }>;
  paths: Array<{ source: SecurityFlowNode; sink: SecurityFlowNode; steps: string[]; sanitized: boolean; severity: SecuritySeverity; confidence: number }>;
  summary: { sources: number; sinks: number; sanitizers: number; riskyPaths: number };
}

export interface TestQualityFile {
  path: string;
  score: number;
  tests: number;
  assertions: number;
  skipped: number;
  focused: number;
  mocks: number;
  productionSymbols: number;
  strengths: string[];
  weaknesses: string[];
}

export interface TestQualityReport {
  score: number;
  files: TestQualityFile[];
  dimensions: { assertions: number; coverage: number; isolation: number; reliability: number; maintainability: number };
  recommendations: string[];
}

export interface ContextPacket {
  schemaVersion: string;
  generatedAt: string;
  query: string;
  intent: RetrievalIntent;
  budget: {
    maximumTokens: number;
    usedTokens: number;
    remainingTokens: number;
    truncated: boolean;
  };
  quality: ContextQuality;
  architecture: {
    layers: string[];
    technologies: string[];
    constraints: string[];
    approved: boolean;
  };
  history: {
    commitsAnalyzed: number;
    recentChanges: string[];
    memory: string[];
  };
  tests: string[];
  recommendedNodes: RetrievalHit[];
  relationships: GraphEdge[];
  excerpts: ContextExcerpt[];
}

export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileChangeStatus;
  hunks: DiffHunk[];
}

export interface DiffProjection {
  source: "git" | "unified-diff";
  base?: string;
  files: ChangedFile[];
}

export interface ImpactedNode {
  node: GraphNode;
  distance: number;
  score: number;
  via: EdgeKind[];
  direct: boolean;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ChangeRisk {
  score: number;
  level: RiskLevel;
  reasons: string[];
}

export interface ChangeImpactReport {
  schemaVersion: string;
  generatedAt: string;
  repositoryFingerprint: string;
  projection: DiffProjection;
  directlyAffected: ImpactedNode[];
  blastRadius: ImpactedNode[];
  affectedFiles: string[];
  affectedTests: string[];
  affectedRoutes: string[];
  recommendedInspectionOrder: string[];
  risk: ChangeRisk;
  stats: {
    changedFiles: number;
    directNodes: number;
    transitiveNodes: number;
    affectedFiles: number;
    affectedTests: number;
    affectedRoutes: number;
  };
}

export interface VerificationCheck {
  name: string;
  status: "passed" | "warning" | "failed";
  detail: string;
}

export interface ChangeVerificationReport {
  schemaVersion: string;
  generatedAt: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  checks: VerificationCheck[];
  addedNodes: string[];
  removedNodes: string[];
  newImportCycles: string[][];
  expectedImpactFiles: string[];
  actuallyChangedFiles: string[];
  confidence: number;
  passed: boolean;
}

export type VerificationStatus = "passed" | "warning" | "failed" | "skipped";
export type SecuritySeverity = "low" | "medium" | "high" | "critical";

export interface VerificationObservation {
  name: string;
  status: VerificationStatus;
  detail: string;
  path?: string;
  line?: number;
}

export interface VerificationCommandResult {
  category: "types" | "lint" | "build" | "test";
  script: string;
  command: string[];
  status: VerificationStatus;
  exitCode: number | null;
  durationMs: number;
  output: string;
  timedOut: boolean;
}

export interface SecurityFinding {
  id: string;
  rule: string;
  severity: SecuritySeverity;
  title: string;
  detail: string;
  path: string;
  line: number;
  column: number;
  confidence: number;
  snippet: string;
}

export interface ArchitectureLayer {
  name: string;
  patterns: string[];
}

export interface ForbiddenDependencyRule {
  from: string;
  to: string;
  reason?: string;
}

export interface ArchitectureConfig {
  version: 1;
  layers: ArchitectureLayer[];
  allowedDependencies?: Record<string, string[]>;
  forbiddenDependencies?: ForbiddenDependencyRule[];
  intent?: Record<string, string>;
  approval?: {
    status: "approved";
    approvedAt: string;
    source: "developer";
    proposalFingerprint: string;
  };
}

export interface ArchitectureProposal {
  version: 1;
  status: "proposed" | "approved";
  generatedAt: string;
  repositoryFingerprint: string;
  proposalFingerprint: string;
  confidence: number;
  detectedTechnologies: string[];
  evidence: string[];
  config: ArchitectureConfig;
}

export interface ArchitectureViolation {
  rule: "allowed-dependencies" | "forbidden-dependency";
  source: string;
  target: string;
  sourceLayer?: string;
  targetLayer?: string;
  reason: string;
  evidence: Evidence;
}

export interface VerificationReport {
  schemaVersion: string;
  generatedAt: string;
  repositoryFingerprint: string;
  staticAnalysis: {
    status: VerificationStatus;
    observations: VerificationObservation[];
  };
  projectCommands: {
    status: VerificationStatus;
    results: VerificationCommandResult[];
  };
  tests: {
    status: VerificationStatus;
    result?: VerificationCommandResult;
  };
  security: {
    status: VerificationStatus;
    filesScanned: number;
    findings: SecurityFinding[];
  };
  architecture: {
    status: VerificationStatus;
    configPath?: string;
    violations: ArchitectureViolation[];
    error?: string;
  };
  summary: {
    passed: boolean;
    confidence: number;
    failures: number;
    warnings: number;
    skipped: number;
  };
}

export interface MemoryRecord {
  id: string;
  kind: "adr" | "why" | "decision" | "warning" | "hack";
  title: string;
  content: string;
  path: string;
  line: number;
  source: "documentation" | "code-comment";
  confidence: number;
}

export interface GitCommitRecord {
  hash: string;
  author: string;
  date: string;
  subject: string;
  files: string[];
}

export interface GitHistorySummary {
  available: boolean;
  commits: number;
  authors: string[];
  fileChurn: Record<string, number>;
  recentCommits: GitCommitRecord[];
  error?: string;
}

export interface PerformanceFinding {
  rule: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  path: string;
  line: number;
  confidence: number;
}

export interface RiskHotspot {
  node: GraphNode;
  score: number;
  level: RiskLevel;
  metrics: {
    lines: number;
    complexity: number;
    fanIn: number;
    fanOut: number;
    fileChurn: number;
    warningMarkers: number;
    securityFindings: number;
    performanceFindings: number;
  };
  reasons: string[];
}

export interface RefactoringOpportunity {
  kind: "large-function" | "high-complexity" | "high-coupling" | "god-module" | "churn-hotspot" | "performance";
  target: string;
  path?: string;
  priority: RiskLevel;
  reason: string;
  suggestion: string;
  evidence: string[];
}

export interface EngineeringIntelligenceReport {
  schemaVersion: string;
  generatedAt: string;
  repositoryFingerprint: string;
  memory: MemoryRecord[];
  history: GitHistorySummary;
  hotspots: RiskHotspot[];
  refactoring: RefactoringOpportunity[];
  performance: PerformanceFinding[];
  security: SecurityFinding[];
  summary: {
    memoryRecords: number;
    commitsAnalyzed: number;
    highRiskHotspots: number;
    refactoringOpportunities: number;
    performanceFindings: number;
    securityFindings: number;
  };
}

export interface DependencyRiskRecord {
  name: string;
  requestedVersion: string;
  resolvedVersion?: string;
  manifest: string;
  kind: "runtime" | "development" | "peer" | "optional" | "undeclared";
  usedBy: string[];
  locked: boolean;
  riskScore: number;
  severity: RiskLevel;
  reasons: string[];
  evidence: string[];
}

export interface DependencyRiskReport {
  generatedAt: string;
  repositoryFingerprint: string;
  lockfiles: string[];
  dependencies: DependencyRiskRecord[];
  summary: {
    total: number;
    used: number;
    unused: number;
    undeclared: number;
    highRisk: number;
    criticalRisk: number;
  };
}

export interface DeadCodeFinding {
  kind: "unreachable-file" | "unused-export" | "unused-private" | "test-only-code";
  node: GraphNode;
  confidence: number;
  severity: RiskLevel;
  incomingReferences: number;
  reasons: string[];
  evidence: string[];
  recommendation: string;
}

export interface DeadCodeReport {
  generatedAt: string;
  repositoryFingerprint: string;
  entryPoints: string[];
  findings: DeadCodeFinding[];
  summary: {
    unreachableFiles: number;
    unusedExports: number;
    unusedPrivateSymbols: number;
    testOnlySymbols: number;
    highConfidence: number;
  };
}

export interface HistoricalBugCommit extends GitCommitRecord {
  classification: "bug-fix" | "regression-fix" | "security-fix";
  issueReferences: string[];
}

export interface HistoricalBugHotspot {
  path: string;
  fixes: number;
  recentFixes: number;
  score: number;
  severity: RiskLevel;
  commits: string[];
  nodeIds: string[];
  reasons: string[];
}

export interface HistoricalBugReport {
  generatedAt: string;
  repositoryFingerprint: string;
  historyAvailable: boolean;
  commits: HistoricalBugCommit[];
  hotspots: HistoricalBugHotspot[];
  summary: {
    bugFixCommits: number;
    securityFixes: number;
    regressionFixes: number;
    affectedFiles: number;
    highRiskHotspots: number;
  };
  error?: string;
}

export interface CrossRepositoryNode {
  id: string;
  kind: "repository" | "package" | "api-endpoint" | "api-consumer";
  label: string;
  repositoryId: string;
  path?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface CrossRepositoryEdge {
  source: string;
  target: string;
  relation: "contains" | "package-dependency" | "api-consumer";
  confidence: number;
  evidence: string[];
}

export interface CrossRepositoryConflict {
  kind: "duplicate-package" | "version-mismatch" | "unresolved-workspace-dependency" | "api-method-mismatch";
  repositories: string[];
  detail: string;
  evidence: string[];
  severity: RiskLevel;
}

export interface CrossRepositoryGraph {
  generatedAt: string;
  repositories: Array<{ id: string; name: string; root: string; fingerprint: string; packageName?: string; packageVersion?: string }>;
  nodes: CrossRepositoryNode[];
  edges: CrossRepositoryEdge[];
  conflicts: CrossRepositoryConflict[];
  unknowns: string[];
  summary: { repositories: number; packageDependencies: number; apiConnections: number; conflicts: number };
}

export interface MutationCandidate {
  id: string;
  path: string;
  line: number;
  column: number;
  start: number;
  end: number;
  operator: "conditional-boundary" | "equality" | "logical" | "boolean-literal" | "arithmetic";
  original: string;
  replacement: string;
  description: string;
  nodeId?: string;
}

export interface MutationResult extends MutationCandidate {
  status: "killed" | "survived" | "timeout" | "error";
  durationMs: number;
  exitCode?: number;
  output: string;
}

export interface MutationTestingReport {
  generatedAt: string;
  repositoryFingerprint: string;
  testCommand?: string[];
  baseline: { status: "passed" | "failed" | "timeout" | "unavailable"; durationMs: number; exitCode?: number; output: string };
  candidates: number;
  executed: number;
  killed: number;
  survived: number;
  timedOut: number;
  errors: number;
  score: number;
  results: MutationResult[];
  unexecuted: MutationCandidate[];
}

export interface BugCommandRun {
  status: "passed" | "failed" | "timeout" | "error" | "unavailable";
  durationMs: number;
  exitCode?: number;
  output: string;
}

export interface BugReproductionReport {
  generatedAt: string;
  repositoryFingerprint: string;
  fixCommit: string;
  parentCommit?: string;
  subject?: string;
  changedFiles: string[];
  suspectedNodeIds: string[];
  testCommand?: string[];
  buggyRun: BugCommandRun;
  fixedRun: BugCommandRun;
  status: "reproduced" | "not-reproduced" | "inconclusive" | "unavailable";
  failureSignature: string[];
  evidence: string[];
}

export interface BugFixVerificationReport {
  generatedAt: string;
  repositoryFingerprint: string;
  reproduction: BugReproductionReport;
  currentRun: BugCommandRun;
  regressionTests: string[];
  changedFiles: string[];
  verification: VerificationReport;
  mutation?: MutationTestingReport;
  criteria: {
    reproducedBeforeFix: boolean;
    currentTestsPass: boolean;
    failureSignatureCleared: boolean;
    regressionTestEvidence: boolean;
    staticVerificationPasses: boolean;
    mutationGuardPasses: boolean;
  };
  passed: boolean;
  failures: string[];
}

export interface ClaimVerification {
  id: string;
  statement: string;
  status: "verified" | "contradicted" | "unverifiable";
  confidence: number;
  references: string[];
  evidence: string[];
  correction?: string;
}

export interface HallucinationVerificationReport {
  generatedAt: string;
  repositoryFingerprint: string;
  claims: ClaimVerification[];
  summary: { total: number; verified: number; contradicted: number; unverifiable: number; score: number };
}

export interface AgentRunRecord {
  id: string;
  agent: string;
  task: string;
  startedAt: string;
  completedAt: string;
  outcome: "success" | "failure" | "partial";
  changedFiles: string[];
  commands: string[];
  testsPassed: number;
  testsFailed: number;
  verificationPassed: boolean;
  inputTokens?: number;
  outputTokens?: number;
  errors: string[];
  metadata?: Record<string, string | number | boolean>;
}

export interface AgentMistakeRecord {
  id: string;
  fingerprint: string;
  category: "test-failure" | "verification-failure" | "architecture" | "security" | "hallucination" | "tool-error" | "other";
  title: string;
  rootCause: string;
  prevention: string;
  status: "open" | "resolved";
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  agentIds: string[];
  tasks: string[];
  evidence: string[];
  resolution?: string;
}

export interface AgentAnalyticsReport {
  generatedAt: string;
  repositoryFingerprint: string;
  runs: AgentRunRecord[];
  agents: Array<{ agent: string; runs: number; successes: number; failures: number; partial: number; successRate: number; averageDurationMs: number; inputTokens: number; outputTokens: number; testsFailed: number; verificationFailures: number; commonErrors: string[] }>;
  mistakes: AgentMistakeRecord[];
  trends: Array<{ date: string; runs: number; successRate: number; failures: number }>;
  summary: { runs: number; agents: number; successRate: number; openMistakes: number; repeatedMistakes: number };
}

export interface AiEvaluationGraph {
  generatedAt: string;
  repositoryFingerprint: string;
  nodes: Array<{ id: string; kind: "prompt" | "version" | "execution" | "model" | "case" | "category"; label: string; status: "passed" | "failed" | "unknown"; score?: number; metadata?: Record<string, string | number | boolean> }>;
  edges: Array<{ source: string; target: string; relation: "has-version" | "uses-version" | "ran-on" | "contains-case" | "in-category" }>;
  modelAnalytics: Array<{ model: string; executions: number; cases: number; passRate: number; averageScore: number; averageLatencyMs: number }>;
  categoryAnalytics: Array<{ category: PromptEvaluationCategory; cases: number; passRate: number; averageScore: number }>;
  regressions: Array<{ prompt: string; versionId: string; previousScore: number; currentScore: number; delta: number; evidence: string[] }>;
  weakestCases: Array<{ prompt: string; versionId: string; executionId: string; caseId: string; model: string; score: number; evidence: string }>;
  summary: { prompts: number; versions: number; executions: number; cases: number; models: number; passRate: number; regressions: number };
}

export interface PromptOptimizationCandidate {
  id: string;
  strategy: "baseline" | "operational-contract" | "evidence-contract";
  prompt: string;
  promptHash: string;
  staticScore: number;
  trainingScore: number;
  validationScore: number;
  trainingPassRate: number;
  validationPassRate: number;
  selectionScore: number;
  passedHeldOutGate: boolean;
  execution: PromptExecutionReport;
}

export interface PromptOptimizationReport {
  generatedAt: string;
  repositoryFingerprint: string;
  provider: { endpoint: string; model: string };
  split: { trainingCaseIds: string[]; validationCaseIds: string[]; strategy: string };
  candidates: PromptOptimizationCandidate[];
  selectedCandidateId?: string;
  promoted: boolean;
  optimizedPrompt: string;
  evidence: string[];
}

export interface CodeArchaeologyReport {
  query: string;
  node?: GraphNode;
  origin?: GitCommitRecord;
  recentChanges: GitCommitRecord[];
  relatedMemory: MemoryRecord[];
  authors: string[];
  confidence: number;
  explanation: string;
}

export interface ArchitectureDriftReport {
  beforeFingerprint: string;
  afterFingerprint: string;
  addedViolations: ArchitectureViolation[];
  resolvedViolations: ArchitectureViolation[];
  unchangedViolations: ArchitectureViolation[];
  status: "stable" | "improved" | "degraded";
}

export type EntryPointKind = "http-route" | "cli" | "cron" | "queue-consumer" | "webhook" | "event-handler" | "frontend-route" | "serverless";

export interface SystemEntryPoint {
  id: string;
  kind: EntryPointKind;
  label: string;
  path: string;
  line: number;
  nodeId: string;
  confidence: number;
  evidence: string[];
}

export interface ExecutionFlowStep {
  order: number;
  node: GraphNode;
  via?: EdgeKind;
  confidence: number;
  evidence: string;
}

export interface ExecutionFlow {
  query: string;
  entryPoint?: SystemEntryPoint;
  steps: ExecutionFlowStep[];
  edges: GraphEdge[];
  truncated: boolean;
  confidence: number;
  unknowns: string[];
}

export interface CodebaseDNA {
  architectureStyle: string;
  technologies: string[];
  testingStrategy: string[];
  complexity: "low" | "medium" | "high";
  coupling: "low" | "medium" | "high";
  technicalDebtPercent: number;
  aiReadiness: number;
  metrics: {
    layers: number;
    entryPoints: number;
    averageComplexity: number;
    averageCoupling: number;
    highRiskHotspots: number;
    memoryRecords: number;
  };
  evidence: string[];
}

export interface CodeProphecy {
  node: GraphNode;
  score: number;
  level: RiskLevel;
  confidence: number;
  prediction: string;
  factors: Array<{ name: string; contribution: number; evidence: string }>;
}

export interface SystemUnknown {
  id: string;
  kind: "unresolved-call" | "dynamic-import" | "low-confidence-edge" | "stale-summary" | "architecture-intent" | "untraced-entry-point";
  severity: "info" | "warning" | "high";
  count: number;
  detail: string;
  paths: string[];
  confidence: number;
}

export interface SeniorExplanation {
  query: string;
  title: string;
  summary: string;
  facts: string[];
  risks: string[];
  constraints: string[];
  relatedTests: string[];
  confidence: number;
}

export interface SystemMapReport {
  schemaVersion: string;
  generatedAt: string;
  repositoryFingerprint: string;
  dna: CodebaseDNA;
  entryPoints: SystemEntryPoint[];
  prophecies: CodeProphecy[];
  unknowns: SystemUnknown[];
  onboarding: SeniorExplanation;
}

export type PromptStructureKey =
  | "role"
  | "objective"
  | "scope"
  | "constraints"
  | "output-format"
  | "tool-policy"
  | "context-handling"
  | "error-handling"
  | "escalation"
  | "examples"
  | "priority-rules";

export interface PromptStructureCheck {
  key: PromptStructureKey;
  label: string;
  status: "present" | "partial" | "missing";
  evidence: string[];
  recommendation: string;
}

export type PromptFindingCategory = "structure" | "ambiguity" | "conflict" | "hierarchy" | "security" | "tool-contract" | "architecture";

export interface PromptFinding {
  id: string;
  category: PromptFindingCategory;
  severity: "info" | "warning" | "high";
  title: string;
  detail: string;
  evidence: string[];
  recommendation: string;
  confidence: number;
  targetNode?: GraphNode;
}

export interface PromptScorecard {
  basis: "static-analysis" | "static-and-behavioral";
  metrics: {
    instructionClarity: number;
    consistency: number;
    completeness: number;
    hierarchy: number;
    outputReliability: number;
    security: number;
    injectionResistance: number;
    leakageResistance: number;
    toolAlignment: number;
    edgeCaseHandling: number;
  };
  overall: number;
  confidence: number;
}

export type PromptEvaluationCategory = "normal" | "boundary" | "ambiguity" | "instruction-conflict" | "injection" | "extraction" | "tool-use" | "out-of-scope" | "tool-failure" | "sensitive-data";

export interface PromptEvaluationCase {
  id: string;
  category: PromptEvaluationCategory;
  input: string;
  expectedBehavior: string;
  rationale: string;
  source: "baseline" | "prompt-finding" | "tool-contract";
}

export interface PromptBehaviorObservation {
  caseId: string;
  model: string;
  passed: boolean;
  score: number;
  evidence: string;
}

export interface PromptBehaviorSummary {
  model: string;
  score: number;
  passed: number;
  failed: number;
  missing: number;
  observations: PromptBehaviorObservation[];
}

export interface PromptDependency {
  instruction: string;
  reference: string;
  relation: "uses-tool" | "constrains-capability";
  status: "matched" | "missing" | "risky";
  targetNode?: GraphNode;
  evidence: string[];
  confidence: number;
}

export interface PromptAnalysisReport {
  schemaVersion: string;
  generatedAt: string;
  repositoryFingerprint?: string;
  promptHash: string;
  structure: PromptStructureCheck[];
  findings: PromptFinding[];
  scorecard: PromptScorecard;
  evaluationSuite: PromptEvaluationCase[];
  dependencies: PromptDependency[];
  behavior?: PromptBehaviorSummary;
  summary: {
    words: number;
    instructions: number;
    findings: number;
    highSeverityFindings: number;
    generatedTests: number;
    matchedTools: number;
    missingTools: number;
  };
}

export interface PromptSemanticChange {
  kind: "added" | "removed" | "modified";
  area: string;
  before?: string;
  after?: string;
  impact: "low" | "medium" | "high";
  consequence: string;
  affectedMetrics: Array<keyof PromptScorecard["metrics"]>;
}

export interface PromptDiffReport {
  schemaVersion: string;
  beforeHash: string;
  afterHash: string;
  beforeScore: number;
  afterScore: number;
  scoreDelta: number;
  changes: PromptSemanticChange[];
  regressions: string[];
  improvements: string[];
  passed: boolean;
}

export interface PromptEvolutionVersion {
  id: string;
  createdAt: string;
  promptHash: string;
  prompt: string;
  reason: string;
  scorecard: PromptScorecard;
  findings: number;
  regression?: PromptDiffReport;
  executions?: Array<{
    id: string;
    recordedAt: string;
    model: string;
    provider?: { endpoint: string };
    passed: boolean;
    score: number;
    passedCases: number;
    failedCases: number;
    durationMs: number;
    failures: Array<{ caseId: string; why: string; recommendation: string }>;
    cases: Array<{ caseId: string; category: PromptEvaluationCategory; input: string; expectedBehavior: string; response?: string; passed: boolean; score: number; evidence: string; durationMs: number; error?: string; why?: string; recommendation?: string }>;
  }>;
}

export interface PromptEvolution {
  schemaVersion: string;
  name: string;
  repositoryFingerprint: string;
  versions: PromptEvolutionVersion[];
}

export interface CoverageFileRecord {
  path: string;
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  source: "coverage-artifact" | "static-test-graph";
}

export interface CoverageIntelligenceReport {
  available: boolean;
  source?: string;
  overall: { statements: number; branches: number; functions: number; lines: number };
  files: CoverageFileRecord[];
  protectedSymbols: number;
  unprotectedSymbols: GraphNode[];
  criticalGaps: Array<{ node: GraphNode; reason: string }>;
  confidence: number;
}

export interface SelectedTestRun {
  selectedTests: string[];
  command?: string;
  status: "passed" | "failed" | "skipped";
  exitCode?: number;
  durationMs: number;
  output: string;
}

export interface ProtectedZone {
  pattern: string;
  reason: string;
  approvalRequired: boolean;
}

export interface AgentPolicy {
  version: 1;
  requireUnderstanding: boolean;
  maxRiskWithoutApproval: number;
  blockArchitectureViolations: boolean;
  protectedZones: ProtectedZone[];
  requiredChecks: Array<"architecture" | "security" | "tests" | "coverage">;
}

export interface HiddenDependency {
  source: GraphNode;
  target?: GraphNode;
  kind: "dynamic-import" | "environment" | "string-reference" | "unresolved-call";
  evidence: string;
  confidence: number;
}

export interface AgentPreflightReport {
  engineeringPractices?: import("./engineering-practices.js").PracticesReport;
  generatedAt: string;
  passed: boolean;
  requiresApproval: boolean;
  understood: boolean;
  risk: ChangeRisk;
  impact: ChangeImpactReport;
  architectureViolations: ArchitectureViolation[];
  protectedZoneHits: Array<{ path: string; zone: ProtectedZone }>;
  hiddenDependencies: HiddenDependency[];
  selectedTests: string[];
  coverageGaps: Array<{ node: GraphNode; reason: string }>;
  seniorPlan: string[];
  evidence: string[];
}

export interface FixVerifyReport {
  preflight: AgentPreflightReport;
  tests: SelectedTestRun;
  verification?: VerificationReport;
  passed: boolean;
}

export interface ArchitectureSnapshot {
  id: string;
  generatedAt: string;
  repositoryFingerprint: string;
  source: "inferred" | "approved" | "git-history";
  commit?: { hash: string; subject: string };
  technologies: string[];
  config: ArchitectureConfig;
}

export interface ArchitectureTimeline {
  snapshots: ArchitectureSnapshot[];
  events: Array<{ at: string; kind: "layer-added" | "layer-removed" | "dependency-added" | "dependency-removed" | "approval-changed"; detail: string }>;
}

export interface AdrMaintenanceReport {
  generatedAt: string;
  drafts: Array<{ path: string; event: ArchitectureTimeline["events"][number] }>;
  stale: Array<{ path: string; reason: string }>;
  current: string[];
}

export interface GitOwnershipRecord {
  path: string;
  owners: Array<{ author: string; commits: number; percent: number }>;
  busFactor: number;
  lastChangedAt?: string;
}

export interface TeamKnowledgeGraph {
  authors: Array<{ name: string; commits: number; files: number; expertise: Array<{ area: string; score: number }> }>;
  ownership: GitOwnershipRecord[];
  sharedKnowledgeRisks: Array<{ path: string; owner: string; reason: string }>;
  branches: string[];
  pullRequests: Array<{ number?: number; hash: string; subject: string; author: string; date: string; files: string[]; status?: "open" | "merged"; source?: "local-ref" | "merge-commit"; base?: string; head?: string; reviewers?: string[] }>;
  blameAvailable: boolean;
}

export interface DeveloperCheckpoint {
  name: string;
  createdAt: string;
  commit?: string;
  repositoryFingerprint: string;
}

export interface ChangeDigest {
  checkpoint: DeveloperCheckpoint;
  generatedAt: string;
  commits: GitCommitRecord[];
  changedFiles: string[];
  architectureEvents: ArchitectureTimeline["events"];
  ownershipChanges: string[];
  summary: string[];
}

export interface RuntimeSpanRecord {
  name: string;
  durationMs: number;
  status: "ok" | "error" | "unknown";
  source: "opentelemetry" | "chrome-trace" | "generic";
  node?: GraphNode;
  attributes: Record<string, string | number | boolean>;
}

export interface RuntimePerformanceReport {
  source: string;
  spans: RuntimeSpanRecord[];
  bottlenecks: Array<{ name: string; totalMs: number; averageMs: number; maximumMs: number; calls: number; errors: number; node?: GraphNode }>;
  unmappedSpans: number;
  confidence: number;
}

export interface ProjectDetectionReport {
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  databases: string[];
  testing: string[];
  infrastructure: string[];
  manifests: string[];
  commands: Record<string, string>;
  confidence: number;
}

export interface UnifiedHealthReport {
  score: number;
  status: "healthy" | "attention" | "critical";
  dimensions: Record<string, { score: number | null; detail: string; available: boolean; basis: "measured" | "estimated" | "configuration" | "unavailable" }>;
  evidence: { measuredDimensions: number; unavailableDimensions: number };
  priorities: string[];
}

export interface UnifiedSearchHit {
  kind: "code" | "relationship" | "architecture" | "history" | "memory" | "prompt" | "health" | "api" | "test" | "security" | "runtime" | "infrastructure" | "error" | "adr" | "checkpoint" | "ai" | "dependency" | "dead-code" | "bug-history" | "mutation" | "claim" | "agent" | "mistake" | "evaluation";
  title: string;
  detail: string;
  path?: string;
  score: number;
}

export interface PromptProviderConfig {
  endpoint: string;
  model: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface PromptExecutionCase {
  test: PromptEvaluationCase;
  response?: string;
  observation: PromptBehaviorObservation;
  failureAnalysis?: { why: string; recommendation: string };
  durationMs: number;
  error?: string;
}

export interface PromptExecutionReport {
  model: string;
  provider?: { endpoint: string };
  generatedAt: string;
  analysis: PromptAnalysisReport;
  cases: PromptExecutionCase[];
  behavior: PromptBehaviorSummary;
  security: { injectionPassed: number; injectionTotal: number; extractionPassed: number; extractionTotal: number };
  passed: boolean;
}

export interface MultiModelPromptReport {
  generatedAt: string;
  runs: PromptExecutionReport[];
  ranking: Array<{ model: string; score: number; passRate: number; averageLatencyMs: number; securityPassRate: number }>;
  consistency: { score: number; unanimousCases: number; divergentCases: Array<{ caseId: string; results: Record<string, boolean> }> };
  winner?: string;
}

export interface PromptToolContract {
  reference: string;
  status: "matched" | "missing" | "risky";
  node?: GraphNode;
  signature?: string;
  parameters: string[];
  returnType?: string;
  authorization: "read" | "write" | "unknown";
  evidence: string[];
}

export interface AiSystemGraph {
  nodes: Array<{ id: string; kind: "agent" | "prompt" | "model" | "evaluation" | "evaluator" | "execution" | "tool" | "code" | "database" | "dataset" | "test"; label: string; status: "ok" | "warning" | "error"; path?: string; metadata?: Record<string, string | number | boolean> }>;
  edges: Array<{ source: string; target: string; relation: string }>;
  toolContracts: PromptToolContract[];
  risks: string[];
}
