import { posix } from "node:path";
import type { ArchitectureModel } from "../architecture/types.js";
import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { Evidence } from "./types.js";

/**
 * Comparable units (spec §34): one per source file, with the features the
 * project's own conventions are mined from. Roles come from names first
 * (`user_controller.py`, `UserService.ts`, `user.repository.ts`), then the
 * directory (`controllers/`), then code evidence (route registrations, SQL,
 * JSX). Every feature keeps the line that shows it.
 */

export type Role =
  | "controller"
  | "route"
  | "service"
  | "repository"
  | "model"
  | "middleware"
  | "component"
  | "view"
  | "hook"
  | "util"
  | "config"
  | "worker"
  | "command"
  | "adapter"
  | "types"
  | "module";

export const ROLE_PLURAL: Record<Role, string> = {
  controller: "controllers",
  route: "route modules",
  service: "services",
  repository: "repositories",
  model: "models",
  middleware: "middleware",
  component: "UI components",
  view: "views / pages",
  hook: "hooks",
  util: "utilities",
  config: "configuration modules",
  worker: "workers / jobs",
  command: "CLI commands",
  adapter: "clients / adapters",
  types: "type modules",
  module: "other modules",
};

export const ROLE_LABEL: Record<Role, string> = {
  controller: "Controller",
  route: "Route",
  service: "Service",
  repository: "Repository",
  model: "Model",
  middleware: "Middleware",
  component: "Component",
  view: "View",
  hook: "Hook",
  util: "Utility",
  config: "Configuration",
  worker: "Worker",
  command: "Command",
  adapter: "Adapter",
  types: "Types",
  module: "Module",
};

export type Responsibility = "http" | "validation" | "database" | "external-api" | "email" | "payments" | "messaging" | "cloud" | "ai" | "file-io" | "auth" | "logging" | "configuration" | "rendering";

export const RESPONSIBILITY_LABEL: Record<Responsibility, string> = {
  http: "HTTP handling",
  validation: "Validation",
  database: "Database access",
  "external-api": "Outbound HTTP",
  email: "Email",
  payments: "Payments",
  messaging: "Messaging / queues",
  cloud: "Cloud / storage",
  ai: "AI services",
  "file-io": "File processing",
  auth: "Authentication",
  logging: "Logging",
  configuration: "Configuration",
  rendering: "Rendering",
};

export type LogMechanism = "console" | "print" | "logging library" | "project logger";
export type TestLayout = "colocated" | "__tests__" | "mirrored" | "tests directory" | "elsewhere";
export type CaseStyle = "kebab" | "snake" | "camel" | "pascal" | "lower" | "other";

export interface Unit {
  path: string;
  role: Role;
  roleBasis: "name" | "directory" | "evidence" | "none";
  module: string;
  component?: string;
  loc: number;
  /** Files depending on it (blast radius for attention). */
  dependents: number;
  /** Source files it depends on. */
  fileDeps: string[];
  /** Stores and external systems it reaches (3.3 ids) with the line that shows it. */
  outside: Map<string, Evidence>;
  responsibilities: Map<Responsibility, Evidence>;
  di: { injected: Evidence[]; manual: Evidence[] };
  logging: Map<LogMechanism, Evidence>;
  env: Evidence[];
  hardcoded: Evidence[];
  tryCatch: number;
  localErrors: Evidence[];
  naming: { stem: string; caseStyle: CaseStyle; marker: "dot" | "word" | "none"; provisional?: string };
  test?: { path: string; layout: TestLayout };
  /** Route handlers defined in this file: name, line, size. */
  handlers: { name: string; line: number; loc: number; route: string }[];
  compositionRoot: boolean;
}

