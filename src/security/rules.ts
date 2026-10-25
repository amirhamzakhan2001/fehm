import type { Confidence, FindingCategory, FindingEvidence, Severity } from "../findings/model.js";
import type { SecurityDomain, SecurityFinding, Trace } from "./types.js";

/**
 * Feature 3.6's rule catalog. Every rule names its domain, CWE and the
 * framework categories it provides evidence for (OWASP Top 10 2021, OWASP
 * API Security 2023, OWASP LLM Top 10 2025, OWASP Agentic 2026), and, when it
 * was adapted from Skylos (Apache-2.0; see THIRD_PARTY_NOTICES.md), the Skylos
 * rule id. A mapping means "evidence relevant to this category", never
 * compliance.
 */

export interface SecurityRule {
  id: string;
  title: string;
  category: FindingCategory;
  domain: SecurityDomain;
  severity: Severity;
  cwe?: string;
  owasp: string[];
  upstream?: string;
}

const R = (id: string, title: string, domain: SecurityDomain, severity: Severity, cwe: string | undefined, owasp: string[], upstream?: string, category: FindingCategory = "security"): SecurityRule => ({ id, title, category, domain, severity, owasp, ...(cwe ? { cwe } : {}), ...(upstream ? { upstream } : {}) });

export const SECURITY_RULES: readonly SecurityRule[] = [
  // injection and data flow
  R("sec/sql-injection", "SQL injection", "data-flow", "critical", "CWE-89", ["A03", "API8"], "SKY-D211"),
  R("sec/command-injection", "Command injection", "data-flow", "critical", "CWE-78", ["A03"], "SKY-D212"),
  R("sec/code-injection", "Code injection (eval)", "data-flow", "critical", "CWE-94", ["A03"], "SKY-D201"),
  R("sec/path-traversal", "Path traversal", "data-flow", "high", "CWE-22", ["A01"], "SKY-D215"),
  R("sec/ssrf", "Server-side request forgery", "data-flow", "high", "CWE-918", ["A10", "API7"], "SKY-D216"),
  R("sec/open-redirect", "Open redirect", "data-flow", "medium", "CWE-601", ["A01"], "SKY-D230"),
  R("sec/xss", "Cross-site scripting", "data-flow", "high", "CWE-79", ["A03"], "SKY-D228"),
  R("sec/header-injection", "HTTP header injection", "data-flow", "medium", "CWE-113", ["A03"]),
  R("sec/unsafe-deserialization", "Unsafe deserialization", "data-flow", "critical", "CWE-502", ["A08"], "SKY-D233"),
  R("sec/mass-assignment", "Mass assignment", "data-flow", "high", "CWE-915", ["A01", "API3"], "SKY-D234"),
  R("sec/template-injection", "Server-side template injection", "data-flow", "high", "CWE-1336", ["A03"], "SKY-D227"),
  R("sec/prototype-pollution", "Prototype pollution", "data-flow", "high", "CWE-1321", ["A03"]),
  R("sec/regex-injection", "Regular expression from user input", "data-flow", "medium", "CWE-1333", ["A03", "API4"]),
  // application patterns
  R("sec/dangerous-exec", "Shell execution with a dynamic command", "application", "high", "CWE-78", ["A03"], "SKY-D209"),
  R("sec/dynamic-eval", "Dynamic code evaluation", "application", "high", "CWE-95", ["A03"], "SKY-D201"),
  R("sec/raw-sql", "SQL built from a dynamic string", "application", "medium", "CWE-89", ["A03"], "SKY-D217"),
  R("sec/insecure-deserializer", "Unsafe deserializer", "application", "high", "CWE-502", ["A08"], "SKY-D206"),
  R("sec/weak-hash", "Weak hash algorithm", "application", "medium", "CWE-328", ["A02"], "SKY-D207"),
  R("sec/weak-cipher", "Weak or legacy cipher", "application", "high", "CWE-327", ["A02"]),
  R("sec/weak-random", "Insecure randomness for a security value", "application", "medium", "CWE-338", ["A02"], "SKY-D250"),
  R("sec/tls-disabled", "TLS verification disabled", "application", "high", "CWE-295", ["A02", "A07"], "SKY-D210"),
  R("sec/jwt-unverified", "JWT decoded without verification", "auth", "high", "CWE-347", ["A07", "API2"], "SKY-D246"),
  R("sec/jwt-weak", "Weak JWT configuration", "auth", "high", "CWE-347", ["A07", "API2"], "SKY-D232"),
  R("sec/cors-wildcard", "Permissive CORS", "api", "medium", "CWE-942", ["A05", "API8"], "SKY-D247"),
  R("sec/insecure-cookie", "Insecure cookie", "auth", "medium", "CWE-614", ["A05", "API8"], "SKY-D252"),
  R("sec/timing-compare", "Timing-unsafe secret comparison", "auth", "medium", "CWE-208", ["A02"], "SKY-D253"),
  R("sec/sensitive-log", "Sensitive data in logs", "application", "medium", "CWE-532", ["A09"], "SKY-D251"),
  R("sec/error-disclosure", "Error details returned to clients", "api", "medium", "CWE-209", ["A04", "API8"], "SKY-D271"),
  R("sec/debug-mode", "Debug mode enabled", "application", "high", "CWE-489", ["A05"], "SKY-D346"),
  R("sec/xxe", "XML external entities enabled", "application", "high", "CWE-611", ["A05"]),
  R("sec/insecure-tempfile", "Insecure temporary file", "application", "medium", "CWE-377", ["A01"], "SKY-D348"),
  R("sec/bind-all", "Service bound to all interfaces", "application", "low", "CWE-1327", ["A05"]),
  // secrets
  R("sec/secret", "Hard-coded secret", "secrets", "critical", "CWE-798", ["A07", "LLM02"], "SKY-S101", "secret"),
  R("sec/client-secret", "Secret exposed to client code", "secrets", "high", "CWE-200", ["A01"], "SKY-S102", "secret"),
  R("sec/committed-env", "Environment file committed", "secrets", "high", "CWE-538", ["A05"], undefined, "secret"),
  // dependencies
  R("sec/vulnerable-dependency", "Reachable vulnerable dependency", "dependencies", "high", "CWE-1395", ["A06"], undefined, "dependency"),
  // auth and API
  R("sec/route-no-authentication", "No authentication control detected on a route", "auth", "high", "CWE-306", ["A01", "A07", "API2", "API5"], "SKY-D280"),
  R("sec/route-no-authorization", "No authorization control detected on a privileged route", "auth", "high", "CWE-862", ["A01", "API1", "API5"]),
  R("sec/route-no-validation", "No input validation detected on a route", "api", "low", "CWE-20", ["A03", "API3"]),
  R("sec/no-rate-limit", "No rate limiting detected", "api", "low", "CWE-770", ["API4"]),
  R("sec/webhook-unverified", "Webhook without signature verification", "api", "high", "CWE-345", ["A08", "API10"], "SKY-D282"),
  R("sec/no-csrf", "State-changing cookie routes without CSRF protection", "api", "medium", "CWE-352", ["A01"]),
  // CI/CD
  R("sec/ci-untrusted-checkout", "Untrusted code runs with repository privileges", "cicd", "critical", "CWE-829", ["A08"], "SKY-D290", "ci"),
  R("sec/ci-template-injection", "Untrusted input interpolated into a CI script", "cicd", "high", "CWE-78", ["A03", "A08"], "SKY-D294", "ci"),
  R("sec/ci-permissions", "Excessive workflow permissions", "cicd", "medium", "CWE-250", ["A01", "A08"], "SKY-D291", "ci"),
  R("sec/ci-unpinned-action", "Action not pinned to a commit", "cicd", "low", "CWE-829", ["A06", "A08"], "SKY-D292", "ci"),
  R("sec/ci-secret-exposure", "Secret exposed in CI output", "cicd", "medium", "CWE-532", ["A09"], "SKY-D298", "ci"),
  R("sec/ci-self-hosted", "Self-hosted runner for untrusted events", "cicd", "medium", "CWE-653", ["A08"], "SKY-D295", "ci"),
  R("sec/ci-pipe-to-shell", "Remote script piped to a shell", "cicd", "medium", "CWE-494", ["A08"], "SKY-D341", "ci"),
  R("sec/ci-persisted-credentials", "Checkout credentials persisted", "cicd", "low", "CWE-522", ["A08"], "SKY-D293", "ci"),
  // containers, kubernetes, infrastructure
  R("sec/docker-root", "Container runs as root", "containers", "medium", "CWE-250", ["A05"], "SKY-D330", "configuration"),
  R("sec/docker-mutable-image", "Mutable base image", "containers", "low", "CWE-1357", ["A06", "A08"], undefined, "configuration"),
  R("sec/docker-remote-add", "Remote file added without checksum", "containers", "medium", "CWE-494", ["A08"], "SKY-D342", "configuration"),
  R("sec/docker-secret", "Secret in image build", "containers", "high", "CWE-798", ["A05", "A07"], "SKY-D343", "configuration"),
  R("sec/docker-no-healthcheck", "No container health check", "containers", "info", undefined, ["A05"], undefined, "configuration"),
  R("sec/compose-privileged", "Privileged or host-level container", "containers", "high", "CWE-250", ["A05"], "SKY-D330", "configuration"),
  R("sec/k8s-privileged", "Privileged or host-namespace pod", "kubernetes", "high", "CWE-250", ["A05"], undefined, "configuration"),
  R("sec/k8s-root", "Pod may run as root", "kubernetes", "medium", "CWE-250", ["A05"], undefined, "configuration"),
  R("sec/k8s-rbac-wildcard", "Wildcard RBAC permissions", "kubernetes", "high", "CWE-269", ["A01", "API5"], undefined, "configuration"),
  R("sec/k8s-secret-literal", "Secret values committed in a manifest", "kubernetes", "high", "CWE-798", ["A05"], undefined, "configuration"),
  R("sec/k8s-no-limits", "No resource limits", "kubernetes", "low", "CWE-770", ["API4"], undefined, "configuration"),
  R("sec/k8s-ingress-no-tls", "Ingress without TLS", "kubernetes", "medium", "CWE-319", ["A02"], undefined, "configuration"),
  R("sec/iac-public-storage", "Publicly readable storage", "infrastructure", "high", "CWE-732", ["A01", "A05"], undefined, "deployment"),
  R("sec/iac-open-ingress", "Network open to the internet", "infrastructure", "high", "CWE-284", ["A05"], undefined, "deployment"),
  R("sec/iac-public-database", "Publicly accessible database", "infrastructure", "critical", "CWE-284", ["A05"], undefined, "deployment"),
  R("sec/iac-no-encryption", "Encryption at rest disabled", "infrastructure", "medium", "CWE-311", ["A02"], undefined, "deployment"),
  R("sec/iac-wildcard-iam", "Wildcard IAM policy", "infrastructure", "high", "CWE-269", ["A01"], undefined, "deployment"),
  // LLM, agents, MCP
  R("sec/llm-prompt-injection", "Untrusted input reaches an LLM prompt", "llm", "medium", "CWE-1427", ["LLM01", "ASI01"], "SKY-D261"),
  R("sec/llm-output-sink", "LLM output reaches a dangerous sink", "llm", "high", "CWE-94", ["LLM05", "ASI05"], "SKY-D262"),
  R("sec/llm-unbounded", "LLM call without an output limit", "llm", "low", "CWE-770", ["LLM10"], "SKY-D267"),
  R("sec/llm-model-unpinned", "Model not pinned to a version", "llm", "info", undefined, ["LLM03", "ASI04"]),
  R("sec/llm-secret-to-model", "Sensitive data sent to an LLM", "llm", "medium", "CWE-359", ["LLM02"], "SKY-D263"),
  R("sec/agent-tool-dangerous", "Agent tool with dangerous capability and no guard", "agents", "high", "CWE-250", ["LLM06", "ASI02", "ASI05"], "SKY-D264"),
  R("sec/agent-tool-no-schema", "Agent tool without an input schema", "agents", "medium", "CWE-20", ["LLM06", "ASI02"]),
  R("sec/mcp-tool-poisoning", "MCP tool description contains instructions", "mcp", "critical", "CWE-1427", ["LLM01", "ASI01"], "SKY-D240"),
  R("sec/mcp-network-no-auth", "MCP server over the network without authentication", "mcp", "high", "CWE-306", ["ASI03", "ASI07"], "SKY-D243"),
  R("sec/mcp-unpinned-server", "MCP server launched from an unpinned package", "mcp", "medium", "CWE-829", ["ASI04"], "SKY-D341"),
];

