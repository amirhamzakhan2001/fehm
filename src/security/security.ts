import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FehmEngine } from "../engine.js";
import { compareFindings, isOpen, SEVERITIES, type AnalyzerRun, type AnalyzerStatus, type FindingEvidence, type Severity } from "../findings/model.js";
import { applyReviews, readReviews } from "../findings/review.js";
import { readAdvisories } from "../health/advisories.js";
import { analyzeCi } from "../health/ci.js";
import { ignored, readHealthConfig } from "../health/config.js";
import { analyzeDependencies } from "../health/dependencies.js";
import { gitHistory } from "../health/git.js";
import { FEHM_VERSION } from "../health/health.js";
import { applyBaseline, readBaseline, recordTrend } from "../health/history.js";
import { analyzeAi } from "./ai.js";
import { analyzeCicd } from "./cicd.js";
import { frameworkMappings, securityControls } from "./controls.js";
import { analyzeInfra } from "./infra.js";
import { secFinding, securityRule, SECURITY_RULES } from "./rules.js";
import { patternLanguage, scanPatterns, type PatternHit } from "./sast.js";
import { CLIENT_ENV, scannableForSecrets, scanSecrets } from "./secrets.js";
import { analyzeSurface } from "./surface.js";
import { analyzeTaint, type TaintFlow } from "./taint.js";
import { SECURITY_SCHEMA, SECURITY_VERSION, type DomainCoverage, type Posture, type SecurityDomain, type SecurityFinding, type SecurityReport, type SinkKind } from "./types.js";

/**
 * Feature 3.6 — Security review.
 *
 *   FehmEngine + 3.2 facts ─┬─ data flow (taint.ts: source → transform → sanitizer → sink, TS AST + Python heuristic)
 *                           ├─ patterns (sast.ts) · secrets (secrets.ts, redacted)
 *                           ├─ attack surface (surface.ts: routes × authn/authz/validation/rate limits)
 *                           ├─ dependencies (3.5 inventory + OSV advisories, with reachability from routes)
 *                           ├─ CI/CD (cicd.ts) · containers, Kubernetes, IaC (infra.ts)
 *                           └─ LLM, agents, MCP (ai.ts)
 *                                        │
 *     findings (shared model) + controls + OWASP/CWE mappings + posture → /security, fehm security, SARIF
 *
 * Deterministic, local and model-free. No finding says code is vulnerable
 * or compliant: each says what was detected, with the evidence and what
 * could not be established.
 */

export const SECURITY_BASELINE_FILE = "security-baseline.json";
export const SECURITY_HISTORY_FILE = "security-history.json";

const SINK_RULE: Record<SinkKind, string> = {
  sql: "sec/sql-injection",
  command: "sec/command-injection",
  "code-eval": "sec/code-injection",
  path: "sec/path-traversal",
  ssrf: "sec/ssrf",
  redirect: "sec/open-redirect",
  xss: "sec/xss",
  header: "sec/header-injection",
  deserialization: "sec/unsafe-deserialization",
  "mass-assignment": "sec/mass-assignment",
  template: "sec/template-injection",
  "prototype-pollution": "sec/prototype-pollution",
  "llm-prompt": "sec/llm-prompt-injection",
  regex: "sec/regex-injection",
};
/** Pattern rules superseded by a data-flow finding on the same line. */
const COVERED_BY_FLOW: Record<string, SinkKind[]> = { "sec/dangerous-exec": ["command"], "sec/dynamic-eval": ["code-eval"], "sec/raw-sql": ["sql"], "sec/insecure-deserializer": ["deserialization"] };
const DOWNGRADE: Record<Severity, Severity> = { critical: "high", high: "medium", medium: "low", low: "info", info: "info" };

const FLOW_TEXT: Record<SinkKind, { why: string; action: string[] }> = {
  sql: { why: "Data from the request becomes part of the SQL text, so it can change the query itself: read other rows, bypass filters, or modify data.", action: ["Pass the value as a bound parameter (placeholders such as $1 or ?, or a tagged sql`` template) instead of building SQL text.", "Keep input validation, but do not rely on it instead of parameters."] },
  command: { why: "The value becomes part of a shell command, so characters like ; | $( ) run additional commands with the server's privileges.", action: ["Call the program directly with an argument array (execFile/spawn without shell), never through a shell string.", "Allowlist the permitted values if the argument selects behaviour."] },
  "code-eval": { why: "The value is executed as code: whoever controls it controls the process.", action: ["Remove eval/Function; parse data with JSON.parse or a real parser, and dispatch on an allowlist of operations."] },
  path: { why: "The value picks a file path, so ../ sequences or absolute paths can read or overwrite files outside the intended directory.", action: ["Resolve the path against a fixed base directory and reject it unless the result still starts with that base, or use path.basename for plain file names."] },
  ssrf: { why: "The value chooses the URL the server fetches, so it can reach internal services, cloud metadata endpoints or localhost ports.", action: ["Fix the scheme and host, or check the destination against an allowlist, and block private address ranges after DNS resolution."] },
  redirect: { why: "The value chooses where the user is redirected, which lends your domain's trust to phishing links.", action: ["Redirect only to relative paths or an allowlist of hosts."] },
  xss: { why: "The value is written into HTML, so script in it runs in other users' browsers with their session.", action: ["Send data as JSON or render it through an escaping template; use textContent instead of innerHTML; sanitize with DOMPurify if HTML is required."] },
  header: { why: "The value is written into a response header; newlines in it can inject headers or split the response.", action: ["Reject or strip CR/LF, and allowlist header values."] },
  deserialization: { why: "Deserializing attacker-controlled data with this deserializer can execute code.", action: ["Use a data-only format (JSON) and validate it against a schema."] },
  "mass-assignment": { why: "The whole request body is written to the model, so a client can set fields it should not (role, isAdmin, ownerId).", action: ["Pick the allowed fields explicitly, or validate the body against a schema that lists them."] },
  template: { why: "The value is compiled as a template, and template languages can execute code.", action: ["Render fixed templates and pass the value as data, never as template source."] },
  "prototype-pollution": { why: "A request-controlled key can reach __proto__ or constructor.prototype and change the behaviour of every object.", action: ["Reject __proto__, constructor and prototype keys, or build objects with Object.create(null) / Map."] },
  "llm-prompt": { why: "Request text is mixed into the prompt.", action: ["Delimit untrusted text and cap its length."] },
  regex: { why: "A user-supplied regular expression can take exponential time (ReDoS) or match more than intended.", action: ["Escape the input (it is data, not a pattern), or use a safe regex engine with a timeout."] },
};

