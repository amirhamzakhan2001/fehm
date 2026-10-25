import { posix } from "node:path";
import { edgeId, fileId, packageId, pathOfId } from "./ids.js";
import type { EdgeKind, Evidence, FileAnalysis, GraphEdge, GraphNode, PendingReference, UnresolvedReference } from "./model.js";

export interface LinkContext {
  /** All indexed file paths. */
  files: ReadonlySet<string>;
  /** Go modules declared by go.mod files: directory ("." for root) → module path. */
  goModules?: { dir: string; module: string }[];
}

export interface LinkResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolved: UnresolvedReference[];
  /** file → files it was linked to, for incremental invalidation. */
  dependsOn: Map<string, string[]>;
}

/**
 * Resolve heuristic PendingReferences against the whole repository.
 *
 * Confidence ladder for name-based calls (never presented as compiler facts):
 *   same file                         0.80
 *   name imported from a linked file  0.75
 *   defined in a file this file imports 0.65
 *   unique name in the repository     0.50
 *   several candidates                → UnresolvedReference ("ambiguous")
 *   no candidate                      → dropped (builtin / external call)
 *
 * `handles` (route → handler name) uses the same ladder with the edge pointing
 * handler → route. `writes` resolves an exact `Type.field` / variable name.
 * `configures` and `references` resolve repository paths (and Python
 * `module:function` entry points) exactly; missing targets are reported.
 */