const BY_ID = new Map(SECURITY_RULES.map((r) => [r.id, r]));

export function securityRule(id: string): SecurityRule {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`unknown security rule ${id}`);
  return r;
}

export interface SecurityFindingInput {
  id: string;
  title: string;
  message: string;
  why: string;
  action: string;
  confidence: Confidence;
  evidence: FindingEvidence[];
  severity?: Severity;
  file?: string;
  line?: number;
  symbol?: string;
  nodeId?: string;
  missing?: string[];
  verification?: string[];
  trace?: Trace;
  controlsDetected?: string[];
  controlsMissing?: string[];
  total?: number;
}

const SAMPLE = 12;

export function secFinding(ruleId: string, input: SecurityFindingInput): SecurityFinding {
  const r = securityRule(ruleId);
  const total = input.total ?? input.evidence.length;
  const f: SecurityFinding = {
    id: input.id,
    ruleId,
    category: r.category,
    domain: r.domain,
    severity: input.severity ?? r.severity,
    confidence: input.confidence,
    title: input.title,
    message: input.message,
    evidence: input.evidence.slice(0, SAMPLE),
    more: Math.max(0, total - Math.min(SAMPLE, input.evidence.length)),
    why: input.why,
    action: input.action,
    verification: input.verification ?? ["Run `fehm security` again: the finding disappears when the pattern or flow is gone."],
    owasp: r.owasp,
  };
  if (r.cwe) f.cwe = r.cwe;
  if (r.upstream) f.upstream = r.upstream;
  for (const k of ["file", "line", "symbol", "nodeId", "missing", "trace", "controlsDetected", "controlsMissing"] as const) if (input[k] !== undefined) (f as unknown as Record<string, unknown>)[k] = input[k];
  return f;
}