export interface SecurityOptions {
  engine: FehmEngine;
  facts?: BriefingFacts;
  stateDirectory?: string;
  dryRun?: boolean;
  scope?: "all" | "changed";
  now?: number;
}

export function buildSecurityReport(options: SecurityOptions): SecurityReport {
  const started = performance.now();
  const { engine } = options;
  const facts = options.facts ?? new BriefingFacts(engine);
  const state = options.stateDirectory;
  const writable = Boolean(state) && !options.dryRun;
  const runs: AnalyzerRun[] = [];
  const timed = <T>(id: string, name: string, fn: () => T, status: (r: T) => { status: AnalyzerStatus; reason?: string; findings?: number } = () => ({ status: "complete" })): T => {
    const t0 = performance.now();
    try {
      const r = fn();
      const s = status(r);
      runs.push({ id, name, status: s.status, ...(s.reason ? { reason: s.reason } : {}), findings: s.findings ?? 0, durationMs: Math.round(performance.now() - t0) });
      return r;
    } catch (e) {
      runs.push({ id, name, status: "error", reason: (e as Error).message, findings: 0, durationMs: Math.round(performance.now() - t0) });
      throw e;
    }
  };

  const { config } = readHealthConfig(engine.root);
  const skip = ignored(config);
  const sources = facts.sourceFiles.filter((p) => !skip(p) && !/\.d\.[cm]?ts$/.test(p));
  const tests = facts.testFiles.filter((p) => !skip(p));
  const lang = (p: string): string => engine.graph.node(`file:${p}`)?.language ?? "other";
  const findings: SecurityFinding[] = [];

  // Data flow.
  const taintFiles = sources.filter((p) => ["typescript", "javascript", "python"].includes(lang(p))).map((p) => ({ path: p, language: lang(p), lines: facts.lines(p) }));
  const taint = timed("taint", "Data flow (source → sink)", () => analyzeTaint({ engine, files: taintFiles }), (t) => ({ status: sources.length > taintFiles.length ? "partial" : "complete", ...(sources.length > taintFiles.length ? { reason: `${sources.length - taintFiles.length} source files are in languages without data-flow support.` } : {}), findings: t.flows.length }));
  const flowLines = new Map<string, Set<SinkKind>>();
  for (const f of taint.flows) {
    const sink = f.trace.steps.at(-1)!;
    const key = `${sink.path}:${sink.line}`;
    flowLines.set(key, new Set([...(flowLines.get(key) ?? []), f.trace.sink.kind]));
    if (f.trace.sink.kind === "llm-prompt") continue; // reported by the AI analyzer
    findings.push(flowFinding(f));
  }

  // Patterns.
  const patternHits = timed("patterns", "Application patterns", () => sources.flatMap((p) => scanPatterns(p, engine.graph.node(`file:${p}`)?.language ?? "other", facts.lines(p))), (h) => ({ status: "complete", findings: h.length }));
  findings.push(...patternFindings(patternHits.filter((h) => !(COVERED_BY_FLOW[h.rule] ?? []).some((k) => flowLines.get(`${h.path}:${h.line}`)?.has(k)))));

  // Secrets across every indexed file (tests included, at lower severity), plus committed .env files.
  const secretFiles = [...engine.fileHashes().keys()].filter((p) => !skip(p) && scannableForSecrets(p));
  findings.push(...timed("secrets", "Secrets", () => secretFindings(engine, facts, secretFiles, sources), (f) => ({ status: "complete", findings: f.length })));

  // Attack surface (needs finding locations for per-route counts).
  const findingLines = new Map<string, number>();
  for (const f of findings) for (const e of f.evidence) if (e.path && e.line) findingLines.set(`${e.path}:${e.line}`, (findingLines.get(`${e.path}:${e.line}`) ?? 0) + 1);
  const surface = timed("surface", "Attack surface, authentication and authorization", () => analyzeSurface({ engine, facts, skip, findingLines }), (s) => ({ status: "complete", findings: s.findings.length }));
  findings.push(...surface.findings);

  // Dependencies with reachability.
  const deps = timed("dependencies", "Dependency vulnerabilities", () => dependencyFindings(engine, facts, state, config, surface.surface.routes), (d) => ({ status: d.status === "checked" ? "complete" : d.status === "stale" ? "partial" : "skipped", reason: d.status === "checked" ? `Advisories from OSV.dev, ${d.checkedAt}` : d.status === "stale" ? "Advisory results predate the current dependency set." : "Known vulnerabilities are not checked until the opt-in OSV.dev lookup runs (Project health → Dependencies, or fehm health --advisories).", findings: d.findings.length }));
  findings.push(...deps.findings);

  // CI/CD, infrastructure, AI.
  const cicd = timed("cicd", "CI/CD pipelines", () => analyzeCicd(facts, skip), (c) => ({ status: c.files ? "complete" : "skipped", ...(c.files ? {} : { reason: "No CI configuration." }), findings: c.findings.length }));
  findings.push(...cicd.findings);
  const infra = timed("infra", "Containers, Kubernetes and infrastructure", () => analyzeInfra(facts, skip), (r) => ({ status: Object.values(r.files).some(Boolean) ? "complete" : "skipped", ...(Object.values(r.files).some(Boolean) ? {} : { reason: "No Dockerfile, Compose, Kubernetes, Terraform or CloudFormation file." }), findings: r.findings.length }));
  findings.push(...infra.findings);
  const ai = timed("ai", "LLM, agent and MCP security", () => analyzeAi({ root: engine.root, facts, skip, flows: taint.flows, surface: surface.surface }), (r) => ({ status: r.inventory.sites.length || r.inventory.tools.length || r.inventory.mcpConfigs.length ? "complete" : "skipped", ...(r.inventory.sites.length || r.inventory.tools.length || r.inventory.mcpConfigs.length ? {} : { reason: "No LLM calls, agent tools or MCP servers were found." }), findings: r.findings.length }));
  findings.push(...ai.findings);
  for (const cfg of ai.configTexts) findings.push(...secretsIn(cfg.path, cfg.lines, false));

  // Related tests, unique ids, review, baseline, scope.
  const testers = new Map<string, string[]>();
  for (const t of tests) for (const target of facts.fileDeps.out.get(t) ?? []) testers.set(target, [...(testers.get(target) ?? []), t]);
  for (const f of findings) {
    const file = f.file ?? f.evidence.at(-1)?.path;
    const t = file ? testers.get(file) : undefined;
    if (t?.length) f.relatedTests = t.slice(0, 5);
  }
  const seen = new Map<string, number>();
  for (const f of findings) {
    const n = seen.get(f.id) ?? 0;
    seen.set(f.id, n + 1);
    if (n) f.id = `${f.id}#${n + 1}`;
  }
  const git = gitHistory(engine.root, new Set(engine.fileHashes().keys()));
  const scope = options.scope ?? "all";
  let shown = findings;
  if (scope === "changed") {
    const changed = new Set(git.changed);
    shown = findings.filter((f) => (f.file && changed.has(f.file)) || f.evidence.some((e) => e.path && changed.has(e.path)));
  }
  if (state) applyReviews(shown, readReviews(state));
  const baseline = applyBaseline(shown, state ? readBaseline(state, SECURITY_BASELINE_FILE) : undefined);
  shown.sort(compareFindings);

  const ciReport = analyzeCi(engine.root, facts);
  const controls = securityControls({ facts, sources, tests, surface: surface.surface, findings: shown, ci: ciReport, localOnly: surface.localOnly, root: engine.root });
  const summary = summarize(shown);
  const { posture, reasons } = postureOf(summary.bySeverity, shown, sources.length);
  const domains = domainCoverage(shown, { sources: sources.length, taint: taintFiles.length, secretFiles: secretFiles.length, routes: surface.surface.routes.length, deps: deps.components, advisories: deps.status, ci: cicd.files, infra: infra.files, ai: ai.inventory });
  const digest = digestOf(engine, skip, [SECURITY_VERSION, deps.checkedAt ?? "", scope]);
  const trendMetrics: Record<string, number> = { findings: summary.open, critical: summary.bySeverity.critical, high: summary.bySeverity.high, secrets: shown.filter((f) => f.domain === "secrets" && isOpen(f)).length, dataFlows: shown.filter((f) => f.trace && isOpen(f)).length, unauthenticated: surface.surface.totals.unauthenticatedStateChanging, routes: surface.surface.routes.length, llmGaps: shown.filter((f) => (f.domain === "llm" || f.domain === "agents" || f.domain === "mcp") && isOpen(f)).length };
  if (deps.status === "checked") trendMetrics.vulnerable = deps.vulnerable.length;
  const trend = writable ? recordTrend(state, { at: new Date(options.now ?? Date.now()).toISOString(), ...(git.commit ? { commit: git.commit } : {}), ...(git.dirty !== undefined ? { dirty: git.dirty } : {}), version: SECURITY_VERSION, metrics: trendMetrics, digest }, SECURITY_HISTORY_FILE) : [{ at: new Date(options.now ?? Date.now()).toISOString(), version: SECURITY_VERSION, metrics: trendMetrics }];

  const report: SecurityReport = {
    schemaVersion: SECURITY_SCHEMA,
    version: SECURITY_VERSION,
    repository: { name: facts.name, root: engine.root },
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    scope,
    posture,
    postureReasons: reasons,
    summary,
    findings: shown,
    domains,
    surface: surface.surface,
    controls,
    ai: ai.inventory,
    frameworks: frameworkMappings(shown),
    secrets: { scannedFiles: secretFiles.length, found: shown.filter((f) => f.domain === "secrets").length, testFixtures: shown.filter((f) => f.domain === "secrets" && f.severity === "low").length },
    dependencies: { components: deps.components, advisories: deps.status, ...(deps.checkedAt ? { checkedAt: deps.checkedAt } : {}), vulnerable: deps.vulnerable },
    analyzers: runs,
    languages: languageSupport(facts, sources, lang),
    provenance: {
      fehmVersion: FEHM_VERSION,
      securityVersion: SECURITY_VERSION,
      ...(git.commit ? { commit: git.commit } : {}),
      ...(git.dirty !== undefined ? { dirty: git.dirty } : {}),
      digest,
      inputs: [`${engine.fileHashes().size} indexed files (content hashes)`, `${SECURITY_RULES.length} rules, security v${SECURITY_VERSION}`, ...(deps.checkedAt ? [`OSV.dev advisories (${deps.checkedAt})`] : [])],
      excluded: ["files the Feature 1 scanner ignores (.gitignore, .fehmignore, node_modules, build output)", ...config.ignore.map((g) => `${g} (.fehm/health.json ignore)`)],
      rulesDerivedFrom: "Skylos 4.x danger, secrets, CI/CD and defend rules (Apache-2.0), re-implemented in TypeScript; see THIRD_PARTY_NOTICES.md",
    },
    ...(baseline ? { baseline } : {}),
    trend,
    unknowns: [],
    freshness: engine.freshness(),
    durationMs: 0,
  };
  report.unknowns = unknowns(report, taintFiles.length, sources.length);
  report.durationMs = Math.round(performance.now() - started);
  return report;
}

