import { createHash } from "node:crypto";

/**
 * Secret detection. Values are never returned: a finding carries the kind,
 * length and a SHA-256 fingerprint (so the same secret can be recognised in
 * other files or after rotation), and source excerpts shown by the page pass
 * through `redactLine`.
 *
 * Provider patterns and the keyed-value rule follow Skylos
 * (`rules/secrets.py`, SKY-S101/S102): a secret-like key name assigned a
 * quoted value of 16+ characters, with explicit placeholder markers
 * (example, sample, fake, dummy, changeme …) suppressed. Fehm adds an
 * entropy floor for keyed values and a few providers (OpenAI, Anthropic,
 * JWTs, credentials in connection URLs).
 */

export interface SecretHit {
  kind: string;
  line: number;
  column: number;
  length: number;
  fingerprint: string;
  confidence: "verified" | "strong" | "inferred";
}

const PROVIDERS: [string, RegExp, SecretHit["confidence"]][] = [
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, "verified"],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}\b/g, "verified"],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,48}\b/g, "verified"],
  ["Stripe key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, "verified"],
  ["AWS access key id", /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA)[0-9A-Z]{16}\b/g, "verified"],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g, "verified"],
  ["SendGrid key", /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "verified"],
  ["Twilio key", /\bSK[0-9a-fA-F]{32}\b/g, "strong"],
  ["Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, "verified"],
  ["OpenAI API key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b/g, "strong"],
  ["Private key", /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g, "verified"],
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "strong"],
  ["Credentials in a connection URL", /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql):\/\/[^:\s/"'@]+:[^@\s"'/]{3,}@/g, "strong"],
];

const KEY_NAME = /(?<![A-Za-z0-9_-])(["']?)((?:[A-Za-z0-9]+[_-])*(?:(?:api|private|secret|access|auth)[_-]?key|token|secret|password|passwd|pwd|bearer|credentials?|client[_-]?secret)(?:[_-][A-Za-z0-9]+)*)\1\s*[:=]\s*(["'`])([^"'`\n]{16,})\3/gi;
const PLACEHOLDER = /(?:^|[^A-Za-z0-9])(?:example|sample|fake|placeholder|dummy|test_test_|changeme|not_a_real|do_not_use|your[-_]|xxx+|redacted|\*{3,}|<[^>]+>)(?![A-Za-z])/i;
const DYNAMIC = /^\$\{|process\.env|os\.environ|getenv|\{\{|%\(|^\$[A-Z_]/;
const HASHY_KEY = /(?:hash|digest|checksum|fingerprint|integrity|sha\d*|_id$|name$|type$|url$|path$|prefix$|header$|field$|param$|env$|var$)/i;

export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

export function fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

/** Lockfiles and generated maps carry hashes, not secrets. */
export function scannableForSecrets(path: string): boolean {
  return !/(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|uv\.lock|Cargo\.lock|go\.sum|Pipfile\.lock|composer\.lock|Gemfile\.lock)$|\.(?:map|min\.js|svg|lock)$/.test(path);
}

export function scanSecrets(lines: readonly string[]): SecretHit[] {
  const out: SecretHit[] = [];
  const n = Math.min(lines.length, 50_000);
  for (let i = 0; i < n; i += 1) {
    const line = lines[i]!;
    if (line.length > 5000) continue;
    const taken: [number, number][] = [];
    for (const [kind, re, confidence] of PROVIDERS) {
      re.lastIndex = 0;
      for (let m = re.exec(line); m; m = re.exec(line)) {
        const value = m[0];
        if (PLACEHOLDER.test(value) || /(.)\1{7,}/.test(value)) continue;
        taken.push([m.index, m.index + value.length]);
        out.push({ kind, line: i + 1, column: m.index + 1, length: value.length, fingerprint: fingerprint(value), confidence });
      }
    }
    KEY_NAME.lastIndex = 0;
    for (let m = KEY_NAME.exec(line); m; m = KEY_NAME.exec(line)) {
      const key = m[2]!;
      const value = m[4]!;
      const start = m.index + m[0].lastIndexOf(value);
      if (taken.some(([a, b]) => start < b && start + value.length > a)) continue;
      if (HASHY_KEY.test(key) || DYNAMIC.test(value) || PLACEHOLDER.test(value) || /\s/.test(value.trim()) || value.includes("${")) continue;
      if (entropy(value) < 3.2 || /^[a-z]+(?:[._-][a-z]+)*$/.test(value) || /^[\w.-]+\.[a-z]{2,4}$/i.test(value)) continue;
      out.push({ kind: `Hard-coded ${key.toLowerCase().replace(/^["']|["']$/g, "")}`, line: i + 1, column: start + 1, length: value.length, fingerprint: fingerprint(value), confidence: "inferred" });
    }
  }
  return out;
}

/** Mask every detected secret on a line (for source excerpts). */
export function redactLine(line: string): string {
  let s = line;
  for (const [, re] of PROVIDERS) s = s.replace(new RegExp(re.source, re.flags), (v) => `${"•".repeat(Math.min(12, v.length))}`);
  return s.replace(new RegExp(KEY_NAME.source, KEY_NAME.flags), (all, _q, key: string, quote: string, value: string) => (HASHY_KEY.test(key) || DYNAMIC.test(value) || PLACEHOLDER.test(value) || entropy(value) < 3.2 ? all : all.replace(`${quote}${value}${quote}`, `${quote}${"•".repeat(12)}${quote}`)));
}

/** Public-client environment variables whose names say they hold a secret (bundled into browser code). */
export const CLIENT_ENV = /\b(?:process\.env|import\.meta\.env)\.((?:NEXT_PUBLIC|REACT_APP|VITE|NUXT_PUBLIC|EXPO_PUBLIC|PUBLIC)_[A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|PRIVATE|TOKEN|CREDENTIAL)[A-Z0-9_]*)/g;
