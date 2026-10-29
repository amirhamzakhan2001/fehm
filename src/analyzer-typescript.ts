import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { edgeId, fileId, firstSentence, packageId, pathOfId, symbolId } from "./ids.js";
import {
  ANALYSIS_VERSION,
  type EdgeKind,
  type Evidence,
  type FileAnalysis,
  type GraphEdge,
  type GraphNode,
  type NodeKind,
  type ScannedFile,
} from "./model.js";

/**
 * TypeScript/JavaScript analysis through the TypeScript compiler and type
 * checker. Cross-file relationships are resolved by the checker (provenance
 * `type-checker`, confidence 1.0). `node_modules` is invisible to the program,
 * so bare imports become `package` nodes rather than being type-resolved.
 *
 * Granularity: top-level declarations and class members become nodes. Nested
 * functions, callbacks and anonymous functions are folded into their enclosing
 * symbol — their calls are attributed to it.
 */
export function analyzeTypeScriptFiles(
  root: string,
  programFiles: readonly ScannedFile[],
  targets: ReadonlySet<string>,
): Map<string, FileAnalysis> {
  const options = compilerOptions(root);
  const host = ts.createCompilerHost(options, true);
  const blocked = (p: string): boolean => p.split(/[\\/]/).includes("node_modules");
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  host.fileExists = (p) => !blocked(p) && fileExists(p);
  host.directoryExists = (p) => !blocked(p) && (directoryExists ? directoryExists(p) : true);

  const rootNames = programFiles.map((f) => f.absolutePath);
  const program = ts.createProgram({ rootNames, options, host });
  const checker = program.getTypeChecker();
  const known = new Set(programFiles.map((f) => f.path));
  const byPath = new Map(programFiles.map((f) => [f.path, f]));
  const toRel = (abs: string): string => relative(root, abs).split(sep).join("/");

  const results = new Map<string, FileAnalysis>();
  for (const path of [...targets].sort()) {
    const scanned = byPath.get(path);
    const sourceFile = scanned && program.getSourceFile(scanned.absolutePath);
    if (!scanned || !sourceFile) continue;
    results.set(path, analyzeSourceFile(sourceFile, scanned, { checker, options, host, known, toRel }));
  }
  return results;
}

interface Ctx {
  checker: ts.TypeChecker;
  options: ts.CompilerOptions;
  host: ts.CompilerHost;
  known: ReadonlySet<string>;
  toRel: (abs: string) => string;
}

function compilerOptions(root: string): ts.CompilerOptions {
  const base: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    noLib: true,
    types: [],
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.Preserve,
  };
  // Honor path aliases from the root tsconfig; nothing else from it matters here.
  const configPath = join(root, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (!read.error && read.config) {
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
    if (parsed.options.baseUrl) base.baseUrl = parsed.options.baseUrl;
    if (parsed.options.paths) base.paths = parsed.options.paths;
  }
  return base;
}

/** Standard-library bases: unresolvable with noLib but not unknown. Not reported. */
const ES_BUILTINS = new Set(["Error", "TypeError", "RangeError", "Array", "Map", "Set", "Promise", "Object", "Function", "EventTarget", "HTMLElement"]);

interface DeclInfo {
  kind: NodeKind;
  qualified: string;
  nameNode?: ts.Node;
}

function unwrap(expr: ts.Expression | undefined): ts.Expression | undefined {
  let e = expr;
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e))) e = e.expression;
  return e;
}

function isTopLevel(node: ts.Node): boolean {
  return scopePrefix(node) !== undefined;
}

/**
 * Qualified-name prefix for a declaration directly in the file ("") or inside
 * a namespace chain ("NS." / "Outer.Inner."); undefined for anything nested
 * deeper (function bodies, blocks), which folds into its enclosing symbol.
 */
function scopePrefix(node: ts.Node): string | undefined {
  const parent = node.parent;
  if (!parent) return undefined;
  if (ts.isSourceFile(parent)) return "";
  if (ts.isModuleBlock(parent) && ts.isModuleDeclaration(parent.parent)) {
    const mod = moduleQualifiedName(parent.parent);
    return mod === undefined ? undefined : `${mod}.`;
  }
  return undefined;
}

