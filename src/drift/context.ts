import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { BriefingFacts } from "../codebase-briefing/facts.js";
import { EXCLUDED_DIRECTORIES } from "../scanner.js";
import type { ContextItem, ProjectContext, ProjectType } from "./types.js";

/**
 * Context before judgment (spec §3.1): language, frameworks, project type,
 * architecture signals, scale and workspaces, each with its evidence. The
 * project type decides which industry practices apply at all: an ML research
 * repository is not measured against a layered web backend.
 */

const MAX_INVENTORY = 20000;

/**
 * Every file in the repository, not only indexed code: file-placement drift
 * needs assets and styles too. `git ls-files` when available (respects
 * .gitignore), else a bounded walk that skips build and dependency folders.
 */
export function inventory(root: string): string[] {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard"], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28, timeout: 30_000 }).toString();
    const files = out.split("\n").filter(Boolean);
    if (files.length) return files.slice(0, MAX_INVENTORY);
  } catch {
    // not a git work tree: walk
  }
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (files.length >= MAX_INVENTORY) return;
    let entries;
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(e.name) && !e.name.startsWith(".")) walk(rel);
      } else if (e.isFile()) files.push(rel);
    }
  };
  walk("");
  return files;
}

const FRAMEWORKS: { id: string; label: string; kind: ProjectContext["frameworks"][number]["kind"]; packages?: string[]; files?: RegExp; imports?: RegExp }[] = [
  { id: "express", label: "Express", kind: "backend", packages: ["express"] },
  { id: "fastify", label: "Fastify", kind: "backend", packages: ["fastify"] },
  { id: "koa", label: "Koa", kind: "backend", packages: ["koa"] },
  { id: "hono", label: "Hono", kind: "backend", packages: ["hono"] },
  { id: "nestjs", label: "NestJS", kind: "backend", packages: ["@nestjs/core", "@nestjs/common"] },
  { id: "nextjs", label: "Next.js", kind: "fullstack", packages: ["next"] },
  { id: "react", label: "React", kind: "frontend", packages: ["react"] },
  { id: "vue", label: "Vue", kind: "frontend", packages: ["vue"] },
  { id: "angular", label: "Angular", kind: "frontend", packages: ["@angular/core"] },
  { id: "svelte", label: "Svelte", kind: "frontend", packages: ["svelte"] },
  { id: "django", label: "Django", kind: "backend", packages: ["django"], files: /(^|\/)manage\.py$/ },
  { id: "flask", label: "Flask", kind: "backend", packages: ["flask"] },
  { id: "fastapi", label: "FastAPI", kind: "backend", packages: ["fastapi"] },
  { id: "spring", label: "Spring", kind: "backend", imports: /org\.springframework/ },
  { id: "rails", label: "Rails", kind: "backend", files: /(^|\/)(Gemfile|config\/routes\.rb)$/ },
  { id: "laravel", label: "Laravel", kind: "backend", files: /(^|\/)(artisan|composer\.json)$/ },
  { id: "dotnet", label: ".NET", kind: "backend", files: /\.(csproj|sln)$/ },
  { id: "gin", label: "Gin", kind: "backend", packages: ["github.com/gin-gonic/gin"] },
  { id: "pytorch", label: "PyTorch", kind: "ml", packages: ["torch"] },
  { id: "tensorflow", label: "TensorFlow", kind: "ml", packages: ["tensorflow"] },
  { id: "sklearn", label: "scikit-learn", kind: "ml", packages: ["sklearn", "scikit-learn"] },
  { id: "airflow", label: "Airflow", kind: "data", packages: ["airflow"] },
  { id: "dagster", label: "Dagster", kind: "data", packages: ["dagster"] },
  { id: "prefect", label: "Prefect", kind: "data", packages: ["prefect"] },
  { id: "react-native", label: "React Native", kind: "mobile", packages: ["react-native"] },
  { id: "flutter", label: "Flutter", kind: "mobile", files: /(^|\/)pubspec\.yaml$/ },
];

const LANGUAGE_OF: Record<string, string> = { ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".swift": "Swift", ".dart": "Dart" };

