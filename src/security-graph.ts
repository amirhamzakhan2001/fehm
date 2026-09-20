import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { CodeGraph, GraphNode, SecurityFlowNode, SecurityFlowReport, SecuritySeverity } from "./model.js";

interface Origin { node: SecurityFlowNode; steps: string[] }
interface SafeOrigin extends Origin { sanitizer: SecurityFlowNode }
interface ValueFlow { tainted: Origin[]; safe: SafeOrigin[] }
interface FunctionSummary { parameters: string[]; sinkParameters: Map<number, Array<{ name: string; node: ts.CallExpression }>>; returnParameters: Set<number> }

const SOURCE_PATTERN = /^(?:req|request)\.(?:body|query|params|headers)(?:\.|\[)|^process\.env\.|^(?:window\.)?location\.(?:search|hash)|^document\.cookie/;
const SANITIZERS = new Set(["sanitize", "escape", "encodeURIComponent", "validator", "parseInt", "safeParse", "parse", "validate"]);
const SINKS = new Set(["eval", "exec", "execSync", "execFile", "spawn", "query", "execute", "writeFile", "fetch", "setInnerHTML", "dangerouslySetInnerHTML"]);

function lineAt(sourceFile: ts.SourceFile, node: ts.Node): number { return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1; }
function ownerAt(graph: CodeGraph, filePath: string, line: number): GraphNode | undefined {
  return graph.nodes.filter((node) => node.path === filePath && node.location && node.location.line <= line && (node.location.endLine ?? node.location.line) >= line)
    .sort((a, b) => ((a.location?.endLine ?? 0) - (a.location?.line ?? 0)) - ((b.location?.endLine ?? 0) - (b.location?.line ?? 0)))[0];
}
function callName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return expression.getText().replace(/\s+/g, " ").slice(0, 80);
}
function emptyFlow(): ValueFlow { return { tainted: [], safe: [] }; }
function mergeFlows(flows: ValueFlow[]): ValueFlow {
  const tainted = new Map<string, Origin>(); const safe = new Map<string, SafeOrigin>();
  for (const flow of flows) {
    for (const origin of flow.tainted) tainted.set(origin.node.id, origin);
    for (const origin of flow.safe) safe.set(`${origin.node.id}:${origin.sanitizer.id}`, origin);
  }
  return { tainted: [...tainted.values()], safe: [...safe.values()] };
}
function severityFor(name: string): SecuritySeverity {
  return /^(?:eval|exec|execSync|spawn|setInnerHTML|dangerouslySetInnerHTML)$/.test(name) ? "high" : /^(?:query|execute|writeFile)$/.test(name) ? "medium" : "low";
}
function functionName(node: ts.SignatureDeclaration): string | undefined {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return undefined;
}

function collectFunctionSummaries(sourceFile: ts.SourceFile): Map<string, FunctionSummary> {
  const summaries = new Map<string, FunctionSummary>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      const callable = node as ts.SignatureDeclaration & { body: ts.ConciseBody };
      const name = functionName(callable); const parameters = callable.parameters.map((item) => item.name.getText(sourceFile));
      if (name) {
        const aliases = new Map<string, Set<number>>(parameters.map((parameter, index) => [parameter, new Set([index])]));
        const sinkParameters = new Map<number, Array<{ name: string; node: ts.CallExpression }>>(); const returnParameters = new Set<number>();
        const influences = (expression: ts.Expression): Set<number> => {
          if (ts.isIdentifier(expression)) return new Set(aliases.get(expression.text) ?? []);
          if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) return influences(expression.expression);
          if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isAwaitExpression(expression)) return influences(expression.expression);
          if (ts.isCallExpression(expression)) {
            if (SANITIZERS.has(callName(expression.expression))) return new Set();
            return new Set(expression.arguments.flatMap((argument) => [...influences(argument)]));
          }
          const values = new Set<number>(); expression.forEachChild((child) => { if (ts.isExpression(child)) for (const index of influences(child)) values.add(index); }); return values;
        };
        const inspect = (child: ts.Node): void => {
          if (child !== node && ts.isFunctionLike(child)) return;
          if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.initializer) aliases.set(child.name.text, influences(child.initializer));
          if (ts.isBinaryExpression(child) && child.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(child.left)) aliases.set(child.left.text, influences(child.right));
          if (ts.isReturnStatement(child) && child.expression) for (const index of influences(child.expression)) returnParameters.add(index);
          if (ts.isCallExpression(child) && SINKS.has(callName(child.expression))) for (const argument of child.arguments) for (const index of influences(argument)) sinkParameters.set(index, [...(sinkParameters.get(index) ?? []), { name: callName(child.expression), node: child }]);
          child.forEachChild(inspect);
        };
        callable.body.forEachChild(inspect); summaries.set(name, { parameters, sinkParameters, returnParameters });
      }
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit); return summaries;
}

