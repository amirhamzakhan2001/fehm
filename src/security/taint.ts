import ts from "typescript";
import type { FehmEngine } from "../engine.js";
import type { GraphNode } from "../model.js";
import type { SinkKind, SourceKind, Trace, TraceStep } from "./types.js";

/**
 * Source → sink data flow for Feature 3.6.
 *
 * TypeScript/JavaScript (TypeScript compiler AST):
 *   - sources: HTTP request data (req/request/ctx query, params, body, headers,
 *     cookies, URL, searchParams, request.json()/formData()), LLM responses,
 *     and MCP / agent tool arguments;
 *   - propagation through declarations, assignments, destructuring, template
 *     literals, concatenation, method calls on tainted values and calls whose
 *     arguments are tainted (the transform the spec shows as `buildQuery()`),
 *     into closures;
 *   - sanitizers by function identity and by the sink they neutralise
 *     (numeric conversion neutralises everything; escaping only HTML/header
 *     sinks; basename and a startsWith guard only paths; allowlist guards
 *     (`if (!ALLOWED.includes(x)) return`) URL, path and redirect sinks);
 *     schema validation lowers confidence but does not neutralise injection;
 *   - parameterized SQL (`query("… $1", [x])`, tagged `sql\`\``) is safe;
 *   - one level of calls: each function is summarised (which parameter reaches
 *     which sink), and a tainted argument passed to it, in the same file or in
 *     a file the graph resolves, is followed into it.
 *
 * Python: the same sources and sinks over source lines within Feature 1's
 * function ranges (heuristic, labelled so).
 *
 * Sink kinds and sources follow Skylos' danger rules (SKY-D211/212/215/216/
 * 228/230/233/234/261/262); see THIRD_PARTY_NOTICES.md.
 */

export interface TaintFlow {
  path: string;
  trace: Trace;
  /** The enclosing function at the sink. */
  fn?: string;
  resolution: "ast" | "heuristic";
  /** Schema/validator calls seen on the path that do not neutralise the sink. */
  validated: boolean;
}

interface Taint {
  kind: SourceKind;
  label: string;
  steps: TraceStep[];
  /** Sink kinds already neutralised along this path. */
  neutral: Set<SinkKind | "all">;
  sanitizers: string[];
  validated: boolean;
  /** `req.body` itself (not a field): what mass assignment needs. */
  wholeBody?: boolean;
}

interface Summary {
  /** param index → sinks reached from it. */
  params: Map<number, { kind: SinkKind; label: string; steps: TraceStep[]; neutral: Set<SinkKind | "all"> }[]>;
}

const REQ_ROOTS = new Set(["req", "request", "ctx", "event", "c"]);
const REQ_PROPS = new Set(["query", "params", "body", "headers", "cookies", "url", "originalUrl", "path", "hostname", "files", "file", "searchParams", "queryStringParameters", "pathParameters", "rawBody", "signedCookies", "ip"]);
const REQ_READERS = new Set(["json", "formData", "text", "arrayBuffer", "blob"]);
const LLM_CALL = /(?:chat\.completions\.create|completions\.create|responses\.create|messages\.create|messages\.stream|generateContent|generateText|streamText|generateObject|streamObject|(?:^|\.)(?:llm|model|chain|agent|chatModel)\w*\.(?:invoke|call|predict|stream))$/i;
const DB_RECEIVER = /(?:^|\.)(?:db|conn|connection|client|pool|sequelize|knex|prisma|sql|database|cursor|tx|trx|stmt|pg|mysql|sqlite|query|repo|manager|entityManager)$/i;
const SQL_METHODS = new Set(["query", "execute", "raw", "unsafe", "$queryRawUnsafe", "$executeRawUnsafe", "exec", "prepare", "all", "get", "run", "each"]);
const FS_METHODS = new Set(["readFile", "readFileSync", "writeFile", "writeFileSync", "appendFile", "appendFileSync", "createReadStream", "createWriteStream", "unlink", "unlinkSync", "rm", "rmSync", "readdir", "readdirSync", "open", "openSync", "rename", "renameSync", "copyFile", "copyFileSync", "mkdir", "mkdirSync", "sendFile", "download", "stat", "statSync", "access", "accessSync"]);
const HTTP_CLIENT = /^(?:fetch|axios(?:\.(?:get|post|put|patch|delete|request|head))?|got(?:\.\w+)?|needle|superagent\.\w+|https?\.(?:get|request)|undici\.request|ky(?:\.\w+)?)$/;
const TEMPLATE_RENDER = /^(?:ejs\.render|pug\.render|pug\.compile|Handlebars\.compile|handlebars\.compile|nunjucks\.renderString|_\.template|lodash\.template|Mustache\.render|doT\.template)$/;
const NUMERIC = /^(?:parseInt|parseFloat|Number|Boolean|BigInt|Math\.\w+|isNaN)$/;
const HTML_ESCAPE = /(?:escape|sanitiz|purify|DOMPurify|encodeHTML|htmlEncode|he\.encode|xss|encodeURIComponent|encodeURI)$/i;
const PATH_SAFE = /(?:^|\.)basename$/;
const VALIDATOR = /(?:\.parse|\.safeParse|\.parseAsync|\.validate|\.validateSync|\.assert|^validate\w*|^assert\w*|^check\w*|\.cast)$/;

