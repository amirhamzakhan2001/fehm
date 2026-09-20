import path from "node:path";
import ts from "typescript";
import { cacheCompilerReads } from "./compiler-host.js";
import type { FehmConfig } from "./config.js";
import { GraphBuilder } from "./graph.js";
import type { GraphNode, NodeKind, SourceLocation } from "./model.js";
import type { ScannedFile } from "./scanner.js";

export interface AnalysisResult {
  graph: GraphBuilder;
  unresolvedCalls: number;
  unresolvedCallsByFile: Record<string, number>;
}

export interface AnalysisOptions {
  includePaths?: ReadonlySet<string>;
}

const SYMBOL_KINDS = new Set<NodeKind>(["class", "interface", "function", "method", "variable", "type"]);

function fileId(relativePath: string): string {
  return `file:${relativePath}`;
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
}

function sourceLocation(sourceFile: ts.SourceFile, node: ts.Node, relativePath: string): SourceLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return { path: relativePath, line: start.line + 1, column: start.character + 1, endLine: end.line + 1 };
}

function declarationName(node: ts.Node): ts.Node | undefined {
  if ("name" in node && node.name && typeof node.name === "object") return node.name as ts.Node;
  return undefined;
}

function nameText(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isVariableDeclaration(node)) return ts.isIdentifier(node.name) ? node.name.text : undefined;
  const name = declarationName(node);
  if (name) return name.getText(sourceFile);
  return undefined;
}

function kindFor(node: ts.Node): NodeKind | undefined {
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isFunctionDeclaration(node)) return "function";
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && !ts.isVariableDeclaration(node.parent)) return "function";
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return "method";
  if (ts.isVariableDeclaration(node)) {
    return node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      ? "function"
      : "variable";
  }
  if (ts.isTypeAliasDeclaration(node)) return "type";
  return undefined;
}

function isExported(node: ts.Node): boolean {
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
}

function summaryFor(node: ts.Node, kind: NodeKind, name: string): string {
  if (kind === "class") return `Class ${name}`;
  if (kind === "interface") return `Interface ${name}`;
  if (kind === "type") return `Type alias ${name}`;
  if (kind === "variable") return `Variable ${name}`;
  const callable = node as ts.SignatureDeclaration;
  return `${kind === "method" ? "Method" : "Function"} ${name} with ${callable.parameters?.length ?? 0} parameter(s)`;
}

function normalizeAbsolute(value: string): string {
  return path.resolve(value);
}

interface GenericDeclaration {
  name: string;
  kind: NodeKind;
  offset: number;
  exported: boolean;
}

function lineColumn(content: string, offset: number, filePath: string, endLine?: number): SourceLocation {
  const before = content.slice(0, offset); const lines = before.split(/\r?\n/);
  return { path: filePath, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1, ...(endLine ? { endLine } : {}) };
}

