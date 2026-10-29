import { directoryId, edgeId, fileId, firstSentence, repositoryId, symbolId } from "./ids.js";
import {
  ANALYSIS_VERSION,
  type EdgeKind,
  type FileAnalysis,
  type GraphEdge,
  type GraphNode,
  type Language,
  type NodeKind,
  type PendingReference,
  type ScannedFile,
} from "./model.js";

/**
 * Deterministic pattern-based extraction for Python, Go, Rust and Java.
 *
 * Declarations are extracted per file (provenance `heuristic`, confidence 0.9).
 * Calls, imports and inheritance are recorded as PendingReferences and
 * resolved later against the whole repository by the linker, which assigns
 * weaker confidences and reports ambiguity instead of guessing.
 *
 * Also extracted: fields (`self.x = …`, struct/class members), modules (Go/Java
 * package clauses, Rust `mod`), enums, HTTP routes (framework decorators and
 * registration calls) with `handles` edges, and `writes` through
 * `self`/`this`/the receiver or Python `global` names.
 *
 * Known limits: no type inference; nested functions fold into their enclosing
 * symbol; Go `type ( … )` groups, Python decorators-as-calls and macro-generated
 * Rust items are not modelled.
 */
export const HEURISTIC_LANGUAGES = new Set<Language>(["python", "go", "rust", "java"]);

const DECL_CONFIDENCE = 0.9;
const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "new", "sizeof", "typeof", "match", "loop", "fn", "func",
  "def", "class", "print", "super", "this", "self", "elif", "else", "in", "not", "and", "or", "with", "assert",
  "lambda", "yield", "await", "async", "try", "except", "raise", "del", "pass", "import", "from", "throw",
  "synchronized", "instanceof", "go", "defer", "select", "case", "range", "make", "len", "cap", "append",
  "some", "ok", "err", "vec", "panic", "unwrap", "expect", "clone", "into", "as", "where", "impl", "mut",
]);

interface Block {
  node: GraphNode;
  start: number; // 0-based line
  end: number; // inclusive 0-based line
  indent: number;
  /** Structural parent edge when it is not "file defines" / "class defines method". */
  parent?: { kind: EdgeKind; id: string };
}

/** Same-file relationships an extractor can establish directly. */
interface DirectEdge {
  kind: EdgeKind;
  source: string;
  target: string;
  confidence: number;
  line: number;
  detail?: string;
}

interface Out {
  pending: PendingReference[];
  edges: DirectEdge[];
}

/** Kinds that never own call sites (a call on `self.x = f()` belongs to the method). */
const NON_OWNER_KINDS = new Set<NodeKind>(["variable", "field", "route", "module"]);