// ─── findings from flows, patterns, secrets and dependencies ────────

function flowFinding(f: TaintFlow): SecurityFinding {
  const sink = f.trace.steps.at(-1)!;
  const source = f.trace.steps[0]!;
  const fromModel = f.trace.source.kind === "llm-output";
  const fromTool = f.trace.source.kind === "tool-argument";
  const ruleId = fromModel ? "sec/llm-output-sink" : SINK_RULE[f.trace.sink.kind];
  const rule = securityRule(ruleId);
  const severity = f.validated ? DOWNGRADE[rule.severity] : rule.severity;
  const text = FLOW_TEXT[f.trace.sink.kind];
  return secFinding(ruleId, {
    id: `sec:flow:${f.trace.sink.kind}:${sink.path}:${sink.line}`,
    severity,
    title: `${fromModel ? "LLM output reaches" : fromTool ? `Tool argument reaches` : "Request data reaches"} ${f.trace.sink.label}`,
    message: `${f.trace.source.label} (${source.path}:${source.line}) flows ${f.trace.steps.length > 2 ? `through ${f.trace.steps.length - 2} ${f.trace.steps.length - 2 === 1 ? "step" : "steps"} ` : ""}into ${f.trace.sink.label} at ${sink.path}:${sink.line}${f.trace.sanitizers.length ? `; seen on the path: ${f.trace.sanitizers.join(", ")}, which do not neutralise this sink` : "; no recognised sanitizer on the path"}.`,
    why: fromModel ? `Model output is attacker-influenced text (prompt injection can steer it). ${text.why}` : fromTool ? `The model chooses tool arguments, and injected instructions can choose them for an attacker. ${text.why}` : text.why,
    action: text.action.join(" "),
    confidence: f.resolution === "ast" ? (f.validated ? "inferred" : "strong") : "inferred",
    file: sink.path,
    line: sink.line,
    ...(f.fn ? { symbol: f.fn } : {}),
    trace: f.trace,
    evidence: f.trace.steps.map((s): FindingEvidence => ({ type: "taint-flow", path: s.path, line: s.line, detail: `${s.role}: ${s.label}`, confidence: f.resolution === "ast" ? "strong" : "inferred" })),
    ...(f.trace.sanitizers.length ? { controlsDetected: f.trace.sanitizers } : {}),
    controlsMissing: [f.trace.sink.kind === "sql" ? "parameterized query" : f.trace.sink.kind === "command" ? "argument array without shell" : f.trace.sink.kind === "path" ? "base-directory check" : f.trace.sink.kind === "xss" ? "output encoding" : "sanitizer for this sink"],
    missing: [f.resolution === "heuristic" ? "Python flows are followed line by line inside one function; flows through other functions are not." : "Flows are followed one call level deep; framework-level sanitisation (an ORM, a gateway) is not visible.", ...(f.validated ? ["A validator was seen on the path; if it restricts the value to a safe shape, this is a false positive."] : [])],
    verification: [`Fix, then run \`fehm security\` again: the flow must no longer reach ${f.trace.sink.label}.`, "Add a negative test that sends a malicious value (for example ' OR 1=1 --, ../../etc/passwd or <script>) and asserts it is rejected or neutralised."],
  });
}