const ROLE_WORDS: [RegExp, Role][] = [
  [/^(controllers?|handlers?)$/, "controller"],
  [/^(routes?|router|routers|urls|endpoints?|api)$/, "route"],
  [/^(services?|usecases?|interactors?)$/, "service"],
  [/^(repositor(y|ies)|repos?|daos?|dal|persistence)$/, "repository"],
  [/^(models?|entit(y|ies)|schemas?|dtos?)$/, "model"],
  [/^(middlewares?|interceptors?|guards?|filters?)$/, "middleware"],
  [/^(components?|widgets?)$/, "component"],
  [/^(views?|pages?|screens?)$/, "view"],
  [/^(hooks?)$/, "hook"],
  [/^(utils?|utilities|helpers?|common|shared|lib)$/, "util"],
  [/^(config|configuration|settings|env)$/, "config"],
  [/^(jobs?|workers?|tasks?|consumers?|cron|queues?)$/, "worker"],
  [/^(cli|commands?|cmds?)$/, "command"],
  [/^(clients?|adapters?|gateways?|providers?|integrations?)$/, "adapter"],
  [/^(types|interfaces|typings)$/, "types"],
];
const COMPOSITION_ROOT = /^(main|index|app|server|container|bootstrap|module|wiring|di|composition|setup|factory|__init__|mod|lib)$/i;
const PROVISIONAL = /(?:^|[._-]|(?<=[a-z0-9]))(final|new|old|copy|backup|bak|temp|tmp|v\d+|\d+)$/i;

/** Words of a file stem: `user_controller`, `UserController`, `user.controller` → [user, controller]. */
function words(stem: string): string[] {
  return stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

function roleOfWord(w: string): Role | undefined {
  return ROLE_WORDS.find(([re]) => re.test(w))?.[1];
}

export function caseStyle(stem: string): CaseStyle {
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(stem)) return "kebab";
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(stem)) return "snake";
  if (/^[A-Z][a-z0-9]+([A-Z][a-z0-9]*)+$/.test(stem) || /^[A-Z][a-z0-9]+$/.test(stem)) return "pascal";
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(stem)) return "camel";
  if (/^[a-z0-9]+$/.test(stem)) return "lower";
  return "other";
}