export function analyzeHeuristicFile(file: ScannedFile, text: string): FileAnalysis {
  const analysis: FileAnalysis = {
    path: file.path,
    hash: file.hash,
    analysisVersion: ANALYSIS_VERSION,
    language: file.language,
    resolution: "heuristic",
    nodes: [],
    edges: [],
    unresolved: [],
    pending: [],
    dependsOn: [],
    diagnostics: [],
  };
  const raw = text.split(/\r?\n/);
  const code = stripCommentsAndStrings(text, file.language).split(/\r?\n/);
  const extractor = EXTRACTORS[file.language];
  if (!extractor) {
    analysis.resolution = "none";
    analysis.diagnostics.push(`no extractor for ${file.language}`);
    return analysis;
  }
  const out: Out = { pending: analysis.pending, edges: [] };
  const blocks = extractor(file, raw, code, out);

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const fid = fileId(file.path);
  const addEdge = (kind: EdgeKind, source: string, target: string, confidence: number, line: number, detail?: string): void => {
    if (source === target) return;
    const id = edgeId(kind, source, target);
    const prev = edges.get(id);
    if (prev && prev.evidence.confidence >= confidence) return;
    const evidence = { provenance: "heuristic" as const, confidence, location: { path: file.path, line }, ...(detail ? { detail } : {}) };
    edges.set(id, { id, kind, source, target, evidence });
  };
  for (const block of blocks) {
    if (nodes.has(block.node.id)) continue;
    nodes.set(block.node.id, block.node);
    const member = block.node.kind === "method" || block.node.kind === "field";
    const parent = block.parent ?? { kind: "defines" as const, id: member ? parentClassId(block, blocks) ?? fid : fid };
    addEdge(parent.kind, parent.id, block.node.id, block.node.evidence.confidence, block.start + 1);
  }
  for (const e of out.edges) if (nodes.has(e.target) || e.target.startsWith("file:")) addEdge(e.kind, e.source, e.target, e.confidence, e.line, e.detail);

  // Calls: attribute each call site to the innermost enclosing block. On a
  // declaration line the declared name itself is not a call.
  const declaredOn = new Map<number, Set<string>>();
  for (const block of blocks) {
    const set = declaredOn.get(block.start) ?? new Set<string>();
    set.add(block.node.name.split(".").at(-1)!);
    declaredOn.set(block.start, set);
  }
  const seen = new Set<string>();
  for (let i = 0; i < code.length; i += 1) {
    const line = code[i]!;
    const declared = new Set(declaredOn.get(i) ?? []);
    const owner = innermost(blocks, i)?.node.id ?? fid;
    for (const match of line.matchAll(/(?:([A-Za-z_][\w]*)\s*(?:\.|::)\s*)?([A-Za-z_]\w*)\s*(?:!\s*)?\(/g)) {
      const name = match[2]!;
      const receiver = match[1];
      if (KEYWORDS.has(name) && !receiver) continue;
      const before = line.slice(0, match.index);
      if (!receiver && /[.\w]$/.test(before)) continue;
      if (/\b(fn|def|func|class|struct|enum|trait|interface|record|impl|type)\s+$/.test(before)) continue;
      if (!receiver && declared.delete(name)) continue;
      const key = `${owner}|${receiver ?? ""}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      analysis.pending.push({
        kind: "call",
        fromNode: owner,
        name,
        ...(receiver ? { member: true, receiver } : {}),
        location: { path: file.path, line: i + 1, column: (match.index ?? 0) + 1 },
      });
    }
  }

  analysis.nodes = [...nodes.values()].sort((a, b) => cmp(a.id, b.id));
  analysis.edges = [...edges.values()].sort((a, b) => cmp(a.id, b.id));
  analysis.pending.sort((a, b) => a.location.line - b.location.line || cmp(a.fromNode, b.fromNode) || cmp(a.name, b.name));
  return analysis;
}

type Extractor = (file: ScannedFile, raw: string[], code: string[], out: Out) => Block[];

const EXTRACTORS: Partial<Record<Language, Extractor>> = {
  python: extractPython,
  go: extractGo,
  rust: extractRust,
  java: extractJava,
};

function makeNode(
  file: ScannedFile,
  kind: NodeKind,
  name: string,
  line: number,
  endLine: number,
  signature: string,
  exported: boolean,
  doc?: string,
): GraphNode {
  const location = { path: file.path, line: line + 1, endLine: endLine + 1 };
  const node: GraphNode = {
    id: symbolId(kind, file.path, name),
    kind,
    name,
    path: file.path,
    language: file.language,
    location,
    signature: signature.trim().replace(/\s+/g, " ").replace(/[:{]\s*$/, "").trim().slice(0, 200),
    exported,
    isTest: file.isTest,
    evidence: { provenance: "heuristic", confidence: DECL_CONFIDENCE, location },
  };
  if (doc) node.doc = doc;
  return node;
}

// ── Python ──────────────────────────────────────────────────────────────────

function extractPython(file: ScannedFile, raw: string[], code: string[], out: Out): Block[] {
  const pending = out.pending;
  const blocks: Block[] = [];
  const classes: Block[] = [];
  const decorators: { method: string; path: string; line: number }[] = [];
  for (let i = 0; i < code.length; i += 1) {
    const line = code[i]!;
    const indent = indentOf(line);
    const loc = { path: file.path, line: i + 1 };

    const imp = /^\s*import\s+(.+)$/.exec(line);
    if (imp) {
      for (const part of imp[1]!.split(",")) {
        const spec = part.trim().split(/\s+as\s+/)[0]!.trim();
        if (spec) pending.push({ kind: "import", fromNode: fileId(file.path), name: spec, location: loc });
      }
      continue;
    }
    const from = /^\s*from\s+(\.*[\w.]*)\s+import\s+\(?\s*(.+?)\)?\s*$/.exec(line);
    if (from) {
      const names = from[2]!.split(",").map((n) => n.trim().split(/\s+as\s+/)[0]!.trim()).filter((n) => /^\w+$/.test(n));
      pending.push({ kind: "import", fromNode: fileId(file.path), name: from[1]!, names, location: loc });
      continue;
    }

    // Flask/FastAPI/Starlette-style route decorators; string contents come from the raw line.
    const route = /^\s*@\w+\.(route|api_route|get|post|put|patch|delete|options|head)\(\s*[rbuRBU]?["']([^"']+)["'](.*)$/.exec(raw[i]!);
    if (route) {
      const verb = route[1] === "route" || route[1] === "api_route" ? /methods\s*=\s*\[\s*["'](\w+)/.exec(route[3]!)?.[1] ?? "GET" : route[1]!;
      decorators.push({ method: verb.toUpperCase(), path: route[2]!, line: i });
      continue;
    }

    const cls = /^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\((.*)\))?\s*:/.exec(line);
    const def = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
    if (!cls && !def) {
      const owner = [...classes].reverse().find((c) => c.indent < indent && c.start < i && c.end >= i);
      const fn = innermostFunction(blocks, i);
      const assign = /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/.exec(line);
      if (assign && indent === 0) {
        blocks.push({ node: makeNode(file, "variable", assign[1]!, i, i, raw[i]!, !assign[1]!.startsWith("_")), start: i, end: i, indent });
      }
      // Class attribute: `name = …` / `name: T` directly in a class body.
      const attr = /^\s+([A-Za-z_]\w*)\s*(?::\s*[^=]+)?(?:=(?!=)|$)/.exec(line);
      if (attr && owner && !fn && /[:=]/.test(line)) addField(file, blocks, owner, attr[1]!, i, raw[i]!);
      // `self.x = …` inside a method: declares the field (first time) and writes it.
      if (fn && owner) {
        for (const m of line.matchAll(/\bself\.([A-Za-z_]\w*)\s*(?:[-+*/|&%]|\/\/|\*\*)?=(?!=)/g)) {
          const field = addField(file, blocks, owner, m[1]!, i, raw[i]!);
          out.edges.push({ kind: "writes", source: fn.node.id, target: field, confidence: 0.8, line: i + 1, detail: `self.${m[1]} assignment` });
        }
      }
      // `global X` then `X = …` inside a function writes the module variable.
      const glob = /^\s+global\s+([\w\s,]+)$/.exec(line);
      if (glob && fn) {
        for (const name of glob[1]!.split(",").map((x) => x.trim())) {
          for (let j = i + 1; j <= fn.end; j += 1) {
            if (new RegExp(`^\\s+${name}\\s*(?:[-+*/]|\\/\\/)?=(?!=)`).test(code[j]!)) {
              out.edges.push({ kind: "writes", source: fn.node.id, target: symbolId("variable", file.path, name), confidence: 0.8, line: j + 1, detail: `global ${name}` });
            }
          }
        }
      }
      continue;
    }
    const end = pythonBlockEnd(code, i, indent);
    const enclosing = [...classes].reverse().find((c) => c.indent < indent && c.start < i && c.end >= i);
    const insideFunction = blocks.some((b) => (b.node.kind === "function" || b.node.kind === "method") && b.indent < indent && b.start < i && b.end >= i);
    if (insideFunction) {
      decorators.length = 0;
      continue; // nested defs/classes fold into their enclosing function
    }
    const doc = pythonDocstring(raw, i + 1);
    if (cls) {
      decorators.length = 0;
      const name = cls[2]!;
      if (enclosing) continue; // nested classes are not modelled
      const block: Block = { node: makeNode(file, "class", name, i, end, raw[i]!, !name.startsWith("_"), doc), start: i, end, indent };
      blocks.push(block);
      classes.push(block);
      for (const base of splitBases(cls[3] ?? "")) {
        if (base === "object" || base.includes("=")) continue;
        pending.push({ kind: "extends", fromNode: block.node.id, name: base.split(".").at(-1)!, location: loc });
      }
    } else if (def) {
      const name = def[2]!;
      const qualified = enclosing ? `${enclosing.node.name}.${name}` : name;
      const kind: NodeKind = enclosing ? "method" : "function";
      const block: Block = { node: makeNode(file, kind, qualified, i, end, raw[i]!, !name.startsWith("_") || name.startsWith("__"), doc), start: i, end, indent };
      blocks.push(block);
      for (const d of decorators.splice(0)) {
        const rid = addRoute(file, blocks, d.method, d.path, d.line, raw[d.line]!, enclosing?.node.id ?? fileId(file.path));
        out.edges.push({ kind: "handles", source: block.node.id, target: rid, confidence: 0.85, line: d.line + 1, detail: "route decorator" });
      }
    }
  }
  return blocks;
}

function innermostFunction(blocks: Block[], line: number): Block | undefined {
  let best: Block | undefined;
  for (const b of blocks) {
    if ((b.node.kind === "function" || b.node.kind === "method") && b.start < line && b.end >= line && (!best || b.start >= best.start)) best = b;
  }
  return best;
}

/** Add `Owner.name` as a field once; returns its id. */
function addField(file: ScannedFile, blocks: Block[], owner: Block, name: string, line: number, text: string, exported = !name.startsWith("_")): string {
  const node = makeNode(file, "field", `${owner.node.name}.${name}`, line, line, text, exported);
  if (!blocks.some((b) => b.node.id === node.id)) {
    node.evidence.confidence = 0.8;
    blocks.push({ node, start: line, end: line, indent: owner.indent + 1, parent: { kind: "defines", id: owner.node.id } });
  }
  return node.id;
}

/** Add a route node once; `parent` is the entity that registers/declares it. */
function addRoute(file: ScannedFile, blocks: Block[], method: string, path: string, line: number, text: string, parent: string): string {
  const node = makeNode(file, "route", `${method} ${path}`, line, line, text, false);
  node.evidence.confidence = 0.85;
  node.evidence.detail = "route registration pattern";
  if (!blocks.some((b) => b.node.id === node.id)) blocks.push({ node, start: line, end: line, indent: 0, parent: { kind: "defines", id: parent } });
  return node.id;
}

/** Module node for a package clause, contained by the file's directory. */
function addPackageModule(file: ScannedFile, blocks: Block[], name: string, line: number, text: string): void {
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ".";
  const node = makeNode(file, "module", name, line, line, text, true);
  node.id = symbolId("module", dir, name);
  node.path = dir;
  node.evidence.detail = "package clause";
  if (!blocks.some((b) => b.node.id === node.id)) {
    blocks.push({ node, start: line, end: line, indent: 0, parent: { kind: "contains", id: dir === "." ? repositoryId() : directoryId(dir) } });
  }
}

function pythonBlockEnd(code: string[], start: number, indent: number): number {
  let end = start;
  let opened = false;
  for (let j = start + 1; j < code.length; j += 1) {
    const line = code[j]!;
    if (!line.trim()) continue;
    if (indentOf(line) <= indent) {
      if (opened || !/^\s*[)\]]/.test(line)) break;
    }
    opened = true;
    end = j;
  }
  return end;
}

function pythonDocstring(raw: string[], from: number): string | undefined {
  for (let j = from; j < Math.min(raw.length, from + 3); j += 1) {
    const line = raw[j]!.trim();
    if (!line) continue;
    const m = /^[rubRUB]?("""|''')(.*)$/.exec(line);
    if (!m) return undefined;
    let body = m[2]!;
    const close = body.indexOf(m[1]!);
    if (close >= 0) return firstSentence(body.slice(0, close));
    for (let k = j + 1; k < raw.length && k < j + 20; k += 1) {
      const idx = raw[k]!.indexOf(m[1]!);
      body += ` ${idx >= 0 ? raw[k]!.slice(0, idx) : raw[k]!}`;
      if (idx >= 0) break;
    }
    return firstSentence(body);
  }
  return undefined;
}

// ── Go ──────────────────────────────────────────────────────────────────────

function extractGo(file: ScannedFile, raw: string[], code: string[], out: Out): Block[] {
  const pending = out.pending;
  const blocks: Block[] = [];
  const depth = braceDepths(code);
  let inImportBlock = false;
  let struct: Block | undefined;
  for (let i = 0; i < code.length; i += 1) {
    const line = code[i]!;
    const rawLine = raw[i]!;
    const loc = { path: file.path, line: i + 1 };
    const pkg = /^package\s+(\w+)/.exec(line);
    if (pkg && depth[i] === 0) {
      addPackageModule(file, blocks, pkg[1]!, i, line);
      continue;
    }
    if (depth[i] === 0 && /^import\s*\($/.test(line.trim())) {
      inImportBlock = true;
      continue;
    }
    if (inImportBlock) {
      if (line.trim().startsWith(")")) inImportBlock = false;
      const m = /^\s*(?:[\w.]+\s+)?"([^"]+)"/.exec(rawLine);
      if (m) pending.push({ kind: "import", fromNode: fileId(file.path), name: m[1]!, names: goAlias(rawLine), location: loc });
      continue;
    }
    const single = /^import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(rawLine);
    if (single && depth[i] === 0) {
      pending.push({ kind: "import", fromNode: fileId(file.path), name: single[1]!, names: goAlias(rawLine), location: loc });
      continue;
    }
    // Struct body: `Name Type` fields; a lone type name is an embedded struct.
    if (struct && depth[i] === 1 && i <= struct.end) {
      const embedded = /^\s*\*?([A-Za-z_][\w.]*)\s*(?:`.*)?$/.exec(line);
      const fields = /^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+[^\s]/.exec(line);
      if (embedded && !line.includes("}")) {
        pending.push({ kind: "extends", fromNode: struct.node.id, name: embedded[1]!.split(".").at(-1)!, location: loc, detail: "embedded struct" });
      } else if (fields) {
        for (const name of fields[1]!.split(",").map((x) => x.trim())) addField(file, blocks, struct, name, i, rawLine, isCapitalized(name));
      }
    }
    // Route registration: http.HandleFunc("/x", h), mux.Handle, gin/echo/chi r.GET("/x", h).
    for (const m of rawLine.matchAll(/\b\w+\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|Any|Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"\s*,\s*([\w.]+)\s*[,)]/g)) {
      let method = m[1]!.startsWith("Handle") ? "ANY" : m[1]!.toUpperCase();
      let path = m[2]!;
      const pattern = /^([A-Z]+)\s+(\/.*)$/.exec(path); // Go 1.22 "GET /x" patterns
      if (pattern) [method, path] = [pattern[1]!, pattern[2]!];
      if (!path.startsWith("/")) continue;
      const owner = innermost(blocks, i);
      const rid = addRoute(file, blocks, method, path, i, rawLine, owner?.node.id ?? fileId(file.path));
      const handler = m[3]!.split(".");
      pending.push({ kind: "handles", fromNode: rid, name: handler.at(-1)!, ...(handler.length > 1 ? { member: true, receiver: handler[0]! } : {}), location: loc });
    }
    if (depth[i] !== 0) continue;
    struct = undefined;
    const doc = lineCommentDoc(raw, i, "//");
    const method = /^func\s*\(\s*(\w*)\s*\*?\s*([A-Za-z_]\w*)(?:\[[^\]]*\])?\s*\)\s*([A-Za-z_]\w*)\s*[[(]/.exec(line);
    const fn = /^func\s+([A-Za-z_]\w*)\s*[[(]/.exec(line);
    const type = /^type\s+([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+(struct|interface)?/.exec(line);
    const decl = /^(?:var|const)\s+([A-Za-z_]\w*)/.exec(line);
    if (method || fn) {
      const end = braceEnd(code, depth, i);
      const name = method ? `${method[2]}.${method[3]}` : fn![1]!;
      const simple = method ? method[3]! : fn![1]!;
      const block: Block = { node: makeNode(file, method ? "method" : "function", name, i, end, line, isCapitalized(simple), doc), start: i, end, indent: 0 };
      blocks.push(block);
      const recv = method?.[1];
      if (recv) {
        for (let j = i; j <= end; j += 1) {
          for (const w of code[j]!.matchAll(new RegExp(`\\b${recv}\\.([A-Za-z_]\\w*)\\s*(?:[-+*/|&%^]?=(?!=)|\\+\\+|--)`, "g"))) {
            pending.push({ kind: "writes", fromNode: block.node.id, name: `${method![2]}.${w[1]}`, location: { path: file.path, line: j + 1 }, detail: `${recv}.${w[1]} assignment` });
          }
        }
      }
    } else if (type) {
      const end = type[2] ? braceEnd(code, depth, i) : i;
      const kind: NodeKind = type[2] === "struct" ? "class" : type[2] === "interface" ? "interface" : "type";
      const block: Block = { node: makeNode(file, kind, type[1]!, i, end, line, isCapitalized(type[1]!), doc), start: i, end, indent: 0 };
      blocks.push(block);
      if (kind === "class") struct = block;
    } else if (decl) {
      blocks.push({ node: makeNode(file, "variable", decl[1]!, i, i, line, isCapitalized(decl[1]!), doc), start: i, end: i, indent: 0 });
    }
  }
  return blocks;
}

function goAlias(rawLine: string): string[] {
  const m = /^\s*(?:import\s+)?([\w.]+)\s+"/.exec(rawLine);
  return m && m[1] !== "import" ? [m[1]!] : [];
}

// ── Rust ────────────────────────────────────────────────────────────────────

function extractRust(file: ScannedFile, raw: string[], code: string[], out: Out): Block[] {
  const pending = out.pending;
  const blocks: Block[] = [];
  const depth = braceDepths(code);
  const impls: { type: string; start: number; end: number; trait?: string }[] = [];
  let struct: Block | undefined;
  const attrRoutes: { method: string; path: string; line: number }[] = [];
  for (let i = 0; i < code.length; i += 1) {
    const line = code[i]!;
    const loc = { path: file.path, line: i + 1 };
    const d = depth[i]!;
    // actix-web / rocket: #[get("/x")] on the following fn.
    const attr = /^\s*#\[(get|post|put|patch|delete|head|options)\(\s*"([^"]+)"/.exec(raw[i]!);
    if (attr) {
      attrRoutes.push({ method: attr[1]!.toUpperCase(), path: attr[2]!, line: i });
      continue;
    }
    // axum: .route("/x", get(handler).post(other))
    for (const m of raw[i]!.matchAll(/\.route\(\s*"([^"]+)"\s*,([^;]*)/g)) {
      for (const h of m[2]!.matchAll(/\b(get|post|put|patch|delete|any)\(\s*([\w:]+)\s*\)/g)) {
        const owner = innermost(blocks, i);
        const rid = addRoute(file, blocks, h[1]!.toUpperCase(), m[1]!, i, raw[i]!, owner?.node.id ?? fileId(file.path));
        pending.push({ kind: "handles", fromNode: rid, name: h[2]!.split("::").at(-1)!, location: loc });
      }
    }
    if (struct && d === 1 && i <= struct.end) {
      const field = /^\s*(?:pub(?:\([^)]*\))?\s+)?([a-z_]\w*)\s*:/.exec(line);
      if (field) addField(file, blocks, struct, field[1]!, i, raw[i]!, /^\s*pub\b/.test(line));
    }
    const use = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/.exec(line);
    if (use && d === 0) {
      pending.push({ kind: "import", fromNode: fileId(file.path), name: use[1]!.replace(/::$/, ""), location: loc });
      continue;
    }
    const mod = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*([;{])/.exec(line);
    if (mod && d === 0) {
      const end = mod[2] === "{" ? braceEnd(code, depth, i) : i;
      blocks.push({ node: makeNode(file, "module", mod[1]!, i, end, line, /^\s*pub\b/.test(line), lineCommentDoc(raw, i, "///")), start: i, end, indent: 0 });
      if (mod[2] === ";") pending.push({ kind: "import", fromNode: fileId(file.path), name: `mod:${mod[1]}`, location: loc });
      continue;
    }
    const impl = /^\s*impl(?:<[^{]*?>)?\s+(?:([\w:]+)(?:<[^{]*?>)?\s+for\s+)?([\w:]+)/.exec(line);
    if (impl && d === 0) {
      const type = impl[2]!.split("::").at(-1)!;
      const entry: { type: string; start: number; end: number; trait?: string } = { type, start: i, end: braceEnd(code, depth, i) };
      if (impl[1]) entry.trait = impl[1].split("::").at(-1)!;
      impls.push(entry);
      continue;
    }
    const pub = /^\s*pub\b/.test(line);
    const doc = lineCommentDoc(raw, i, "///");
    const fn = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/.exec(line);
    if (fn) {
      const owner = impls.find((b) => b.start < i && b.end >= i);
      if (d === 0 || (owner && d === 1)) {
        const end = braceEnd(code, depth, i);
        const name = owner ? `${owner.type}.${fn[1]}` : fn[1]!;
        const block: Block = { node: makeNode(file, owner ? "method" : "function", name, i, end, line, pub, doc), start: i, end, indent: d };
        blocks.push(block);
        for (const r of attrRoutes.splice(0)) {
          const rid = addRoute(file, blocks, r.method, r.path, r.line, raw[r.line]!, fileId(file.path));
          out.edges.push({ kind: "handles", source: block.node.id, target: rid, confidence: 0.85, line: r.line + 1, detail: "route attribute" });
        }
        if (owner) {
          for (let j = i; j <= end; j += 1) {
            for (const w of code[j]!.matchAll(/\bself\.([A-Za-z_]\w*)\s*(?:[-+*/|&%^]?=(?!=))/g)) {
              pending.push({ kind: "writes", fromNode: block.node.id, name: `${owner.type}.${w[1]}`, location: { path: file.path, line: j + 1 }, detail: `self.${w[1]} assignment` });
            }
          }
        }
      }
      continue;
    }
    if (d !== 0) continue;
    struct = undefined;
    const item = /^\s*(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|type|union)\s+([A-Za-z_]\w*)/.exec(line);
    if (item) {
      const kind: NodeKind = item[1] === "struct" || item[1] === "union" ? "class" : item[1] === "trait" ? "interface" : item[1] === "enum" ? "enum" : "type";
      const end = /[{]/.test(line) ? braceEnd(code, depth, i) : i;
      const block: Block = { node: makeNode(file, kind, item[2]!, i, end, line, pub, doc), start: i, end, indent: 0 };
      blocks.push(block);
      if (item[1] === "struct" && /[{]/.test(line)) struct = block;
      continue;
    }
    const cst = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(?:mut\s+)?([A-Za-z_]\w*)/.exec(line);
    if (cst) blocks.push({ node: makeNode(file, "variable", cst[1]!, i, i, line, pub, doc), start: i, end: i, indent: 0 });
  }
  for (const impl of impls) {
    if (!impl.trait) continue;
    const local = blocks.find((b) => (b.node.kind === "class" || b.node.kind === "type" || b.node.kind === "enum") && b.node.name === impl.type);
    if (local) pending.push({ kind: "implements", fromNode: local.node.id, name: impl.trait, location: { path: file.path, line: impl.start + 1 } });
  }
  return blocks;
}

// ── Java ────────────────────────────────────────────────────────────────────

const SPRING_MAPPING = /@(Get|Post|Put|Patch|Delete|Request)Mapping\b(?:\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*"([^"]*)"[^)]*\))?(.*)$/;

function extractJava(file: ScannedFile, raw: string[], code: string[], out: Out): Block[] {
  const pending = out.pending;
  const blocks: Block[] = [];
  const depth = braceDepths(code);
  let current: Block | undefined;
  let classPrefix = "";
  let pendingRoute: { method?: string; path: string; line: number } | undefined;
  for (let i = 0; i < code.length; i += 1) {
    const line = code[i]!;
    const d = depth[i]!;
    const loc = { path: file.path, line: i + 1 };
    const pkg = /^\s*package\s+([\w.]+)\s*;/.exec(line);
    if (pkg && d === 0) {
      addPackageModule(file, blocks, pkg[1]!, i, line);
      continue;
    }
    const imp = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/.exec(line);
    if (imp) {
      pending.push({ kind: "import", fromNode: fileId(file.path), name: imp[1]!, location: loc });
      continue;
    }
    // Spring @GetMapping/@RequestMapping and JAX-RS @Path/@GET annotations (read from raw text).
    const spring = SPRING_MAPPING.exec(raw[i]!);
    const jaxPath = /^\s*@Path\(\s*"([^"]*)"/.exec(raw[i]!);
    const jaxVerb = /^\s*@(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.exec(raw[i]!);
    if (spring || jaxPath || jaxVerb) {
      if (d === 0) {
        if (spring || jaxPath) classPrefix = (spring?.[2] ?? jaxPath?.[1] ?? "").replace(/\/+$/, "");
      } else {
        const verb = spring ? (spring[1] === "Request" ? /RequestMethod\.(\w+)/.exec(spring[3] ?? "")?.[1] : spring[1]!.toUpperCase()) : jaxVerb?.[1];
        pendingRoute = {
          ...(verb ?? pendingRoute?.method ? { method: (verb ?? pendingRoute?.method)!.toUpperCase() } : {}),
          path: spring?.[2] ?? jaxPath?.[1] ?? pendingRoute?.path ?? "",
          line: pendingRoute?.line ?? i,
        };
      }
      if (!/\b(class|interface|enum|record)\b|\(.*\)\s*\{/.test(line.replace(/@\w+(\([^)]*\))?/g, ""))) continue;
    }
    const doc = javadoc(raw, i);
    const type = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp)\s+)*(class|interface|enum|record)\s+([A-Za-z_]\w*)(?:<[^{]*?>)?(?:\s*\([^)]*\))?((?:\s+(?:extends|implements|permits)\s+[\w.<>,?\s]+?)*)\s*\{/.exec(line);
    if (type && d === 0) {
      const kind: NodeKind = type[1] === "interface" ? "interface" : type[1] === "enum" ? "enum" : "class";
      const end = braceEnd(code, depth, i);
      current = { node: makeNode(file, kind, type[2]!, i, end, line, /\bpublic\b/.test(line), doc), start: i, end, indent: 0 };
      blocks.push(current);
      const clauses = type[3] ?? "";
      const ext = /\bextends\s+([\w.<>,?\s]+?)(?=\s+implements\b|\s+permits\b|$)/.exec(clauses);
      const impl = /\bimplements\s+([\w.<>,?\s]+?)(?=\s+permits\b|$)/.exec(clauses);
      for (const name of splitBases(ext?.[1] ?? "")) pending.push({ kind: "extends", fromNode: current.node.id, name: name.split(".").at(-1)!, location: loc });
      for (const name of splitBases(impl?.[1] ?? "")) pending.push({ kind: "implements", fromNode: current.node.id, name: name.split(".").at(-1)!, location: loc });
      continue;
    }
    if (!current || d !== 1 || i > current.end) continue;
    const method = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp)\s+)*(?:<[^>]+>\s+)?(?:[\w.<>[\],?]+\s+)?([A-Za-z_]\w*)\s*\([^;]*$/.exec(line);
    if (method && !KEYWORDS.has(method[1]!) && /[{)]\s*(throws\s+[\w.,\s]+)?\{?\s*$/.test(line)) {
      const end = braceEnd(code, depth, i);
      const name = method[1] === current.node.name ? "constructor" : method[1]!;
      const block: Block = { node: makeNode(file, "method", `${current.node.name}.${name}`, i, end, line, /\bpublic\b/.test(line), doc), start: i, end, indent: 1 };
      blocks.push(block);
      if (pendingRoute && (pendingRoute.method || pendingRoute.path)) {
        const path = `/${[classPrefix, pendingRoute.path].map((x) => x.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;
        const rid = addRoute(file, blocks, pendingRoute.method ?? "ANY", path, pendingRoute.line, raw[pendingRoute.line]!, current.node.id);
        out.edges.push({ kind: "handles", source: block.node.id, target: rid, confidence: 0.85, line: pendingRoute.line + 1, detail: "route annotation" });
      }
      pendingRoute = undefined;
      for (let j = i; j <= end; j += 1) {
        for (const w of code[j]!.matchAll(/\bthis\.([A-Za-z_]\w*)\s*(?:[-+*/|&%^]?=(?!=)|\+\+|--)/g)) {
          pending.push({ kind: "writes", fromNode: block.node.id, name: `${current.node.name}.${w[1]}`, location: { path: file.path, line: j + 1 }, detail: `this.${w[1]} assignment` });
        }
      }
      continue;
    }
    // Field: `[modifiers] Type name [= …];` directly in the class body.
    const field = /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|protected|private|static|final|transient|volatile)\s+)*[\w.<>[\],?]+(?:<[^;=]*>)?\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;\s*$/.exec(line);
    if (field && !/^\s*(return|throw|package|import)\b/.test(line) && !/\(/.test(line.split("=")[0]!)) {
      addField(file, blocks, current, field[1]!, i, raw[i]!, /\bpublic\b/.test(line));
    }
  }
  return blocks;
}

function javadoc(raw: string[], line: number): string | undefined {
  let j = line - 1;
  while (j >= 0 && /^\s*@/.test(raw[j]!)) j -= 1;
  if (j < 0 || !raw[j]!.trim().endsWith("*/")) return undefined;
  const parts: string[] = [];
  for (; j >= 0; j -= 1) {
    parts.unshift(raw[j]!);
    if (raw[j]!.includes("/**")) break;
    if (raw[j]!.includes("/*")) return undefined;
  }
  const body = parts.join(" ").replace(/\/\*\*|\*\//g, " ").replace(/^\s*\*\s?/gm, "").replace(/\s\*\s/g, " ");
  return firstSentence(body.split(/\s@\w+/)[0] ?? "");
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function lineCommentDoc(raw: string[], line: number, marker: string): string | undefined {
  const parts: string[] = [];
  for (let j = line - 1; j >= 0; j -= 1) {
    const t = raw[j]!.trim();
    if (!t.startsWith(marker)) break;
    parts.unshift(t.slice(marker.length).replace(/^\/+/, ""));
  }
  return parts.length ? firstSentence(parts.join(" ")) : undefined;
}

function splitBases(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "<" || ch === "[" || ch === "(") depth += 1;
    if (ch === ">" || ch === "]" || ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((s) => s.replace(/<.*$|\[.*$/, "").trim()).filter((s) => /^[\w.]+$/.test(s));
}

function innermost(blocks: Block[], line: number): Block | undefined {
  let best: Block | undefined;
  for (const block of blocks) {
    if (NON_OWNER_KINDS.has(block.node.kind)) continue;
    if (block.start <= line && block.end >= line && (!best || block.start >= best.start)) best = block;
  }
  return best;
}

function parentClassId(block: Block, blocks: Block[]): string | undefined {
  const className = block.node.name.split(".")[0];
  const parent = blocks.find((b) => (b.node.kind === "class" || b.node.kind === "interface" || b.node.kind === "type") && b.node.name === className);
  return parent?.node.id;
}

function indentOf(line: string): number {
  return (/^\s*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;
}

function isCapitalized(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/** Brace depth at the start of each line of comment/string-stripped code. */
function braceDepths(code: string[]): number[] {
  const out: number[] = [];
  let depth = 0;
  for (const line of code) {
    out.push(depth);
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  return out;
}

/** Last line of the brace block opened on or after `start`. */
function braceEnd(code: string[], depths: number[], start: number): number {
  const base = depths[start]!;
  let opened = false;
  let depth = base;
  for (let j = start; j < code.length; j += 1) {
    for (const ch of code[j]!) {
      if (ch === "{") {
        depth += 1;
        opened = true;
      } else if (ch === "}") {
        depth -= 1;
        if (opened && depth === base) return j;
      } else if (ch === ";" && !opened && j === start) {
        return j; // declaration without body (interface method, extern fn)
      }
    }
    if (!opened && j > start + 5) return start;
  }
  return code.length - 1;
}

/**
 * Blank out comments and string contents (keeping quotes and newlines) so
 * pattern matching never sees code-like text inside them.
 */
export function stripCommentsAndStrings(text: string, language: Language): string {
  const out: string[] = [];
  const hashComments = language === "python";
  const slashComments = language !== "python";
  let i = 0;
  const n = text.length;
  const blank = (s: string): string => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (hashComments && ch === "#") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out.push(blank(text.slice(i, stop)));
      i = stop;
      continue;
    }
    if (slashComments && ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      out.push(blank(text.slice(i, stop)));
      i = stop;
      continue;
    }
    if (slashComments && ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out.push(blank(text.slice(i, stop)));
      i = stop;
      continue;
    }
    if (language === "python" && (text.startsWith('"""', i) || text.startsWith("'''", i))) {
      const quote = text.slice(i, i + 3);
      const end = text.indexOf(quote, i + 3);
      const stop = end < 0 ? n : end + 3;
      out.push(quote + blank(text.slice(i + 3, Math.max(i + 3, stop - 3))) + (end < 0 ? "" : quote));
      i = stop;
      continue;
    }
    const isQuote =
      ch === '"' ||
      (ch === "'" && (language !== "rust" || /^'(?:\\.|[^\\'])'/.test(text.slice(i, i + 4)))) ||
      (ch === "`" && language === "go");
    if (isQuote) {
      let j = i + 1;
      while (j < n && text[j] !== ch && !(text[j] === "\n" && ch !== "`")) {
        if (text[j] === "\\" && ch !== "`") j += 1;
        j += 1;
      }
      out.push(ch + blank(text.slice(i + 1, Math.min(j, n))) + (j < n && text[j] === ch ? ch : ""));
      i = j < n && text[j] === ch ? j + 1 : j;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