const PATTERN_TEXT: Record<string, { title: (n: number) => string; why: string; action: string }> = {
  "sec/weak-hash": { title: (n) => `${n} use${n === 1 ? "" : "s"} of MD5 or SHA-1`, why: "MD5 and SHA-1 are broken for collision resistance, and far too fast for passwords.", action: "Use SHA-256 or better for integrity, and bcrypt/argon2/scrypt for passwords. Non-security checksums (cache keys, ETags) are fine: mark them reviewed." },
  "sec/weak-cipher": { title: (n) => `${n} weak or legacy cipher${n === 1 ? "" : "s"}`, why: "DES, RC4 and ECB mode leak plaintext patterns or are broken outright; createCipher derives keys without an IV.", action: "Use AES-GCM (createCipheriv with a random IV) or a vetted library such as libsodium." },
  "sec/weak-random": { title: (n) => `${n} security value${n === 1 ? " is" : "s are"} generated with a non-cryptographic random source`, why: "Math.random and Python's random are predictable; tokens and IDs made with them can be guessed.", action: "Use crypto.randomBytes / crypto.randomUUID, or Python's secrets module." },
  "sec/tls-disabled": { title: (n) => `${n} place${n === 1 ? "" : "s"} disable${n === 1 ? "s" : ""} TLS certificate verification`, why: "Without verification anyone on the network path can impersonate the server and read or change the traffic.", action: "Remove the override; trust a private CA explicitly if one is needed." },
  "sec/jwt-unverified": { title: (n) => `${n} JWT${n === 1 ? " is" : "s are"} decoded without verifying the signature`, why: "An unverified token can be forged: any claims, any user.", action: "Use jwt.verify (or PyJWT decode with verification) with an explicit algorithm list." },
  "sec/jwt-weak": { title: (n) => `${n} weak JWT setting${n === 1 ? "" : "s"}`, why: "Accepting alg:none or ignoring expiry lets forged or stolen tokens work.", action: "Pin the accepted algorithms and keep expiry checks on." },
  "sec/cors-wildcard": { title: (n) => `${n} permissive CORS ${n === 1 ? "policy" : "policies"}`, why: "Any website can make requests to the API from a visitor's browser; with credentials allowed it can act as the user.", action: "List the allowed origins explicitly, and never combine a wildcard with credentials." },
  "sec/insecure-cookie": { title: (n) => `${n} cookie${n === 1 ? " is" : "s are"} set without httpOnly/secure`, why: "Cookies without httpOnly are readable by injected script; without secure they travel over plain HTTP.", action: "Set httpOnly, secure and sameSite on session and auth cookies." },
  "sec/timing-compare": { title: (n) => `${n} secret comparison${n === 1 ? "" : "s"} with ==/===`, why: "String comparison stops at the first different character, leaking how much of a guessed token was right.", action: "Compare with crypto.timingSafeEqual or hmac.compare_digest." },
  "sec/sensitive-log": { title: (n) => `${n} log statement${n === 1 ? " includes" : "s include"} a secret-named value`, why: "Logs are widely readable and long-lived; credentials in them leak.", action: "Log identifiers, not secrets; redact sensitive fields in the logger." },
  "sec/error-disclosure": { title: (n) => `${n} response${n === 1 ? " returns" : "s return"} stack traces or tracebacks`, why: "Stack traces reveal paths, versions and internals useful to an attacker.", action: "Log the details server-side and return a generic error with a correlation id." },
  "sec/debug-mode": { title: (n) => `Debug mode is enabled (${n})`, why: "Framework debug modes expose interactive debuggers or detailed errors that can execute code or leak secrets.", action: "Drive debug mode from the environment and keep it off in production." },
  "sec/xxe": { title: (n) => `${n} XML parser${n === 1 ? " may resolve" : "s may resolve"} external entities`, why: "External entities read local files or make network requests when parsing attacker-supplied XML.", action: "Disable DTDs and external entities (or use defusedxml in Python)." },
  "sec/insecure-tempfile": { title: (n) => `${n} predictable temporary file name${n === 1 ? "" : "s"}`, why: "Another process can create the file first and hijack what is written to it.", action: "Use tempfile.mkstemp / NamedTemporaryFile." },
  "sec/bind-all": { title: (n) => `${n} server${n === 1 ? " listens" : "s listen"} on all interfaces`, why: "0.0.0.0 exposes the service on every network the host is on; fine in a container, risky on a laptop or VM.", action: "Bind to 127.0.0.1 unless the service must be reachable from outside." },
  "sec/dangerous-exec": { title: (n) => `${n} shell command${n === 1 ? " is" : "s are"} built from a dynamic string`, why: "If any part of the string can be influenced from outside, it can run extra commands.", action: "Use execFile/spawn with an argument array (Python: a list without shell=True)." },
  "sec/dynamic-eval": { title: (n) => `${n} dynamic code evaluation${n === 1 ? "" : "s"}`, why: "Evaluating a non-constant string executes whatever it contains.", action: "Remove eval/exec; parse data instead of executing it." },
  "sec/raw-sql": { title: (n) => `${n} SQL ${n === 1 ? "statement is" : "statements are"} built by string interpolation`, why: "Even when no request data reaches it today, interpolated SQL becomes injectable the moment one does.", action: "Use bound parameters for every value." },
  "sec/insecure-deserializer": { title: (n) => `${n} use${n === 1 ? "" : "s"} of a deserializer that can execute code`, why: "pickle, marshal, unsafe YAML and native Java/JS deserializers run code embedded in the data.", action: "Use JSON (or yaml.safe_load, torch.load(weights_only=True)) and never deserialize untrusted input this way." },
};