const STEP_SAMPLE = 8;

function calleeText(e: ts.Expression, sf: ts.SourceFile): string {
  return e.getText(sf).replace(/\s+/g, "").replace(/\?\./g, ".");
}

function lineOf(n: ts.Node, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
}

function isFn(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
}

function fnName(fn: ts.FunctionLikeDeclaration, sf: ts.SourceFile): string | undefined {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.getText(sf);
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p)) return p.name.getText(sf);
  return undefined;
}

function bindingNames(b: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(b)) out.push(b.text);
  else for (const el of b.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
  return out;
}

function neutralFor(callee: string): { kinds: (SinkKind | "all")[]; validated?: boolean } | undefined {
  const last = callee.split(".").pop() ?? callee;
  if (NUMERIC.test(callee) || NUMERIC.test(last)) return { kinds: ["all"] };
  if (PATH_SAFE.test(callee)) return { kinds: ["path"] };
  if (HTML_ESCAPE.test(callee)) return { kinds: /encodeURI/.test(callee) ? ["xss", "header", "redirect"] : ["xss", "header", "template"] };
  if (/(?:^|\.)(?:escapeId|escapeIdentifier|escapeLiteral|format)$/.test(callee) && /mysql|pg|sql|SqlString/i.test(callee)) return { kinds: ["sql"] };
  if (/(?:^|\.)quote$/.test(callee) && /shell|shlex/i.test(callee)) return { kinds: ["command"] };
  if (VALIDATOR.test(callee) || VALIDATOR.test(last)) return { kinds: [], validated: true };
  return undefined;
}

// ─── TypeScript / JavaScript ────────────────────────────────────────

export interface TaintContext {
  engine: FehmEngine;
  /** Files to analyse (source files in supported languages). */
  files: { path: string; language: string; lines: readonly string[] }[];
}

