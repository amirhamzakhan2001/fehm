import { posix } from "node:path";
import type { FehmEngine } from "../engine.js";
import type { CodeGraph } from "../graph.js";
import type { FileRole, GraphEdge, GraphNode, Provenance } from "../model.js";
import { firstSentence } from "../ids.js";
import { moduleLabels } from "./builder.js";
import { isBuiltin, normalizePackage, techInfo, type TechInfo } from "./catalog.js";

/** Drop `undefined` values so optional fields stay absent (exactOptionalPropertyTypes). */
export function strip<T>(o: { [K in keyof T]?: T[K] | undefined }): T {
  const rec = o as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return o as T;
}

export interface Located {
  path: string;
  line: number;
}

export interface DeclaredDependency extends Located {
  name: string;
  /** Manifest requirement, not an installed/resolved version. */
  requirement?: string;
  dev: boolean;
}

export interface Manifest {
  path: string;
  kind: "npm" | "python" | "go" | "cargo" | "maven" | "gradle";
  name?: string;
  description?: string;
  descriptionLine?: number;
  bin: { name: string; target: string; line: number }[];
  main?: string;
  scripts: { name: string; command: string; line: number }[];
  dependencies: DeclaredDependency[];
  engines?: string;
}

export interface Route extends Located {
  method: string;
  route: string;
  style: "call" | "decorator" | "switch" | "comparison" | "file" | "annotation";
  handler?: GraphNode;
  enclosing?: GraphNode;
}

export interface CliCommand extends Located {
  name: string;
  /** Enclosing dispatcher function, e.g. `main` or `skillsCommand`. */
  group: string;
  handler?: GraphNode;
}

export type RuntimeKind = "server" | "interval" | "watcher" | "scheduled" | "worker" | "signal-handler" | "main-guard" | "child-process";

export interface Signal extends Located {
  kind: string;
  text: string;
}

export interface ConfigFile {
  path: string;
  kind: "docker" | "compose" | "ci" | "kubernetes" | "platform" | "env-example" | "typescript" | "lint" | "coverage" | "other-config";
  label: string;
}

export interface FileMetrics {
  path: string;
  /** Distinct source files depending on this file (imports, calls, references, uses, inheritance). */
  dependents: number;
  dependencies: number;
  /** Inbound symbol-level edges from other files. */
  inboundSymbolEdges: number;
  defines: number;
  /** Entry-point files that reach this file through dependency edges. */
  entryReach: number;
  /** Test files that reach this file (static reachability, not measured coverage). */
  testReach: number;
  lines: number;
  module: string;
}

const MAX_SIGNAL_FILES = 4000;
const MAX_SIGNAL_LINES = 20_000;
const STRUCTURAL = new Set(["contains", "defines"]);

