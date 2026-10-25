import { posix } from "node:path";
import { edgeId, fileId, packageId } from "./ids.js";
import { ANALYSIS_VERSION, type FileAnalysis, type GraphEdge, type GraphNode, type PendingReference, type ScannedFile } from "./model.js";

/**
 * Manifests and config files → `configures` edges.
 *
 *   declared dependency            manifest configures package:<name>   (ast, 1.0 — parsed manifest)
 *   entry point (main/bin/exports,
 *   [[bin]] path, [project.scripts]) manifest configures file / function (ast, resolved by the linker)
 *   file named in a script/CMD/CI  config configures file               (heuristic, 0.8 — token match)
 *
 * Targets that are not in the index (build output, missing files) are
 * reported as unresolved by the linker, never invented.
 */
export function analyzeConfigFile(file: ScannedFile, text: string): FileAnalysis {
  const analysis: FileAnalysis = {
    path: file.path,
    hash: file.hash,
    analysisVersion: ANALYSIS_VERSION,
    language: file.language,
    resolution: "ast",
    nodes: [],
    edges: [],
    unresolved: [],
    pending: [],
    dependsOn: [],
    diagnostics: [],
  };
  const fid = fileId(file.path);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const lineOf = (needle: string): number => {
    const idx = text.indexOf(needle);
    return idx < 0 ? 1 : text.slice(0, idx).split("\n").length;
  };
  const dependency = (name: string, detail: string): void => {
    const clean = name.trim();
    if (!/^[@\w][\w@./-]*$/.test(clean)) return;
    const id = packageId(clean);
    const location = { path: file.path, line: lineOf(clean) };
    if (!nodes.has(id)) nodes.set(id, { id, kind: "package", name: clean, evidence: { provenance: "ast", confidence: 1, location, detail: "declared dependency" } });
    const eid = edgeId("configures", fid, id);
    edges.set(eid, { id: eid, kind: "configures", source: fid, target: id, evidence: { provenance: "ast", confidence: 1, location, detail } });
  };
  const target = (path: string, detail: string, heuristic = false): void => {
    const ref: PendingReference = {
      kind: "configures",
      fromNode: fid,
      name: path,
      location: { path: file.path, line: lineOf(path) },
      provenance: heuristic ? "heuristic" : "ast",
      detail,
    };
    if (heuristic) ref.confidence = 0.8;
    if (!analysis.pending.some((p) => p.name === path)) analysis.pending.push(ref);
  };
  /** File-looking tokens in a command line (scripts, CMD, CI `run:`). */
  const commandFiles = (command: string, detail: string): void => {
    for (const m of command.matchAll(/(?:^|[\s"'=(])(\.{0,2}\/?[\w@./-]+\.(?:[cm]?[jt]sx?|py|go|rs|java|sh|rb))(?=$|[\s"',)])/g)) {
      target(m[1]!, detail, true);
    }
  };

  const name = posix.basename(file.path);
  try {
    if (name === "package.json") {
      const pkg = JSON.parse(text) as Record<string, unknown>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const deps = pkg[field];
        if (deps && typeof deps === "object") for (const [dep, version] of Object.entries(deps)) dependency(dep, `${field}: ${String(version)}`);
      }
      for (const field of ["main", "module", "types", "typings", "browser"]) {
        if (typeof pkg[field] === "string") target(pkg[field] as string, `package.json "${field}"`);
      }
      const bin = pkg.bin;
      if (typeof bin === "string") target(bin, 'package.json "bin"');
      else if (bin && typeof bin === "object") for (const [cmd, p] of Object.entries(bin)) if (typeof p === "string") target(p, `bin "${cmd}"`);
      const walkExports = (v: unknown): void => {
        if (typeof v === "string") target(v, 'package.json "exports"');
        else if (v && typeof v === "object") for (const x of Object.values(v)) walkExports(x);
      };
      walkExports(pkg.exports);
      const scripts = pkg.scripts;
      if (scripts && typeof scripts === "object") for (const [script, cmd] of Object.entries(scripts)) if (typeof cmd === "string") commandFiles(cmd, `script "${script}"`);
    } else if (name === "requirements.txt" || /^requirements[-.\w]*\.txt$/.test(name)) {
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Za-z0-9][\w.-]*)/.exec(line.replace(/#.*/, ""));
        if (m && !line.trim().startsWith("-")) dependency(m[1]!, "requirements");
      }
    } else if (name === "pyproject.toml") {
      let section = "";
      let inDeps = false;
      for (const line of text.split(/\r?\n/)) {
        const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
        if (header) {
          section = header[1]!.trim();
          inDeps = false;
          continue;
        }
        if (/^\s*dependencies\s*=\s*\[/.test(line) && section === "project") inDeps = true;
        if (inDeps) {
          for (const m of line.matchAll(/["']([A-Za-z0-9][\w.-]*)/g)) dependency(m[1]!, "project.dependencies");
          if (line.includes("]")) inDeps = false;
          continue;
        }
        if (section === "tool.poetry.dependencies" || section === "tool.poetry.dev-dependencies" || /^tool\.poetry\.group\.[\w-]+\.dependencies$/.test(section)) {
          const m = /^\s*([A-Za-z0-9][\w.-]*)\s*=/.exec(line);
          if (m && m[1] !== "python") dependency(m[1]!, section);
        }
        if (section === "project.scripts" || section === "tool.poetry.scripts") {
          const m = /^\s*([\w.-]+)\s*=\s*["']([\w.]+):([\w.]+)["']/.exec(line);
          if (m) target(`pymod:${m[2]}:${m[3]!.split(".").at(-1)}`, `script "${m[1]}"`);
        }
      }
    } else if (name === "go.mod") {
      let block = false;
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*require\s*\($/.test(line)) block = true;
        else if (block && /^\s*\)/.test(line)) block = false;
        const m = block ? /^\s*([\w.\-/]+)\s+v/.exec(line) : /^\s*require\s+([\w.\-/]+)\s+v/.exec(line);
        if (m) dependency(m[1]!, "go.mod require");
      }
    } else if (name === "Cargo.toml") {
      let section = "";
      for (const line of text.split(/\r?\n/)) {
        const header = /^\s*\[\[?([^\]]+)\]\]?\s*$/.exec(line);
        if (header) {
          section = header[1]!.trim();
          continue;
        }
        if (/^(dev-|build-)?dependencies$/.test(section)) {
          const m = /^\s*([A-Za-z0-9][\w-]*)\s*=/.exec(line);
          if (m) dependency(m[1]!, `Cargo ${section}`);
        }
        if (section === "bin" || section === "lib") {
          const m = /^\s*path\s*=\s*"([^"]+)"/.exec(line);
          if (m) target(m[1]!, `Cargo [${section}] path`);
        }
      }
    } else if (/^Dockerfile(\..*)?$/.test(name)) {
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*(CMD|ENTRYPOINT|RUN)\s+(.+)$/i.exec(line);
        if (m) commandFiles(m[2]!, `Dockerfile ${m[1]!.toUpperCase()}`);
      }
    } else if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file.path)) {
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*-?\s*run:\s*(.+)$/.exec(line);
        if (m) commandFiles(m[1]!, "CI run step");
      }
    }
  } catch (error) {
    analysis.diagnostics.push(`could not parse ${name}: ${(error as Error).message}`);
  }
  analysis.nodes = [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  analysis.edges = [...edges.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return analysis;
}

/** Files the config analyzer understands. */
export function isConfigAnalyzable(path: string): boolean {
  const name = posix.basename(path);
  return (
    name === "package.json" ||
    name === "pyproject.toml" ||
    name === "go.mod" ||
    name === "Cargo.toml" ||
    /^requirements[-.\w]*\.txt$/.test(name) ||
    /^Dockerfile(\..*)?$/.test(name) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)
  );
}