export async function buildSecurityGraph(graph: CodeGraph): Promise<SecurityFlowReport> {
  const nodes = new Map<string, SecurityFlowNode>(); const edgeMap = new Map<string, SecurityFlowReport["edges"][number]>(); const pathMap = new Map<string, SecurityFlowReport["paths"][number]>();
  const addNode = (node: SecurityFlowNode): SecurityFlowNode => { nodes.set(node.id, node); return node; };
  const addEdge = (source: string, target: string, confidence: number): void => { edgeMap.set(`${source}->${target}`, { source, target, relation: "data-flow", confidence }); };

  for (const file of graph.nodes.filter((node) => node.kind === "file" && node.path && !node.test)) {
    let content: string; try { content = await readFile(path.join(graph.repository.root, file.path as string), "utf8"); } catch { continue; }
    const scriptKind = /\.tsx$/i.test(file.path as string) ? ts.ScriptKind.TSX : /\.[cm]?js$/i.test(file.path as string) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file.path as string, content, ts.ScriptTarget.Latest, true, scriptKind); const summaries = collectFunctionSummaries(sourceFile);
    const sourceNode = (expression: ts.Expression): SecurityFlowNode => {
      const line = lineAt(sourceFile, expression); const text = expression.getText(sourceFile); const id = `security:source:${file.path}:${expression.getStart(sourceFile)}`; const symbol = ownerAt(graph, file.path as string, line);
      return addNode({ id, kind: "source", label: `untrusted or sensitive input: ${text}`, path: file.path as string, line, ...(symbol ? { symbol } : {}), confidence: 0.96 });
    };
    const operationNode = (kind: "sanitizer" | "sink", expression: ts.Node, label: string, confidence: number): SecurityFlowNode => {
      const line = lineAt(sourceFile, expression); const id = `security:${kind}:${file.path}:${expression.getStart(sourceFile)}`; const symbol = ownerAt(graph, file.path as string, line);
      return addNode({ id, kind, label, path: file.path as string, line, ...(symbol ? { symbol } : {}), confidence });
    };
    const reportSink = (name: string, call: ts.CallExpression, flow: ValueFlow, via?: string): void => {
      if (!flow.tainted.length && !flow.safe.length) return;
      const sink = operationNode("sink", call, `security-sensitive sink: ${name}`, 0.92); const severity = severityFor(name);
      for (const origin of flow.tainted) {
        addEdge(origin.node.id, sink.id, via ? 0.82 : 0.94); const key = `${origin.node.id}:${sink.id}:unsafe`;
        pathMap.set(key, { source: origin.node, sink, steps: [...origin.steps, ...(via ? [`call ${via}`] : []), sink.symbol?.qualifiedName ?? `${sink.path}:${sink.line}`], sanitized: false, severity, confidence: via ? 0.82 : 0.94 });
      }
      for (const origin of flow.safe) {
        addEdge(origin.node.id, origin.sanitizer.id, 0.94); addEdge(origin.sanitizer.id, sink.id, 0.9); const key = `${origin.node.id}:${sink.id}:${origin.sanitizer.id}`;
        pathMap.set(key, { source: origin.node, sink, steps: [...origin.steps, origin.sanitizer.label, ...(via ? [`call ${via}`] : []), sink.symbol?.qualifiedName ?? `${sink.path}:${sink.line}`], sanitized: true, severity, confidence: via ? 0.78 : 0.9 });
      }
    };
    const evaluate = (expression: ts.Expression, environment: Map<string, ValueFlow>): ValueFlow => {
      const text = expression.getText(sourceFile).replace(/\s+/g, " ");
      if (SOURCE_PATTERN.test(text)) { const node = sourceNode(expression); return { tainted: [{ node, steps: [node.label] }], safe: [] }; }
      if (ts.isIdentifier(expression)) return environment.get(expression.text) ?? emptyFlow();
      if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression) || ts.isAwaitExpression(expression)) return evaluate(expression.expression, environment);
      if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) return evaluate(expression.expression, environment);
      if (ts.isCallExpression(expression)) {
        const name = callName(expression.expression); const argumentFlows = expression.arguments.map((argument) => evaluate(argument, environment)); const combined = mergeFlows(argumentFlows);
        if (SANITIZERS.has(name)) {
          const sanitizer = operationNode("sanitizer", expression, `validation or sanitization: ${name}`, 0.9);
          return { tainted: [], safe: [...combined.safe, ...combined.tainted.map((origin) => ({ ...origin, sanitizer }))] };
        }
        if (SINKS.has(name)) { reportSink(name, expression, combined); return combined; }
        const summary = summaries.get(name);
        if (summary) {
          for (const [index, sinks] of summary.sinkParameters) for (const sink of sinks) reportSink(sink.name, sink.node, argumentFlows[index] ?? emptyFlow(), name);
          return mergeFlows([...summary.returnParameters].map((index) => argumentFlows[index] ?? emptyFlow()));
        }
        return combined;
      }
      const flows: ValueFlow[] = []; expression.forEachChild((child) => { if (ts.isExpression(child)) flows.push(evaluate(child, environment)); }); return mergeFlows(flows);
    };
    const processScope = (scope: ts.Node): void => {
      const environment = new Map<string, ValueFlow>();
      const walk = (node: ts.Node): void => {
        if (node !== scope && ts.isFunctionLike(node)) return;
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) { environment.set(node.name.text, evaluate(node.initializer, environment)); return; }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) { environment.set(node.left.text, evaluate(node.right, environment)); return; }
        if (ts.isCallExpression(node)) { evaluate(node, environment); return; }
        node.forEachChild(walk);
      };
      scope.forEachChild(walk);
    };
    processScope(sourceFile);
    const visitFunctions = (node: ts.Node): void => { if (ts.isFunctionLike(node) && "body" in node && node.body) processScope(node.body as ts.ConciseBody); node.forEachChild(visitFunctions); };
    sourceFile.forEachChild(visitFunctions);
  }
  const values = [...nodes.values()]; const paths = [...pathMap.values()];
  return { nodes: values, edges: [...edgeMap.values()], paths, summary: { sources: values.filter((item) => item.kind === "source").length, sinks: values.filter((item) => item.kind === "sink").length, sanitizers: values.filter((item) => item.kind === "sanitizer").length, riskyPaths: paths.filter((item) => !item.sanitized && (item.severity === "high" || item.severity === "critical")).length } };
}