const ROUTE_CALL = /\b(?:app|router|server|api|route|routes|fastify|r|v1|bp|blueprint|srv|http)\.(get|post|put|patch|delete|options|head|all|use|route)\(\s*["'`](\/[^"'`\s]*)["'`]/i;
const ROUTE_DECORATOR = /@(?:\w+\.)?(get|post|put|patch|delete|route|api_route|websocket)\(\s*["'](\/[^"']*)["']/i;
const ROUTE_GO = /\b(?:HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE)\(\s*"(\/[^"]*)"/;
const ROUTE_SPRING = /@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"(\/[^"]*)"/;
const ROUTE_CASE = /\bcase\s+["'`](\/[A-Za-z0-9_\-/.:{}]*)["'`]\s*:/;
const ROUTE_COMPARE = /\b(?:pathname|path|url|route)\s*===?\s*["'`](\/[A-Za-z0-9_\-/.:{}]*)["'`]/;
const ROUTE_PREFIX = /\b(?:pathname|path|url)\.startsWith\(\s*["'`](\/[A-Za-z0-9_\-/.:]+)["'`]\)/;
/** Reads argv or imports a CLI library. Library names only count as imports (`click` is also a DOM event). */
const CLI_ARGV = /process\.argv|sys\.argv|os\.Args\b|^\s*(?:import|from)\s+(?:argparse|click|typer)\b|(?:from\s+|require\()["'](?:commander|yargs|cac|meow|sade)["']|"github\.com\/(?:spf13\/cobra|urfave\/cli)/;
const CLI_CASE = /^\s*case\s+["']([a-z][a-z0-9-]*)["']\s*:/;
const CLI_DECLARE = /\.command\(\s*["']([a-z][\w-]*)|add_parser\(\s*["']([a-z][\w-]*)|@(?:\w+\.)?command\(\s*(?:name\s*=\s*)?["']([a-z][\w-]*)/;
const ENV = [/process\.env\.([A-Z][A-Z0-9_]*)/g, /process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g, /os\.environ(?:\.get)?[[(]\s*["']([A-Z][A-Z0-9_]*)["']/g, /os\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g, /os\.Getenv\(\s*"([A-Z][A-Z0-9_]*)"/g, /System\.getenv\(\s*"([A-Z][A-Z0-9_]*)"/g];
const RUNTIME: [RuntimeKind, RegExp][] = [
  ["server", /\.listen\(|(?<!function\s{1,4})\bcreateServer\(|ListenAndServe\(|uvicorn\.run\(|\bapp\.run\(|serve_forever\(/],
  ["interval", /\bsetInterval\(/],
  ["watcher", /\bfs\.watch\(|\bwatchFile\(|\bchokidar\b|\bwatchdog\b/],
  ["scheduled", /\bcron\.schedule\(|\bnew CronJob\(|@Scheduled\(|\bschedule\.every\(|@periodic_task|\bcrontab\(/],
  ["worker", /\bnew Worker\(|\.consume\(|\.subscribe\(\s*["'{]|@(?:shared_)?task\b|\bcelery\b.*\btask\b/],
  ["signal-handler", /process\.on\(\s*["'](SIGINT|SIGTERM|exit|uncaughtException)["']/],
  ["main-guard", /^if __name__ == ["']__main__["']/],
  ["child-process", /(?<![\w.])(?:execSync|execFileSync|spawnSync|spawn|execFile|exec)\(|\bchild_process\.\w+\(|\bsubprocess\.(?:run|Popen|call|check_output)\(|\bos\.system\(/],
];
const SINKS: [string, RegExp][] = [
  ["dynamic code evaluation", /(^|[^.\w])eval\(|\bnew Function\(/],
  ["process execution", /(?<![\w.])(?:execSync|exec|spawn|spawnSync|execFile|execFileSync)\(|\bchild_process\.\w+\(|\bsubprocess\.|\bos\.system\(|\bRuntime\.getRuntime\(\)\.exec/],
  ["unsafe deserialization", /\bpickle\.loads?\(|\byaml\.load\((?![^)]*SafeLoader)|\bunserialize\(/],
  ["raw HTML injection", /\binnerHTML\s*=|dangerouslySetInnerHTML|\bdocument\.write\(/],
];
/**
 * SQL is recognised structurally (a string that opens with `select … from`,
 * `insert into x`, `update x set`, …), so prose such as "update failed" is not.
 */
const SQL = /\b(?:CREATE TABLE(?: IF NOT EXISTS)?|INSERT INTO|DELETE FROM|UPDATE|FROM|JOIN)\s+["'`]?([a-z_][a-z0-9_]{2,})["'`]?/gi;
const SQL_CONTEXT = /["'`]\s*(?:select\b.+\bfrom\s+\w|insert\s+into\s+\w|update\s+\w+\s+set\b|delete\s+from\s+\w|create\s+table\s|with\s+\w+\s+as\s*\()/i;
const MODEL_DECL: RegExp[] = [
  /\bmodel\(\s*["']([A-Z]\w+)["']/,
  /\bdefine\(\s*["']([a-z]\w+)["']\s*,\s*{/,
  /^class\s+([A-Z]\w+)\((?:[\w.]*\.)?(?:Model|Base|Document|SQLModel|DeclarativeBase)\b/,
  /@Entity\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/,
  /^\s*@Entity\b/,
];
const FILE_WRITE = /\b(?:writeFileSync|writeFile|appendFileSync|renameSync|createWriteStream)\(|\bopen\([^)]*["'][wa]b?["']|\bjson\.dump\(/;
const OUTBOUND = /\bfetch\(\s*["'`]https?:|\baxios\.(?:get|post|put|delete|request)\(|\brequests\.(?:get|post|put|delete)\(|\bhttpx\.(?:get|post)\(|\bhttp\.Get\(/;
const SECURITY_HEADER = /content-security-policy|x-content-type-options|strict-transport-security|x-frame-options|frame-ancestors|\bhelmet\(|\bcors\(/i;
const LISTEN_HOST = /\.listen\([^)]*["'](127\.0\.0\.1|localhost|0\.0\.0\.0|::)["']/;
const VALIDATION = /\b(?:z\.object|Joi\.object|yup\.object|BaseModel\)|@IsString|validate\(|safeParse\()/;
const HANDLER_STOP = new Set(["send", "reply", "json", "res", "req", "writeHead", "end", "Number", "String", "Boolean", "post", "get", "q", "url", "searchParams", "JSON", "stringify", "parse", "Math", "min", "max", "ctx", "headers", "next", "resolve", "then", "catch", "await", "async", "return", "new", "if", "switch", "case", "handle", "body", "app", "router"]);

function roleOf(node: GraphNode): FileRole {
  return (/role=(\w+)/.exec(node.evidence.detail ?? "")?.[1] as FileRole | undefined) ?? "other";
}

/**
 * Everything the section builders read, extracted once from the Feature 1
 * engine. The graph is the source of truth for structure and relationships;
 * the only source reads are line-level pattern checks over files the index
 * already holds (routes, env vars, runtime calls, SQL), and those findings are
 * always `heuristic` evidence.
 */
export class BriefingFacts {
  readonly graph: CodeGraph;
  readonly name: string;
  private memo = new Map<string, unknown>();

  constructor(readonly engine: FehmEngine) {
    this.graph = engine.graph;
    this.name = this.graph.node("repository:.")?.name ?? posix.basename(engine.root);
  }

  private once<T>(key: string, make: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, make());
    return this.memo.get(key) as T;
  }

  lines(path: string): readonly string[] {
    return this.engine.sourceLines(path) ?? [];
  }

  get files(): { node: GraphNode; path: string; role: FileRole }[] {
    return this.once("files", () =>
      this.graph
        .nodes()
        .filter((n) => n.kind === "file" && n.path)
        .map((node) => ({ node, path: node.path!, role: roleOf(node) })),
    );
  }

  get roleByPath(): Map<string, FileRole> {
    return this.once("roleByPath", () => new Map(this.files.map((f) => [f.path, f.role])));
  }

  filesWithRole(...roles: FileRole[]): string[] {
    return this.files.filter((f) => roles.includes(f.role)).map((f) => f.path);
  }

  get sourceFiles(): string[] {
    return this.once("sourceFiles", () => this.filesWithRole("source"));
  }

  get testFiles(): string[] {
    return this.once("testFiles", () => this.filesWithRole("test"));
  }

  /** Symbols defined directly by a file (graph `defines`, file → symbol). */
  definedIn(path: string): GraphNode[] {
    return this.graph
      .edgesOf(`file:${path}`, "out", ["defines"])
      .map((e) => this.graph.node(e.target))
      .filter((n): n is GraphNode => Boolean(n));
  }

  /** Every symbol whose path is this file (including methods under classes). */
  symbolsIn(path: string): GraphNode[] {
    return this.once(`symbols:${path}`, () => {
      const out: GraphNode[] = [];
      const stack = this.definedIn(path);
      const seen = new Set<string>();
      while (stack.length) {
        const n = stack.pop()!;
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        out.push(n);
        for (const e of this.graph.edgesOf(n.id, "out", ["defines"])) {
          const child = this.graph.node(e.target);
          if (child?.path === path) stack.push(child);
        }
      }
      return out.sort((a, b) => (a.location?.line ?? 0) - (b.location?.line ?? 0));
    });
  }

  /** Innermost function/method/class whose span contains the line. */
  enclosing(path: string, line: number): GraphNode | undefined {
    let best: GraphNode | undefined;
    for (const n of this.symbolsIn(path)) {
      const loc = n.location;
      if (!loc?.endLine || loc.line > line || loc.endLine < line) continue;
      if (n.kind !== "function" && n.kind !== "method" && n.kind !== "class" && n.kind !== "variable") continue;
      if (!best || loc.endLine - loc.line < best.location!.endLine! - best.location!.line) best = n;
    }
    return best;
  }

  // ─── manifests & docs ─────────────────────────────────────────────

  get manifests(): Manifest[] {
    return this.once("manifests", () => this.files.filter((f) => f.role === "manifest").map((f) => parseManifest(f.path, this.lines(f.path))).filter((m): m is Manifest => Boolean(m)));
  }

  /** The manifest at the repository root, else the shallowest one. */
  get primaryManifest(): Manifest | undefined {
    return this.once("primaryManifest", () => [...this.manifests].sort((a, b) => a.path.split("/").length - b.path.split("/").length || (a.path < b.path ? -1 : 1))[0]);
  }

  get readme(): { path: string; line: number; text: string } | undefined {
    return this.once("readme", () => {
      const file = this.files.find((f) => /^readme(\.[a-z]+)?$/i.test(f.path)) ?? this.files.find((f) => /(^|\/)readme\.md$/i.test(f.path) && f.path.split("/").length === 2);
      if (!file) return undefined;
      const lines = this.lines(file.path);
      let start = -1;
      const para: string[] = [];
      for (let i = 0; i < lines.length; i += 1) {
        const t = lines[i]!.trim();
        const skip = !t || t.startsWith("#") || t.startsWith("![") || t.startsWith("[![") || t.startsWith("<") || t.startsWith("```") || t.startsWith("|") || t.startsWith("---");
        if (skip) {
          if (para.length) break;
          continue;
        }
        if (start < 0) start = i + 1;
        para.push(t);
        if (para.join(" ").length > 400) break;
      }
      if (!para.length) return undefined;
      const text = para.join(" ").replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      return { path: file.path, line: start, text: text.length > 420 ? `${text.slice(0, 417)}…` : text };
    });
  }

  get declaredDependencies(): (DeclaredDependency & { manifest: string })[] {
    return this.once("declared", () => this.manifests.flatMap((m) => m.dependencies.map((d) => ({ ...d, manifest: m.path }))));
  }

  /** External packages with the files that import them (graph `imports` edges). */
  get packages(): { name: string; nodeId: string; importers: string[]; info?: TechInfo; builtin: boolean; provenance: Provenance; line?: Located }[] {
    return this.once("packages", () =>
      this.graph
        .nodes()
        .filter((n) => n.kind === "package")
        .map((n) => {
          const edges = this.graph.edgesOf(n.id, "in", ["imports"]);
          const importers = [...new Set(edges.map((e) => this.graph.node(e.source)?.path).filter((p): p is string => Boolean(p)))].sort();
          const first = edges.find((e) => e.evidence.location)?.evidence.location;
          const name = normalizePackage(n.name);
          const info = techInfo(n.name) ?? techInfo(name);
          return strip<{ name: string; nodeId: string; importers: string[]; info?: TechInfo; builtin: boolean; provenance: Provenance; line?: Located }>({
            name,
            nodeId: n.id,
            importers,
            info,
            builtin: isBuiltin(n.name),
            provenance: edges[0]?.evidence.provenance ?? n.evidence.provenance,
            line: first ? { path: first.path, line: first.line } : undefined,
          });
        })
        .sort((a, b) => b.importers.length - a.importers.length || (a.name < b.name ? -1 : 1)),
    );
  }

  /** Non-test importers only: a package used only by tests is not runtime usage. */
  runtimeImporters(pkg: { importers: string[] }): string[] {
    return pkg.importers.filter((p) => this.roleByPath.get(p) !== "test");
  }

  // ─── configuration / infrastructure files ─────────────────────────

  get configFiles(): ConfigFile[] {
    return this.once("configFiles", () => {
      const out: ConfigFile[] = [];
      for (const f of this.files) {
        const base = posix.basename(f.path);
        const lower = base.toLowerCase();
        let kind: ConfigFile["kind"] | undefined;
        let label = base;
        if (lower === "dockerfile" || lower.endsWith(".dockerfile") || lower.startsWith("dockerfile.")) kind = "docker";
        else if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(lower)) kind = "compose";
        else if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f.path) || lower === ".gitlab-ci.yml" || f.path === ".circleci/config.yml" || lower === "azure-pipelines.yml" || lower === "jenkinsfile") kind = "ci";
        else if (/^(vercel\.json|netlify\.toml|fly\.toml|render\.ya?ml|app\.ya?ml|serverless\.ya?ml|railway\.json|amplify\.ya?ml|firebase\.json|wrangler\.toml|now\.json|heroku\.yml|apprunner\.yaml)$/.test(lower) && !isKubernetes(f.node.language, this.lines(f.path)) && (!/^app\.ya?ml$/.test(lower) || this.lines(f.path).some((l) => /^runtime:\s*\S/.test(l)))) {
          kind = "platform";
          label = PLATFORM_LABEL[lower.replace(/\.ya?ml$|\.json$|\.toml$/, "")] ?? base;
        } else if (lower === ".env.example" || lower === ".env.sample") kind = "env-example";
        else if (/^tsconfig(\.[\w-]+)?\.json$|^jsconfig\.json$|^mypy\.ini$/.test(lower)) kind = "typescript";
        else if (/eslint|^\.prettierrc|^biome\.json$|^ruff\.toml$|^\.flake8$|^\.pylintrc$|^golangci/.test(lower)) kind = "lint";
        else if (/^\.nycrc|^\.c8rc|^codecov\.ya?ml$|^\.coveragerc$|^jest\.config|^vitest\.config/.test(lower)) kind = "coverage";
        else if (isKubernetes(f.node.language, this.lines(f.path))) kind = "kubernetes";
        if (kind) out.push({ path: f.path, kind, label });
      }
      return out;
    });
  }

  configOf(kind: ConfigFile["kind"]): ConfigFile[] {
    return this.configFiles.filter((c) => c.kind === kind);
  }

  // ─── source-line signals (heuristic) ──────────────────────────────

  get signals(): {
    routes: Route[];
    cli: CliCommand[];
    env: Map<string, Located[]>;
    runtime: (Signal & { kind: RuntimeKind })[];
    sinks: Signal[];
    tables: Map<string, (Located & { op: string })[]>;
    models: Signal[];
    fileWrites: Located[];
    outbound: Located[];
    securityHeaders: Signal[];
    listenHosts: Signal[];
    validation: Located[];
    truncated: boolean;
  } {
    return this.once("signals", () => {
      const routes: Route[] = [];
      const cli: CliCommand[] = [];
      const env = new Map<string, Located[]>();
      const runtime: (Signal & { kind: RuntimeKind })[] = [];
      const sinks: Signal[] = [];
      const tables = new Map<string, (Located & { op: string })[]>();
      const models: Signal[] = [];
      const fileWrites: Located[] = [];
      const outbound: Located[] = [];
      const securityHeaders: Signal[] = [];
      const listenHosts: Signal[] = [];
      const validation: Located[] = [];
      const candidates = this.files.filter((f) => f.role === "source" && !f.node.evidence.detail?.includes("not analyzed"));
      const truncated = candidates.length > MAX_SIGNAL_FILES;
      const cliFiles = this.cliSourceFiles;
      for (const f of candidates.slice(0, MAX_SIGNAL_FILES)) {
        const lines = this.lines(f.path);
        const isCli = cliFiles.has(f.path);
        const limit = Math.min(lines.length, MAX_SIGNAL_LINES);
        let inBlockComment = false;
        for (let i = 0; i < limit; i += 1) {
          const raw = lines[i]!;
          const t = raw.trim();
          if (inBlockComment) {
            if (t.includes("*/")) inBlockComment = false;
            continue;
          }
          if (t.startsWith("/*")) {
            inBlockComment = !t.includes("*/");
            continue;
          }
          if (t.startsWith("//") || t.startsWith("#") || t.startsWith("*")) continue;
          if (t.length > 2000) continue;
          const at = { path: f.path, line: i + 1 };
          // Pattern checks never look inside regex literals (pattern tables would match themselves);
          // code-only checks also ignore string contents.
          const noRegex = stripRegexLiterals(raw);
          const code = stripStrings(noRegex);
          let m: RegExpExecArray | null;
          if ((m = ROUTE_CALL.exec(noRegex)) && !(m[1]!.toLowerCase() === "use" && m[2] === "/")) routes.push({ ...at, method: m[1]!.toUpperCase() === "ROUTE" ? "ANY" : m[1]!.toUpperCase(), route: m[2]!, style: "call" });
          else if ((m = ROUTE_DECORATOR.exec(noRegex))) routes.push({ ...at, method: /route|api_route/i.test(m[1]!) ? "ANY" : m[1]!.toUpperCase(), route: m[2]!, style: "decorator" });
          else if ((m = ROUTE_SPRING.exec(noRegex))) routes.push({ ...at, method: m[1] === "Request" ? "ANY" : m[1]!.toUpperCase(), route: m[2]!, style: "annotation" });
          else if ((m = ROUTE_GO.exec(noRegex))) routes.push({ ...at, method: /\b(GET|POST|PUT|PATCH|DELETE)\(/.exec(noRegex)?.[1] ?? "ANY", route: m[1]!, style: "call" });
          else if ((m = ROUTE_CASE.exec(noRegex)) && m[1]!.length > 1) routes.push({ ...at, method: "ANY", route: m[1]!, style: "switch" });
          else if ((m = ROUTE_COMPARE.exec(noRegex)) && m[1]!.length > 1) routes.push({ ...at, method: /method\s*===?\s*["'](GET|POST|PUT|DELETE|PATCH)/.exec(noRegex)?.[1] ?? "ANY", route: m[1]!, style: "comparison" });
          else if ((m = ROUTE_PREFIX.exec(noRegex))) routes.push({ ...at, method: "ANY", route: `${m[1]!.replace(/\/$/, "")}/*`, style: "comparison" });
          if (isCli) {
            if ((m = CLI_CASE.exec(noRegex))) cli.push({ ...at, name: m[1]!, group: this.enclosing(f.path, i + 1)?.name ?? posix.basename(f.path) });
            else if ((m = CLI_DECLARE.exec(noRegex))) cli.push({ ...at, name: (m[1] ?? m[2] ?? m[3])!, group: this.enclosing(f.path, i + 1)?.name ?? posix.basename(f.path) });
          }
          for (const re of ENV) {
            re.lastIndex = 0;
            while ((m = re.exec(noRegex))) {
              const list = env.get(m[1]!) ?? [];
              if (list.length < 8) list.push(at);
              env.set(m[1]!, list);
            }
          }
          const js = f.node.language === "typescript" || f.node.language === "javascript";
          const spawnOk = !js || this.importsPackage(f.path, /^(node:child_process|execa|cross-spawn)$/);
          for (const [kind, re] of RUNTIME) if (re.test(code) && (kind !== "child-process" || spawnOk)) runtime.push({ ...at, kind, text: t.slice(0, 140) });
          for (const [kind, re] of SINKS) if (re.test(kind === "raw HTML injection" ? noRegex : code) && (kind !== "process execution" || spawnOk)) sinks.push({ ...at, kind, text: t.slice(0, 140) });
          if (SQL_CONTEXT.test(noRegex)) {
            SQL.lastIndex = 0;
            while ((m = SQL.exec(noRegex))) {
              const table = m[1]!.toLowerCase();
              if (SQL_NOISE.has(table)) continue;
              const op = m[0].split(/\s+/)[0]!.toUpperCase();
              const list = tables.get(table) ?? [];
              if (list.length < 12) list.push({ ...at, op });
              tables.set(table, list);
            }
          }
          for (const re of MODEL_DECL) {
            if ((m = re.exec(noRegex))) {
              const name = m[1] ?? /class\s+(\w+)/.exec(lines[i + 1] ?? "")?.[1];
              if (name) models.push({ ...at, kind: "model", text: name });
              break;
            }
          }
          if (FILE_WRITE.test(noRegex)) fileWrites.push(at);
          if (OUTBOUND.test(noRegex)) outbound.push(at);
          if (SECURITY_HEADER.test(noRegex)) securityHeaders.push({ ...at, kind: "header", text: t.slice(0, 140) });
          if ((m = LISTEN_HOST.exec(noRegex))) listenHosts.push({ ...at, kind: "listen", text: m[1]! });
          else if (/\.listen\(/.test(code) && (m = /["'](127\.0\.0\.1|localhost|0\.0\.0\.0)["']/.exec(noRegex))) listenHosts.push({ ...at, kind: "listen", text: m[1]! });
          if (VALIDATION.test(code)) validation.push(at);
        }
      }
      // A route prefix guard (`path.startsWith("/api/x")`) adds nothing when exact routes under it exist.
      const exact = routes.filter((r) => !r.route.endsWith("/*"));
      const kept = routes.filter((r) => !r.route.endsWith("/*") || !exact.some((e) => e.route.startsWith(r.route.slice(0, -1))));
      routes.length = 0;
      routes.push(...kept);
      for (const r of this.fileRoutes) routes.push(r);
      const pick = <T extends { handler?: GraphNode }>(items: { item: T; candidates: GraphNode[]; group: string }[]): void => {
        // A callee shared by many cases of one dispatcher (e.g. an `open()` helper) is plumbing, not the handler.
        const freq = new Map<string, number>();
        const size = new Map<string, number>();
        for (const x of items) {
          size.set(x.group, (size.get(x.group) ?? 0) + 1);
          for (const c of new Set(x.candidates.map((n) => n.id))) freq.set(`${x.group}|${c}`, (freq.get(`${x.group}|${c}`) ?? 0) + 1);
        }
        for (const x of items) {
          const limit = Math.max(2, Math.floor((size.get(x.group) ?? 0) * 0.2));
          const chosen = x.candidates.find((c) => (freq.get(`${x.group}|${c.id}`) ?? 0) <= limit) ?? x.candidates[0];
          if (chosen) x.item.handler = chosen;
        }
      };
      pick(
        cli.map((c) => {
          const enclosing = this.enclosing(c.path, c.line);
          return { item: c, candidates: this.handlerCandidates({ path: c.path, line: c.line, method: "", route: c.name, style: "switch" }, enclosing, 10), group: `${c.path}|${c.group}` };
        }),
      );
      pick(
        routes.map((r) => {
          const enclosing = this.enclosing(r.path, r.line);
          if (enclosing) r.enclosing = enclosing;
          return { item: r, candidates: this.handlerCandidates(r, enclosing, 5), group: `${r.path}|${enclosing?.id ?? ""}` };
        }),
      );
      return { routes, cli, env, runtime, sinks, tables, models, fileWrites, outbound, securityHeaders, listenHosts, validation, truncated };
    });
  }

  /** Next.js / file-system routes, from paths alone. */
  private get fileRoutes(): Route[] {
    const out: Route[] = [];
    for (const path of this.sourceFiles) {
      let m = /(?:^|\/)app\/(.*?)\/?route\.[cm]?[jt]sx?$/.exec(path);
      if (m) {
        out.push({ path, line: 1, method: "ANY", route: `/${m[1]!}`.replace(/\/\([^)]+\)/g, "").replace(/\/$/, "") || "/", style: "file" });
        continue;
      }
      m = /(?:^|\/)pages\/(api\/.*?)(?:\/index)?\.[cm]?[jt]sx?$/.exec(path);
      if (m) out.push({ path, line: 1, method: "ANY", route: `/${m[1]!}`, style: "file" });
    }
    return out;
  }

  /** Files that dispatch CLI commands: bin targets and conventional CLI files that read argv. */
  get cliSourceFiles(): Set<string> {
    return this.once("cliFiles", () => {
      const out = new Set<string>();
      for (const target of this.binTargets) out.add(target);
      for (const path of this.sourceFiles) {
        const stem = posix.basename(path).replace(/\.[^.]+$/, "");
        if (!/^(cli|main|__main__|bin|index|app|manage|commands?)$/.test(stem) && !path.includes("/bin/") && !path.includes("/commands/")) continue;
        if (this.lines(path).some((l) => CLI_ARGV.test(l))) out.add(path);
      }
      return out;
    });
  }

  /** Source files behind the manifests' `bin` entries (dist/x.js → src/x.ts when built). */
  get binTargets(): string[] {
    return this.once("binTargets", () => {
      const out: string[] = [];
      for (const m of this.manifests) {
        for (const b of m.bin) {
          const found = this.mapBuiltToSource(posix.join(posix.dirname(m.path), b.target));
          if (found) out.push(found);
        }
      }
      return [...new Set(out)];
    });
  }

  mapBuiltToSource(target: string): string | undefined {
    const clean = posix.normalize(target).replace(/^\.\//, "");
    if (this.roleByPath.has(clean)) return clean;
    const stem = clean.replace(/\.[cm]?js$/, "");
    const candidates = [stem, stem.replace(/^(dist|build|lib|out)\//, "src/"), stem.replace(/^(dist|build|lib|out)\//, "")];
    for (const c of candidates) for (const ext of [".ts", ".mts", ".tsx", ".js", ".mjs"]) if (this.roleByPath.has(c + ext)) return c + ext;
    return undefined;
  }

  /**
   * Functions the code at a route/command registration hands control to, in
   * source order: calls on the registration line (after the path) and, for
   * switch/if dispatch, the following lines up to the next case. Only graph
   * symbols the enclosing function calls, or that the file defines, qualify.
   */
  private handlerCandidates(route: Route, enclosing: GraphNode | undefined, span: number): GraphNode[] {
    const lines = this.lines(route.path);
    const window: string[] = [];
    const first = lines[route.line - 1] ?? "";
    const idx = first.indexOf(route.route);
    window.push(idx >= 0 ? first.slice(idx + route.route.length) : first);
    if (route.style === "switch" || route.style === "comparison") {
      for (let i = route.line; i < Math.min(lines.length, route.line + span); i += 1) {
        const l = lines[i]!;
        if (/^\s*(case|default)\b|^\s*}\s*$|^\s*(}\s*)?(else\s+)?if\s*\(/.test(l)) break;
        window.push(l);
      }
    }
    const callees = new Map<string, GraphNode>();
    if (enclosing) {
      for (const e of this.graph.edgesOf(enclosing.id, "out", ["calls", "references"])) {
        const n = this.graph.node(e.target);
        if (n && (n.kind === "function" || n.kind === "method")) callees.set(n.name.split(".").at(-1)!, n);
      }
    }
    const local = new Map<string, GraphNode>();
    for (const n of this.symbolsIn(route.path)) if (n.kind === "function" || n.kind === "method") local.set(n.name.split(".").at(-1)!, n);
    const out: GraphNode[] = [];
    for (const text of window) {
      for (const m of stripStrings(text).matchAll(/([A-Za-z_$][\w$]*)\s*(\(|,|\))/g)) {
        const name = m[1]!;
        if (HANDLER_STOP.has(name)) continue;
        const hit = callees.get(name) ?? local.get(name);
        if (hit && hit.id !== enclosing?.id && !out.includes(hit)) out.push(hit);
      }
    }
    if (out.length) return out;
    if (route.style === "file") return this.definedIn(route.path).filter((n) => /^(GET|POST|PUT|PATCH|DELETE|handler|default)$/.test(n.name));
    if (route.style === "decorator" || route.style === "annotation") {
      // The decorated function is the next definition after the decorator line.
      return this.symbolsIn(route.path).filter((n) => (n.kind === "function" || n.kind === "method") && (n.location?.line ?? 0) > route.line && (n.location?.line ?? 0) <= route.line + 4).slice(0, 1);
    }
    return [];
  }

  /** Whether a file imports an external package matching the pattern (graph `imports` edges). */
  importsPackage(path: string, pattern: RegExp): boolean {
    return this.graph.edgesOf(`file:${path}`, "out", ["imports"]).some((e) => {
      const n = this.graph.node(e.target);
      return n?.kind === "package" && pattern.test(normalizePackage(n.name));
    });
  }

  // ─── dependency structure ─────────────────────────────────────────

  fileOf(id: string): string | undefined {
    const n = this.graph.node(id);
    if (!n || n.kind === "package" || n.kind === "directory" || n.kind === "repository") return undefined;
    return n.path;
  }

  /** File-level dependency adjacency from every non-structural edge (imports, calls, references, uses, inheritance). */
  get fileDeps(): { out: Map<string, Set<string>>; in: Map<string, Set<string>>; inboundSymbol: Map<string, number>; edgeProvenance: Map<string, Provenance> } {
    return this.once("fileDeps", () => {
      const out = new Map<string, Set<string>>();
      const inn = new Map<string, Set<string>>();
      const inboundSymbol = new Map<string, number>();
      const edgeProvenance = new Map<string, Provenance>();
      const code = new Set(this.files.filter((f) => f.role === "source" || f.role === "test").map((f) => f.path));
      for (const e of this.graph.edges()) {
        if (STRUCTURAL.has(e.kind)) continue;
        const a = this.fileOf(e.source);
        const b = this.fileOf(e.target);
        if (!a || !b || a === b || !code.has(a) || !code.has(b)) continue;
        add(out, a, b);
        add(inn, b, a);
        if (e.kind !== "imports") inboundSymbol.set(b, (inboundSymbol.get(b) ?? 0) + 1);
        const key = `${a}→${b}`;
        const prev = edgeProvenance.get(key);
        if (!prev || rank(e.evidence.provenance) < rank(prev)) edgeProvenance.set(key, e.evidence.provenance);
      }
      return { out, in: inn, inboundSymbol, edgeProvenance };
    });
  }

  /** Entry files: convention names, bin targets, CLI dispatchers, route-registering files, Python/Go mains. */
  get entryFiles(): { path: string; reasons: string[] }[] {
    return this.once("entryFiles", () => {
      const reasons = new Map<string, Set<string>>();
      const note = (p: string, r: string): void => {
        if (this.roleByPath.get(p) !== "source") return;
        const s = reasons.get(p) ?? new Set();
        s.add(r);
        reasons.set(p, s);
      };
      for (const p of this.engine.systemMap().entryPoints) note(p, "conventional entry file name");
      for (const p of this.binTargets) note(p, "package bin target");
      for (const m of this.manifests) if (m.main) {
        const src = this.mapBuiltToSource(posix.join(posix.dirname(m.path), m.main));
        if (src) note(src, "package main");
      }
      for (const p of this.cliSourceFiles) note(p, "reads command-line arguments");
      for (const r of this.signals.routes) note(r.path, "registers HTTP routes");
      for (const s of this.signals.runtime) {
        if (s.kind === "main-guard") note(s.path, "__main__ guard");
        if (s.kind === "server") note(s.path, "starts a server");
      }
      for (const f of this.sourceFiles) if (/(^|\/)main\.go$/.test(f) && this.definedIn(f).some((n) => n.name === "main")) note(f, "Go main");
      return [...reasons.entries()].map(([path, r]) => ({ path, reasons: [...r].sort() })).sort((a, b) => (a.path < b.path ? -1 : 1));
    });
  }

  private reach(starts: string[]): Map<string, number> {
    const count = new Map<string, number>();
    for (const start of starts) {
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const next of this.fileDeps.out.get(cur) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          stack.push(next);
        }
      }
      for (const p of seen) count.set(p, (count.get(p) ?? 0) + 1);
    }
    return count;
  }

  get metrics(): Map<string, FileMetrics> {
    return this.once("metrics", () => {
      const entryReach = this.reach(this.entryFiles.map((e) => e.path));
      const testReach = this.reach(this.testFiles);
      const out = new Map<string, FileMetrics>();
      for (const path of this.sourceFiles) {
        const dependents = [...(this.fileDeps.in.get(path) ?? [])].filter((p) => this.roleByPath.get(p) === "source");
        const symbols = this.symbolsIn(path);
        const lines = Math.max(this.lines(path).length, ...symbols.map((s) => s.location?.endLine ?? 0));
        out.set(path, {
          path,
          dependents: dependents.length,
          dependencies: [...(this.fileDeps.out.get(path) ?? [])].filter((p) => this.roleByPath.get(p) === "source").length,
          inboundSymbolEdges: this.fileDeps.inboundSymbol.get(path) ?? 0,
          defines: symbols.length,
          entryReach: entryReach.get(path) ?? 0,
          testReach: testReach.get(path) ?? 0,
          lines,
          module: this.moduleOf(path),
        });
      }
      return out;
    });
  }

  /** Strongly connected components (size > 1) of the source-file dependency graph: import/call cycles. */
  get cycles(): string[][] {
    return this.once("cycles", () => tarjan(this.sourceFiles, (p) => [...(this.fileDeps.out.get(p) ?? [])].filter((q) => this.roleByPath.get(q) === "source")).filter((c) => c.length > 1));
  }

  // ─── modules ──────────────────────────────────────────────────────

  /**
   * Module of a source file: its directory; inside a flat directory (10+ source
   * files) files are grouped by shared filename prefix (`skill-router.ts` and
   * `skill-model.ts` → `src/skill-*`).
   */
  moduleOf(path: string): string {
    return this.moduleMap.get(path) ?? posix.dirname(path);
  }

  private get moduleMap(): Map<string, string> {
    return this.once("moduleMap", () => {
      const byDir = new Map<string, string[]>();
      for (const p of this.sourceFiles) {
        const d = posix.dirname(p);
        byDir.set(d, [...(byDir.get(d) ?? []), p]);
      }
      const out = new Map<string, string>();
      for (const [dir, files] of byDir) {
        if (files.length < 10) {
          for (const f of files) out.set(f, dir);
          continue;
        }
        const prefix = (f: string): string => posix.basename(f).replace(/\.[^.]+$/, "").split(/[-_.]/)[0]!;
        const counts = new Map<string, number>();
        for (const f of files) counts.set(prefix(f), (counts.get(prefix(f)) ?? 0) + 1);
        for (const f of files) {
          const p = prefix(f);
          out.set(f, counts.get(p)! >= 2 ? `${dir === "." ? "" : `${dir}/`}${p}*` : `${dir === "." ? "" : `${dir}/`}${posix.basename(f).replace(/\.[^.]+$/, "")}`);
        }
      }
      return out;
    });
  }

  get modules(): { name: string; files: string[]; dependsOn: Map<string, number>; dependents: Map<string, number> }[] {
    return this.once("modules", () => {
      const map = new Map<string, { name: string; files: string[]; dependsOn: Map<string, number>; dependents: Map<string, number> }>();
      for (const p of this.sourceFiles) {
        const m = this.moduleOf(p);
        const entry = map.get(m) ?? { name: m, files: [] as string[], dependsOn: new Map<string, number>(), dependents: new Map<string, number>() };
        entry.files.push(p);
        map.set(m, entry);
      }
      for (const [a, targets] of this.fileDeps.out) {
        if (this.roleByPath.get(a) !== "source") continue;
        for (const b of targets) {
          if (this.roleByPath.get(b) !== "source") continue;
          const ma = this.moduleOf(a);
          const mb = this.moduleOf(b);
          if (ma === mb) continue;
          const A = map.get(ma)!;
          const B = map.get(mb)!;
          A.dependsOn.set(mb, (A.dependsOn.get(mb) ?? 0) + 1);
          B.dependents.set(ma, (B.dependents.get(ma) ?? 0) + 1);
        }
      }
      return [...map.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
    });
  }

  /** Unique human label for a module (see `moduleLabels`). */
  label(module: string): string {
    return this.once("labels", () => moduleLabels(this.modules.map((m) => m.name))).get(module) ?? module;
  }

  /** Share of non-structural relationships that are heuristic (pattern-extracted). */
  get heuristicShare(): number {
    return this.once("heuristicShare", () => {
      let total = 0;
      let heuristic = 0;
      for (const e of this.graph.edges()) {
        if (STRUCTURAL.has(e.kind)) continue;
        total += 1;
        if (e.evidence.provenance === "heuristic") heuristic += 1;
      }
      return total ? heuristic / total : 0;
    });
  }

  /** Most-referenced symbols defined in a file (for "why it matters"). */
  keySymbols(path: string, limit = 3): { node: GraphNode; inbound: number }[] {
    return this.definedIn(path)
      .filter((n) => n.kind !== "variable" || n.exported)
      .map((node) => ({ node, inbound: this.graph.edgesOf(node.id, "in", ["calls", "references", "uses", "extends", "implements"]).filter((e) => this.fileOf(e.source) !== path).length }))
      .sort((a, b) => b.inbound - a.inbound || Number(Boolean(b.node.exported)) - Number(Boolean(a.node.exported)) || (a.node.name < b.node.name ? -1 : 1))
      .slice(0, limit);
  }

  /** The doc comment that best describes a file: its own leading doc, else its most-used symbol's doc. */
  describe(path: string): string | undefined {
    const header = this.headerComment(path);
    if (header) return header;
    for (const { node } of this.keySymbols(path, 4)) if (node.doc && node.kind !== "variable") return node.doc;
    return undefined;
  }

  /** The comment block a file opens with (before any import or code), as one sentence. */
  private headerComment(path: string): string | undefined {
    const lines = this.lines(path);
    const text: string[] = [];
    let open: "block" | "doc" | "line" | undefined;
    for (let i = 0; i < Math.min(lines.length, 40); i += 1) {
      const t = lines[i]!.trim();
      if (!open) {
        if (!t || t.startsWith("#!") || /^["']use \w+["'];?$/.test(t) || /^#.*coding[:=]/.test(t)) continue;
        if (t.startsWith("/*")) open = "block";
        else if (t.startsWith('"""') || t.startsWith("'''")) open = "doc";
        else if (t.startsWith("//") || t.startsWith("#")) open = "line";
        else return undefined;
      }
      if (open === "line") {
        if (!t.startsWith("//") && !t.startsWith("#")) break;
        text.push(t.replace(/^(\/\/+|#+)\s?/, ""));
        continue;
      }
      const closes = open === "block" ? t.includes("*/") && (i > 0 || t.indexOf("*/") > 1) : (t.match(/"""|'''/g)?.length ?? 0) >= (text.length ? 1 : 2);
      text.push(t.replace(/^\/\*+\s?|\*\/$|^\*\s?|"""|'''/g, "").trim());
      if (closes) break;
    }
    const joined = text.filter((l) => l && !/^(eslint|@ts-|prettier|type:|noqa|@\w+|Copyright|SPDX|License)/i.test(l)).join(" ").trim();
    return joined.length >= 12 ? firstSentence(joined, 200) : undefined;
  }

  edgeProvenance(a: string, b: string): Provenance | undefined {
    return this.fileDeps.edgeProvenance.get(`${a}→${b}`);
  }

  strongestEdge(edges: GraphEdge[]): GraphEdge | undefined {
    return [...edges].sort((a, b) => rank(a.evidence.provenance) - rank(b.evidence.provenance))[0];
  }
}

function isKubernetes(language: string | undefined, lines: readonly string[]): boolean {
  return language === "yaml" && lines.some((l) => /^apiVersion:\s*\S+/.test(l)) && lines.some((l) => /^kind:\s*(Deployment|Service|Ingress|StatefulSet|DaemonSet|CronJob|Job|ConfigMap|Pod)\b/.test(l));
}

const PLATFORM_LABEL: Record<string, string> = {
  vercel: "Vercel",
  now: "Vercel",
  netlify: "Netlify",
  fly: "Fly.io",
  render: "Render",
  app: "Google App Engine",
  serverless: "Serverless Framework",
  railway: "Railway",
  amplify: "AWS Amplify",
  firebase: "Firebase Hosting",
  wrangler: "Cloudflare Workers",
  heroku: "Heroku",
  apprunner: "AWS App Runner",
};

const SQL_NOISE = new Set(["the", "select", "where", "table", "values", "set", "into", "exists", "not", "and", "json", "dual", "information_schema", "sqlite_master", "each", "unnest", "generate_series", "lateral"]);

/** Remove regex literals (`/…/flags` after an operator or bracket) from one line. */
export function stripRegexLiterals(line: string): string {
  return line.replace(/(^|[=(,:[!&|?;{}]|\breturn|\btest)\s*\/(?![*/\s])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+\/[dgimsuy]*/g, "$1 /re/");
}

/** Blank out single-line string literal contents, keeping the quotes. */
export function stripStrings(line: string): string {
  return line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, (q) => `${q[0]}${q[0]}`);
}

export function rank(p: Provenance): number {
  return p === "filesystem" ? 0 : p === "type-checker" ? 1 : p === "ast" ? 2 : 3;
}

function add(map: Map<string, Set<string>>, a: string, b: string): void {
  let s = map.get(a);
  if (!s) map.set(a, (s = new Set()));
  s.add(b);
}

function tarjan(nodes: string[], next: (n: string) => string[]): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const strong = (v: string): void => {
    // Iterative to survive deep dependency chains.
    const work: { v: string; i: number; succ: string[] }[] = [{ v, i: 0, succ: next(v) }];
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    while (work.length) {
      const top = work[work.length - 1]!;
      if (top.i < top.succ.length) {
        const w = top.succ[top.i++]!;
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index);
          index += 1;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0, succ: next(w) });
        } else if (onStack.has(w)) low.set(top.v, Math.min(low.get(top.v)!, idx.get(w)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.v, Math.min(low.get(parent.v)!, low.get(top.v)!));
      if (low.get(top.v) === idx.get(top.v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== top.v);
        out.push(comp.sort());
      }
    }
  };
  for (const n of nodes) if (!idx.has(n)) strong(n);
  return out.sort((a, b) => b.length - a.length);
}

// ─── manifest parsing ─────────────────────────────────────────────

function lineOf(lines: readonly string[], needle: RegExp, from = 0): number {
  for (let i = from; i < lines.length; i += 1) if (needle.test(lines[i]!)) return i + 1;
  return 1;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function parseManifest(path: string, lines: readonly string[]): Manifest | undefined {
  const base = posix.basename(path);
  const text = lines.join("\n");
  if (base === "package.json") {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    const m: Manifest = { path, kind: "npm", bin: [], scripts: [], dependencies: [] };
    if (typeof json.name === "string") m.name = json.name;
    if (typeof json.description === "string" && json.description) {
      m.description = json.description;
      m.descriptionLine = lineOf(lines, /"description"\s*:/);
    }
    const bin = json.bin;
    if (typeof bin === "string") m.bin.push({ name: m.name ?? "bin", target: bin, line: lineOf(lines, /"bin"\s*:/) });
    else if (bin && typeof bin === "object") for (const [k, v] of Object.entries(bin as Record<string, string>)) m.bin.push({ name: k, target: v, line: lineOf(lines, new RegExp(`"${escapeRe(k)}"\\s*:`)) });
    if (typeof json.main === "string") m.main = json.main;
    const scripts = json.scripts as Record<string, string> | undefined;
    if (scripts) for (const [k, v] of Object.entries(scripts)) m.scripts.push({ name: k, command: v, line: lineOf(lines, new RegExp(`"${escapeRe(k)}"\\s*:`), lineOf(lines, /"scripts"\s*:/)) });
    for (const [field, dev] of [["dependencies", false], ["devDependencies", true], ["peerDependencies", false], ["optionalDependencies", false]] as const) {
      const deps = json[field] as Record<string, string> | undefined;
      if (!deps) continue;
      const start = lineOf(lines, new RegExp(`"${field}"\\s*:`));
      for (const name of Object.keys(deps)) m.dependencies.push({ path, name, dev, ...(typeof deps[name] === "string" ? { requirement: deps[name] } : {}), line: lineOf(lines, new RegExp(`"${escapeRe(name)}"\\s*:`), start - 1) });
    }
    const engines = json.engines as Record<string, string> | undefined;
    if (engines?.node) m.engines = `Node.js ${engines.node}`;
    return m;
  }
  if (base === "pyproject.toml" || base === "setup.cfg" || base === "setup.py" || base === "requirements.txt" || base === "Pipfile") {
    const m: Manifest = { path, kind: "python", bin: [], scripts: [], dependencies: [] };
    const name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text);
    if (name) m.name = name[1]!;
    const desc = /^\s*description\s*=\s*["']([^"']+)["']/m.exec(text);
    if (desc) {
      m.description = desc[1]!;
      m.descriptionLine = lineOf(lines, /^\s*description\s*=/);
    }
    const py = /requires-python\s*=\s*["']([^"']+)["']/.exec(text);
    if (py) m.engines = `Python ${py[1]}`;
    let section = "";
    let inDepsArray = false;
    lines.forEach((raw, i) => {
      const l = raw.trim();
      const sec = /^\[([^\]]+)\]/.exec(l);
      if (sec) {
        section = sec[1]!;
        inDepsArray = false;
        return;
      }
      const dep = (spec: string, dev: boolean): void => {
        const n = /^["']?([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1];
        if (n && !/^(python|pip|setuptools|wheel)$/i.test(n)) m.dependencies.push({ path, name: n.toLowerCase(), dev, line: i + 1 });
      };
      if (base === "requirements.txt") {
        if (l && !l.startsWith("#") && !l.startsWith("-")) dep(l, /dev|test/.test(path));
        return;
      }
      if (/^dependencies\s*=\s*\[/.test(l) || /^(dev|test)[\w-]*\s*=\s*\[/.test(l) && section.includes("optional-dependencies")) {
        inDepsArray = true;
        const inline = l.slice(l.indexOf("[") + 1);
        for (const s of inline.split(",")) if (s.trim().replace(/\]$/, "")) dep(s.trim(), !l.startsWith("dependencies"));
        if (l.includes("]")) inDepsArray = false;
        return;
      }
      if (inDepsArray) {
        if (l.startsWith("]")) inDepsArray = false;
        else dep(l.replace(/,$/, ""), section.includes("optional") || section.includes("dev"));
        return;
      }
      if (/tool\.poetry\.(dev-)?dependencies|^packages$|^dev-packages$/.test(section) && /^[A-Za-z]/.test(l)) dep(l.split("=")[0]!.trim(), /dev/.test(section));
      if (section === "project.scripts" || section === "tool.poetry.scripts") {
        const s = /^([\w-]+)\s*=\s*["']([^"']+)["']/.exec(l);
        if (s) m.bin.push({ name: s[1]!, target: s[2]!, line: i + 1 });
      }
    });
    return m;
  }
  if (base === "go.mod") {
    const m: Manifest = { path, kind: "go", bin: [], scripts: [], dependencies: [] };
    const mod = /^module\s+(\S+)/m.exec(text);
    if (mod) m.name = mod[1]!;
    const go = /^go\s+(\S+)/m.exec(text);
    if (go) m.engines = `Go ${go[1]}`;
    let inRequire = false;
    lines.forEach((raw, i) => {
      const l = raw.trim();
      if (l.startsWith("require (")) return void (inRequire = true);
      if (inRequire && l === ")") return void (inRequire = false);
      const dep = inRequire ? /^(\S+)\s+v/.exec(l) : /^require\s+(\S+)\s+v/.exec(l);
      if (dep) m.dependencies.push({ path, name: dep[1]!, dev: /\/\/ indirect/.test(l), line: i + 1 });
    });
    return m;
  }
  if (base === "Cargo.toml") {
    const m: Manifest = { path, kind: "cargo", bin: [], scripts: [], dependencies: [] };
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(text);
    if (name) m.name = name[1]!;
    const desc = /^\s*description\s*=\s*"([^"]+)"/m.exec(text);
    if (desc) (m.description = desc[1]!), (m.descriptionLine = lineOf(lines, /^\s*description\s*=/));
    let section = "";
    lines.forEach((raw, i) => {
      const l = raw.trim();
      const sec = /^\[([^\]]+)\]/.exec(l);
      if (sec) return void (section = sec[1]!);
      if (/dependencies$/.test(section)) {
        const d = /^([A-Za-z0-9_-]+)\s*=/.exec(l);
        if (d) m.dependencies.push({ path, name: d[1]!, dev: section.startsWith("dev"), line: i + 1 });
      }
    });
    return m;
  }
  if (base === "pom.xml" || base.startsWith("build.gradle")) {
    const m: Manifest = { path, kind: base === "pom.xml" ? "maven" : "gradle", bin: [], scripts: [], dependencies: [] };
    lines.forEach((raw, i) => {
      const a = /<artifactId>([^<]+)<\/artifactId>/.exec(raw) ?? /(?:implementation|api|testImplementation)\s*\(?\s*["'][^:"']+:([^:"']+)/.exec(raw);
      if (a) m.dependencies.push({ path, name: a[1]!, dev: /test/i.test(raw), line: i + 1 });
    });
    return m;
  }
  return undefined;
}