export function detectContext(root: string, facts: BriefingFacts, files: string[]): ProjectContext {
  const unknowns: string[] = [];
  const source = facts.sourceFiles;

  // Languages: indexed source files (they respect .fehmignore; the raw inventory may hold vendored snapshots).
  const langCount = new Map<string, number>();
  for (const f of source) {
    const l = LANGUAGE_OF[posix.extname(f).toLowerCase()];
    if (l && !/(^|\/)(test|tests|__tests__)\//.test(f)) langCount.set(l, (langCount.get(l) ?? 0) + 1);
  }
  const langTotal = [...langCount.values()].reduce((s, n) => s + n, 0) || 1;
  const languages = [...langCount].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, files: n, share: Math.round((n / langTotal) * 100) / 100 }));

  // Frameworks: imported packages (runtime importers), marker files, or import text.
  const imported = new Map(facts.packages.filter((p) => facts.runtimeImporters(p).length).map((p) => [p.name, facts.runtimeImporters(p)]));
  const frameworks: ProjectContext["frameworks"] = [];
  for (const fw of FRAMEWORKS) {
    const evidence: string[] = [];
    for (const p of fw.packages ?? []) {
      const importers = imported.get(p);
      if (importers?.length) evidence.push(`imports ${p} (${importers.slice(0, 2).join(", ")}${importers.length > 2 ? ` +${importers.length - 2}` : ""})`);
    }
    if (fw.files) for (const f of files.filter((x) => fw.files!.test(x)).slice(0, 2)) evidence.push(`${f} present`);
    if (fw.imports) {
      const hit = source.find((f) => facts.lines(f).slice(0, 60).some((l) => fw.imports!.test(l)));
      if (hit) evidence.push(`${hit} imports ${fw.imports.source.replace(/\\/g, "")}`);
    }
    if (evidence.length) frameworks.push({ id: fw.id, label: fw.label, kind: fw.kind, evidence });
  }

  // Workspaces (monorepo).
  const workspaces = detectWorkspaces(root, files);

  // Project types, scored by independent signals.
  const s = facts.signals;
  const has = (re: RegExp): string[] => files.filter((f) => re.test(f)).slice(0, 3);
  const types: (ContextItem & { type: ProjectType; score: number })[] = [];
  const add = (type: ProjectType, label: string, score: number, evidence: string[]): void => {
    if (score > 0 && evidence.length) types.push({ id: type, type, label, score, evidence });
  };
  const fwKinds = new Set(frameworks.map((f) => f.kind));
  const uiFiles = source.filter((f) => /\.(tsx|jsx|vue|svelte)$/.test(f));
  add("monorepo", "Monorepo", workspaces.length >= 2 ? 5 : 0, workspaces.length >= 2 ? [`${workspaces.length} workspace packages: ${workspaces.slice(0, 4).map((w) => w.path).join(", ")}`] : []);
  add("backend-service", "Backend service", (fwKinds.has("backend") ? 3 : 0) + (s.routes.length ? 2 : 0) + (s.tables.size ? 1 : 0), [...frameworks.filter((f) => f.kind === "backend").map((f) => `${f.label} detected`), ...(s.routes.length ? [`${s.routes.length} HTTP routes registered`] : []), ...(s.tables.size ? [`SQL against ${s.tables.size} tables`] : [])]);
  add("web-application", "Web application", (fwKinds.has("frontend") || fwKinds.has("fullstack") ? 3 : 0) + (uiFiles.length >= 3 ? 1 : 0), [...frameworks.filter((f) => f.kind === "frontend" || f.kind === "fullstack").map((f) => `${f.label} detected`), ...(uiFiles.length ? [`${uiFiles.length} UI component files`] : [])]);
  const docker = has(/(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/);
  add("microservice", "Microservice", types.some((t) => t.type === "backend-service") && docker.length && workspaces.length < 2 ? 1 : 0, docker.map((d) => `${d} present`));
  add("cli", "Command-line tool", (facts.binTargets.length ? 3 : 0) + (s.cli.length ? 2 : 0), [...facts.binTargets.map((b) => `bin target ${b}`), ...(s.cli.length ? [`${s.cli.length} CLI commands dispatched`] : [])]);
  const manifest = facts.primaryManifest;
  add("library", "Library", manifest?.main && !s.routes.length && !facts.binTargets.length ? 2 : 0, manifest?.main ? [`${manifest.path} declares main ${manifest.main}`] : []);
  const notebooks = has(/\.ipynb$/);
  add("ml-project", "ML project", (fwKinds.has("ml") ? 3 : 0) + (notebooks.length ? 1 : 0), [...frameworks.filter((f) => f.kind === "ml").map((f) => `${f.label} detected`), ...notebooks.map((n) => `${n} notebook`)]);
  add("research", "Research project", notebooks.length >= 3 && !manifest ? 3 : 0, notebooks.length >= 3 ? [`${files.filter((f) => f.endsWith(".ipynb")).length} notebooks, no package manifest`] : []);
  add("data-pipeline", "Data pipeline", fwKinds.has("data") ? 4 : has(/(^|\/)dbt_project\.yml$/).length ? 4 : 0, [...frameworks.filter((f) => f.kind === "data").map((f) => `${f.label} detected`), ...has(/(^|\/)dbt_project\.yml$/)]);
  add("mobile", "Mobile application", fwKinds.has("mobile") || has(/AndroidManifest\.xml$|Info\.plist$/).length ? 4 : 0, [...frameworks.filter((f) => f.kind === "mobile").map((f) => `${f.label} detected`), ...has(/AndroidManifest\.xml$|Info\.plist$/)]);
  add("game", "Game", has(/(^|\/)(project\.godot|ProjectSettings\/ProjectVersion\.txt)$/).length || imported.has("phaser") || imported.has("pygame") ? 4 : 0, [...has(/(^|\/)(project\.godot|ProjectSettings\/ProjectVersion\.txt)$/), ...(imported.has("phaser") ? ["imports phaser"] : []), ...(imported.has("pygame") ? ["imports pygame"] : [])]);
  const tf = files.filter((f) => /\.(tf|tfvars)$/.test(f) || /(^|\/)(Chart\.yaml|Pulumi\.ya?ml)$/.test(f));
  add("infrastructure", "Infrastructure project", tf.length && tf.length >= source.length / 2 ? 4 : 0, tf.slice(0, 3).map((f) => `${f}`));
  types.sort((a, b) => b.score - a.score || (a.type < b.type ? -1 : 1));
  if (!types.length) unknowns.push("The project type could not be determined; only project-mined patterns and generic practices apply.");
  // A monorepo is a shape; the practices come from what its packages are.
  const primary = (types.find((t) => t.type !== "monorepo") ?? types[0])?.type ?? "library";

  // Architecture signals from role-bearing names and directories.
  const dirNames = new Map<string, number>();
  for (const f of source) for (const seg of posix.dirname(f).split("/")) dirNames.set(seg.toLowerCase(), (dirNames.get(seg.toLowerCase()) ?? 0) + 1);
  const hasDir = (...names: string[]): string[] => names.filter((n) => dirNames.has(n));
  const nameHits = (re: RegExp): string[] => source.filter((f) => re.test(posix.basename(f))).slice(0, 3);
  const arch: ContextItem[] = [];
  const layered = [...hasDir("controllers", "controller", "handlers", "routes"), ...hasDir("services", "service"), ...hasDir("repositories", "repository", "repos", "dao")];
  const layeredNames = [...nameHits(/controller/i), ...nameHits(/service/i), ...nameHits(/repositor/i)];
  if (layered.length >= 2 || layeredNames.length >= 4) arch.push({ id: "layered", label: "Layered (controller / service / repository)", evidence: [...layered.map((d) => `${d}/ directories`), ...layeredNames.slice(0, 3)] });
  const mvc = hasDir("models", "views", "controllers");
  if (mvc.length === 3) arch.push({ id: "mvc", label: "MVC", evidence: mvc.map((d) => `${d}/`) });
  const hex = hasDir("ports", "adapters", "domain");
  if (hex.length >= 2) arch.push({ id: "hexagonal", label: "Hexagonal (ports and adapters)", evidence: hex.map((d) => `${d}/`) });
  const clean = hasDir("domain", "usecases", "use-cases", "application", "infrastructure");
  if (clean.length >= 3) arch.push({ id: "clean", label: "Clean architecture", evidence: clean.map((d) => `${d}/`) });
  if (uiFiles.length >= 3 || hasDir("components").length) arch.push({ id: "component-based", label: "Component-based UI", evidence: [...hasDir("components").map((d) => `${d}/`), ...(uiFiles.length ? [`${uiFiles.length} component files`] : [])] });
  const queues = facts.packages.filter((p) => p.info?.category === "queue" && facts.runtimeImporters(p).length);
  if (queues.length) arch.push({ id: "event-driven", label: "Event / message driven parts", evidence: queues.map((q) => `imports ${q.name}`) });
  if (!arch.length) {
    const tops = [...new Set(source.map((f) => f.split("/").slice(0, 2).join("/")))];
    arch.push({ id: "modular", label: "Modular (organised by directory)", evidence: [`${tops.length} top-level source areas`] });
  }

  const lines = source.reduce((sum, f) => sum + facts.lines(f).filter((l) => l.trim()).length, 0);
  const label = source.length > 800 || lines > 150_000 ? "large" : source.length > 120 || lines > 20_000 ? "medium" : "small";
  unknowns.push("The business domain is not inferred.");
  return { languages, frameworks, projectTypes: types, primaryType: primary, architectureSignals: arch, scale: { files: files.length, sourceFiles: source.length, lines, label }, workspaces, unknowns };
}

