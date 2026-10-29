import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONTRACT_VERSION, type ArchitectureContract, type ContractIssue, type ContractLayer, type ContractRule, type LayerRole, type Severity, type StructurePolicy } from "./types.js";

/**
 * The reference architecture on disk. The approved contract lives in the
 * repository (`.fehm/architecture.json`, committed with the code) regardless
 * of where Fehm keeps its index state; a saved proposal sits next to it.
 * A contract file is validated before it is trusted: anything malformed is
 * reported with its JSON path and the file is not used.
 */

export const CONTRACT_FILE = ".fehm/architecture.json";
export const PROPOSAL_FILE = ".fehm/architecture.proposed.json";

const ID = /^[a-z][a-z0-9-]{0,39}$/;
const STYLES = new Set(["layered", "hexagonal", "onion", "modular", "custom"]);
const ROLES = new Set<LayerRole>(["interface", "application", "domain", "data", "infrastructure", "shared", "other"]);
const SEVERITIES = new Set<Severity>(["high", "medium", "low"]);
/** Targets outside the layers: 3.3's store and external node ids. */
const OUTSIDE = /^(store|external):[A-Za-z0-9@/._*-]+$/;

export const DEFAULT_MAX_DEPENDENCIES = 6;

export function contractPath(root: string, file = CONTRACT_FILE): string {
  return join(root, file);
}

export type ContractRead = { ok: true; contract: ArchitectureContract } | { ok: false; issues: ContractIssue[] } | { ok: false; missing: true };

export function readContract(root: string, file: string): ContractRead {
  const path = contractPath(root, file);
  if (!existsSync(path)) return { ok: false, missing: true };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, issues: [{ path: "$", message: `not valid JSON: ${(e as Error).message}` }] };
  }
  // Before Feature 3.4, 3.3 kept its layout cache at this path: that is not a contract.
  if (raw && typeof raw === "object" && "views" in raw && !("layers" in raw) && !("config" in raw)) return { ok: false, missing: true };
  return parseContract(raw);
}