export function analyzeTaint(ctx: TaintContext): { flows: TaintFlow[]; analysed: { ast: number; heuristic: number } } {
  const flows: TaintFlow[] = [];
  const parsed = new Map<string, ts.SourceFile>();
  const analysed = { ast: 0, heuristic: 0 };
  for (const f of ctx.files) {
    if (f.language === "typescript" || f.language === "javascript") {
      if (/\.d\.[cm]?ts$/.test(f.path)) continue;
      const kind = /\.tsx$/.test(f.path) ? ts.ScriptKind.TSX : /\.jsx$/.test(f.path) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(f.path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
      parsed.set(f.path, ts.createSourceFile(f.path, f.lines.join("\n"), ts.ScriptTarget.Latest, true, kind));
      analysed.ast += 1;
    }
  }
  // Summaries: which parameter of which function reaches which sink. Two rounds so a wrapper of a wrapper is followed.
  const summaries = new Map<string, Summary>();
  const fnNodes = graphFunctionIndex(ctx.engine);
  for (let round = 0; round < 2; round += 1) {
    for (const [path, sf] of parsed) new FileAnalysis(path, sf, ctx.engine, summaries, fnNodes, true).run();
  }
  for (const [path, sf] of parsed) flows.push(...new FileAnalysis(path, sf, ctx.engine, summaries, fnNodes, false).run());
  for (const f of ctx.files) {
    if (f.language !== "python") continue;
    analysed.heuristic += 1;
    flows.push(...pythonTaint(f.path, f.lines, ctx.engine));
  }
  return { flows: dedupe(flows), analysed };
}

function dedupe(flows: TaintFlow[]): TaintFlow[] {
  const seen = new Map<string, TaintFlow>();
  for (const f of flows) {
    const sink = f.trace.steps.at(-1)!;
    const key = `${f.trace.source.kind}|${f.trace.sink.kind}|${sink.path}:${sink.line}`;
    const prev = seen.get(key);
    if (!prev || prev.trace.steps.length > f.trace.steps.length) seen.set(key, f);
  }
  return [...seen.values()];
}

/** Graph function/method nodes by `path:line`, to key summaries and resolve cross-file calls. */
function graphFunctionIndex(engine: FehmEngine): Map<string, GraphNode> {
  const out = new Map<string, GraphNode>();
  for (const n of engine.graph.nodes()) if ((n.kind === "function" || n.kind === "method") && n.path && n.location) out.set(`${n.path}:${n.location.line}`, n);
  return out;
}

class FileAnalysis {
  private readonly flows: TaintFlow[] = [];
  private readonly localFns = new Map<string, ts.FunctionLikeDeclaration>();

  constructor(
    private readonly path: string,
    private readonly sf: ts.SourceFile,
    private readonly engine: FehmEngine,
    private readonly summaries: Map<string, Summary>,
    private readonly fnNodes: Map<string, GraphNode>,
    private readonly summarising: boolean,
  ) {}

  run(): TaintFlow[] {
    const collect = (n: ts.Node): void => {
      if (isFn(n)) {
        const name = fnName(n, this.sf);
        if (name) this.localFns.set(name, n);
      }
      ts.forEachChild(n, collect);
    };
    collect(this.sf);
    if (this.summarising) {
      for (const fn of this.localFns.values()) this.summarise(fn);
      return [];
    }
    this.scope(this.sf, new Map(), undefined);
    return this.flows;
  }

  private key(fn: ts.FunctionLikeDeclaration): string {
    return `${this.path}:${lineOf(fn, this.sf)}`;
  }

  private step(role: TraceStep["role"], label: string, n: ts.Node): TraceStep {
    return { role, label: label.length > 120 ? `${label.slice(0, 117)}…` : label, path: this.path, line: lineOf(n, this.sf) };
  }

  /** Summarise a function: taint each parameter and record the sinks it reaches. */
  private summarise(fn: ts.FunctionLikeDeclaration): void {
    const summary: Summary = { params: new Map() };
    fn.parameters.forEach((p, i) => {
      const names = bindingNames(p.name);
      if (!names.length) return;
      const env = new Map<string, Taint>();
      for (const nm of names) env.set(nm, { kind: "http-request", label: `parameter ${nm}`, steps: [this.step("call", `${fnName(fn, this.sf) ?? "function"}(${nm})`, p)], neutral: new Set(), sanitizers: [], validated: false });
      const before = this.flows.length;
      if (fn.body) this.scope(fn.body, env, fn, true);
      const hits = this.flows.splice(before).map((f) => ({ kind: f.trace.sink.kind, label: f.trace.sink.label, steps: f.trace.steps.slice(1), neutral: new Set<SinkKind | "all">() }));
      if (hits.length) summary.params.set(i, hits);
    });
    if (summary.params.size) this.summaries.set(this.key(fn), summary);
  }

  /** Walk a scope in source order. `env` maps tainted local names. Nested functions inherit a copy (closures). */
  private scope(node: ts.Node, env: Map<string, Taint>, fn: ts.FunctionLikeDeclaration | undefined, summarising = false): void {
    const visit = (n: ts.Node): void => {
      if (isFn(n) && n !== fn) {
        const inner = new Map(env);
        this.bindParams(n, inner);
        if (n.body) this.scope(n.body, inner, n, summarising);
        return;
      }
      if (ts.isVariableDeclaration(n) && n.initializer) {
        ts.forEachChild(n, visit);
        const t = this.taintOf(n.initializer, env);
        for (const nm of bindingNames(n.name)) {
          if (t) env.set(nm, { ...t, steps: [...t.steps, this.step("transform", `${nm} = ${n.initializer.getText(this.sf).split("\n")[0]}`, n)].slice(-STEP_SAMPLE), wholeBody: Boolean(t.wholeBody && ts.isIdentifier(n.name)) });
          else env.delete(nm);
        }
        return;
      }
      if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.EqualsToken || n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)) {
        ts.forEachChild(n, visit);
        this.assignment(n, env);
        return;
      }
      if (ts.isIfStatement(n)) this.guard(n, env);
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) this.checkCall(n, env, fn);
      if (ts.isJsxAttribute(n) && n.name.getText(this.sf) === "dangerouslySetInnerHTML" && n.initializer) {
        const t = this.taintOf(n.initializer as ts.Expression, env);
        if (t) this.report(t, "xss", "dangerouslySetInnerHTML", n, fn);
      }
      if (ts.isTaggedTemplateExpression(n)) return; // sql`…${x}` is parameterized
      ts.forEachChild(n, visit);
    };
    if (!fn) visit(node);
    else ts.forEachChild(node, visit);
  }

  private bindParams(fn: ts.FunctionLikeDeclaration, env: Map<string, Taint>): void {
    for (const p of fn.parameters) for (const nm of bindingNames(p.name)) env.delete(nm);
    // MCP / agent tool callbacks: arguments come from the model.
    const call = fn.parent && ts.isCallExpression(fn.parent) ? fn.parent : undefined;
    const callee = call ? calleeText(call.expression, this.sf) : "";
    const prop = fn.parent && ts.isPropertyAssignment(fn.parent) ? fn.parent.name.getText(this.sf) : "";
    const toolish = /(?:^|\.)(?:tool|registerTool|addTool|setRequestHandler)$/.test(callee) || (prop === "execute" && /\btool\s*\(/.test(fn.parent.parent?.parent?.getText(this.sf).slice(0, 60) ?? ""));
    if (toolish) {
      for (const p of fn.parameters) for (const nm of bindingNames(p.name)) env.set(nm, { kind: "tool-argument", label: `tool argument ${nm}`, steps: [this.step("source", `tool argument ${nm} (chosen by the model)`, p)], neutral: new Set(), sanitizers: [], validated: false });
    }
  }

  private assignment(n: ts.BinaryExpression, env: Map<string, Taint>): void {
    const t = this.taintOf(n.right, env);
    const left = n.left;
    if (ts.isIdentifier(left)) {
      if (t) env.set(left.text, { ...t, steps: [...t.steps, this.step("transform", `${left.text} ${n.operatorToken.getText(this.sf)} …`, n)].slice(-STEP_SAMPLE) });
      else if (n.operatorToken.kind === ts.SyntaxKind.EqualsToken) env.delete(left.text);
      return;
    }
    if (!t) return;
    if (ts.isPropertyAccessExpression(left)) {
      const prop = left.name.text;
      if (prop === "innerHTML" || prop === "outerHTML") this.report(t, "xss", `${left.getText(this.sf)} =`, n, undefined);
      if ((prop === "href" || prop === "location") && /location/.test(left.getText(this.sf))) this.report(t, "redirect", `${left.getText(this.sf)} =`, n, undefined);
    }
    if (ts.isElementAccessExpression(left) && this.taintOf(left.argumentExpression, env) && ts.isElementAccessExpression(left.expression)) this.report(t, "prototype-pollution", `${left.getText(this.sf).split("\n")[0]} = …`, n, undefined);
  }

  /** `if (!ALLOWED.includes(x)) return/throw` (and startsWith/has/test) neutralises x for URL, path and redirect sinks. */
  private guard(n: ts.IfStatement, env: Map<string, Taint>): void {
    const cond = n.expression.getText(this.sf);
    const exits = (s: ts.Statement): boolean => ts.isReturnStatement(s) || ts.isThrowStatement(s) || (ts.isBlock(s) && s.statements.some((x) => ts.isReturnStatement(x) || ts.isThrowStatement(x)));
    if (!exits(n.thenStatement)) return;
    const kind = /\.(?:includes|has|indexOf)\(/.test(cond) ? "allowlist" : /\.startsWith\(/.test(cond) ? "prefix check" : /\.test\(|\.match\(/.test(cond) ? "pattern check" : undefined;
    if (!kind) return;
    for (const [nm, t] of env) {
      if (!new RegExp(`\\b${nm.replace(/\$/g, "\\$")}\\b`).test(cond)) continue;
      const neutral = new Set(t.neutral);
      for (const k of kind === "pattern check" ? (["path", "redirect", "ssrf", "header"] as const) : (["path", "redirect", "ssrf"] as const)) neutral.add(k);
      env.set(nm, { ...t, neutral, sanitizers: [...t.sanitizers, `${kind} at line ${lineOf(n, this.sf)}`], validated: kind === "pattern check" ? true : t.validated });
    }
  }

  /** Taint of an expression, or undefined. Sources are recognised here. */
  private taintOf(e: ts.Expression, env: Map<string, Taint>): Taint | undefined {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) return this.taintOf(e.expression, env);
    if (ts.isIdentifier(e)) return env.get(e.text);
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      const src = this.requestSource(e);
      if (src) return src;
      const llm = this.llmOutput(e, env);
      if (llm) return llm;
      const base = this.taintOf(e.expression, env);
      if (base) return { ...base, wholeBody: false };
      return undefined;
    }
    if (ts.isCallExpression(e)) {
      const callee = calleeText(e.expression, this.sf);
      const src = this.requestSource(e);
      if (src) return src;
      if (LLM_CALL.test(callee)) {
        return { kind: "llm-output", label: `${callee}(…) response`, steps: [this.step("source", `LLM response from ${callee}(…)`, e)], neutral: new Set(), sanitizers: [], validated: false };
      }
      const argTaints = e.arguments.map((a) => this.taintOf(a, env)).filter((x): x is Taint => Boolean(x));
      const recv = ts.isPropertyAccessExpression(e.expression) ? this.taintOf(e.expression.expression, env) : undefined;
      const t = argTaints[0] ?? recv;
      if (!t) return undefined;
      const neutral = neutralFor(callee);
      if (neutral) {
        const n = new Set(t.neutral);
        for (const k of neutral.kinds) n.add(k);
        return { ...t, wholeBody: false, neutral: n, sanitizers: [...t.sanitizers, `${callee}()`], validated: t.validated || Boolean(neutral.validated), steps: [...t.steps, this.step("sanitizer", `${callee}(…)`, e)].slice(-STEP_SAMPLE) };
      }
      const role = recv && !argTaints.length ? "transform" : "call";
      return { ...t, wholeBody: false, steps: [...t.steps, this.step(role, `${callee}(…)`, e)].slice(-STEP_SAMPLE) };
    }
    if (ts.isTemplateExpression(e)) return this.first(e.templateSpans.map((s) => s.expression), env, "template string");
    if (ts.isBinaryExpression(e)) {
      if (e.operatorToken.kind === ts.SyntaxKind.PlusToken) return this.first([e.left, e.right], env, "string concatenation");
      if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(e.operatorToken.kind)) return this.taintOf(e.left, env) ?? this.taintOf(e.right, env);
      return undefined;
    }
    if (ts.isConditionalExpression(e)) return this.taintOf(e.whenTrue, env) ?? this.taintOf(e.whenFalse, env);
    if (ts.isArrayLiteralExpression(e)) return this.first(e.elements.map((x) => (ts.isSpreadElement(x) ? x.expression : x)), env);
    if (ts.isObjectLiteralExpression(e)) {
      const vals: ts.Expression[] = [];
      for (const p of e.properties) {
        if (ts.isPropertyAssignment(p)) vals.push(p.initializer);
        else if (ts.isShorthandPropertyAssignment(p)) vals.push(p.name);
        else if (ts.isSpreadAssignment(p)) vals.push(p.expression);
      }
      return this.first(vals, env);
    }
    if (ts.isSpreadElement(e)) return this.taintOf(e.expression, env);
    return undefined;
  }

  private first(exprs: readonly ts.Expression[], env: Map<string, Taint>, via?: string): Taint | undefined {
    for (const x of exprs) {
      const t = this.taintOf(x, env);
      if (t) return via ? { ...t, wholeBody: false, steps: [...t.steps, this.step("transform", via, x)].slice(-STEP_SAMPLE) } : t;
    }
    return undefined;
  }

  private requestSource(e: ts.Expression): Taint | undefined {
    const text = calleeText(e, this.sf);
    const parts = text.split(/[.[]/);
    const root = parts[0] ?? "";
    const mk = (label: string, whole = false): Taint => ({ kind: "http-request", label, steps: [this.step("source", label, e)], neutral: new Set(), sanitizers: [], validated: false, wholeBody: whole });
    if (ts.isCallExpression(e)) {
      if (ts.isPropertyAccessExpression(e.expression)) {
        const m = e.expression.name.text;
        const recv = calleeText(e.expression.expression, this.sf);
        if (m === "get" && /(?:^|\.)searchParams$/.test(recv)) return mk(`${recv}.get(…)`);
        if (REQ_READERS.has(m) && REQ_ROOTS.has(recv)) return mk(`${recv}.${m}()`, m === "json" || m === "formData");
        if ((m === "param" || m === "get" || m === "header") && REQ_ROOTS.has(recv) && recv !== "c") return mk(`${recv}.${m}(…)`);
        if (recv === "c.req" && ["query", "param", "json", "header", "parseBody", "text"].includes(m)) return mk(`c.req.${m}(…)`, m === "json" || m === "parseBody");
      }
      return undefined;
    }
    if (!REQ_ROOTS.has(root) || root === "c") return undefined;
    const prop = root === "ctx" && parts[1] === "request" ? parts[2] : parts[1];
    if (!prop || !REQ_PROPS.has(prop)) return undefined;
    if (root === "event" && !["body", "queryStringParameters", "pathParameters", "headers"].includes(prop)) return undefined;
    return mk(text.split("\n")[0]!, prop === "body" && parts.length === (root === "ctx" ? 3 : 2));
  }

  private llmOutput(e: ts.PropertyAccessExpression | ts.ElementAccessExpression, env: Map<string, Taint>): Taint | undefined {
    const t = calleeText(e, this.sf);
    if (!/\.(?:choices|content|output_text|text|message|candidates)\b/.test(t)) return undefined;
    let root: ts.Expression = e;
    while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) root = root.expression;
    const base = ts.isIdentifier(root) ? env.get(root.text) : undefined;
    return base?.kind === "llm-output" ? base : undefined;
  }

  // ─── sinks ─────────────────────────────────────────────────────────

  private checkCall(n: ts.CallExpression | ts.NewExpression, env: Map<string, Taint>, fn: ts.FunctionLikeDeclaration | undefined): void {
    const callee = calleeText(n.expression, this.sf);
    const args = n.arguments ?? ts.factory.createNodeArray();
    const last = callee.split(".").pop() ?? callee;
    const recv = callee.includes(".") ? callee.slice(0, callee.lastIndexOf(".")) : "";
    const arg = (i: number): Taint | undefined => (args[i] ? this.taintOf(args[i]!, env) : undefined);
    const hit = (kind: SinkKind, i: number, label = `${callee}(…)`): void => {
      const t = arg(i);
      if (t) this.report(t, kind, label, n, fn);
    };

    if (ts.isNewExpression(n)) {
      if (callee === "Function") args.forEach((_, i) => hit("code-eval", i, "new Function(…)"));
      else if (callee === "RegExp") hit("regex", 0, "new RegExp(…)");
      else if (/^[A-Z]\w*$/.test(callee) && args.length === 1) this.massAssignment(arg(0), n, fn, `new ${callee}(…)`);
      return;
    }
    // SQL: text argument built from tainted data; parameters in a separate array are safe.
    const kvLike = ["get", "all", "run", "each", "prepare"].includes(last) && !/(?:^|\.)(?:db|sqlite|database|stmt)$/i.test(recv);
    if (SQL_METHODS.has(last) && !kvLike && (DB_RECEIVER.test(recv) || last.startsWith("$"))) {
      const first = args[0];
      if (first && !ts.isStringLiteral(first) && !ts.isNoSubstitutionTemplateLiteral(first) && !ts.isTaggedTemplateExpression(first)) hit("sql", 0, `${callee}(…) SQL text`);
    }
    if (/^(?:child_process\.)?(?:exec|execSync)$/.test(callee) || /(?:^|\.)(?:exec|execSync)$/.test(callee) && /child_process|cp|childProcess/.test(recv)) hit("command", 0);
    else if (/^(?:child_process\.)?(?:spawn|spawnSync|execFile|execFileSync)$/.test(callee)) {
      hit("command", 0);
      const opts = args.find((a) => ts.isObjectLiteralExpression(a) && /\bshell\s*:\s*true/.test(a.getText(this.sf)));
      if (opts && args[1]) hit("command", 1, `${callee}(…, { shell: true })`);
    }
    if (callee === "eval" || /^vm\.(?:runIn\w+|compileFunction)$/.test(callee) || (/^(?:setTimeout|setInterval)$/.test(callee) && args[0] && !isFn(args[0]))) hit("code-eval", 0);
    if (FS_METHODS.has(last) && (/^(?:fs|fsp|fs\.promises|promises|fse|res|reply)$/.test(recv) || /^(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream)$/.test(callee))) hit("path", 0);
    // A fixed scheme and host with a variable path is not SSRF; a fixed relative path is not an open redirect.
    const fixedPrefix = (i: number, re: RegExp): boolean => {
      const a = args[i];
      const head = !a ? "" : ts.isTemplateExpression(a) ? a.head.text : ts.isBinaryExpression(a) && (ts.isStringLiteral(a.left) || ts.isNoSubstitutionTemplateLiteral(a.left)) ? a.left.text : "";
      return re.test(head);
    };
    if (HTTP_CLIENT.test(callee) && !fixedPrefix(0, /^https?:\/\/[^/${}]+\//i)) hit("ssrf", 0);
    const ri = args.length > 1 && ts.isNumericLiteral(args[0]!) ? 1 : 0;
    if (/(?:^|\.)redirect$/.test(callee) && !fixedPrefix(ri, /^\/(?!\/)|^https?:\/\/[^/${}]+\//i)) hit("redirect", ri);
    if (/^(?:res|reply|response)\.(?:send|end|write)$/.test(callee) && args[0] && !ts.isObjectLiteralExpression(args[0]) && !ts.isArrayLiteralExpression(args[0])) {
      const t = arg(0);
      if (t && t.kind !== "llm-output") this.report(t, "xss", `${callee}(…) HTML response`, n, fn);
    }
    if (/^document\.(?:write|writeln)$/.test(callee) || last === "insertAdjacentHTML") hit("xss", last === "insertAdjacentHTML" ? 1 : 0);
    if (/^(?:res|reply|response)\.(?:setHeader|set|header|append)$/.test(callee)) {
      const name = args[0] && ts.isStringLiteral(args[0]) ? args[0].text.toLowerCase() : "";
      hit(name === "location" ? "redirect" : "header", 1, `${callee}("${name || "…"}", …)`);
    }
    if (/(?:^|\.)unserialize$|^v8\.deserialize$|^serialize\.unserialize$/.test(callee)) hit("deserialization", 0);
    if (TEMPLATE_RENDER.test(callee)) hit("template", 0);
    if (/^(?:_|lodash)\.(?:set|setWith)$|^(?:set|setWith|setValue)$/.test(callee)) hit("prototype-pollution", 1, `${callee}(obj, path, …)`);
    if (/^(?:_|lodash)\.(?:merge|mergeWith|defaultsDeep)$|^(?:deepmerge|merge)$/.test(callee)) {
      const t = arg(1);
      if (t?.wholeBody) this.report(t, "prototype-pollution", `${callee}(…, request body)`, n, fn);
    }
    if (/\.(?:create|update|insert|insertOne|updateOne|findOneAndUpdate|build|upsert|save)$/.test(callee) || callee === "Object.assign") this.massAssignment(arg(callee === "Object.assign" ? 1 : callee.endsWith("updateOne") || callee.endsWith("findOneAndUpdate") ? 1 : 0), n, fn, `${callee}(…)`);
    if (LLM_CALL.test(callee)) {
      for (let i = 0; i < args.length; i += 1) {
        const t = arg(i);
        if (t && t.kind === "http-request") this.report(t, "llm-prompt", `${callee}(…) prompt`, n, fn);
      }
    }
    // One level into summarised functions (same file, or resolved through the graph).
    const summary = this.summaryFor(n, callee, fn);
    if (summary) {
      for (const [i, sinks] of summary.params) {
        const t = arg(i);
        if (!t) continue;
        for (const s of sinks) {
          if (t.neutral.has("all") || t.neutral.has(s.kind)) continue;
          const merged: Taint = { ...t, steps: [...t.steps, this.step("call", `${callee}(…)`, n)].slice(-STEP_SAMPLE) };
          this.report(merged, s.kind, s.label, n, fn, s.steps);
        }
      }
    }
  }

  private massAssignment(t: Taint | undefined, n: ts.Node, fn: ts.FunctionLikeDeclaration | undefined, label: string): void {
    if (t?.wholeBody && t.kind === "http-request") this.report(t, "mass-assignment", label, n, fn);
  }

  private summaryFor(n: ts.CallExpression, callee: string, fn: ts.FunctionLikeDeclaration | undefined): Summary | undefined {
    const short = callee.split(".").pop()!;
    const local = !callee.includes(".") || callee.startsWith("this.") ? this.localFns.get(short) : undefined;
    if (local && local !== fn) return this.summaries.get(this.key(local));
    // Cross-file: the graph's calls from the enclosing function (or the file) to a function of that name.
    const from = fn ? this.fnNodes.get(this.key(fn)) : undefined;
    const fromId = from?.id ?? `file:${this.path}`;
    for (const e of this.engine.graph.edgesOf(fromId, "out", ["calls"])) {
      const t = this.engine.graph.node(e.target);
      if (!t?.path || !t.location || t.name.split(".").pop() !== short) continue;
      const s = this.summaries.get(`${t.path}:${t.location.line}`);
      if (s) return s;
    }
    void n;
    return undefined;
  }

  private report(t: Taint, kind: SinkKind, label: string, n: ts.Node, fn: ts.FunctionLikeDeclaration | undefined, tail: TraceStep[] = []): void {
    if (t.neutral.has("all") || t.neutral.has(kind)) return;
    if (t.kind === "llm-output" && !["code-eval", "command", "sql", "xss", "path", "deserialization", "template"].includes(kind)) return;
    if (kind === "llm-prompt" && t.kind !== "http-request") return;
    // Through a summarised call, the callee's own sink step ends the trace.
    const steps = tail.length ? [...t.steps, ...tail] : [...t.steps, this.step("sink", label, n)];
    this.flows.push({
      path: this.path,
      trace: { source: { kind: t.kind, label: t.label }, sink: { kind, label }, steps, sanitizers: t.sanitizers, interprocedural: tail.length > 0 || steps.some((s) => s.role === "call") },
      ...(fn ? { fn: fnName(fn, this.sf) ?? "(anonymous)" } : {}),
      resolution: "ast",
      validated: t.validated,
    });
  }
}

// ─── Python (heuristic) ─────────────────────────────────────────────

const PY_SOURCE = /\brequest\.(?:args|form|values|json|data|files|cookies|headers|GET|POST|body|query_params|path_params|get_json\(\)|get_data\(\))/;
const PY_ROUTE = /^\s*@(?:[\w.]+\.)?(?:route|get|post|put|patch|delete|api_route|api_view|websocket)\b/;
const PY_SANITIZER = /\b(?:int|float|bool|secure_filename|shlex\.quote|escape|bleach\.clean|html\.escape|markupsafe\.escape|os\.path\.basename|uuid\.UUID)\(/;
const PY_SINKS: [SinkKind, RegExp][] = [
  ["sql", /\.(?:execute|executemany|executescript|raw)\(|\btext\(/],
  ["command", /\bos\.(?:system|popen)\(|\bsubprocess\.\w+\([^)]*shell\s*=\s*True|\bcommands\.getoutput\(/],
  ["code-eval", /(?<![\w.])(?:eval|exec)\(/],
  ["path", /(?<![\w.])open\(|\bsend_file\(|\bsend_from_directory\(|\bos\.(?:remove|unlink|rmdir)\(|\bshutil\.(?:rmtree|copy\w*|move)\(/],
  ["ssrf", /\b(?:requests|httpx)\.(?:get|post|put|delete|patch|head|request)\(|\burlopen\(/],
  ["redirect", /(?<![\w.])redirect\(|\bRedirectResponse\(|\bHttpResponseRedirect\(/],
  ["template", /\brender_template_string\(|\bTemplate\(|\bjinja2\.Template\(/],
  ["deserialization", /\bpickle\.loads?\(|\bmarshal\.loads?\(|\byaml\.load\((?![^)]*Loader\s*=\s*yaml\.SafeLoader)|\bjsonpickle\.decode\(/],
  ["xss", /\bMarkup\(|\bmark_safe\(|\bHttpResponse\(/],
  ["llm-prompt", /\.(?:chat\.completions\.create|messages\.create|responses\.create|generate_content|invoke)\(/],
];

function pythonTaint(path: string, lines: readonly string[], engine: FehmEngine): TaintFlow[] {
  const out: TaintFlow[] = [];
  const fns = engine.graph.nodes().filter((n) => (n.kind === "function" || n.kind === "method") && n.path === path && n.location?.endLine);
  const step = (role: TraceStep["role"], label: string, line: number): TraceStep => ({ role, label: label.trim().slice(0, 120), path, line });
  for (const fn of fns) {
    const line = fn.location!.line;
    const endLine = fn.location!.endLine!;
    const tainted = new Map<string, { label: string; steps: TraceStep[]; neutral: boolean }>();
    // Parameters of a route handler come from the request.
    const decorated = lines.slice(Math.max(0, line - 6), line - 1).some((l) => PY_ROUTE.test(l));
    if (decorated) {
      const sig = lines.slice(line - 1, Math.min(endLine, line + 4)).join(" ");
      const params = /\(([^)]*)\)/.exec(sig)?.[1] ?? "";
      for (const p of params.split(",")) {
        const nm = p.trim().split(/[:=\s]/)[0]!.replace(/^\*+/, "");
        if (nm && !/^(?:self|cls|request|db|session|background_tasks|response)$/.test(nm) && !/Depends\(/.test(p)) tainted.set(nm, { label: `route parameter ${nm}`, steps: [step("source", `route parameter ${nm}`, line)], neutral: false });
      }
    }
    for (let i = line; i < endLine && i < lines.length; i += 1) {
      const raw = lines[i]!;
      const l = raw.replace(/#.*$/, "");
      if (!l.trim()) continue;
      const names = [...tainted.keys()];
      const mentions = (s: string): string | undefined => names.find((nm) => new RegExp(`\\b${nm}\\b`).test(s));
      const assign = /^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)\s*(.+)$/.exec(l);
      if (assign) {
        const [, target, rhs] = assign as unknown as [string, string, string];
        const src = PY_SOURCE.exec(rhs);
        const via = mentions(rhs);
        if (src || via) {
          const base = src ? { label: src[0], steps: [step("source", src[0], i + 1)], neutral: false } : tainted.get(via!)!;
          const neutral = base.neutral || PY_SANITIZER.test(rhs);
          tainted.set(target, { label: base.label, steps: [...base.steps, step(PY_SANITIZER.test(rhs) ? "sanitizer" : "transform", `${target} = ${rhs}`, i + 1)].slice(-STEP_SAMPLE), neutral });
          continue;
        } else if (tainted.has(target)) tainted.delete(target);
      }
      for (const [kind, re] of PY_SINKS) {
        if (!re.test(l)) continue;
        const direct = PY_SOURCE.exec(l);
        const via = mentions(l);
        if (!direct && !via) continue;
        const t = direct ? { label: direct[0], steps: [step("source", direct[0], i + 1)], neutral: false } : tainted.get(via!)!;
        if (t.neutral || PY_SANITIZER.test(l)) continue;
        if (kind === "sql") {
          // Parameterized: a plain string literal followed by a parameter tuple/dict.
          if (/\.(?:execute|executemany)\(\s*(?:[rbu]?["'][^"']*["'])\s*,/.test(l) && !/\bf["']/.test(l) && !/["']\s*(?:%|\+|\.format)/.test(l)) continue;
        }
        out.push({ path, trace: { source: { kind: "http-request", label: t.label }, sink: { kind, label: l.trim().slice(0, 100) }, steps: [...t.steps, step("sink", l, i + 1)], sanitizers: [], interprocedural: false }, fn: fn.name, resolution: "heuristic", validated: false });
      }
    }
  }
  return out;
}
