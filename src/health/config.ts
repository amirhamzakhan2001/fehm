import { createHash } from "node:crypto";
import { join } from "node:path";
import { matchesAny } from "../drift/contract.js";
import { readJson } from "../persistence.js";

/**
 * Optional project configuration, `.fehm/health.json`, committed with the
 * code like 3.4's contract. Everything has a default; a malformed file is
 * reported and the defaults are used instead, never half-applied.
 *
 * ```jsonc
 * {
 *   "ignore": ["src/generated/**"],
 *   "thresholds": { "cyclomatic": 10, "cognitive": 15, "nesting": 3, "functionLines": 50,
 *                   "params": 5, "classMethods": 20, "classFields": 15, "classLines": 500 },
 *   "coverage": ["reports/lcov.info"],        // extra artifact paths
 *   "licenses": { "deny": ["AGPL-*"], "review": ["GPL-*", "LGPL-*"] }
 * }
 * ```
 */

export const CONFIG_FILE = ".fehm/health.json";

export interface Thresholds {
  cyclomatic: number;
  cognitive: number;
  nesting: number;
  functionLines: number;
  params: number;
  classMethods: number;
  classFields: number;
  classLines: number;
}

export interface HealthConfig {
  ignore: string[];
  thresholds: Thresholds;
  coverage: string[];
  licenses: { deny: string[]; review: string[] };
}

/** Skylos' defaults (SKY-Q301, Q306, Q302, C304, C303, Q501/Q502), kept so results line up with it. */
export const DEFAULT_THRESHOLDS: Thresholds = { cyclomatic: 10, cognitive: 15, nesting: 3, functionLines: 50, params: 5, classMethods: 20, classFields: 15, classLines: 500 };

/** Strong copyleft and source-available licenses are flagged for review by default; nothing is denied unless configured. */
export const DEFAULT_LICENSES = { deny: [] as string[], review: ["GPL-*", "AGPL-*", "LGPL-*", "SSPL-*", "EUPL-*", "OSL-*", "CPAL-*", "BUSL-*", "Elastic-*", "CC-BY-NC-*", "CC-BY-SA-*"] };

export function defaultConfig(): HealthConfig {
  return { ignore: [], thresholds: { ...DEFAULT_THRESHOLDS }, coverage: [], licenses: { deny: [...DEFAULT_LICENSES.deny], review: [...DEFAULT_LICENSES.review] } };
}

export function readHealthConfig(root: string): { config: HealthConfig; file?: string; issues: string[] } {
  const r = readJson<unknown>(join(root, CONFIG_FILE));
  if (!r.ok) return r.reason === "missing" ? { config: defaultConfig(), issues: [] } : { config: defaultConfig(), file: CONFIG_FILE, issues: [`${CONFIG_FILE} is not valid JSON (${r.detail}); defaults are used.`] };
  const parsed = parseHealthConfig(r.value);
  return parsed.ok ? { config: parsed.config, file: CONFIG_FILE, issues: [] } : { config: defaultConfig(), file: CONFIG_FILE, issues: parsed.issues.map((i) => `${i}; defaults are used.`) };
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);

export function parseHealthConfig(raw: unknown): { ok: true; config: HealthConfig } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const config = defaultConfig();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, issues: ["$: expected an object"] };
  const o = raw as Record<string, unknown>;
  const known = new Set(["$schema", "ignore", "thresholds", "coverage", "licenses"]);
  for (const k of Object.keys(o)) if (!known.has(k)) issues.push(`$.${k}: unknown setting`);
  if (o.ignore !== undefined) {
    if (!strings(o.ignore)) issues.push("$.ignore: expected an array of glob strings");
    else config.ignore = o.ignore;
  }
  if (o.coverage !== undefined) {
    if (!strings(o.coverage)) issues.push("$.coverage: expected an array of repository-relative paths");
    else if (o.coverage.some((p) => p.startsWith("/") || p.split("/").includes(".."))) issues.push("$.coverage: paths must stay inside the repository");
    else config.coverage = o.coverage;
  }
  if (o.thresholds !== undefined) {
    if (typeof o.thresholds !== "object" || o.thresholds === null) issues.push("$.thresholds: expected an object");
    else {
      for (const [k, v] of Object.entries(o.thresholds as Record<string, unknown>)) {
        if (!(k in DEFAULT_THRESHOLDS)) issues.push(`$.thresholds.${k}: unknown threshold`);
        else if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 10_000) issues.push(`$.thresholds.${k}: expected a positive integer`);
        else config.thresholds[k as keyof Thresholds] = v;
      }
    }
  }
  if (o.licenses !== undefined) {
    const l = o.licenses as Record<string, unknown>;
    if (typeof l !== "object" || l === null) issues.push("$.licenses: expected an object");
    else {
      for (const k of Object.keys(l)) if (k !== "deny" && k !== "review") issues.push(`$.licenses.${k}: unknown setting`);
      if (l.deny !== undefined) (strings(l.deny) ? (config.licenses.deny = l.deny) : issues.push("$.licenses.deny: expected an array of SPDX ids or trailing-* patterns"));
      if (l.review !== undefined) (strings(l.review) ? (config.licenses.review = l.review) : issues.push("$.licenses.review: expected an array of SPDX ids or trailing-* patterns"));
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, config };
}

export function configHash(config: HealthConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16);
}

export function ignored(config: HealthConfig): (path: string) => boolean {
  return config.ignore.length ? (p) => matchesAny(p, config.ignore) : () => false;
}

/** SPDX license policy. Compound expressions are checked term by term: `MIT OR GPL-3.0` is allowed (a permissive choice exists), `MIT AND GPL-3.0` is not. */
export function licensePolicy(license: string, config: HealthConfig): "allowed" | "review" | "denied" | "unknown" {
  if (!license || license === "NOASSERTION" || license === "UNKNOWN") return "unknown";
  const match = (id: string, list: string[]): boolean => list.some((p) => (p.endsWith("*") ? id.toUpperCase().startsWith(p.slice(0, -1).toUpperCase()) : id.toUpperCase() === p.toUpperCase()));
  const verdict = (id: string): "allowed" | "review" | "denied" => (match(id, config.licenses.deny) ? "denied" : match(id, config.licenses.review) ? "review" : "allowed");
  const rank = { allowed: 0, review: 1, denied: 2 } as const;
  const expr = license.replace(/[()]/g, " ").trim();
  if (/\sOR\s/i.test(expr)) {
    const options = expr.split(/\s+OR\s+/i).map((t) => worst(t.split(/\s+AND\s+/i).map((x) => verdict(x.trim().replace(/\s+WITH\s+.*/i, "")))));
    return options.reduce((a, b) => (rank[a] <= rank[b] ? a : b));
  }
  return worst(expr.split(/\s+AND\s+/i).map((x) => verdict(x.trim().replace(/\s+WITH\s+.*/i, ""))));

  function worst(v: ("allowed" | "review" | "denied")[]): "allowed" | "review" | "denied" {
    return v.reduce((a, b) => (rank[a] >= rank[b] ? a : b), "allowed");
  }
}