function detectWorkspaces(root: string, files: string[]): ProjectContext["workspaces"] {
  const globs: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { workspaces?: string[] | { packages?: string[] } };
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    if (ws) globs.push(...ws);
  } catch {
    // no package.json
  }
  const pnpm = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpm)) for (const m of readFileSync(pnpm, "utf8").matchAll(/^\s*-\s*["']?([^"'\n]+)["']?\s*$/gm)) globs.push(m[1]!.trim());
  // Conventional layout without declarations: apps/*, packages/*, services/*, libs/* each with a manifest.
  const manifests = files.filter((f) => /(^|\/)(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml)$/.test(f) && f.includes("/"));
  const dirs = new Set<string>();
  for (const m of manifests) {
    const dir = posix.dirname(m);
    const inGlob = globs.some((g) => new RegExp(`^${g.replace(/\/\*\*?$/, "/[^/]+").replace(/\./g, "\\.").replace(/\*/g, "[^/]*")}$`).test(dir));
    if (inGlob || /^(apps|packages|services|libs|modules)\/[^/]+$/.test(dir)) dirs.add(dir);
  }
  return [...dirs].sort().map((path) => {
    const top = path.split("/")[0]!;
    return { name: posix.basename(path), path, kind: top === "apps" ? "app" : top === "packages" || top === "libs" ? "package" : top === "services" ? "service" : "other" };
  });
}