/** `namespace A.B {}` nests ModuleDeclarations directly; walk up to the top. */
function moduleQualifiedName(mod: ts.ModuleDeclaration): string | undefined {
  const name = ts.isIdentifier(mod.name) ? mod.name.text : mod.name.text;
  if (ts.isModuleDeclaration(mod.parent)) {
    const outer = moduleQualifiedName(mod.parent);
    return outer === undefined ? undefined : `${outer}.${name}`;
  }
  const prefix = scopePrefix(mod);
  return prefix === undefined ? undefined : `${prefix}${name}`;
}

/** The owning top-level class (declaration or `const X = class {}`) of a member. */
function classOwnerName(cls: ts.Node): string | undefined {
  if (ts.isClassDeclaration(cls) && isTopLevel(cls)) return `${scopePrefix(cls)}${cls.name?.text ?? "default"}`;
  if (ts.isInterfaceDeclaration(cls) && isTopLevel(cls)) return `${scopePrefix(cls)}${cls.name.text}`;
  if (ts.isClassExpression(cls) && ts.isVariableDeclaration(cls.parent) && ts.isIdentifier(cls.parent.name)) {
    const stmt = cls.parent.parent?.parent;
    if (stmt && ts.isVariableStatement(stmt) && isTopLevel(stmt)) return `${scopePrefix(stmt)}${cls.parent.name.text}`;
  }
  return undefined;
}

/** Which declarations become graph nodes. Pure on the AST, so ids are stable across files. */
export function declarationInfo(node: ts.Node): DeclInfo | undefined {
  const named = (kind: NodeKind, name: ts.Identifier | undefined, fallback = "default"): DeclInfo => ({
    kind,
    qualified: `${scopePrefix(node)}${name?.text ?? fallback}`,
    ...(name ? { nameNode: name } : {}),
  });
  if (ts.isModuleDeclaration(node) && !ts.isModuleDeclaration(node.parent)) {
    const qualified = moduleQualifiedName(node);
    if (qualified === undefined) return undefined;
    // `namespace A.B {}`: the node for A.B is the innermost declaration; skip the outer shell.
    return { kind: "module", qualified, nameNode: node.name };
  }
  if (ts.isModuleDeclaration(node) && ts.isModuleDeclaration(node.parent)) {
    const qualified = moduleQualifiedName(node);
    return qualified === undefined ? undefined : { kind: "module", qualified, nameNode: node.name };
  }
  if (!isTopLevel(node) && !ts.isClassElement(node) && !ts.isParameter(node) && !ts.isVariableDeclaration(node) && !ts.isTypeElement(node)) return undefined;
  if (ts.isFunctionDeclaration(node) && isTopLevel(node)) return named("function", node.name);
  if (ts.isClassDeclaration(node) && isTopLevel(node)) return named("class", node.name);
  if (ts.isInterfaceDeclaration(node) && isTopLevel(node)) return named("interface", node.name);
  if (ts.isTypeAliasDeclaration(node) && isTopLevel(node)) return named("type", node.name);
  if (ts.isEnumDeclaration(node) && isTopLevel(node)) return named("enum", node.name);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    const stmt = node.parent?.parent;
    if (!stmt || !ts.isVariableStatement(stmt) || !isTopLevel(stmt)) return undefined;
    const init = unwrap(node.initializer);
    const kind: NodeKind =
      init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? "function" : init && ts.isClassExpression(init) ? "class" : "variable";
    return { kind, qualified: `${scopePrefix(stmt)}${node.name.text}`, nameNode: node.name };
  }
  // Constructor parameter properties (`constructor(readonly url: string)`) are fields.
  if (ts.isParameter(node) && ts.isIdentifier(node.name) && ts.isConstructorDeclaration(node.parent) && hasParameterPropertyModifier(node)) {
    const owner = classOwnerName(node.parent.parent);
    return owner ? { kind: "field", qualified: `${owner}.${node.name.text}`, nameNode: node.name } : undefined;
  }
  // Interface members: properties are fields; method signatures stay with the interface.
  if (ts.isPropertySignature(node) && node.parent && ts.isInterfaceDeclaration(node.parent)) {
    const owner = classOwnerName(node.parent);
    const member = propertyName(node.name);
    return owner && member ? { kind: "field", qualified: `${owner}.${member}`, nameNode: node.name } : undefined;
  }
  const functionValued = ts.isPropertyDeclaration(node) && !!unwrap(node.initializer) && isFunctionLike(unwrap(node.initializer)!);
  const isMember =
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isPropertyDeclaration(node);
  if (isMember && node.parent) {
    const owner = classOwnerName(node.parent);
    if (!owner || ts.isInterfaceDeclaration(node.parent)) return undefined;
    const member = ts.isConstructorDeclaration(node) ? "constructor" : memberName(node as ts.ClassElement);
    if (!member) return undefined;
    const nameNode = (node as ts.ClassElement).name;
    const kind: NodeKind = ts.isPropertyDeclaration(node) && !functionValued ? "field" : "method";
    return { kind, qualified: `${owner}.${member}`, ...(nameNode ? { nameNode } : {}) };
  }
  return undefined;
}

