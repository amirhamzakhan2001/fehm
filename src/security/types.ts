/**
 * Feature 3.6 contract, shared with the browser (type-only imports there).
 *
 * Security review reports findings with evidence, the controls that were
 * detected or not, and how untrusted data moves from sources to sinks. It
 * never produces a "security score", and it never says code is vulnerable
 * or compliant: it says what was detected, where, what supports it, and what
 * could not be established.
 */

import type { AnalyzerRun, Confidence, Finding, Severity } from "../findings/model.js";
import type { BaselineDiff, TrendPoint } from "../health/types.js";

export const SECURITY_SCHEMA = "1.0";
/** Bump when findings change for the same code (marks trend points, keys nothing else). */
export const SECURITY_VERSION = "1";

// ─── data flow ──────────────────────────────────────────────────────

export type SinkKind =
  | "sql"
  | "command"
  | "code-eval"
  | "path"
  | "ssrf"
  | "redirect"
  | "xss"
  | "header"
  | "deserialization"
  | "mass-assignment"
  | "template"
  | "prototype-pollution"
  | "llm-prompt"
  | "regex";

export type SourceKind = "http-request" | "llm-output" | "tool-argument" | "cli-argument" | "environment" | "file-content";

export interface TraceStep {
  role: "source" | "transform" | "call" | "sanitizer" | "sink";
  label: string;
  path: string;
  line: number;
  nodeId?: string;
}

export interface Trace {
  source: { kind: SourceKind; label: string };
  sink: { kind: SinkKind; label: string };
  steps: TraceStep[];
  /** Sanitizers, validators or parameterization seen on the path (none means none recognised). */
  sanitizers: string[];
  interprocedural: boolean;
}

/** A security finding: the shared finding plus its data-flow trace and framework mappings. */
export interface SecurityFinding extends Finding {
  domain: SecurityDomain;
  cwe?: string;
  owasp?: string[];
  trace?: Trace;
  controlsDetected?: string[];
  controlsMissing?: string[];
  /** Test files that exercise the affected file (to re-run after a fix). */
  relatedTests?: string[];
}

export type SecurityDomain = "application" | "data-flow" | "secrets" | "dependencies" | "auth" | "api" | "cicd" | "containers" | "kubernetes" | "infrastructure" | "llm" | "agents" | "mcp";

// ─── attack surface ─────────────────────────────────────────────────

export type ControlState = "detected" | "not-detected" | "unknown" | "not-applicable";

export interface RouteControl {
  state: ControlState;
  evidence?: { path: string; line: number; text: string };
}

export interface SurfaceRoute {
  id: string;
  method: string;
  route: string;
  path: string;
  line: number;
  handler?: { name: string; nodeId: string };
  kind: "http" | "webhook" | "graphql" | "mcp";
  stateChanging: boolean;
  sensitive: string[];
  authentication: RouteControl;
  authorization: RouteControl;
  validation: RouteControl;
  rateLimit: RouteControl;
  /** What the handler reaches (through calls, depth 3). */
  reaches: { database: boolean; filesystem: boolean; network: boolean; process: boolean; llm: boolean };
  findings: number;
}

export interface AttackSurface {
  routes: SurfaceRoute[];
  totals: { routes: number; unauthenticated: number; unauthenticatedStateChanging: number; sensitive: number; withFindings: number; webhooks: number; mcp: number };
  globalControls: { name: string; evidence: { path: string; line: number; text: string } }[];
}

// ─── controls inventory ─────────────────────────────────────────────

export type ControlId = "authentication" | "authorization" | "input-validation" | "secrets-management" | "rate-limiting" | "audit-logging" | "password-hashing" | "transport-security" | "security-headers" | "csrf" | "cors" | "dependency-scanning" | "security-testing";

export interface SecurityControl {
  id: ControlId;
  title: string;
  status: "present" | "partial" | "missing" | "not-applicable" | "unknown";
  summary: string;
  evidence: { path: string; line?: number; text: string }[];
}