function patternFindings(hits: PatternHit[]): SecurityFinding[] {
  const by = new Map<string, PatternHit[]>();
  for (const h of hits) by.set(h.rule, [...(by.get(h.rule) ?? []), h]);
  const out: SecurityFinding[] = [];
  const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
  for (const [rule, list] of by) {
    const t = PATTERN_TEXT[rule]!;
    const sev = list.map((h) => h.severity).filter((s): s is NonNullable<typeof s> => Boolean(s)).sort((a, b) => rank[a] - rank[b])[0];
    out.push(secFinding(rule, { id: `sec:pattern:${rule.slice(4)}`, ...(sev ? { severity: sev } : {}), title: t.title(list.length), message: `${list.length} ${list.length === 1 ? "occurrence" : "occurrences"} in ${new Set(list.map((h) => h.path)).size} ${new Set(list.map((h) => h.path)).size === 1 ? "file" : "files"}.`, why: t.why, action: t.action, confidence: list.every((h) => h.confidence === "verified") ? "verified" : list.some((h) => h.confidence === "inferred") ? "inferred" : "strong", ...(list.length === 1 ? { file: list[0]!.path, line: list[0]!.line } : {}), evidence: list.map((h) => ({ type: "ast" as const, path: h.path, line: h.line, detail: h.detail, confidence: h.confidence })) }));
  }
  return out;
}

function secretsIn(path: string, lines: readonly string[], test: boolean): SecurityFinding[] {
  const hits = scanSecrets(lines);
  const out: SecurityFinding[] = [];
  for (const h of hits.slice(0, 20)) {
    const severity: Severity = test ? "low" : h.confidence === "verified" ? "critical" : h.confidence === "strong" ? "high" : "medium";
    out.push(
      secFinding("sec/secret", {
        id: `sec:secret:${path}:${h.fingerprint}`,
        severity,
        title: `${h.kind} in ${path}${test ? " (test file)" : ""}`,
        message: `A ${h.length}-character value matching ${h.kind.toLowerCase()} is committed at ${path}:${h.line}. The value is not shown; fingerprint ${h.fingerprint}.`,
        why: test ? "Test fixtures are usually fake, but real keys end up in tests too, and anything in the repository is readable by everyone with access, forever (git history)." : "Anyone with read access to the repository, its forks, CI logs or build artifacts can use the credential. Removing it from the file does not remove it from git history.",
        action: test ? "Confirm it is a fake value (then mark it reviewed), or replace it with a clearly fake placeholder." : "Rotate the credential first, then move it to an environment variable or secret manager, and purge it from git history if the repository is shared.",
        confidence: h.confidence,
        file: path,
        line: h.line,
        evidence: [{ type: "pattern", path, line: h.line, detail: `${h.kind}: •••••••• (${h.length} chars, ${h.fingerprint})`, confidence: h.confidence }],
        verification: ["Run `fehm security` again: the finding disappears once the value is gone from the file.", "Confirm the old credential no longer works (rotation)."],
      }),
    );
  }
  return out;
}

