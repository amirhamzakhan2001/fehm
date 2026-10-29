import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { CiReport } from "../health/types.js";
import { cleanLine } from "./sast.js";
import { OWASP_AGENTIC, OWASP_API, OWASP_LLM, OWASP_TOP10, SECURITY_RULES } from "./rules.js";
import type { AttackSurface, FrameworkMapping, SecurityControl, SecurityFinding } from "./types.js";

/**
 * The security-controls inventory (which defences the code shows evidence
 * of) and the framework mappings (which OWASP/CWE categories the rules
 * provide evidence for). Neither is a compliance claim: a control is
 * "present" when evidence of it was found, and a framework category shows
 * findings, no findings, or "not covered" when no Fehm rule maps to it.
 */

type Ev = SecurityControl["evidence"][number];

/** Package evidence counts only as an import or require, not a mention of the name. */
const imports = (pkgs: string): string => `(?:\\bfrom\\s+|\\brequire\\(\\s*|^\\s*import\\s+)["'](?:${pkgs})["']`;

function grep(facts: BriefingFacts, files: string[], re: RegExp, limit = 3): Ev[] {
  const out: Ev[] = [];
  for (const f of files) {
    const lines = facts.lines(f);
    const lang = /\.py$/.test(f) ? "py" : "js";
    for (let i = 0; i < Math.min(lines.length, 20_000) && out.length < limit; i += 1) {
      // Comments, regex literals and prose strings removed: code that describes a control is not the control.
      if (/^\s*(?:\/\/|#|\*|\/\*)/.test(lines[i]!)) continue;
      if (re.test(cleanLine(lines[i]!, lang))) out.push({ path: f, line: i + 1, text: lines[i]!.trim().slice(0, 140) });
    }
    if (out.length >= limit) break;
  }
  return out;
}

export interface ControlInputs {
  facts: BriefingFacts;
  sources: string[];
  tests: string[];
  surface: AttackSurface;
  findings: SecurityFinding[];
  ci: CiReport;
  localOnly: boolean;
  root: string;
}

export function securityControls({ facts, sources, tests, surface, findings, ci, localOnly }: ControlInputs): SecurityControl[] {
  const routes = surface.routes;
  const hasRoutes = routes.length > 0;
  const c = (id: SecurityControl["id"], title: string, status: SecurityControl["status"], summary: string, evidence: Ev[] = []): SecurityControl => ({ id, title, status, summary, evidence: evidence.slice(0, 5) });
  const routeEv = (pick: (r: AttackSurface["routes"][number]) => { path: string; line: number; text: string } | undefined): Ev[] => routes.map(pick).filter((x): x is Ev & { line: number } => Boolean(x));
  const out: SecurityControl[] = [];

  const authn = routes.filter((r) => r.authentication.state === "detected");
  const exposed = routes.filter((r) => r.kind !== "webhook" && r.authentication.state !== "detected" && (r.stateChanging || r.sensitive.length));
  out.push(!hasRoutes ? c("authentication", "Authentication", "not-applicable", "No HTTP routes were found.") : !authn.length ? c("authentication", "Authentication", "missing", `No authentication evidence on any of ${routes.length} routes${localOnly ? " (servers bind to localhost only)" : ""}.`) : exposed.length ? c("authentication", "Authentication", "partial", `${authn.length} of ${routes.length} routes show authentication; ${exposed.length} state-changing or sensitive routes do not.`, routeEv((r) => r.authentication.evidence)) : c("authentication", "Authentication", "present", `Authentication evidence on every state-changing or sensitive route (${authn.length} routes).`, routeEv((r) => r.authentication.evidence)));

  const admin = routes.filter((r) => r.sensitive.includes("administrative"));
  const authz = routes.filter((r) => r.authorization.state === "detected");
  out.push(!hasRoutes ? c("authorization", "Authorization", "not-applicable", "No HTTP routes were found.") : authz.length && admin.every((r) => r.authorization.state === "detected") ? c("authorization", "Authorization", "present", `Role, permission or ownership checks on ${authz.length} routes, including every administrative route.`, routeEv((r) => r.authorization.evidence)) : authz.length ? c("authorization", "Authorization", "partial", `Checks on ${authz.length} routes; ${admin.filter((r) => r.authorization.state !== "detected").length} administrative routes show none.`, routeEv((r) => r.authorization.evidence)) : admin.length ? c("authorization", "Authorization", "missing", `${admin.length} administrative routes and no role or permission check anywhere.`) : c("authorization", "Authorization", "unknown", "No role, permission or ownership checks were found, and no route looks administrative."));

  const validation = facts.signals.validation.filter((v) => sources.includes(v.path));
  const unvalidated = routes.filter((r) => r.stateChanging && r.validation.state === "not-detected");
  out.push(!hasRoutes && !validation.length ? c("input-validation", "Input validation", "not-applicable", "No HTTP routes were found.") : validation.length && !unvalidated.length ? c("input-validation", "Input validation", "present", "Schema or validator use found, and every state-changing route shows it.", validation.map((v) => ({ path: v.path, line: v.line, text: "validation" }))) : validation.length || routes.some((r) => r.validation.state === "detected") ? c("input-validation", "Input validation", "partial", `Validation is used, but ${unvalidated.length} state-changing routes show none.`, validation.map((v) => ({ path: v.path, line: v.line, text: "validation" }))) : c("input-validation", "Input validation", "missing", "No schema or validator library use was found."));

  const hardcoded = findings.filter((f) => (f.ruleId === "sec/secret" && f.severity !== "low") || f.ruleId === "sec/committed-env" || f.ruleId === "sec/docker-secret" || f.ruleId === "sec/k8s-secret-literal");
  const env = [...facts.signals.env.values()].flat();
  const manager = grep(facts, sources, new RegExp(`\\bnew\\s+(?:SecretsManager\\w*|SecretClient|SecretManagerServiceClient)\\(|${imports("@aws-sdk/client-secrets-manager|node-vault|@google-cloud/secret-manager|@azure/keyvault-secrets|@infisical/sdk|@dopplerhq/node-sdk")}|^\\s*import\\s+hvac\\b`));
  out.push(hardcoded.length ? c("secrets-management", "Secrets management", env.length || manager.length ? "partial" : "missing", `${hardcoded.length} hard-coded or committed secret ${hardcoded.length === 1 ? "finding" : "findings"}${env.length ? `; configuration otherwise comes from ${new Set(env.map((e) => e.path)).size} files reading environment variables` : ""}.`, hardcoded.slice(0, 3).map((f) => ({ path: f.file ?? f.evidence[0]?.path ?? "", ...(f.line ? { line: f.line } : {}), text: f.title }))) : c("secrets-management", "Secrets management", env.length || manager.length ? "present" : "unknown", env.length || manager.length ? `No hard-coded secrets found; configuration read from the environment${manager.length ? " and a secret manager" : ""}.` : "No hard-coded secrets found, and no configuration source was detected.", [...manager, ...env.slice(0, 2).map((e) => ({ path: e.path, line: e.line, text: "environment variable" }))]));

  const rate = routes.filter((r) => r.rateLimit.state === "detected");
  out.push(!hasRoutes ? c("rate-limiting", "Rate limiting", "not-applicable", "No HTTP routes were found.") : rate.length === routes.length ? c("rate-limiting", "Rate limiting", "present", "Every route shows rate limiting.", routeEv((r) => r.rateLimit.evidence)) : rate.length ? c("rate-limiting", "Rate limiting", "partial", `${rate.length} of ${routes.length} routes show rate limiting.`, routeEv((r) => r.rateLimit.evidence)) : c("rate-limiting", "Rate limiting", localOnly ? "unknown" : "missing", "No rate limiter was detected (it may be enforced by a gateway)."));

  const audit = grep(facts, sources, /\b(?:audit|auditLog|audit_log|AuditLog|auditTrail|recordAudit|writeAudit|logAudit)\s*\(|\b(?:auditLog|auditLogger|audit_log|auditTrail)\.\w+\(/);
  const logger = grep(facts, sources, new RegExp(`${imports("winston|pino|bunyan|log4js|loglevel")}|\\bstructlog\\.|\\blogging\\.getLogger\\(|\\bLoggerFactory\\.getLogger\\(|\\bzap\\.New|\\blogrus\\.|\\bzerolog\\.`));
  out.push(audit.length ? c("audit-logging", "Audit logging", "present", "Audit logging code was found.", audit) : logger.length ? c("audit-logging", "Audit logging", "partial", "A logging library is used; no audit trail of security events was found.", logger) : c("audit-logging", "Audit logging", hasRoutes ? "missing" : "unknown", "No logging library or audit trail was found."));

  const hashing = grep(facts, sources, new RegExp(`\\b(?:bcrypt|bcryptjs|argon2|passlib)\\.\\w+\\(|\\bcrypto\\.(?:scrypt|scryptSync|pbkdf2|pbkdf2Sync)\\(|\\b(?:hashpw|make_password|generate_password_hash|PasswordHasher)\\(|${imports("bcrypt|bcryptjs|argon2|@node-rs/argon2")}`));
  const passwords = grep(facts, sources, /\bpassword\b/i, 1);
  out.push(hashing.length ? c("password-hashing", "Password hashing", "present", "A password-hashing function (bcrypt, argon2, scrypt or PBKDF2) is used.", hashing) : passwords.length && hasRoutes ? c("password-hashing", "Password hashing", "unknown", "Passwords are handled, but no password-hashing library was found (an identity provider may handle them).", passwords) : c("password-hashing", "Password hashing", "not-applicable", "The code does not appear to handle passwords."));

  const tls = grep(facts, sources, /\bhttps\.createServer\(|\btls\.createServer\(|["']strict-transport-security["']\s*[,:\]]|\bhsts\(|\bssl_context\s*=|ListenAndServeTLS\(|\bSECURE_SSL_REDIRECT\s*=\s*True|\bSECURE_HSTS_SECONDS\s*=/i);
  out.push(tls.length ? c("transport-security", "Transport security", "present", "TLS termination or HSTS is configured in code.", tls) : c("transport-security", "Transport security", localOnly || !hasRoutes ? "not-applicable" : "unknown", localOnly ? "Servers bind to localhost only." : "No TLS configuration in code; it is usually terminated by a proxy or platform, which Fehm cannot see."));

  const headers = facts.signals.securityHeaders.filter((h) => sources.includes(h.path));
  out.push(!hasRoutes ? c("security-headers", "Security headers", "not-applicable", "No HTTP routes were found.") : headers.length ? c("security-headers", "Security headers", "present", "Security headers (helmet, CSP, nosniff, frame options, HSTS) are set.", headers.map((h) => ({ path: h.path, line: h.line, text: h.text }))) : c("security-headers", "Security headers", "missing", "No security headers or helmet-style middleware was found."));

  const cookies = grep(facts, sources, new RegExp(imports("express-session|cookie-session|cookie-parser|iron-session|next-auth|@fastify/session|@fastify/cookie")));
  const cookieUse = grep(facts, sources, /\b(?:res|reply)\.(?:cookie|setCookie)\(|\bSessionMiddleware\b|\bflask_login\b|django\.contrib\.sessions|\bsession\[\s*["']/);
  cookies.push(...cookieUse);
  const csrf = grep(facts, sources, new RegExp(`${imports("csurf|lusca|@fastify/csrf-protection|csrf-csrf|csrf-sync")}|` + /\b(?:csrfProtection|doubleCsrf|CSRFProtect|csrf_protect|CsrfViewMiddleware)\b|\bsameSite\s*:\s*["'](?:strict|lax)["']|\bsamesite\s*=\s*["'](?:Strict|Lax)["']|headers\[\s*["']x-[\w-]+["']\s*\]|["']x-requested-with["']/.source, "i"));
  const changing = routes.filter((r) => r.stateChanging).length;
  out.push(csrf.length ? c("csrf", "CSRF protection", "present", "CSRF tokens, SameSite cookies or a required custom header were found.", csrf) : cookies.length && changing ? c("csrf", "CSRF protection", "missing", `Cookie-based sessions and ${changing} state-changing routes, with no CSRF defence found.`, cookies) : c("csrf", "CSRF protection", "not-applicable", "No cookie-based sessions were found."));

  const cors = grep(facts, sources, /\bcors\(|["']Access-Control-Allow-Origin["']\s*[,:\]]|\bCORSMiddleware\b|\bCORS\(\s*app|\ballow_origins\s*=/);
  const loose = findings.some((f) => f.ruleId === "sec/cors-wildcard");
  out.push(!cors.length ? c("cors", "CORS policy", "not-applicable", "No CORS configuration: browsers apply the same-origin policy.") : loose ? c("cors", "CORS policy", "partial", "CORS is configured, but at least one policy allows any origin.", cors) : c("cors", "CORS policy", "present", "CORS is configured with explicit origins.", cors));

  const scan = ci.gates.filter((g) => (g.id === "security" || g.id === "dependency-updates") && g.present);
  out.push(scan.length ? c("dependency-scanning", "Dependency and security scanning in CI", scan.length === 2 ? "present" : "partial", scan.map((g) => g.label).join(" and ") + " detected in CI.", scan.map((g) => ({ path: g.evidence!.path, line: g.evidence!.line, text: g.evidence!.text }))) : c("dependency-scanning", "Dependency and security scanning in CI", ci.files.length ? "missing" : "unknown", ci.files.length ? "CI runs no recognised security scanner and no update bot is configured." : "No CI configuration was found."));

  const secTests = tests.filter((t) => /secur|auth|login|permission|csrf|xss|inject|sanit/i.test(t));
  const negative = grep(facts, tests, /\b(?:401|403)\b|Unauthorized|Forbidden|toThrow|assertRaises|pytest\.raises/, 3);
  out.push(secTests.length ? c("security-testing", "Security tests", "present", `${secTests.length} test files cover authentication or security behaviour.`, secTests.slice(0, 5).map((t) => ({ path: t, text: "security-related test file" }))) : negative.length ? c("security-testing", "Security tests", "partial", "No dedicated security tests; some tests check error or unauthorized responses.", negative) : c("security-testing", "Security tests", tests.length ? "missing" : "unknown", tests.length ? "No test checks authentication, authorization or rejection of bad input." : "No tests were found."));
  return out;
}

export function frameworkMappings(findings: SecurityFinding[]): FrameworkMapping[] {
  const open = findings.filter((f) => !f.review || f.review.status === "reviewed");
  const build = (id: FrameworkMapping["id"], name: string, catalog: [string, string][]): FrameworkMapping => ({
    id,
    name,
    categories: catalog.map(([cid, cname]) => {
      const rules = SECURITY_RULES.filter((r) => r.owasp.includes(cid)).map((r) => r.id);
      const n = open.filter((f) => rules.includes(f.ruleId)).length;
      return { id: cid, name: cname, rules, findings: n, status: !rules.length ? "not-covered" : n ? "findings" : "no-findings" };
    }),
  });
  const cwes = new Map<string, { rules: Set<string>; n: number; name: string }>();
  for (const r of SECURITY_RULES) {
    if (!r.cwe) continue;
    const e = cwes.get(r.cwe) ?? { rules: new Set(), n: 0, name: r.title };
    e.rules.add(r.id);
    cwes.set(r.cwe, e);
  }
  for (const f of open) if (f.cwe && cwes.has(f.cwe)) cwes.get(f.cwe)!.n += 1;
  return [
    build("owasp-top10-2021", "OWASP Top 10 (2021)", OWASP_TOP10),
    build("owasp-api-2023", "OWASP API Security Top 10 (2023)", OWASP_API),
    build("owasp-llm-2025", "OWASP Top 10 for LLM Applications (2025)", OWASP_LLM),
    build("owasp-agentic-2026", "OWASP Top 10 for Agentic Applications (2026)", OWASP_AGENTIC),
    { id: "cwe", name: "CWE", categories: [...cwes].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).map(([cid, e]) => ({ id: cid, name: e.name, rules: [...e.rules], findings: e.n, status: e.n ? "findings" : "no-findings" })) },
  ];
}