function genericDeclarations(file: ScannedFile): GenericDeclaration[] {
  const result: GenericDeclaration[] = [];
  const collect = (pattern: RegExp, kind: NodeKind, nameGroup: number, exported: (match: RegExpMatchArray) => boolean): void => {
    for (const match of file.content.matchAll(pattern)) if (match[nameGroup]) result.push({ name: match[nameGroup] as string, kind, offset: match.index ?? 0, exported: exported(match) });
  };
  if (file.language === "python") {
    collect(/^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm, "function", 1, (match) => !(match[1] as string).startsWith("_"));
    collect(/^[ \t]*class\s+([A-Za-z_]\w*)\b/gm, "class", 1, (match) => !(match[1] as string).startsWith("_"));
  } else if (file.language === "go") {
    collect(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gm, "function", 1, (match) => /^[A-Z]/.test(match[1] as string));
    collect(/^\s*type\s+([A-Za-z_]\w*)\s+struct\b/gm, "class", 1, (match) => /^[A-Z]/.test(match[1] as string));
    collect(/^\s*type\s+([A-Za-z_]\w*)\s+interface\b/gm, "interface", 1, (match) => /^[A-Z]/.test(match[1] as string));
  } else if (file.language === "rust") {
    collect(/^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/gm, "function", 2, (match) => Boolean(match[1]));
    collect(/^\s*(pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)\b/gm, "class", 2, (match) => Boolean(match[1]));
    collect(/^\s*(pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)\b/gm, "interface", 2, (match) => Boolean(match[1]));
    collect(/^\s*(pub(?:\([^)]*\))?\s+)?(?:enum|type)\s+([A-Za-z_]\w*)\b/gm, "type", 2, (match) => Boolean(match[1]));
  } else if (file.language === "java") {
    collect(/^\s*(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+|static\s+)*(?:class|record|enum)\s+([A-Za-z_$][\w$]*)\b/gm, "class", 1, (match) => /\bpublic\b/.test(match[0]));
    collect(/^\s*(?:public\s+|protected\s+|private\s+|abstract\s+)*(?:interface|@interface)\s+([A-Za-z_$][\w$]*)\b/gm, "interface", 1, (match) => /\bpublic\b/.test(match[0]));
    collect(/^\s*(public|protected|private)?\s*(?:static\s+|final\s+|synchronized\s+|abstract\s+|native\s+)*(?:[A-Za-z_$][\w$<>,.?\[\] ]+\s+)([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?:throws\s+[^\{]+)?\{/gm, "method", 2, (match) => match[1] === "public");
  }
  return [...new Map(result.map((item) => [`${item.offset}:${item.kind}:${item.name}`, item])).values()].sort((left, right) => left.offset - right.offset);
}

function genericImports(file: ScannedFile): Array<{ specifier: string; offset: number }> {
  const patterns = file.language === "python" ? [/^\s*from\s+([.\w]+)\s+import\s+/gm, /^\s*import\s+([\w.]+)/gm]
    : file.language === "go" ? [/^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm, /^\s*"([^"]+)"\s*$/gm]
      : file.language === "rust" ? [/^\s*use\s+([^;]+);/gm, /^\s*mod\s+([A-Za-z_]\w*)\s*;/gm]
        : [/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm];
  return patterns.flatMap((pattern) => [...file.content.matchAll(pattern)].flatMap((match) => match[1] ? [{ specifier: match[1] as string, offset: match.index ?? 0 }] : []));
}

function analyzePolyglotFiles(graph: GraphBuilder, files: ScannedFile[], options: AnalysisOptions): void {
  const generic = files.filter((file) => !["javascript", "typescript"].includes(file.language));
  const paths = new Set(files.map((file) => file.relativePath));
  const symbolsByName = new Map<string, string[]>();
  for (const file of generic) {
    if (options.includePaths && !options.includePaths.has(file.relativePath)) continue;
    const declarations = genericDeclarations(file);
    for (const [index, declaration] of declarations.entries()) {
      const next = declarations[index + 1]; const location = lineColumn(file.content, declaration.offset, file.relativePath, next ? Math.max(1, lineColumn(file.content, next.offset, file.relativePath).line - 1) : file.content.split(/\r?\n/).length);
      const id = `symbol:${file.relativePath}:${location.line}:${location.column}:${declaration.name}`;
      graph.addNode({ id, kind: declaration.kind, name: declaration.name, qualifiedName: `${file.relativePath}#${declaration.name}`, path: file.relativePath, location, language: file.language, exported: declaration.exported, test: file.test, summary: `${declaration.kind === "method" ? "Method" : declaration.kind[0]?.toUpperCase()}${declaration.kind.slice(1)} ${declaration.name}`, summaryStatus: "fresh", summarySource: "deterministic" });
      graph.addEdge({ kind: "defines", source: fileId(file.relativePath), target: id, evidence: { provenance: "heuristic", confidence: 0.9, location, detail: `${file.language} declaration parser` } });
      const values = symbolsByName.get(declaration.name) ?? []; values.push(id); symbolsByName.set(declaration.name, values);
    }
    for (const imported of genericImports(file)) {
      const clean = imported.specifier.replace(/^crate::/, "").replace(/^\.+/, "").replace(/::/g, "/").replace(/\./g, "/");
      const directory = path.posix.dirname(file.relativePath); const local = directory === "." ? clean : `${directory}/${clean}`;
      const candidates = file.language === "python" ? [`${local}.py`, `${local}/__init__.py`, `${clean}.py`, `${clean}/__init__.py`]
        : file.language === "rust" ? [`src/${clean}.rs`, `src/${clean}/mod.rs`, `${clean}.rs`] : [];
      const target = candidates.find((candidate) => paths.has(candidate)); const location = lineColumn(file.content, imported.offset, file.relativePath);
      if (target) graph.addEdge({ kind: "imports", source: fileId(file.relativePath), target: fileId(target), evidence: { provenance: "heuristic", confidence: 0.9, location, detail: imported.specifier } });
      else {
        const name = imported.specifier.split(/[./:]/).filter(Boolean)[0]; if (!name) continue; const id = `package:${name}`;
        graph.addNode({ id, kind: "package", name, qualifiedName: name, summary: `External package ${name}`, summaryStatus: "fresh", summarySource: "deterministic" });
        graph.addEdge({ kind: "imports", source: fileId(file.relativePath), target: id, evidence: { provenance: "heuristic", confidence: 0.75, location, detail: imported.specifier } });
      }
    }
  }
  for (const file of generic) {
    if (options.includePaths && !options.includePaths.has(file.relativePath)) continue;
    for (const match of file.content.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const targets = symbolsByName.get(match[1] as string); if (targets?.length !== 1) continue;
      graph.addEdge({ kind: "calls", source: fileId(file.relativePath), target: targets[0] as string, evidence: { provenance: "heuristic", confidence: 0.7, location: lineColumn(file.content, match.index ?? 0, file.relativePath), detail: `${file.language} call-site parser` } });
    }
  }
}

export function analyzeTypeScript(config: FehmConfig, files: ScannedFile[], options: AnalysisOptions = {}): AnalysisResult {
  const graph = new GraphBuilder();
  const rootName = path.basename(config.root);
  const repositoryId = `repo:${rootName}`;
  graph.addNode({ id: repositoryId, kind: "repository", name: rootName, qualifiedName: rootName, path: "." });

  const scriptFiles = files.filter((file) => file.language === "javascript" || file.language === "typescript");
  const contents = new Map(scriptFiles.map((file) => [normalizeAbsolute(file.absolutePath), file.content]));
  const host = ts.createCompilerHost(
    {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
    },
    true,
  );
  cacheCompilerReads(host, contents);

  const program = ts.createProgram({ rootNames: scriptFiles.map((file) => file.absolutePath), options: {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  }, host });
  const checker = program.getTypeChecker();
  const fileByAbsolute = new Map(files.map((file) => [normalizeAbsolute(file.absolutePath), file]));
  const declarationIds = new Map<ts.Node, string>();
  const ownerDeclarations = new Set<ts.Node>();
  const sourceIds = new Map<string, string>();

  for (const file of files) {
    const id = fileId(file.relativePath);
    sourceIds.set(normalizeAbsolute(file.absolutePath), id);
    const directory = path.posix.dirname(file.relativePath);
    let containerId = repositoryId;
    if (directory !== ".") {
      let accumulated = "";
      for (const segment of directory.split("/")) {
        accumulated = accumulated ? `${accumulated}/${segment}` : segment;
        const directoryId = `directory:${accumulated}`;
        if (!graph.hasNode(directoryId)) {
          graph.addNode({
            id: directoryId,
            kind: "directory",
            name: segment,
            qualifiedName: accumulated,
            path: accumulated,
            summary: `Directory ${accumulated}`,
            summaryStatus: "fresh",
            summarySource: "deterministic",
          });
          graph.addEdge({
            kind: "contains",
            source: containerId,
            target: directoryId,
            evidence: { provenance: "filesystem", confidence: 1 },
          });
        }
        containerId = directoryId;
      }
    }
    graph.addNode({
      id,
      kind: "file",
      name: path.basename(file.relativePath),
      qualifiedName: file.relativePath,
      path: file.relativePath,
      language: file.language,
      test: file.test,
      summary: `${file.language} ${file.test ? "test " : ""}file`,
      summaryStatus: "fresh",
      summarySource: "deterministic",
    });
    graph.addEdge({ kind: "contains", source: containerId, target: id, evidence: { provenance: "filesystem", confidence: 1 } });
  }

  for (const sourceFile of program.getSourceFiles()) {
    const scanned = fileByAbsolute.get(normalizeAbsolute(sourceFile.fileName));
    if (!scanned) continue;
    const include = !options.includePaths || options.includePaths.has(scanned.relativePath);
    const parentStack: string[] = [fileId(scanned.relativePath)];

    const visit = (node: ts.Node): void => {
      const kind = kindFor(node);
      let pushed = false;
      if (kind && SYMBOL_KINDS.has(kind)) {
        let name = nameText(node, sourceFile);
        if (!name && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
          name = nameText(node.parent, sourceFile);
        }
        if (name) {
          const location = sourceLocation(sourceFile, node, scanned.relativePath);
          const id = `symbol:${scanned.relativePath}:${location.line}:${location.column}:${name}`;
          const parentId = parentStack[parentStack.length - 1] ?? fileId(scanned.relativePath);
          const parent = parentId.split(":").at(-1);
          const qualifiedName = parentId.startsWith("symbol:") ? `${parent}.${name}` : `${scanned.relativePath}#${name}`;
          const graphNode: GraphNode = {
            id,
            kind,
            name,
            qualifiedName,
            path: scanned.relativePath,
            location,
            language: scanned.language,
            exported: isExported(node) || (ts.isVariableDeclaration(node) && isExported(node.parent.parent)),
            test: scanned.test,
            summary: summaryFor(node, kind, name),
            summaryStatus: "fresh",
            summarySource: "deterministic",
          };
          if (include) {
            graph.addNode(graphNode);
            graph.addEdge({ kind: "defines", source: parentId, target: id, evidence: { provenance: "ast", confidence: 1, location } });
          }
          declarationIds.set(node, id);
          if (kind === "class" || kind === "interface" || kind === "function" || kind === "method") {
            ownerDeclarations.add(node);
          }
          if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
            declarationIds.set(node.parent, id);
          }
          if (kind === "class" || kind === "interface" || kind === "function" || kind === "method") {
            parentStack.push(id);
            pushed = true;
          }
        }
      }
      ts.forEachChild(node, visit);
      if (pushed) parentStack.pop();
    };
    visit(sourceFile);
  }

  const resolveDeclaration = (node: ts.Node): string | undefined => {
    let symbol = ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
    if (!symbol) return undefined;
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    for (const declaration of symbol.declarations ?? []) {
      const direct = declarationIds.get(declaration);
      if (direct) return direct;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const initialized = declarationIds.get(declaration.initializer);
        if (initialized) return initialized;
      }
    }
    return undefined;
  };

  const isDeclarationIdentifier = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    if (ts.isShorthandPropertyAssignment(parent)) return false;
    if (declarationName(parent) === node) return true;
    return ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent)
      || ts.isExportSpecifier(parent) || ts.isBindingElement(parent) && parent.name === node
      || ts.isPropertyAssignment(parent) && parent.name === node
      || ts.isPropertyDeclaration(parent) && parent.name === node;
  };

  let unresolvedCalls = 0;
  const unresolvedCallsByFile: Record<string, number> = {};
  for (const sourceFile of program.getSourceFiles()) {
    const scanned = fileByAbsolute.get(normalizeAbsolute(sourceFile.fileName));
    if (!scanned) continue;
    if (options.includePaths && !options.includePaths.has(scanned.relativePath)) continue;
    unresolvedCallsByFile[scanned.relativePath] = 0;
    const ownerStack: string[] = [fileId(scanned.relativePath)];

    const visit = (node: ts.Node): void => {
      const mapped = declarationIds.get(node);
      const ownsChildren = Boolean(mapped && ownerDeclarations.has(node));
      if (mapped && ownsChildren) ownerStack.push(mapped);

      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const location = sourceLocation(sourceFile, node.moduleSpecifier, scanned.relativePath);
        const symbol = checker.getSymbolAtLocation(node.moduleSpecifier);
        const declaration = symbol?.declarations?.find(ts.isSourceFile);
        const targetFile = declaration ? sourceIds.get(normalizeAbsolute(declaration.fileName)) : undefined;
        if (targetFile) {
          graph.addEdge({ kind: "imports", source: fileId(scanned.relativePath), target: targetFile, evidence: { provenance: "type-checker", confidence: 1, location } });
        } else if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
          const name = packageName(specifier);
          const id = `package:${name}`;
          graph.addNode({ id, kind: "package", name, qualifiedName: name, summary: `External package ${name}`, summaryStatus: "fresh", summarySource: "deterministic" });
          graph.addEdge({ kind: "imports", source: fileId(scanned.relativePath), target: id, evidence: { provenance: "ast", confidence: 1, location, detail: specifier } });
        }
      }

      if (ts.isCallExpression(node)) {
        const caller = ownerStack[ownerStack.length - 1] ?? fileId(scanned.relativePath);
        const callee = resolveDeclaration(node.expression);
        if (callee && caller !== callee) {
          graph.addEdge({
            kind: "calls",
            source: caller,
            target: callee,
            evidence: { provenance: "type-checker", confidence: 1, location: sourceLocation(sourceFile, node.expression, scanned.relativePath) },
          });
        } else if (!callee) {
          unresolvedCalls += 1;
          unresolvedCallsByFile[scanned.relativePath] = (unresolvedCallsByFile[scanned.relativePath] ?? 0) + 1;
        }
      }

      if (ts.isIdentifier(node) && !isDeclarationIdentifier(node)) {
        const owner = ownerStack[ownerStack.length - 1] ?? fileId(scanned.relativePath);
        const target = resolveDeclaration(node);
        const partOfCall = ts.isCallExpression(node.parent) && node.parent.expression === node;
        if (target && owner !== target && !partOfCall) {
          graph.addEdge({
            kind: "references",
            source: owner,
            target,
            evidence: { provenance: "type-checker", confidence: 1, location: sourceLocation(sourceFile, node, scanned.relativePath) },
          });
        }
      }

      if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node) || ts.isNewExpression(node)) {
        const owner = ownerStack[ownerStack.length - 1] ?? fileId(scanned.relativePath);
        const expression = ts.isTypeReferenceNode(node) ? node.typeName : node.expression;
        const target = resolveDeclaration(expression);
        if (target && owner !== target) {
          graph.addEdge({
            kind: "uses",
            source: owner,
            target,
            evidence: { provenance: "type-checker", confidence: 1, location: sourceLocation(sourceFile, expression, scanned.relativePath) },
          });
        }
      }

      if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && mapped) {
        for (const clause of node.heritageClauses ?? []) {
          for (const type of clause.types) {
            const target = resolveDeclaration(type.expression);
            if (!target) continue;
            graph.addEdge({
              kind: clause.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements",
              source: mapped,
              target,
              evidence: { provenance: "type-checker", confidence: 1, location: sourceLocation(sourceFile, type, scanned.relativePath) },
            });
          }
        }
      }

      ts.forEachChild(node, visit);
      if (mapped && ownsChildren) ownerStack.pop();
    };
    visit(sourceFile);
  }

  analyzePolyglotFiles(graph, files, options);

  return { graph, unresolvedCalls, unresolvedCallsByFile };
}