export function linkPending(analyses: readonly FileAnalysis[], ctx: LinkContext): LinkResult {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const unresolved: UnresolvedReference[] = [];
  const dependsOn = new Map<string, Set<string>>();

  const byName = new Map<string, GraphNode[]>();
  const byQualified = new Map<string, GraphNode[]>();
  const directories = new Set<string>();
  for (const file of ctx.files) for (let d = posix.dirname(file); d !== "."; d = posix.dirname(d)) directories.add(d);
  for (const analysis of analyses) {
    for (const node of analysis.nodes) {
      if (node.kind === "package" || node.kind === "file") continue;
      byQualified.set(node.name, [...(byQualified.get(node.name) ?? []), node]);
      const simple = node.name.split(".").at(-1)!;
      const list = byName.get(simple);
      if (list) list.push(node);
      else byName.set(simple, [node]);
    }
  }
  const filesByDir = new Map<string, string[]>();
  for (const file of [...ctx.files].sort()) {
    const dir = posix.dirname(file);
    filesByDir.set(dir, [...(filesByDir.get(dir) ?? []), file]);
  }

  const addEdge = (kind: EdgeKind, source: string, target: string, evidence: Evidence): void => {
    if (source === target) return;
    const id = edgeId(kind, source, target);
    const prev = edges.get(id);
    if (!prev || prev.evidence.confidence < evidence.confidence) edges.set(id, { id, kind, source, target, evidence });
    const from = pathOfId(source);
    const to = pathOfId(target);
    if (from && to && from !== to) {
      let set = dependsOn.get(from);
      if (!set) dependsOn.set(from, (set = new Set()));
      set.add(to);
    }
  };
  const addPackage = (name: string, ref: PendingReference): void => {
    const id = packageId(name);
    if (!nodes.has(id)) {
      nodes.set(id, { id, kind: "package", name, evidence: { provenance: "heuristic", confidence: 0.9, location: ref.location, detail: "external module" } });
    }
  };

  /** `configures`/`references`: a repository path, or `pymod:pkg.mod:func` for Python entry points. */
  const linkPath = (ref: PendingReference, analysis: FileAnalysis): void => {
    const kind: EdgeKind = ref.kind === "configures" ? "configures" : "references";
    const evidence = (confidence: number): Evidence => ({
      provenance: ref.provenance ?? "ast",
      confidence: ref.confidence ?? confidence,
      location: ref.location,
      ...(ref.detail ? { detail: ref.detail } : {}),
    });
    if (ref.name.startsWith("pymod:")) {
      const [, mod, fn] = ref.name.split(":");
      const target = mod ? resolveImport("python", analysis.path, mod, ctx, filesByDir).files[0] : undefined;
      const symbol = target && fn ? (byName.get(fn) ?? []).find((n) => n.path === target && (n.kind === "function" || n.kind === "method")) : undefined;
      if (symbol) addEdge(kind, ref.fromNode, symbol.id, evidence(0.9));
      else if (target) addEdge(kind, ref.fromNode, fileId(target), evidence(0.8));
      else unresolved.push({ kind: ref.kind as "configures", fromNode: ref.fromNode, text: ref.name.slice(6), location: ref.location, reason: "entry point module not found in repository" });
      return;
    }
    const base = posix.dirname(analysis.path);
    const clean = decodeURIComponent(ref.name.replace(/[?#].*$/, "")).replace(/^\.\//, "");
    const candidate = posix.normalize(clean.startsWith("/") ? clean.slice(1) : posix.join(base, clean)).replace(/\/$/, "");
    if (ctx.files.has(candidate)) addEdge(kind, ref.fromNode, fileId(candidate), evidence(1));
    else if (directories.has(candidate)) addEdge(kind, ref.fromNode, `directory:${candidate}`, evidence(1));
    else if (candidate === "." || candidate === "") addEdge(kind, ref.fromNode, "repository:.", evidence(1));
    else unresolved.push({ kind: ref.kind as "configures", fromNode: ref.fromNode, text: ref.name, location: ref.location, reason: "path not in the index (missing, ignored or generated)" });
  };

  for (const analysis of [...analyses].sort((a, b) => cmp(a.path, b.path))) {
    const language = analysis.language;
    // Imports first, so calls can use the imported-name tables.
    const importedFiles = new Set<string>();
    const importedNames = new Map<string, Set<string>>(); // name → files it came from
    for (const ref of analysis.pending) {
      if (ref.kind !== "import") continue;
      const targets = resolveImport(language, analysis.path, ref.name, ctx, filesByDir);
      if (targets.files.length > 0) {
        for (const target of targets.files) {
          importedFiles.add(target);
          addEdge("imports", fileId(analysis.path), fileId(target), {
            provenance: "heuristic",
            confidence: targets.confidence,
            location: ref.location,
            detail: `import ${ref.name}`,
          });
          for (const name of ref.names ?? []) importedNames.set(name, new Set([...(importedNames.get(name) ?? []), target]));
        }
        // Java `import a.b.C` binds C; Go import binds its package alias/last segment.
        const bound = language === "go" ? ref.names?.[0] ?? ref.name.split("/").at(-1)! : ref.name.split(".").at(-1)!;
        if (language === "java" || language === "go") importedNames.set(bound, new Set([...(importedNames.get(bound) ?? []), ...targets.files]));
      } else if (targets.external) {
        addPackage(targets.external, ref);
        addEdge("imports", fileId(analysis.path), packageId(targets.external), {
          provenance: "heuristic",
          confidence: targets.confidence,
          location: ref.location,
          detail: `${ref.name} not found in repository; treated as external`,
        });
      } else {
        unresolved.push({ kind: "import", fromNode: ref.fromNode, text: ref.name, location: ref.location, reason: "module not found in repository" });
      }
    }

    for (const ref of analysis.pending) {
      if (ref.kind === "import") continue;
      if (ref.kind === "configures" || ref.kind === "references") {
        linkPath(ref, analysis);
        continue;
      }
      if (ref.kind === "writes") {
        const candidates = (byQualified.get(ref.name) ?? []).filter((n) => n.language === language && (n.kind === "field" || n.kind === "variable"));
        const local = candidates.filter((n) => n.path === analysis.path);
        const pick = local.length === 1 ? { node: local[0]!, confidence: 0.8 } : candidates.length === 1 ? { node: candidates[0]!, confidence: 0.6 } : undefined;
        if (pick) {
          addEdge("writes", ref.fromNode, pick.node.id, { provenance: "heuristic", confidence: pick.confidence, location: ref.location, ...(ref.detail ? { detail: ref.detail } : {}) });
        } else if (candidates.length > 1) {
          unresolved.push({ kind: "writes", fromNode: ref.fromNode, text: ref.name, location: ref.location, reason: `ambiguous: ${candidates.length} candidates` });
        }
        continue;
      }
      const wanted = ref.kind === "call" || ref.kind === "handles" ? (ref.kind === "handles" ? HANDLERS : CALLABLE) : TYPE_LIKE;
      const candidates = (byName.get(ref.name) ?? []).filter((n) => n.language === language && wanted.has(n.kind) && n.id !== ref.fromNode);
      if (candidates.length === 0) {
        if (ref.kind !== "call") unresolved.push({ kind: ref.kind, fromNode: ref.fromNode, text: ref.name, location: ref.location, reason: "no declaration found in repository" });
        continue;
      }
      const kind: EdgeKind = ref.kind === "call" ? "calls" : ref.kind;
      const pick = choose(candidates, analysis.path, ref, importedFiles, importedNames);
      if (pick) {
        const confidence = ref.member && pick.rule !== "same file" ? pick.confidence - 0.1 : pick.confidence;
        const [source, target] = kind === "handles" ? [pick.node.id, ref.fromNode] : [ref.fromNode, pick.node.id];
        addEdge(kind, source, target, {
          provenance: "heuristic",
          confidence: Math.round(confidence * 100) / 100,
          location: ref.location,
          detail: ref.detail ?? `${pick.rule} match for ${ref.receiver ? `${ref.receiver}.` : ""}${ref.name}`,
        });
      } else if (!ref.member) {
        unresolved.push({
          kind: ref.kind,
          fromNode: ref.fromNode,
          text: ref.name,
          location: ref.location,
          reason: `ambiguous: ${candidates.length} candidates (${candidates.slice(0, 3).map((c) => c.id).join(", ")}${candidates.length > 3 ? ", …" : ""})`,
        });
      }
    }
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => cmp(a.id, b.id)),
    edges: [...edges.values()].sort((a, b) => cmp(a.id, b.id)),
    unresolved,
    dependsOn: new Map([...dependsOn].map(([k, v]) => [k, [...v].sort()])),
  };
}

const CALLABLE = new Set(["function", "method", "class"]);
const TYPE_LIKE = new Set(["class", "interface", "type", "enum"]);
const HANDLERS = new Set(["function", "method"]);

function choose(
  candidates: GraphNode[],
  path: string,
  ref: PendingReference,
  importedFiles: ReadonlySet<string>,
  importedNames: ReadonlyMap<string, ReadonlySet<string>>,
): { node: GraphNode; confidence: number; rule: string } | undefined {
  const unique = (list: GraphNode[]): GraphNode | undefined => (list.length === 1 ? list[0] : undefined);
  const sameFile = unique(candidates.filter((c) => c.path === path));
  if (sameFile && (!ref.member || ref.receiver === "self" || ref.receiver === "this" || ref.receiver === "Self")) {
    return { node: sameFile, confidence: 0.8, rule: "same file" };
  }
  const fromNames = importedNames.get(ref.member ? ref.receiver ?? "" : ref.name) ?? importedNames.get(ref.name);
  if (fromNames) {
    const hit = unique(candidates.filter((c) => c.path && fromNames.has(c.path)));
    if (hit) return { node: hit, confidence: 0.75, rule: "imported name" };
  }
  const imported = unique(candidates.filter((c) => c.path && importedFiles.has(c.path)));
  if (imported) return { node: imported, confidence: 0.65, rule: "imported file" };
  if (sameFile) return { node: sameFile, confidence: 0.7, rule: "same file" };
  if (!ref.member && candidates.length === 1) return { node: candidates[0]!, confidence: 0.5, rule: "unique name" };
  return undefined;
}

function resolveImport(
  language: string,
  from: string,
  spec: string,
  ctx: LinkContext,
  filesByDir: ReadonlyMap<string, string[]>,
): { files: string[]; external?: string; confidence: number } {
  const has = (p: string): boolean => ctx.files.has(p);
  const dir = posix.dirname(from);
  if (language === "python") {
    const dots = /^\.*/.exec(spec)![0].length;
    const rest = spec.slice(dots).split(".").filter(Boolean).join("/");
    const bases = dots > 0 ? [posix.join(dir, ...Array<string>(dots - 1).fill(".."))] : [".", "src", dir];
    for (const base of bases) {
      for (const cand of [`${rest}.py`, `${rest}/__init__.py`]) {
        const p = posix.normalize(posix.join(base, cand));
        if (rest && has(p)) return { files: [p], confidence: 0.85 };
      }
      if (!rest && dots > 0 && has(posix.join(base, "__init__.py"))) return { files: [posix.join(base, "__init__.py")], confidence: 0.85 };
    }
    return dots > 0 ? { files: [], confidence: 0 } : { files: [], external: spec.split(".")[0]!, confidence: 0.6 };
  }
  if (language === "go") {
    const mod = (ctx.goModules ?? []).find((m) => spec === m.module || spec.startsWith(`${m.module}/`));
    if (mod) {
      const sub = spec === mod.module ? "" : spec.slice(mod.module.length + 1);
      const rel = posix.normalize(posix.join(mod.dir, sub || "."));
      const files = (filesByDir.get(rel) ?? []).filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"));
      return files.length ? { files, confidence: 0.85 } : { files: [], confidence: 0 };
    }
    return { files: [], external: spec, confidence: 0.9 };
  }
  if (language === "rust") {
    if (spec.startsWith("mod:")) {
      const name = spec.slice(4);
      const moduleDir = /(^|\/)(main|lib|mod)\.rs$/.test(from) ? dir : posix.join(dir, posix.basename(from, ".rs"));
      for (const cand of [`${moduleDir}/${name}.rs`, `${moduleDir}/${name}/mod.rs`]) if (has(posix.normalize(cand))) return { files: [posix.normalize(cand)], confidence: 0.9 };
      return { files: [], confidence: 0 };
    }
    const parts = spec.split("::");
    const head = parts[0]!;
    if (head !== "crate" && head !== "self" && head !== "super") return { files: [], external: head, confidence: 0.9 };
    const crateRoot = from.includes("src/") ? from.slice(0, from.indexOf("src/") + 3) : ".";
    const base = head === "crate" ? crateRoot : head === "self" ? dir : posix.dirname(dir);
    const segs = parts.slice(1);
    for (let k = segs.length; k > 0; k -= 1) {
      const sub = segs.slice(0, k).join("/");
      for (const cand of [`${base}/${sub}.rs`, `${base}/${sub}/mod.rs`]) {
        const p = posix.normalize(cand);
        if (has(p)) return { files: [p], confidence: 0.7 };
      }
    }
    return { files: [], confidence: 0 };
  }
  if (language === "java") {
    if (spec.endsWith(".*")) {
      const suffix = spec.slice(0, -2).replace(/\./g, "/");
      const files = [...filesByDir.entries()].filter(([d]) => d === suffix || d.endsWith(`/${suffix}`)).flatMap(([, f]) => f.filter((x) => x.endsWith(".java")));
      return files.length ? { files, confidence: 0.8 } : { files: [], external: spec.slice(0, -2), confidence: 0.9 };
    }
    const suffix = `${spec.replace(/\./g, "/")}.java`;
    const files = [...ctx.files].filter((f) => f === suffix || f.endsWith(`/${suffix}`)).sort();
    if (files.length === 1) return { files, confidence: 0.9 };
    if (files.length > 1) return { files: [], confidence: 0 }; // ambiguous: several source roots define it
    return { files: [], external: spec.split(".").slice(0, -1).join(".") || spec, confidence: 0.9 };
  }
  return { files: [], confidence: 0 };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