const DI_INJECTED = /@(Inject|Autowired|InjectRepository)\b|\bDepends\(|\binject\(|@inject\(/;
const DI_TYPED = /(Service|Repository|Repo|Client|Gateway|Dao|Provider|Store)\b/;
const DI_MANUAL = /\bnew\s+([A-Z]\w*(?:Service|Repository|Repo|Client|Gateway|Dao|Provider))\s*\(|=\s*([A-Z]\w*(?:Service|Repository|Repo|Client|Gateway|Dao))\(\s*\)/;
const LOG_CONSOLE = /\bconsole\.(log|info|warn|error|debug)\(/;
const LOG_PRINT = /^\s*print\(|\bfmt\.Print(ln|f)?\(|System\.(out|err)\.print/;
const LOG_LIBRARY_IMPORT = /\b(winston|pino|bunyan|log4js|loglevel|loguru|structlog|log4j|slf4j|zap|logrus|zerolog|tracing)\b|^\s*import logging\b|logging\.getLogger\(|\blog::(info|warn|error|debug)/;
/** Connection strings to data stores and brokers (a local HTTP URL a tool prints is not configuration). */
const HARDCODED = /["'`]((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^"'`\s]+)["'`]/;
const TRY = /\btry\s*\{|^\s*try:\s*$/;
const LOCAL_ERROR = /res\.status\(\s*[45]\d\d\s*\)|status_code\s*=\s*[45]\d\d|HttpResponse\w*\([^)]*status\s*=\s*[45]\d\d|ResponseEntity\.status\(|\breply\.code\(\s*[45]\d\d|abort\(\s*[45]\d\d/;
const AUTH_CALL = /\b(authenticate|authorize|requireAuth|isAuthenticated|verifyToken|checkAuth|ensureAuth|login_required|jwt_required|UseGuards|PreAuthorize|get_current_user|currentUser|requireUser|passport\.authenticate)\b/;
const HTTP_DECORATOR = /@(Get|Post|Put|Delete|Patch|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping)\b|@(app|router|bp|blueprint)\.(get|post|put|delete|patch|route)\(/;
const RENDER = /\brender_template\(|\bres\.render\(|\bdocument\.(getElementById|querySelector|createElement)|return\s*\(\s*<[A-Za-z]|^\s*<[A-Z][A-Za-z]*[\s>/]/;
const SDK_RESPONSIBILITY: Record<string, Responsibility> = { email: "email", sms: "email", payments: "payments", queue: "messaging", storage: "cloud", cloud: "cloud", ai: "ai" };

export const CENTRAL_ERROR_HANDLER = /\(\s*err(?:or)?\s*(?::\s*\w+)?\s*,\s*req\w*\s*(?::\s*\w+)?\s*,\s*res\w*\s*(?::\s*\w+)?\s*,\s*next\b|app\.use\(\s*\w*[eE]rror\w*\s*\)|\.exception_handler\(|\.errorhandler\(|@ControllerAdvice\b|@RestControllerAdvice\b|@Catch\(|useGlobalFilters\(|setErrorHandler\(/;

export function extractUnits(facts: BriefingFacts, model: ArchitectureModel, skip: (path: string) => boolean = () => false): Unit[] {
  const sources = facts.sourceFiles.filter((f) => !skip(f));
  const s = facts.signals;
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const componentOf = (path: string): string | undefined => {
    let cur = byId.get(`file:${path}`);
    while (cur && cur.level !== 1) cur = cur.parent ? byId.get(cur.parent) : undefined;
    return cur?.id;
  };
  const routesByFile = new Map<string, typeof s.routes>();
  for (const r of s.routes) routesByFile.set(r.path, [...(routesByFile.get(r.path) ?? []), r]);
  const tableFiles = new Set<string>();
  for (const uses of s.tables.values()) for (const u of uses) tableFiles.add(u.path);
  const validationByFile = new Map<string, number>();
  for (const v of s.validation) if (!validationByFile.has(v.path)) validationByFile.set(v.path, v.line);
  const envByFile = new Map<string, Evidence[]>();
  for (const [name, list] of s.env) for (const l of list) envByFile.set(l.path, [...(envByFile.get(l.path) ?? []), { path: l.path, line: l.line, detail: `reads ${name}` }]);
  const importersOf = (category: string): Set<string> => new Set(facts.packages.filter((p) => p.info?.category === category).flatMap((p) => facts.runtimeImporters(p)));
  const validationImporters = importersOf("validation");
  const authImporters = importersOf("auth");
  const categoryOfExternal = new Map<string, string>();
  for (const p of facts.packages) if (p.info) categoryOfExternal.set(`external:${p.name}`, p.info.category);
  const outsideByFile = new Map<string, Map<string, Evidence>>();
  for (const l of model.externalLinks) {
    if (l.inbound) continue;
    const m = outsideByFile.get(l.file) ?? new Map<string, Evidence>();
    if (!m.has(l.target)) m.set(l.target, { path: l.evidence.path, ...(l.evidence.line ? { line: l.evidence.line } : {}), ...(l.evidence.nodeId ? { nodeId: l.evidence.nodeId } : {}), detail: l.evidence.detail ?? l.type });
    outsideByFile.set(l.file, m);
  }
  const linksOut = new Map<string, Set<string>>();
  const linksIn = new Map<string, Set<string>>();
  for (const l of model.codeLinks) {
    linksOut.set(l.source, (linksOut.get(l.source) ?? new Set()).add(l.target));
    linksIn.set(l.target, (linksIn.get(l.target) ?? new Set()).add(l.source));
  }
  const loggerFiles = new Set(sources.filter((f) => /^log(ger|ging)?$/i.test(posix.basename(f).replace(/\.[^.]+$/, ""))));

  // Tests: stem → test files.
  const testStem = (p: string): string =>
    posix
      .basename(p)
      .replace(/\.[^.]+$/, "")
      .replace(/\.(test|spec)$/, "")
      .replace(/_test$/, "")
      .replace(/^test_/, "")
      .replace(/(Test|Tests|IT)$/, "")
      .toLowerCase();
  const tests = new Map<string, string[]>();
  for (const t of facts.testFiles) tests.set(testStem(t), [...(tests.get(testStem(t)) ?? []), t]);

  const units: Unit[] = [];
  for (const path of sources) {
    const lines = facts.lines(path);
    const ext = posix.extname(path);
    const base = posix.basename(path).replace(/\.[^.]+$/, "");
    const stem = /^(index|__init__|mod)$/.test(base) ? posix.basename(posix.dirname(path)) : base;
    const w = words(base);
    // ── role
    let role: Role | undefined;
    let roleBasis: Unit["roleBasis"] = "none";
    const last = w[w.length - 1];
    const nameRole = last ? roleOfWord(last) : undefined;
    if (nameRole && w.length > 1) (role = nameRole), (roleBasis = "name");
    if (!role) {
      const dirs = posix.dirname(path).split("/").reverse();
      for (const d of dirs) {
        const r = roleOfWord(d.toLowerCase());
        if (r) {
          role = r;
          roleBasis = "directory";
          break;
        }
      }
    }
    if (!role && nameRole) (role = nameRole), (roleBasis = "name");
    if (!role) {
      if (routesByFile.has(path)) role = "route";
      else if (tableFiles.has(path) || outsideByFile.get(path)?.has("store:database")) role = "repository";
      else if (/\.(tsx|jsx|vue|svelte)$/.test(ext)) role = "component";
      else if (s.cli.some((c) => c.path === path)) role = "command";
      if (role) roleBasis = "evidence";
    }
    // Django's views.py are request handlers, not UI pages.
    if (role === "view" && ext === ".py") role = "controller";
    // ── responsibilities
    const resp = new Map<Responsibility, Evidence>();
    const note = (r: Responsibility, e: Evidence): void => void (resp.has(r) || resp.set(r, e));
    const routes = routesByFile.get(path) ?? [];
    if (routes[0]) note("http", { path, line: routes[0].line, detail: `${routes[0].method} ${routes[0].route}` });
    const outside = outsideByFile.get(path) ?? new Map<string, Evidence>();
    for (const [target, e] of outside) {
      if (target === "store:database") note("database", e);
      else if (target === "store:filesystem") note("file-io", e);
      else if (target === "external:http") note("external-api", e);
      else note(SDK_RESPONSIBILITY[categoryOfExternal.get(target) ?? ""] ?? "external-api", e);
    }
    if (validationByFile.has(path)) note("validation", { path, line: validationByFile.get(path)!, detail: "validates input" });
    else if (validationImporters.has(path)) note("validation", { path, detail: "imports a validation library" });
    if (authImporters.has(path)) note("auth", { path, detail: "imports an authentication library" });
    const env = envByFile.get(path) ?? [];
    if (env[0]) note("configuration", env[0]);
    const di: Unit["di"] = { injected: [], manual: [] };
    const logging = new Map<LogMechanism, Evidence>();
    const hardcoded: Evidence[] = [];
    const localErrors: Evidence[] = [];
    let tryCatch = 0;
    const limit = Math.min(lines.length, 8000);
    let inCtor = 0;
    for (let i = 0; i < limit; i += 1) {
      const l = lines[i]!;
      const t = l.trim();
      if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*")) continue;
      const at = (detail: string): Evidence => ({ path, line: i + 1, detail });
      if (/\bconstructor\s*\(|def __init__\s*\(/.test(l)) inCtor = 6;
      if (inCtor > 0) {
        inCtor -= 1;
        if (DI_TYPED.test(l) && /[:(,]\s*(?:(?:private|public|protected|readonly)\s+)*\w+\s*:\s*\w*(Service|Repository|Repo|Client|Gateway|Dao|Provider|Store)\b|\w+_(service|repository|repo|client)\b/.test(l)) di.injected.push(at(t.slice(0, 100)));
        if (/\)\s*[{:]/.test(l)) inCtor = 0;
      }
      if (DI_INJECTED.test(l)) di.injected.push(at(t.slice(0, 100)));
      const manual = DI_MANUAL.exec(l);
      if (manual) di.manual.push(at(`constructs ${manual[1] ?? manual[2]} itself`));
      if (LOG_CONSOLE.test(l) && !logging.has("console")) logging.set("console", at(t.slice(0, 100)));
      if (LOG_PRINT.test(l) && !logging.has("print")) logging.set("print", at(t.slice(0, 100)));
      if (LOG_LIBRARY_IMPORT.test(l) && !logging.has("logging library")) logging.set("logging library", at(t.slice(0, 100)));
      const hc = HARDCODED.exec(l);
      if (hc && hardcoded.length < 6) hardcoded.push(at(`hard-coded ${hc[1]!.replace(/\/\/[^:@/]+:[^@/]+@/, "//***:***@").slice(0, 80)}`));
      if (TRY.test(l)) tryCatch += 1;
      if (LOCAL_ERROR.test(l) && localErrors.length < 6) localErrors.push(at(t.slice(0, 100)));
      if (!resp.has("auth") && AUTH_CALL.test(l)) note("auth", at(t.slice(0, 100)));
      if (!resp.has("http") && HTTP_DECORATOR.test(l)) note("http", at(t.slice(0, 100)));
      if (!resp.has("rendering") && RENDER.test(l)) note("rendering", at(t.slice(0, 100)));
    }
    // 3.3's code links: route → handler direction fixed, structural edges excluded (3.2's fileDeps still point handler → route).
    const deps = [...(linksOut.get(path) ?? [])].filter((d) => d !== path);
    for (const d of deps) if (loggerFiles.has(d) && !logging.has("project logger")) logging.set("project logger", { path, detail: `uses ${d}` });
    if (logging.size) note("logging", [...logging.values()][0]!);
    // ── naming
    const stemNoMarker = base.replace(/\.(controller|service|repository|module|component|model|guard|dto|entity|middleware)$/, "");
    const marker: Unit["naming"]["marker"] = /\.(controller|service|repository|module|component|model|guard|dto|entity|middleware)$/.test(base) ? "dot" : nameRole && w.length > 1 ? "word" : "none";
    const provisional = PROVISIONAL.exec(stemNoMarker)?.[1];
    // ── tests
    const candidates = tests.get(stem.toLowerCase()) ?? [];
    let test: Unit["test"];
    if (candidates.length) {
      const dir = posix.dirname(path);
      const rel = dir.replace(/^(src|lib|app)\/?/, "");
      const layoutOf = (t: string): TestLayout => {
        const td = posix.dirname(t);
        if (td === dir) return "colocated";
        if (td === `${dir}/__tests__`) return "__tests__";
        const tr = td.replace(/^(tests?|spec|__tests__|src\/test\/\w+)\/?/, "");
        if (/^(tests?|spec|src\/test)(\/|$)/.test(td)) return tr === rel ? "mirrored" : "tests directory";
        return "elsewhere";
      };
      const best = [...candidates].sort((a, b) => ["colocated", "__tests__", "mirrored", "tests directory", "elsewhere"].indexOf(layoutOf(a)) - ["colocated", "__tests__", "mirrored", "tests directory", "elsewhere"].indexOf(layoutOf(b)))[0]!;
      test = { path: best, layout: layoutOf(best) };
    }
    // ── handlers
    const handlers = routes
      .filter((r) => r.handler?.location?.endLine && r.handler.path === path)
      .map((r) => ({ name: r.handler!.name, line: r.handler!.location!.line, loc: r.handler!.location!.endLine! - r.handler!.location!.line + 1, route: `${r.method} ${r.route}` }));
    units.push({
      path,
      role: role ?? "module",
      roleBasis,
      module: facts.moduleOf(path),
      ...(componentOf(path) ? { component: componentOf(path)! } : {}),
      loc: lines.filter((l) => l.trim()).length,
      dependents: linksIn.get(path)?.size ?? 0,
      fileDeps: deps,
      outside,
      responsibilities: resp,
      di,
      logging,
      env,
      hardcoded,
      tryCatch,
      localErrors,
      naming: { stem: stemNoMarker, caseStyle: caseStyle(stemNoMarker), marker, ...(provisional ? { provisional } : {}) },
      ...(test ? { test } : {}),
      handlers,
      compositionRoot: COMPOSITION_ROOT.test(base),
    });
  }
  return units;
}