function hasParameterPropertyModifier(node: ts.ParameterDeclaration): boolean {
  return (ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.ParameterPropertyModifier | ts.ModifierFlags.Readonly)) !== 0;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  return undefined;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "del", "options", "head", "all"]);
const ROUTE_DECORATORS = new Set(["Get", "Post", "Put", "Patch", "Delete", "Options", "Head", "All"]);

/** `app.post("/login", h)`-style registration: HTTP verb method, path literal, ≥ 1 handler. */
function routeRegistration(node: ts.CallExpression): { method: string; path: string; handlers: ts.Expression[] } | undefined {
  const callee = unwrap(node.expression);
  if (!callee || !ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.name)) return undefined;
  const verb = callee.name.text.toLowerCase();
  if (!HTTP_METHODS.has(verb) || callee.name.text !== callee.name.text.toLowerCase() && callee.name.text !== callee.name.text.toUpperCase()) return undefined;
  const [first, ...rest] = node.arguments;
  if (!first || !ts.isStringLiteralLike(first) || !/^[/*]/.test(first.text) || rest.length === 0) return undefined;
  return { method: verb === "del" ? "DELETE" : verb.toUpperCase(), path: first.text, handlers: [...rest] };
}

/** NestJS-style `@Get("x")` on a method inside `@Controller("prefix")`. */
function decoratorRoute(member: ts.MethodDeclaration): { method: string; path: string; at: ts.Node } | undefined {
  for (const d of ts.getDecorators(member) ?? []) {
    const call = d.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || !ROUTE_DECORATORS.has(call.expression.text)) continue;
    const arg = call.arguments[0];
    const sub = arg && ts.isStringLiteralLike(arg) ? arg.text : "";
    let prefix = "";
    for (const cd of ts.getDecorators(member.parent as ts.ClassDeclaration) ?? []) {
      const c = cd.expression;
      if (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "Controller") {
        const a = c.arguments[0];
        if (a && ts.isStringLiteralLike(a)) prefix = a.text;
      }
    }
    const path = `/${[prefix, sub].map((x) => x.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;
    return { method: call.expression.text.toUpperCase(), path, at: d };
  }
  return undefined;
}

const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken, ts.SyntaxKind.CaretEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
]);

/** Name node of an assignment target (`x`, `this.x`, `obj.x`), if simple. */
function writeTarget(expr: ts.Expression): ts.Node | undefined {
  const e = unwrap(expr);
  if (!e) return undefined;
  if (ts.isIdentifier(e)) return e;
  if (ts.isPropertyAccessExpression(e)) return e.name;
  return undefined;
}

function isFunctionLike(e: ts.Expression): boolean {
  return ts.isArrowFunction(e) || ts.isFunctionExpression(e);
}

function memberName(node: ts.ClassElement): string | undefined {
  const name = node.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function analyzeSourceFile(sf: ts.SourceFile, scanned: ScannedFile, ctx: Ctx): FileAnalysis {
  const path = scanned.path;
  const fid = fileId(path);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const analysis: FileAnalysis = {
    path,
    hash: scanned.hash,
    analysisVersion: ANALYSIS_VERSION,
    language: scanned.language,
    resolution: "type-checker",
    nodes: [],
    edges: [],
    unresolved: [],
    pending: [],
    dependsOn: [],
    diagnostics: [],
  };
  const syntaxErrors = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (syntaxErrors.length > 0) {
    analysis.diagnostics.push(`${syntaxErrors.length} syntax error(s); extraction is best-effort`);
  }

  const loc = (node: ts.Node): { path: string; line: number; column: number } => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { path, line: line + 1, column: character + 1 };
  };
  const addEdge = (kind: EdgeKind, source: string, target: string, evidence: Evidence): void => {
    if (source === target) return;
    const id = edgeId(kind, source, target);
    const existing = edges.get(id);
    if (!existing || existing.evidence.confidence < evidence.confidence) edges.set(id, { id, kind, source, target, evidence });
  };
  const checked = (at: ts.Node, detail?: string): Evidence => ({
    provenance: "type-checker",
    confidence: 1,
    location: loc(at),
    ...(detail ? { detail } : {}),
  });

  /** Map a resolved symbol to a Fehm node id, or a package for external imports. */
  const resolveTarget = (at: ts.Node): { id?: string; pkg?: string } => {
    let symbol = ctx.checker.getSymbolAtLocation(at);
    if (!symbol) return {};
    if (symbol.flags & ts.SymbolFlags.Alias) {
      const aliased = ctx.checker.getAliasedSymbol(symbol);
      if (aliased.declarations?.length) symbol = aliased;
      else {
        const pkg = externalPackageOfAlias(symbol);
        return pkg ? { pkg } : {};
      }
    }
    for (const decl of symbol.declarations ?? []) {
      const declFile = ctx.toRel(decl.getSourceFile().fileName);
      if (!ctx.known.has(declFile)) continue;
      const info = declarationInfo(decl);
      if (info) return { id: symbolId(info.kind, declFile, info.qualified) };
    }
    return {};
  };
  const externalPackageOfAlias = (symbol: ts.Symbol): string | undefined => {
    const decl = symbol.declarations?.[0];
    let n: ts.Node | undefined = decl;
    while (n && !ts.isImportDeclaration(n)) n = n.parent;
    if (n && ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && isBare(n.moduleSpecifier.text)) {
      return packageName(n.moduleSpecifier.text);
    }
    return undefined;
  };

  const resolveModule = (specifier: string, at: ts.Node, evidence: Evidence, owner: string): void => {
    const resolved = ts.resolveModuleName(specifier, sf.fileName, ctx.options, ctx.host).resolvedModule;
    const target = resolved ? ctx.toRel(resolve(resolved.resolvedFileName)) : undefined;
    if (target && ctx.known.has(target)) {
      addEdge("imports", fid, fileId(target), evidence);
      return;
    }
    if (isBare(specifier)) {
      const name = packageName(specifier);
      addPackage(name, at);
      addEdge("imports", fid, packageId(name), { ...evidence, provenance: evidence.provenance === "type-checker" ? "ast" : evidence.provenance });
      return;
    }
    analysis.unresolved.push({ kind: "import", fromNode: owner, text: specifier, location: loc(at), reason: "module not found in repository" });
  };
  const addPackage = (name: string, at: ts.Node): void => {
    const id = packageId(name);
    if (!nodes.has(id)) nodes.set(id, { id, kind: "package", name, evidence: { provenance: "ast", confidence: 1, location: loc(at), detail: "external module" } });
  };

  const handledCallees = new Set<ts.Node>();

  const addRoute = (method: string, routePath: string, at: ts.Node, parent: string, confidence: number, detail: string): string => {
    const name = `${method} ${routePath}`;
    const id = symbolId("route", path, name);
    if (!nodes.has(id)) {
      const { line } = sf.getLineAndCharacterOfPosition(at.getStart(sf));
      const location = { path, line: line + 1, column: 1, endLine: line + 1 };
      nodes.set(id, {
        id,
        kind: "route",
        name,
        path,
        language: scanned.language,
        location,
        signature: at.getText(sf).split("\n")[0]!.trim().slice(0, 200),
        isTest: scanned.isTest,
        evidence: { provenance: "ast", confidence, location, detail },
      });
    }
    addEdge("defines", parent, id, { provenance: "ast", confidence, location: loc(at) });
    return id;
  };

  const visit = (node: ts.Node, owner: string, ownerKind: NodeKind | "file"): void => {
    const info = declarationInfo(node);
    if (info) {
      const id = symbolId(info.kind, path, info.qualified);
      const parentDefines = info.kind === "method" || info.kind === "field" ? classIdOf(node) : moduleIdOf(node) ?? fid;
      if (!nodes.has(id)) nodes.set(id, makeNode(node, info, id, sf, scanned, loc));
      addEdge("defines", parentDefines ?? fid, id, { provenance: "ast", confidence: 1, location: loc(node) });
      owner = id;
      ownerKind = info.kind;
    }

    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) resolveModule(spec.text, spec, checked(spec), fid);
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression;
      if (ts.isStringLiteral(expr)) resolveModule(expr.text, expr, checked(expr), fid);
      return;
    }

    // Assignments: `x = …`, `this.f += …`, `x++` write the resolved variable/field.
    const written =
      ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)
        ? writeTarget(node.left)
        : (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
            (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
          ? writeTarget(node.operand)
          : undefined;
    if (written) {
      const target = resolveTarget(written);
      const kind = target.id?.slice(0, target.id.indexOf(":"));
      if (target.id && (kind === "variable" || kind === "field")) {
        addEdge("writes", owner, target.id, checked(written));
        handledCallees.add(written);
      }
    }

    if (ts.isMethodDeclaration(node) && info) {
      const route = decoratorRoute(node);
      if (route) {
        const rid = addRoute(route.method, route.path, route.at, classIdOf(node) ?? fid, 0.9, "route decorator");
        addEdge("handles", symbolId(info.kind, path, info.qualified), rid, { provenance: "ast", confidence: 0.9, location: loc(route.at), detail: "decorated route handler" });
      }
    }
    if (ts.isCallExpression(node)) {
      const route = routeRegistration(node);
      // Only a registration whose handler is a function makes a route, so HTTP
      // *client* calls such as `axios.get("/api", options)` are not mistaken for one.
      const handlers: { id?: string; inline?: ts.ArrowFunction | ts.FunctionExpression; at: ts.Node }[] = [];
      for (const handler of route?.handlers ?? []) {
        const inner = unwrap(handler);
        if (!inner) continue;
        if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) handlers.push({ inline: inner, at: inner });
        else {
          const name = calleeName(inner);
          const t = name ? resolveTarget(name) : {};
          if (t.id && /^(function|method):/.test(t.id)) handlers.push({ id: t.id, at: inner });
        }
      }
      if (route && handlers.length > 0) {
        const rid = addRoute(route.method, route.path, node, owner, 0.85, `${node.expression.getText(sf)} registration`);
        let handled = false;
        for (const h of handlers) {
          if (h.id) {
            addEdge("handles", h.id, rid, { provenance: "ast", confidence: 0.85, location: loc(h.at), detail: "handler passed to route registration" });
            handled = true;
            continue;
          }
          // Inline handler: the repository functions it calls directly are the real handlers.
          const walk = (n: ts.Node): void => {
            if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && calleeName(n.expression)) {
              const t = resolveTarget(calleeName(n.expression)!);
              if (t.id && /^(function|method):/.test(t.id)) {
                addEdge("handles", t.id, rid, { provenance: "ast", confidence: 0.75, location: loc(n), detail: "called from inline route handler" });
                handled = true;
              }
            }
            ts.forEachChild(n, walk);
          };
          walk(h.inline!.body);
        }
        if (!handled && owner !== fid) {
          addEdge("handles", owner, rid, { provenance: "ast", confidence: 0.7, location: loc(node), detail: "inline handler registered here" });
        }
      }
    }

    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || isRequire(node))) {
      const arg = node.arguments[0];
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (arg && ts.isStringLiteralLike(arg)) {
        resolveModule(arg.text, arg, { provenance: "ast", confidence: dynamic ? 0.9 : 0.95, location: loc(arg), detail: dynamic ? "dynamic import" : "require" }, owner);
      } else {
        analysis.unresolved.push({
          kind: "dynamic-import",
          fromNode: owner,
          text: node.getText(sf).slice(0, 120),
          location: loc(node),
          reason: "module specifier is not a string literal",
        });
      }
      handledCallees.add(node.expression);
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = calleeName(node.expression);
      if (callee) {
        handledCallees.add(callee);
        const target = resolveTarget(callee);
        if (target.id) addEdge("calls", owner, target.id, checked(callee));
        else if (target.pkg) {
          addPackage(target.pkg, callee);
          addEdge("uses", owner, packageId(target.pkg), { provenance: "ast", confidence: 0.9, location: loc(callee), detail: `calls imported binding ${callee.getText(sf)}` });
        }
      }
    }

    if (ts.isHeritageClause(node)) {
      const kind: EdgeKind = node.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
      for (const type of node.types) {
        const target = resolveTarget(type.expression);
        if (target.id) addEdge(kind, owner, target.id, checked(type));
        else if (target.pkg) {
          addPackage(target.pkg, type);
          addEdge(kind, owner, packageId(target.pkg), { provenance: "ast", confidence: 0.9, location: loc(type), detail: `external base ${type.expression.getText(sf)}` });
        } else if (!ES_BUILTINS.has(type.expression.getText(sf))) {
          analysis.unresolved.push({ kind, fromNode: owner, text: type.getText(sf), location: loc(type), reason: "base type not declared in repository" });
        }
        handledCallees.add(type.expression);
      }
    }

    if (ts.isIdentifier(node) && !handledCallees.has(node) && !isDeclarationName(node) && ownerKind !== "file") {
      const target = resolveTarget(node);
      if (target.id && target.id !== owner) {
        const inType = isInTypePosition(node);
        addEdge(inType ? "uses" : "references", owner, target.id, checked(node, inType ? "type reference" : undefined));
      }
    } else if (ts.isIdentifier(node) && !handledCallees.has(node) && !isDeclarationName(node)) {
      // Module-level references (e.g. `export default router`, `app.use(x)` args).
      const target = resolveTarget(node);
      if (target.id) addEdge(isInTypePosition(node) ? "uses" : "references", fid, target.id, checked(node));
    }

    ts.forEachChild(node, (child) => visit(child, owner, ownerKind));
  };

  const moduleIdOf = (decl: ts.Node): string | undefined => {
    const anchor = ts.isVariableDeclaration(decl) ? decl.parent.parent : decl;
    if (ts.isModuleDeclaration(anchor) && ts.isModuleDeclaration(anchor.parent)) {
      const q = moduleQualifiedName(anchor.parent);
      return q === undefined ? undefined : symbolId("module", path, q);
    }
    const block = anchor.parent;
    if (!block || !ts.isModuleBlock(block)) return undefined;
    const q = moduleQualifiedName(block.parent);
    return q === undefined ? undefined : symbolId("module", path, q);
  };
  const classIdOf = (member: ts.Node): string | undefined => {
    const cls = ts.isParameter(member) ? member.parent.parent : member.parent;
    if (!cls) return undefined;
    const info = declarationInfo(ts.isClassExpression(cls) ? cls.parent : cls);
    return info ? symbolId(info.kind, path, info.qualified) : undefined;
  };

  ts.forEachChild(sf, (child) => visit(child, fid, "file"));

  analysis.nodes = [...nodes.values()].sort((a, b) => cmp(a.id, b.id));
  analysis.edges = [...edges.values()].sort((a, b) => cmp(a.id, b.id));
  const deps = new Set<string>();
  for (const edge of analysis.edges) {
    const p = pathOfId(edge.target);
    if (p && p !== path) deps.add(p);
  }
  analysis.dependsOn = [...deps].sort();
  return analysis;
}

function makeNode(
  node: ts.Node,
  info: DeclInfo,
  id: string,
  sf: ts.SourceFile,
  scanned: ScannedFile,
  loc: (n: ts.Node) => { path: string; line: number; column: number },
): GraphNode {
  const anchor = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  const endLine = sf.getLineAndCharacterOfPosition(anchor.getEnd()).line + 1;
  const location = { ...loc(anchor), endLine };
  const doc = leadingDoc(anchor, sf);
  const out: GraphNode = {
    id,
    kind: info.kind,
    name: info.qualified,
    path: scanned.path,
    language: scanned.language,
    location,
    signature: signatureOf(node, anchor, sf),
    exported: isExported(node, anchor),
    isTest: scanned.isTest,
    evidence: { provenance: "ast", confidence: 1, location },
  };
  if (doc) out.doc = doc;
  return out;
}

function signatureOf(node: ts.Node, anchor: ts.Node, sf: ts.SourceFile): string {
  const text = anchor.getText(sf);
  let cut = text.length;
  const body =
    (ts.isFunctionLike(node) && "body" in node ? (node.body as ts.Node | undefined) : undefined) ??
    (ts.isVariableDeclaration(node) && node.initializer && isFunctionLike(unwrap(node.initializer)!)
      ? (unwrap(node.initializer) as ts.ArrowFunction).body
      : undefined);
  if (body) cut = body.getStart(sf) - anchor.getStart(sf);
  else if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) {
    const brace = text.indexOf("{");
    if (brace >= 0) cut = brace;
  }
  const sig = text.slice(0, cut).replace(/\s+/g, " ").trim().replace(/[{=]\s*$/, "").trim();
  return sig.length > 200 ? `${sig.slice(0, 199)}…` : sig;
}

function leadingDoc(node: ts.Node, sf: ts.SourceFile): string | undefined {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? [];
  const last = ranges.at(-1);
  if (!last) return undefined;
  const raw = sf.text.slice(last.pos, last.end);
  if (!raw.startsWith("/**")) return undefined;
  const body = raw
    .replace(/^\/\*\*|\*\/$/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .filter((l) => !l.trim().startsWith("@"))
    .join(" ");
  return firstSentence(body);
}

function isExported(node: ts.Node, anchor: ts.Node): boolean {
  if (ts.isParameter(node)) {
    if (ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return false;
    const cls = node.parent.parent;
    return isExported(cls, cls);
  }
  if (ts.isPropertySignature(node)) return isExported(node.parent, node.parent);
  if (ts.isClassElement(node)) {
    const cls = node.parent;
    const flags = ts.getCombinedModifierFlags(node as ts.Declaration);
    if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return false;
    if (node.name && ts.isPrivateIdentifier(node.name)) return false;
    return !!cls && isExported(cls, ts.isClassExpression(cls) ? cls.parent.parent.parent : cls);
  }
  const target = ts.isVariableStatement(anchor) ? anchor : node;
  return (ts.getCombinedModifierFlags(target as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function calleeName(expr: ts.Expression): ts.Node | undefined {
  const e = unwrap(expr);
  if (!e) return undefined;
  if (ts.isIdentifier(e)) return e;
  if (ts.isPropertyAccessExpression(e)) return e.name;
  if (ts.isElementAccessExpression(e) && ts.isStringLiteral(e.argumentExpression)) return e.argumentExpression;
  return undefined;
}

function isRequire(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length === 1;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return !!parent && "name" in parent && (parent as { name?: ts.Node }).name === node && (ts.isDeclarationStatement(parent) || ts.isVariableDeclaration(parent) || ts.isClassElement(parent) || ts.isParameter(parent) || ts.isPropertyAssignment(parent) || ts.isBindingElement(parent) || ts.isTypeElement(parent) || ts.isEnumMember(parent));
}

function isInTypePosition(node: ts.Node): boolean {
  let n: ts.Node | undefined = node.parent;
  while (n && (ts.isQualifiedName(n) || ts.isPropertyAccessExpression(n))) n = n.parent;
  return !!n && (ts.isTypeReferenceNode(n) || ts.isExpressionWithTypeArguments(n) || ts.isTypeQueryNode(n));
}

function isBare(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

export function packageName(specifier: string): string {
  const s = specifier.replace(/^node:/, "");
  const parts = s.split("/");
  return s.startsWith("@") && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