/** Validate and normalize a contract (defaults filled in). Never throws. */
export function parseContract(raw: unknown): { ok: true; contract: ArchitectureContract } | { ok: false; issues: ContractIssue[] } {
  const issues: ContractIssue[] = [];
  const bad = (path: string, message: string): void => void issues.push({ path, message });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, issues: [{ path: "$", message: "must be a JSON object" }] };
  const o = raw as Record<string, unknown>;
  // The pre-rebuild proposal format wrapped the layers in `config`; accept it.
  const c = (o.config && typeof o.config === "object" && !o.layers ? { ...o, ...(o.config as Record<string, unknown>) } : o) as Record<string, unknown>;

  const version = c.version ?? CONTRACT_VERSION;
  if (version !== CONTRACT_VERSION) bad("$.version", `unsupported version ${JSON.stringify(version)} (expected ${CONTRACT_VERSION})`);
  const style = c.style ?? "layered";
  if (typeof style !== "string" || !STYLES.has(style)) bad("$.style", `must be one of ${[...STYLES].join(", ")}`);
  const layering = c.layering ?? (style === "layered" || style === "onion" || style === "hexagonal" ? "relaxed" : "none");
  if (layering !== "relaxed" && layering !== "strict" && layering !== "none") bad("$.layering", "must be relaxed, strict or none");

  const layers: ContractLayer[] = [];
  if (!Array.isArray(c.layers) || !c.layers.length) bad("$.layers", "must be a non-empty array");
  else {
    c.layers.forEach((l: unknown, i: number) => {
      const p = `$.layers[${i}]`;
      if (!l || typeof l !== "object") return bad(p, "must be an object");
      const x = l as Record<string, unknown>;
      // Old format: `name` was the id and `patterns` the paths.
      const id = typeof x.id === "string" ? x.id : typeof x.name === "string" ? slug(x.name) : "";
      if (!ID.test(id)) return bad(`${p}.id`, "must be a short lowercase id (a-z, 0-9, -)");
      if (layers.some((y) => y.id === id)) return bad(`${p}.id`, `duplicate layer id "${id}"`);
      const paths = x.paths ?? x.patterns;
      if (!Array.isArray(paths) || !paths.length || !paths.every((s) => typeof s === "string" && s.trim() && !s.startsWith("/") && !s.includes(".."))) return bad(`${p}.paths`, "must be a non-empty array of repository-relative globs");
      const role = x.role ?? "other";
      if (!ROLES.has(role as LayerRole)) return bad(`${p}.role`, `must be one of ${[...ROLES].join(", ")}`);
      const layer: ContractLayer = { id, name: typeof x.name === "string" && x.name.trim() ? x.name : id, role: role as LayerRole, paths: (paths as string[]).map((s) => s.trim().replace(/^\.\//, "")) };
      if (typeof x.description === "string") layer.description = x.description;
      if (Array.isArray(x.evidence)) layer.evidence = x.evidence.filter((s): s is string => typeof s === "string");
      layers.push(layer);
    });
  }
  const layerIds = new Set(layers.map((l) => l.id));
  const target = (t: unknown, p: string, allowStar = true): t is string => {
    if (typeof t !== "string") return (bad(p, "must be a string"), false);
    if ((allowStar && t === "*") || layerIds.has(t) || OUTSIDE.test(t)) return true;
    bad(p, `unknown target "${t}" (a layer id, store:…, external:…${allowStar ? " or *" : ""})`);
    return false;
  };

  const rules: ContractRule[] = [];
  const rawRules = c.rules ?? [];
  if (!Array.isArray(rawRules)) bad("$.rules", "must be an array");
  else {
    rawRules.forEach((r: unknown, i: number) => {
      const p = `$.rules[${i}]`;
      if (!r || typeof r !== "object") return bad(p, "must be an object");
      const x = r as Record<string, unknown>;
      const id = typeof x.id === "string" && x.id.trim() ? x.id.trim() : `rule-${i + 1}`;
      if (rules.some((y) => y.id === id)) return bad(`${p}.id`, `duplicate rule id "${id}"`);
      const rule: ContractRule = { id };
      const list = (k: "allow" | "forbid" | "onlyFrom"): string[] | undefined => {
        const v = x[k];
        if (v === undefined) return undefined;
        if (!Array.isArray(v)) return (bad(`${p}.${k}`, "must be an array"), undefined);
        return v.filter((t, j) => target(t, `${p}.${k}[${j}]`, k !== "onlyFrom"));
      };
      if (x.from !== undefined) {
        if (target(x.from, `${p}.from`) && (x.from === "*" || layerIds.has(x.from))) rule.from = x.from;
        else if (typeof x.from === "string" && OUTSIDE.test(x.from)) bad(`${p}.from`, "rules start from a layer (or *), not a store or external system");
        const allow = list("allow");
        const forbid = list("forbid");
        if (allow) rule.allow = allow;
        if (forbid) rule.forbid = forbid;
        if (!allow && !forbid) bad(p, "a `from` rule needs `allow` or `forbid`");
      } else if (x.to !== undefined) {
        if (target(x.to, `${p}.to`, false)) rule.to = x.to;
        const only = list("onlyFrom");
        if (only && only.every((t) => layerIds.has(t))) rule.onlyFrom = only;
        else bad(`${p}.onlyFrom`, "a `to` rule needs `onlyFrom`: a list of layer ids");
      } else bad(p, "needs `from` (with allow/forbid) or `to` (with onlyFrom)");
      if (typeof x.reason === "string") rule.reason = x.reason;
      if (x.severity !== undefined) {
        if (SEVERITIES.has(x.severity as Severity)) rule.severity = x.severity as Severity;
        else bad(`${p}.severity`, "must be high, medium or low");
      }
      rules.push(rule);
    });
  }
  // Old format: `allowedDependencies: { layer: [layers] }` with no implicit layering.
  let legacyLayering: "none" | undefined;
  if (c.allowedDependencies && typeof c.allowedDependencies === "object" && !Array.isArray(c.allowedDependencies) && !c.rules) {
    legacyLayering = "none";
    for (const [from, to] of Object.entries(c.allowedDependencies as Record<string, unknown>)) {
      if (!layerIds.has(slug(from)) || !Array.isArray(to)) continue;
      rules.push({ id: `allow-${slug(from)}`, from: slug(from), allow: to.filter((t): t is string => typeof t === "string" && layerIds.has(slug(t))).map(slug) });
    }
    // Everything not allowed is forbidden in that format.
    for (const l of layers) if (!rules.some((r) => r.from === l.id)) rules.push({ id: `allow-${l.id}`, from: l.id, allow: [] });
  }

  const cycles = c.cycles ?? "forbid";
  if (cycles !== "forbid" && cycles !== "review" && cycles !== "allow") bad("$.cycles", "must be forbid, review or allow");
  const structure: StructurePolicy[] = [];
  if (c.structure !== undefined) {
    if (!Array.isArray(c.structure)) bad("$.structure", "must be an array of { path, allow }");
    else
      c.structure.forEach((s: unknown, i: number) => {
        const x = (s ?? {}) as Record<string, unknown>;
        if (typeof x.path !== "string" || !Array.isArray(x.allow) || !x.allow.every((a) => typeof a === "string")) return bad(`$.structure[${i}]`, "needs `path` (string) and `allow` (array of names)");
        structure.push({ path: x.path.replace(/^\.\/|\/$/g, "") || ".", allow: x.allow as string[], ...(typeof x.reason === "string" ? { reason: x.reason } : {}) });
      });
  }
  const coupling = (c.coupling ?? {}) as Record<string, unknown>;
  const maxDependencies = coupling.maxDependencies ?? DEFAULT_MAX_DEPENDENCIES;
  if (typeof maxDependencies !== "number" || !Number.isInteger(maxDependencies) || maxDependencies < 1) bad("$.coupling.maxDependencies", "must be a positive integer");
  const ignore = c.ignore ?? [];
  if (!Array.isArray(ignore) || !ignore.every((s) => typeof s === "string")) bad("$.ignore", "must be an array of globs");

  if (issues.length) return { ok: false, issues };
  const contract: ArchitectureContract = {
    version: CONTRACT_VERSION,
    status: c.status === "proposed" ? "proposed" : "approved",
    style: style as ArchitectureContract["style"],
    layers,
    layering: legacyLayering ?? (layering as ArchitectureContract["layering"]),
    rules,
    cycles: cycles as ArchitectureContract["cycles"],
    allowUnassigned: c.allowUnassigned === true,
    structure,
    coupling: { maxDependencies: maxDependencies as number },
    ignore: ignore as string[],
  };
  if (typeof c.description === "string") contract.description = c.description;
  if (typeof c.generatedAt === "string") contract.generatedAt = c.generatedAt;
  if (typeof c.approvedAt === "string") contract.approvedAt = c.approvedAt;
  return { ok: true, contract };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "layer";
}

/** Hash of what the contract decides (not of when it was written or approved). */
export function contractHash(c: ArchitectureContract): string {
  const { generatedAt: _g, approvedAt: _a, status: _s, ...rest } = c;
  void _g, void _a, void _s;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex").slice(0, 16);
}

/** Write a contract atomically (pretty-printed: it is meant to be reviewed and committed). */
export function writeContract(root: string, file: string, contract: ArchitectureContract): string {
  const path = contractPath(root, file);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(contract, null, 2)}\n`);
  renameSync(tmp, path);
  return path;
}

// ─── globs ──────────────────────────────────────────────────────────

const globCache = new Map<string, RegExp>();

/** `*` matches within one path segment, `**` across segments; `dir/**` also matches files directly in `dir`. */
export function globToRegExp(glob: string): RegExp {
  let re = globCache.get(glob);
  if (re) return re;
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (ch === "*") out += "[^/]*";
    else if (ch === "?") out += "[^/]";
    else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  re = new RegExp(`^${out}$`);
  globCache.set(glob, re);
  return re;
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/** The layer a file belongs to: the first layer, in contract order, with a matching path. */
export function layerOf(path: string, contract: ArchitectureContract): string | undefined {
  for (const l of contract.layers) if (matchesAny(path, l.paths)) return l.id;
  return undefined;
}

/** Does a rule target pattern (`*`, `external:*`, a layer id, a node id) cover a unit id? */
export function targetMatches(pattern: string, unit: string): boolean {
  if (pattern === "*" || pattern === unit) return true;
  return pattern.endsWith("*") && unit.startsWith(pattern.slice(0, -1));
}