// ─── AI / agents / MCP ──────────────────────────────────────────────

export interface LlmSite {
  path: string;
  line: number;
  provider: string;
  call: string;
  model?: string;
  modelPinned?: boolean;
  maxTokens: boolean;
  untrustedInput: boolean;
  outputToSink?: SinkKind;
}

export interface AgentTool {
  name: string;
  framework: "mcp" | "langchain" | "ai-sdk" | "openai" | "anthropic" | "other";
  path: string;
  line: number;
  capabilities: ("shell" | "filesystem-read" | "filesystem-write" | "network" | "database" | "code-eval")[];
  schema: boolean;
  approval: boolean;
  description?: string;
}

export interface McpServerConfig {
  path: string;
  line: number;
  name: string;
  command?: string;
  transport: "stdio" | "http" | "unknown";
  unpinnedPackage?: string;
}

export interface AiInventory {
  providers: { name: string; files: number }[];
  frameworks: { name: string; files: number }[];
  sites: LlmSite[];
  tools: AgentTool[];
  mcpServers: { path: string; line: number; transport: "stdio" | "http" | "sse" | "unknown"; auth: boolean }[];
  mcpConfigs: McpServerConfig[];
  /** Share of prompt sites / tools with evidence of each control (detected evidence, not certainty). */
  controls: { id: string; label: string; applicable: number; detected: number }[];
}

// ─── frameworks ─────────────────────────────────────────────────────

export interface FrameworkCategory {
  id: string;
  name: string;
  rules: string[];
  findings: number;
  /** Findings open against rules mapped to this category. */
  status: "findings" | "no-findings" | "not-covered";
}

export interface FrameworkMapping {
  id: "owasp-top10-2021" | "owasp-api-2023" | "owasp-llm-2025" | "owasp-agentic-2026" | "cwe";
  name: string;
  categories: FrameworkCategory[];
}

// ─── the report ─────────────────────────────────────────────────────

export type Posture = "critical-attention" | "attention-required" | "review" | "no-high-severity-findings" | "unknown";

export interface DomainCoverage {
  domain: SecurityDomain;
  title: string;
  /** Share of the relevant inputs this domain's analyzers could examine (not a safety measure). */
  analysed: number;
  relevant: number;
  applicable: boolean;
  findings: Record<Severity, number>;
  note: string;
}

export interface SecurityReport {
  schemaVersion: string;
  version: string;
  repository: { name: string; root: string };
  generatedAt: string;
  scope: "all" | "changed";
  posture: Posture;
  postureReasons: string[];
  summary: { bySeverity: Record<Severity, number>; byDomain: Record<string, number>; open: number };
  findings: SecurityFinding[];
  domains: DomainCoverage[];
  surface: AttackSurface;
  controls: SecurityControl[];
  ai: AiInventory;
  frameworks: FrameworkMapping[];
  secrets: { scannedFiles: number; found: number; testFixtures: number };
  dependencies: { components: number; advisories: "not-checked" | "checked" | "stale" | "error"; checkedAt?: string; vulnerable: { name: string; version: string; ids: string[]; severity: Severity | "unknown"; direct: boolean; reachable: "yes" | "no" | "unknown"; path?: string[] }[] };
  analyzers: AnalyzerRun[];
  languages: { language: string; files: number; taint: "ast" | "heuristic" | "unsupported"; patterns: "ast" | "heuristic" | "unsupported" }[];
  provenance: { fehmVersion: string; securityVersion: string; commit?: string; dirty?: boolean; digest: string; inputs: string[]; excluded: string[]; rulesDerivedFrom: string };
  baseline?: BaselineDiff;
  trend: TrendPoint[];
  unknowns: string[];
  freshness: { fresh: boolean; added: number; modified: number; deleted: number };
  durationMs: number;
}

export interface SecurityPagePayload extends SecurityReport {
  writable: boolean;
}

export type { Confidence, Severity };