// ─── framework catalogs ─────────────────────────────────────────────

export const OWASP_TOP10: [string, string][] = [
  ["A01", "Broken Access Control"],
  ["A02", "Cryptographic Failures"],
  ["A03", "Injection"],
  ["A04", "Insecure Design"],
  ["A05", "Security Misconfiguration"],
  ["A06", "Vulnerable and Outdated Components"],
  ["A07", "Identification and Authentication Failures"],
  ["A08", "Software and Data Integrity Failures"],
  ["A09", "Security Logging and Monitoring Failures"],
  ["A10", "Server-Side Request Forgery"],
];
export const OWASP_API: [string, string][] = [
  ["API1", "Broken Object Level Authorization"],
  ["API2", "Broken Authentication"],
  ["API3", "Broken Object Property Level Authorization"],
  ["API4", "Unrestricted Resource Consumption"],
  ["API5", "Broken Function Level Authorization"],
  ["API6", "Unrestricted Access to Sensitive Business Flows"],
  ["API7", "Server Side Request Forgery"],
  ["API8", "Security Misconfiguration"],
  ["API9", "Improper Inventory Management"],
  ["API10", "Unsafe Consumption of APIs"],
];
export const OWASP_LLM: [string, string][] = [
  ["LLM01", "Prompt Injection"],
  ["LLM02", "Sensitive Information Disclosure"],
  ["LLM03", "Supply Chain"],
  ["LLM04", "Data and Model Poisoning"],
  ["LLM05", "Improper Output Handling"],
  ["LLM06", "Excessive Agency"],
  ["LLM07", "System Prompt Leakage"],
  ["LLM08", "Vector and Embedding Weaknesses"],
  ["LLM09", "Misinformation"],
  ["LLM10", "Unbounded Consumption"],
];
export const OWASP_AGENTIC: [string, string][] = [
  ["ASI01", "Agent Goal Hijack"],
  ["ASI02", "Tool Misuse and Exploitation"],
  ["ASI03", "Identity and Privilege Abuse"],
  ["ASI04", "Agentic Supply Chain Vulnerabilities"],
  ["ASI05", "Unexpected Code Execution"],
  ["ASI06", "Memory and Context Poisoning"],
  ["ASI07", "Insecure Inter-Agent Communication"],
  ["ASI08", "Cascading Failures"],
  ["ASI09", "Human-Agent Trust Exploitation"],
  ["ASI10", "Rogue Agents"],
];