function secretFindings(engine: FehmEngine, facts: BriefingFacts, files: string[], sources: string[]): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const role = facts.roleByPath;
  for (const p of files) {
    const lines = engine.sourceLines(p);
    if (!lines) continue;
    out.push(...secretsIn(p, lines, role.get(p) === "test" || /(?:^|\/)(?:tests?|__tests__|fixtures?|spec|testdata)\//.test(p)));
  }
  // .env files tracked by git (the Feature 1 scanner skips them, so ask git).
  let tracked: string[] = [];
  try {
    tracked = execFileSync("git", ["-C", engine.root, "ls-files", "--", "*.env", ".env", ".env.*", "**/.env", "**/.env.*"], { stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).toString().split("\n").map((s) => s.trim()).filter((s) => s && !/\.(?:example|sample|template|dist)$|\.env\.(?:example|sample|template|test)$/.test(s));
  } catch {
    /* not a git repository */
  }
  for (const p of tracked) {
    const abs = join(engine.root, p);
    if (!existsSync(abs)) continue;
    const lines = readFileSync(abs, "utf8").split(/\r?\n/);
    const values = lines.filter((l) => /^\s*(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*\S/.test(l)).length;
    out.push(secFinding("sec/committed-env", { id: `sec:env:${p}`, title: `Environment file ${p} is committed`, message: `${values} ${values === 1 ? "variable is" : "variables are"} set in a file tracked by git. Values are not shown.`, why: ".env files hold credentials by convention; committing one publishes them to everyone with repository access and keeps them in history.", action: "Rotate any real credentials, remove the file from git (git rm --cached), add it to .gitignore, and commit a .env.example with placeholders instead.", confidence: "verified", file: p, evidence: [{ type: "config", path: p, detail: `tracked by git; ${values} assignments` }] }));
    out.push(...secretsIn(p, lines, false).map((f) => ({ ...f, id: `${f.id}:env` })));
  }
  // Secret-named public client variables.
  const client: FindingEvidence[] = [];
  for (const p of sources) {
    facts.lines(p).forEach((l, i) => {
      CLIENT_ENV.lastIndex = 0;
      for (let m = CLIENT_ENV.exec(l); m; m = CLIENT_ENV.exec(l)) client.push({ type: "pattern", path: p, line: i + 1, detail: `${m[1]} is bundled into client code` });
    });
  }
  if (client.length) out.push(secFinding("sec/client-secret", { id: "sec:client-secret", title: `${client.length} secret-named ${client.length === 1 ? "variable is" : "variables are"} exposed to the browser`, message: "NEXT_PUBLIC_, VITE_, REACT_APP_ (and similar) variables are inlined into the JavaScript bundle that every visitor downloads.", why: "A secret in a public build variable is public.", action: "Keep the secret server-side and call it through an API route; rename the variable without the public prefix.", confidence: "strong", evidence: client }));
  return out;
}

interface DepResult {
  findings: SecurityFinding[];
  components: number;
  status: "not-checked" | "checked" | "stale" | "error";
  checkedAt?: string;
  vulnerable: SecurityReport["dependencies"]["vulnerable"];
}

function dependencyFindings(engine: FehmEngine, facts: BriefingFacts, state: string | undefined, config: ReturnType<typeof readHealthConfig>["config"], routes: SecurityReport["surface"]["routes"]): DepResult {
  const { report } = analyzeDependencies(engine.root, facts, config, []);
  const adv = state ? readAdvisories(state, report.components) : undefined;
  if (!adv || (adv.status !== "checked" && adv.status !== "stale")) return { findings: [], components: report.components.length, status: adv?.status ?? "not-checked", vulnerable: [] };
  const byPkg = new Map<string, typeof adv.items>();
  for (const a of adv.items) byPkg.set(`${a.package}@${a.version}`, [...(byPkg.get(`${a.package}@${a.version}`) ?? []), a]);
  const pkgImporters = new Map(facts.packages.map((p) => [p.name, facts.runtimeImporters(p)]));
  const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4, unknown: 5 } as const;
  const vulnerable: DepResult["vulnerable"] = [];
  const findings: SecurityFinding[] = [];
  for (const [key, list] of byPkg) {
    const [name, version] = [key.slice(0, key.lastIndexOf("@")), key.slice(key.lastIndexOf("@") + 1)];
    const comp = report.components.find((c) => c.name === name && c.version === version);
    const worst = [...list].sort((a, b) => rank[a.severity] - rank[b.severity])[0]!;
    const importers = pkgImporters.get(name) ?? [];
    let reachable: "yes" | "no" | "unknown" = comp?.direct ? (importers.length ? "no" : "unknown") : "unknown";
    let path: string[] | undefined;
    if (importers.length) {
      for (const r of routes) {
        const start = r.handler ? engine.graph.node(r.handler.nodeId)?.path ?? r.path : r.path;
        const found = bfs(facts, start, new Set(importers));
        if (found) {
          reachable = "yes";
          path = [`${r.method} ${r.route}`, ...found, name];
          break;
        }
      }
      if (reachable !== "yes" && importers.some((f) => (facts.metrics.get(f)?.entryReach ?? 0) > 0)) {
        reachable = "yes";
        path = [importers.find((f) => (facts.metrics.get(f)?.entryReach ?? 0) > 0)!, name];
      }
    }
    vulnerable.push({ name, version, ids: list.map((a) => a.aliases.find((x) => x.startsWith("CVE-")) ?? a.id), severity: worst.severity, direct: Boolean(comp?.direct), reachable, ...(path ? { path } : {}) });
    const base: Severity = worst.severity === "unknown" ? "medium" : worst.severity;
    findings.push(
      secFinding("sec/vulnerable-dependency", {
        id: `sec:dep:${key}`,
        severity: reachable === "no" ? DOWNGRADE[base] : base,
        title: `${name}@${version}: ${list.length} known ${list.length === 1 ? "vulnerability" : "vulnerabilities"}${reachable === "yes" ? " (reachable)" : reachable === "no" ? " (imported, not reached from an entry point)" : ""}`,
        message: `${list.map((a) => a.aliases.find((x) => x.startsWith("CVE-")) ?? a.id).slice(0, 4).join(", ")}. ${reachable === "yes" ? `Reachable: ${path!.join(" → ")}.` : reachable === "no" ? "Imported by application code, but no route or entry point reaches the importing files." : "Transitive, or imported nowhere Fehm can see; reachability unknown."}`,
        why: worst.summary || "A published advisory affects this version.",
        action: "Upgrade to a fixed version. If you cannot yet, check whether the vulnerable function is called on the path shown, and record the decision (Accepted risk).",
        confidence: adv.status === "stale" ? "inferred" : "verified",
        evidence: [...list.map((a): FindingEvidence => ({ type: "dependency", detail: `${a.id}${a.aliases.length ? ` (${a.aliases.slice(0, 2).join(", ")})` : ""} · ${a.severity}: ${a.summary.slice(0, 140)}` })), ...(path ? [{ type: "import" as const, detail: `path: ${path.join(" → ")}` }] : [])],
        missing: ["Whether the vulnerable function itself is called (function-level reachability) is not established."],
        verification: ["Upgrade, then re-run the advisory check (fehm health --advisories) and `fehm security`."],
      }),
    );
  }
  return { findings, components: report.components.length, status: adv.status, ...(adv.checkedAt ? { checkedAt: adv.checkedAt } : {}), vulnerable };
}

function bfs(facts: BriefingFacts, start: string, targets: Set<string>): string[] | undefined {
  const prev = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    if (targets.has(cur)) {
      const path: string[] = [];
      for (let x: string | null | undefined = cur; x; x = prev.get(x)) path.unshift(x);
      return path;
    }
    if ((prev.size ?? 0) > 5000) break;
    for (const next of facts.fileDeps.out.get(cur) ?? []) if (!prev.has(next)) {
      prev.set(next, cur);
      queue.push(next);
    }
  }
  return undefined;
}

// ─── posture, domains, provenance ───────────────────────────────────

function summarize(findings: SecurityFinding[]): SecurityReport["summary"] {
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  const byDomain: Record<string, number> = {};
  let open = 0;
  for (const f of findings) {
    if (!isOpen(f)) continue;
    open += 1;
    bySeverity[f.severity] += 1;
    byDomain[f.domain] = (byDomain[f.domain] ?? 0) + 1;
  }
  return { bySeverity, byDomain, open };
}

function postureOf(c: Record<Severity, number>, findings: SecurityFinding[], sources: number): { posture: Posture; reasons: string[] } {
  if (!sources) return { posture: "unknown", reasons: ["No source files were analysed."] };
  const open = findings.filter(isOpen);
  const top = (s: Severity): string[] => open.filter((f) => f.severity === s).slice(0, 3).map((f) => f.title);
  if (c.critical) return { posture: "critical-attention", reasons: [`${c.critical} critical ${c.critical === 1 ? "finding" : "findings"}:`, ...top("critical")] };
  if (c.high) return { posture: "attention-required", reasons: [`${c.high} high-severity ${c.high === 1 ? "finding" : "findings"}:`, ...top("high")] };
  if (c.medium) return { posture: "review", reasons: [`${c.medium} medium-severity ${c.medium === 1 ? "finding" : "findings"} to review.`, ...top("medium")] };
  return { posture: "no-high-severity-findings", reasons: ["No critical, high or medium findings in what was analysed. This is not a statement that the code is secure: see Analysis for what was not covered."] };
}

const DOMAIN_TITLE: Record<SecurityDomain, string> = { application: "Application code", "data-flow": "Data flow", secrets: "Secrets", dependencies: "Dependencies", auth: "Authentication", api: "API", cicd: "CI/CD", containers: "Containers", kubernetes: "Kubernetes", infrastructure: "Infrastructure", llm: "LLM", agents: "Agents", mcp: "MCP" };

function domainCoverage(findings: SecurityFinding[], n: { sources: number; taint: number; secretFiles: number; routes: number; deps: number; advisories: string; ci: number; infra: { docker: number; compose: number; kubernetes: number; iac: number }; ai: { sites: unknown[]; tools: unknown[]; mcpConfigs: unknown[]; mcpServers: unknown[] } }): DomainCoverage[] {
  const count = (d: SecurityDomain): Record<Severity, number> => {
    const out = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
    for (const f of findings) if (f.domain === d && isOpen(f)) out[f.severity] += 1;
    return out;
  };
  const row = (domain: SecurityDomain, analysed: number, relevant: number, note: string, applicable = relevant > 0): DomainCoverage => ({ domain, title: DOMAIN_TITLE[domain], analysed, relevant, applicable, findings: count(domain), note });
  const aiCount = n.ai.sites.length;
  return [
    row("data-flow", n.taint, n.sources, "Source files in languages with data-flow analysis (TypeScript/JavaScript by syntax tree, Python by lines)."),
    row("application", n.sources, n.sources, "Source files checked against the pattern rules."),
    row("secrets", n.secretFiles, n.secretFiles, "Indexed files scanned for credentials (lockfiles and source maps excluded)."),
    row("auth", n.routes, n.routes, "Routes checked for authentication and authorization evidence."),
    row("api", n.routes, n.routes, "Routes checked for validation, rate limiting, CORS, CSRF and webhooks."),
    row("dependencies", n.advisories === "checked" ? n.deps : 0, n.deps, n.advisories === "checked" ? "Components checked against OSV.dev advisories." : "Advisories not checked: run the opt-in OSV.dev lookup from Project health."),
    row("cicd", n.ci, n.ci, "CI configuration files."),
    row("containers", n.infra.docker + n.infra.compose, n.infra.docker + n.infra.compose, "Dockerfiles and Compose files."),
    row("kubernetes", n.infra.kubernetes, n.infra.kubernetes, "Kubernetes manifests."),
    row("infrastructure", n.infra.iac, n.infra.iac, "Terraform and CloudFormation templates."),
    row("llm", aiCount, aiCount, "LLM call sites."),
    row("agents", n.ai.tools.length, n.ai.tools.length, "Agent and MCP tool definitions."),
    row("mcp", n.ai.mcpServers.length + n.ai.mcpConfigs.length, n.ai.mcpServers.length + n.ai.mcpConfigs.length, "MCP servers and client configurations."),
  ];
}

function languageSupport(facts: BriefingFacts, sources: string[], lang: (p: string) => string): SecurityReport["languages"] {
  const counts = new Map<string, number>();
  for (const p of sources) counts.set(lang(p), (counts.get(lang(p)) ?? 0) + 1);
  void facts;
  return [...counts]
    .filter(([l]) => !["json", "yaml", "toml", "markdown", "other"].includes(l))
    .sort((a, b) => b[1] - a[1])
    .map(([language, files]) => ({ language, files, taint: language === "typescript" || language === "javascript" ? "ast" : language === "python" ? "heuristic" : "unsupported", patterns: patternLanguage(language as never) ? (language === "typescript" || language === "javascript" ? "ast" : "heuristic") : "unsupported" }));
}

function digestOf(engine: FehmEngine, skip: (p: string) => boolean, extra: string[]): string {
  const h = createHash("sha256");
  for (const [p, x] of [...engine.fileHashes()].filter(([p]) => !skip(p)).sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(`${p}\0${x}\n`);
  for (const e of extra) h.update(`${e}\n`);
  return h.digest("hex");
}

function unknowns(r: SecurityReport, taintFiles: number, sources: number): string[] {
  const out: string[] = [];
  if (sources > taintFiles) out.push(`Data flow: ${sources - taintFiles} source files are in languages without data-flow analysis (Go, Java, Rust …); only pattern rules ran on them.`);
  out.push("Data flow is followed one call level deep and within the repository. Framework-level protections (ORM escaping, gateway validation, WAF rules) and flows through queues, databases or other services are not visible.");
  out.push("Authentication and authorization are judged from code evidence. A reverse proxy, API gateway or platform (Vercel, Cloudflare, an ingress controller) may enforce them where Fehm cannot see.");
  if (r.dependencies.advisories !== "checked") out.push("Known vulnerabilities: not checked. The OSV.dev lookup uses the network and runs only when asked for (Project health → Dependencies, or fehm health --advisories).");
  out.push("Secrets are found by pattern; a credential with no recognisable shape or name is missed, and git history is not scanned.");
  out.push("No finding is proof of an exploitable vulnerability, and the absence of findings is not proof of security. Framework mappings (OWASP, CWE) show where evidence exists, not compliance.");
  return out;
}

// ─── text and SARIF ─────────────────────────────────────────────────

const POSTURE_LABEL: Record<Posture, string> = { "critical-attention": "CRITICAL ATTENTION", "attention-required": "ATTENTION REQUIRED", review: "REVIEW", "no-high-severity-findings": "NO HIGH-SEVERITY FINDINGS", unknown: "UNKNOWN" };

export function renderSecurityText(r: SecurityReport, options: { all?: boolean } = {}): string {
  const out: string[] = [];
  const s = r.summary.bySeverity;
  out.push(`Security review — ${r.repository.name}${r.scope === "changed" ? " (changed files only)" : ""}`);
  out.push(`Posture: ${POSTURE_LABEL[r.posture]}`);
  for (const reason of r.postureReasons) out.push(`  ${reason}`);
  out.push(`Findings: ${s.critical} critical · ${s.high} high · ${s.medium} medium · ${s.low} low · ${s.info} info${r.baseline ? ` · ${r.baseline.added} new since baseline, ${r.baseline.fixed.length} fixed` : ""}`);
  out.push(`Attack surface: ${r.surface.totals.routes} routes · ${r.surface.totals.unauthenticated} without detected authentication · ${r.surface.totals.sensitive} sensitive · ${r.ai.sites.length} LLM calls · ${r.ai.tools.length} agent tools`);
  out.push("");
  const shown = r.findings.filter((f) => isOpen(f) && (options.all || f.severity !== "info" && f.severity !== "low"));
  for (const f of shown.slice(0, options.all ? shown.length : 40)) {
    out.push(`  [${f.severity}] ${f.title}${f.cwe ? `  (${f.cwe})` : ""}${f.baseline === "new" ? "  (new)" : ""}`);
    if (f.trace) out.push(`      ${f.trace.steps.map((st) => `${st.label} (${st.path}:${st.line})`).join("\n      → ")}`);
    else if (f.file || f.evidence[0]?.path) out.push(`      ${f.file ?? f.evidence[0]!.path}${(f.line ?? f.evidence[0]?.line) ? `:${f.line ?? f.evidence[0]!.line}` : ""}`);
  }
  if (!options.all && shown.length > 40) out.push(`  … ${shown.length - 40} more (--all)`);
  out.push("");
  out.push("Controls:");
  for (const c of r.controls) out.push(`  ${{ present: "✓", partial: "◐", missing: "✗", "not-applicable": "·", unknown: "?" }[c.status]} ${c.title.padEnd(40)} ${c.summary}`);
  out.push("");
  out.push("Not determined:");
  for (const u of r.unknowns) out.push(`  ? ${u}`);
  out.push("");
  out.push(`digest ${r.provenance.digest.slice(0, 16)} · ${r.durationMs} ms · no model calls`);
  return out.join("\n");
}

/** SARIF 2.1.0 for GitHub code scanning and other CI consumers. Data-flow findings carry codeFlows. */
export function toSarif(r: SecurityReport): unknown {
  const used = [...new Set(r.findings.map((f) => f.ruleId))];
  const level = (s: Severity): string => (s === "critical" || s === "high" ? "error" : s === "medium" ? "warning" : "note");
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "fehm-security",
            version: FEHM_VERSION,
            informationUri: "https://github.com/amirhamzakhan2001/fehm",
            rules: used.map((id) => {
              const rule = SECURITY_RULES.find((x) => x.id === id)!;
              return { id, name: rule.title, shortDescription: { text: rule.title }, properties: { tags: ["security", ...(rule.cwe ? [rule.cwe] : []), ...rule.owasp], ...(rule.upstream ? { upstream: rule.upstream } : {}) }, defaultConfiguration: { level: level(rule.severity) } };
            }),
          },
        },
        results: r.findings.filter(isOpen).map((f) => {
          const loc = (path: string, line?: number): unknown => ({ physicalLocation: { artifactLocation: { uri: path }, ...(line ? { region: { startLine: line } } : {}) } });
          const primary = f.file ?? f.evidence.find((e) => e.path)?.path;
          const line = f.line ?? f.evidence.find((e) => e.path)?.line;
          return {
            ruleId: f.ruleId,
            level: level(f.severity),
            message: { text: `${f.title}. ${f.message}` },
            ...(primary ? { locations: [loc(primary, line)] } : {}),
            partialFingerprints: { fehmFindingId: f.id },
            properties: { severity: f.severity, confidence: f.confidence, ...(f.cwe ? { cwe: f.cwe } : {}) },
            ...(f.trace ? { codeFlows: [{ threadFlows: [{ locations: f.trace.steps.map((s) => ({ location: { ...(loc(s.path, s.line) as object), message: { text: `${s.role}: ${s.label}` } } })) }] }] } : {}),
          };
        }),
      },
    ],
  };
}
