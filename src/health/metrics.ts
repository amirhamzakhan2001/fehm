import ts from "typescript";
import { stripRegexLiterals, stripStrings } from "../codebase-briefing/facts.js";
import type { GraphNode, Language } from "../model.js";
import type { FileAnalysisResult, FunctionMetrics, PatternHit, TestFileFacts } from "./types.js";

/**
 * Per-file analysis for Feature 3.5: function metrics (cyclomatic and
 * cognitive complexity, nesting, length, parameters), pattern hits
 * (reliability, dead code, AI-code indicators) and, for test files, test
 * facts. It depends only on the file's content, so results are cached by
 * content hash.
 *
 * TypeScript and JavaScript are parsed with the TypeScript compiler (`ast`).
 * Python, Go, Java and Rust use line-level analysis over the function ranges
 * the Feature 1 analyzer already found (`heuristic`). The complexity rules
 * follow Skylos (SKY-Q301, Q306, Q302, C303, C304, Q305); see
 * THIRD_PARTY_NOTICES.md.
 */

const TS_LANGS = new Set<Language>(["typescript", "javascript"]);
const HEURISTIC_LANGS = new Set<Language>(["python", "go", "java", "rust"]);

export function analyzable(language: Language): "ast" | "heuristic" | undefined {
  return TS_LANGS.has(language) ? "ast" : HEURISTIC_LANGS.has(language) ? "heuristic" : undefined;
}

export interface FileInput {
  path: string;
  hash: string;
  language: Language;
  lines: readonly string[];
  isTest: boolean;
  /** Function/method nodes the Feature 1 analyzer found in this file (heuristic ranges). */
  functions: GraphNode[];
}

export function analyzeFile(input: FileInput): FileAnalysisResult | undefined {
  const mode = analyzable(input.language);
  if (!mode || /\.d\.[cm]?ts$/.test(input.path)) return undefined;
  const base: FileAnalysisResult = { path: input.path, hash: input.hash, resolution: mode, functions: [], classes: [], hits: [] };
  if (mode === "ast") analyzeTypeScript(input, base);
  else analyzeHeuristic(input, base);
  base.hits.push(...lineHits(input));
  return base;
}

// ─── line patterns (every language) ─────────────────────────────────

const SUPPRESSION = /(?:\/\/|\/\*)\s*@ts-(ignore|nocheck)\b|\/\/\s*@ts-expect-error\s*$|#\s*type:\s*ignore\s*$/;
const BLANKET_LINT = /\/\*\s*eslint-disable\s*\*\/|\/\/\s*eslint-disable\s*$|#\s*noqa\s*$|#\s*pylint:\s*disable\s*=\s*all\b|#\s*ruff:\s*noqa\s*$|#\s*flake8:\s*noqa\b/;
const PY_DEBUG = /^\s*(?:breakpoint\(\)|(?:i?pdb)\.set_trace\(\)|import\s+i?pdb\b)/;
const DISABLED_CONTROL: [RegExp, string][] = [
  [/\brejectUnauthorized\s*:\s*false\b/, "TLS certificate verification disabled (rejectUnauthorized: false)"],
  [/\bstrictSSL\s*:\s*false\b/, "TLS verification disabled (strictSSL: false)"],
  [/\bverify\s*=\s*False\b/, "TLS certificate verification disabled (verify=False)"],
  [/\bssl\._create_unverified_context\(/, "unverified SSL context"],
  [/\bcheck_hostname\s*=\s*False\b/, "TLS hostname check disabled"],
  [/\bInsecureSkipVerify\s*:\s*true\b/, "TLS verification disabled (InsecureSkipVerify: true)"],
  [/^\s*@csrf_exempt\b/, "CSRF protection disabled for a view (@csrf_exempt)"],
  [/\bWTF_CSRF_ENABLED\s*=\s*False\b/, "CSRF protection disabled (WTF_CSRF_ENABLED = False)"],
];
/** Checked on the raw line, anchored at a statement start so prose and patterns that mention it do not match. */
const TLS_ENV = /^\s*(?:process\.env\.|os\.environ\[["']|export\s+)?NODE_TLS_REJECT_UNAUTHORIZED["']?\]?\s*=\s*["']?0\b/;
/** Whole string literals that are placeholders, not prose that mentions one. */
const PLACEHOLDER_DATA = /^(?:lorem ipsum\b.*|your[-_ ]?api[-_ ]?key(?:[-_ ]?here)?|<your[-_ ][a-z -]+>|changeme|replace[-_ ]?me|foo@bar\.com|john\.doe@example\.com|sk-x{6,})$/i;
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const TAUTOLOGY = /\bexpect\(\s*(?:true|1|!0)\s*\)\.(?:toBe|toEqual|toBeTruthy)\(\s*(?:true|1)?\s*\)|\bassert(?:\.ok|\.equal|\.strictEqual)?\(\s*true\s*\)|\bassert(?:True|\.isTrue)\(\s*true\s*\)|^\s*assert\s+(?:True|1)\s*(?:#.*)?$|\bassert!\(\s*true\s*\)/;

function isCommentLine(line: string): boolean {
  return /^\s*(?:\/\/|#(?!\[)|\*|\/\*)/.test(line);
}

function lineHits(input: FileInput): PatternHit[] {
  const out: PatternHit[] = [];
  const n = Math.min(input.lines.length, 20_000);
  for (let i = 0; i < n; i += 1) {
    const line = input.lines[i]!;
    if (line.length > 2000) continue;
    const s = SUPPRESSION.exec(line);
    if (s) out.push({ rule: "quality/compiler-suppression", line: i + 1, detail: line.trim().slice(0, 120) });
    if (BLANKET_LINT.test(line)) out.push({ rule: "quality/blanket-lint-disable", line: i + 1, detail: line.trim().slice(0, 120) });
    if (input.isTest) {
      if (TAUTOLOGY.test(line)) out.push({ rule: "ai-code/weakened-test", line: i + 1, detail: line.trim().slice(0, 120) });
      continue;
    }
    if (isCommentLine(line)) continue;
    if (input.language === "python" && PY_DEBUG.test(line)) out.push({ rule: "quality/debug-leftover", line: i + 1, detail: line.trim() });
    // Regex literals and string contents are removed first, so code that describes these patterns is not flagged.
    const bare = stripRegexLiterals(line);
    const d = DISABLED_CONTROL.find(([re]) => re.test(stripStrings(bare)));
    if (d) out.push({ rule: "ai-code/disabled-control", line: i + 1, detail: d[1] });
    else if (TLS_ENV.test(line)) out.push({ rule: "ai-code/disabled-control", line: i + 1, detail: "TLS verification disabled for the whole process (NODE_TLS_REJECT_UNAUTHORIZED=0)" });
    if ([...bare.matchAll(STRING_LITERAL)].some((m) => PLACEHOLDER_DATA.test(m[2]!.trim()))) out.push({ rule: "ai-code/placeholder-data", line: i + 1, detail: line.trim().slice(0, 120) });
  }
  return out;
}

// ─── TypeScript / JavaScript ────────────────────────────────────────

function scriptKind(path: string): ts.ScriptKind {
  if (/\.tsx$/.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(path)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

type FnLike = ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;

function isFnLike(n: ts.Node): n is FnLike {
  return ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
}

const LOGICAL = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]);
const isLoop = (n: ts.Node): boolean => ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n);

function propName(n: ts.PropertyName | ts.BindingName | undefined, sf: ts.SourceFile): string | undefined {
  if (!n) return undefined;
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return n.getText(sf);
}

function fnName(fn: FnLike, sf: ts.SourceFile): { name: string; kind: FunctionMetrics["kind"] } {
  const cls = (): string | undefined => {
    const c = fn.parent;
    return c && (ts.isClassDeclaration(c) || ts.isClassExpression(c)) ? c.name?.text : undefined;
  };
  if (ts.isConstructorDeclaration(fn)) return { name: `${cls() ?? "class"}.constructor`, kind: "method" };
  if (ts.isMethodDeclaration(fn) || ts.isGetAccessorDeclaration(fn) || ts.isSetAccessorDeclaration(fn)) {
    const c = cls();
    const m = propName(fn.name, sf) ?? "method";
    return c ? { name: `${c}.${m}`, kind: "method" } : { name: m, kind: "method" };
  }
  if (ts.isFunctionDeclaration(fn) && fn.name) return { name: fn.name.text, kind: "function" };
  if (ts.isFunctionExpression(fn) && fn.name) return { name: fn.name.text, kind: "function" };
  const p = fn.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return { name: p.name.text, kind: "function" };
  if (p && (ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p))) return { name: propName(p.name, sf) ?? "(anonymous)", kind: ts.isPropertyDeclaration(p) ? "method" : "function" };
  return { name: "(anonymous)", kind: "anonymous" };
}

/** Visit a function's own body, not the bodies of functions nested in it. */
function walkOwn(node: ts.Node, visit: (n: ts.Node) => void): void {
  ts.forEachChild(node, (child) => {
    if (isFnLike(child) || ts.isClassDeclaration(child) || ts.isClassExpression(child)) return;
    visit(child);
    walkOwn(child, visit);
  });
}

function cyclomatic(fn: FnLike): number {
  let c = 1;
  if (!fn.body) return c;
  const count = (n: ts.Node): void => {
    if (ts.isIfStatement(n) || ts.isConditionalExpression(n) || isLoop(n) || ts.isCatchClause(n) || ts.isCaseClause(n)) c += 1;
    else if (ts.isBinaryExpression(n) && LOGICAL.has(n.operatorToken.kind)) c += 1;
  };
  if (!ts.isBlock(fn.body)) count(fn.body);
  walkOwn(fn.body, count);
  return c;
}

/** Skylos' cognitive complexity (SKY-Q306), mapped onto TypeScript syntax. Nested functions are measured on their own. */
function cognitive(fn: FnLike): number {
  let total = 0;
  const proc = (n: ts.Node, nesting: number, isElif = false): void => {
    if (isFnLike(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n)) return;
    if (ts.isIfStatement(n)) {
      total += isElif ? 1 : 1 + nesting;
      proc(n.expression, nesting + 1);
      proc(n.thenStatement, nesting + 1);
      if (n.elseStatement) {
        if (ts.isIfStatement(n.elseStatement)) proc(n.elseStatement, nesting, true);
        else {
          total += 1;
          proc(n.elseStatement, nesting + 1);
        }
      }
      return;
    }
    if (isLoop(n)) {
      total += 1 + nesting;
      ts.forEachChild(n, (c) => proc(c, nesting + 1));
      return;
    }
    if (ts.isSwitchStatement(n)) {
      total += 1 + nesting;
      proc(n.expression, nesting);
      for (const clause of n.caseBlock.clauses) for (const s of clause.statements) proc(s, nesting + 1);
      return;
    }
    if (ts.isConditionalExpression(n)) {
      total += 1 + nesting;
      ts.forEachChild(n, (c) => proc(c, nesting));
      return;
    }
    if (ts.isTryStatement(n)) {
      proc(n.tryBlock, nesting);
      if (n.catchClause) {
        total += 1 + nesting;
        proc(n.catchClause.block, nesting + 1);
      }
      if (n.finallyBlock) proc(n.finallyBlock, nesting);
      return;
    }
    if (ts.isBinaryExpression(n) && LOGICAL.has(n.operatorToken.kind)) total += 1;
    ts.forEachChild(n, (c) => proc(c, nesting));
  };
  if (fn.body) {
    if (ts.isBlock(fn.body)) for (const s of fn.body.statements) proc(s, 0);
    else proc(fn.body, 0);
  }
  return total;
}

/** Skylos' nesting depth (SKY-Q302): branches and loops nest; `else if` does not; `try` nests except at the function's top level. */
function nestingDepth(fn: FnLike): number {
  if (!fn.body || !ts.isBlock(fn.body)) return 0;
  const depth = (stmts: readonly ts.Statement[], d: number, top: boolean): number => {
    let max = d;
    for (const s of stmts) max = Math.max(max, stmtDepth(s, d, top));
    return max;
  };
  const body = (s: ts.Statement, d: number): number => (ts.isBlock(s) ? depth(s.statements, d, false) : stmtDepth(s, d, false));
  const stmtDepth = (s: ts.Statement, d: number, top: boolean): number => {
    if (ts.isIfStatement(s)) {
      let m = body(s.thenStatement, d + 1);
      if (s.elseStatement) m = Math.max(m, ts.isIfStatement(s.elseStatement) ? stmtDepth(s.elseStatement, d, top) : body(s.elseStatement, d + 1));
      return m;
    }
    if (isLoop(s)) return body((s as ts.IterationStatement).statement, d + 1);
    if (ts.isSwitchStatement(s)) return Math.max(d + 1, ...s.caseBlock.clauses.map((c) => depth(c.statements, d + 1, false)));
    if (ts.isTryStatement(s)) {
      const inner = d + (top ? 0 : 1);
      return Math.max(depth(s.tryBlock.statements, inner, false), s.catchClause ? depth(s.catchClause.block.statements, inner, false) : inner, s.finallyBlock ? depth(s.finallyBlock.statements, inner, false) : inner);
    }
    if (ts.isBlock(s)) return depth(s.statements, d, top);
    if (ts.isLabeledStatement(s)) return stmtDepth(s.statement, d, top);
    return d;
  };
  return depth(fn.body.statements, 0, true);
}

const normalize = (s: string): string => s.replace(/\s+/g, " ").trim();

function duplicateBranches(n: ts.IfStatement | ts.SwitchStatement, sf: ts.SourceFile): string | undefined {
  if (ts.isIfStatement(n)) {
    if (n.parent && ts.isIfStatement(n.parent) && n.parent.elseStatement === n) return undefined; // counted from the head of the chain
    const branches: string[] = [];
    let cur: ts.Statement | undefined = n;
    while (cur && ts.isIfStatement(cur)) {
      branches.push(normalize(cur.thenStatement.getText(sf)));
      cur = cur.elseStatement;
    }
    if (cur) branches.push(normalize(cur.getText(sf)));
    const meaningful = branches.filter((b) => b.replace(/[{};\s]/g, "").length > 0);
    const dup = meaningful.find((b, i) => meaningful.indexOf(b) !== i);
    return dup && branches.length >= 2 ? `${branches.length} branches, two with the same body` : undefined;
  }
  const bodies = n.caseBlock.clauses.map((c) => normalize(c.statements.map((s) => s.getText(sf)).join(" "))).filter((b) => b && b !== "break;" && b.replace(/break;$/, "").trim());
  const dup = bodies.find((b, i) => bodies.indexOf(b) !== i);
  return dup ? `switch with ${n.caseBlock.clauses.length} cases, two with the same body` : undefined;
}

const TERMINATORS = (s: ts.Statement): boolean => ts.isReturnStatement(s) || ts.isThrowStatement(s) || ts.isBreakStatement(s) || ts.isContinueStatement(s);
const HOISTED = (s: ts.Statement): boolean => ts.isFunctionDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEmptyStatement(s) || ts.isModuleDeclaration(s);

function analyzeTypeScript(input: FileInput, out: FileAnalysisResult): void {
  const text = input.lines.join("\n");
  const sf = ts.createSourceFile(input.path, text, ts.ScriptTarget.Latest, true, scriptKind(input.path));
  const line = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const identifiers = new Map<string, number>();
  const hasJsx = /\.[jt]sx$/.test(input.path);

  const visit = (n: ts.Node, enclosing: string | undefined): void => {
    let here = enclosing;
    if (ts.isIdentifier(n)) identifiers.set(n.text, (identifiers.get(n.text) ?? 0) + 1);
    if (isFnLike(n) && !input.isTest) {
      const { name, kind } = fnName(n, sf);
      const start = line(n.getStart(sf));
      const end = line(n.getEnd());
      here = kind === "anonymous" ? enclosing : name;
      out.functions.push({
        name: kind === "anonymous" ? `(anonymous in ${enclosing ?? "module"})` : name,
        kind,
        path: input.path,
        line: start,
        endLine: end,
        lines: end - start + 1,
        params: n.parameters.filter((p) => !(ts.isIdentifier(p.name) && p.name.text === "this")).length,
        cyclomatic: cyclomatic(n),
        cognitive: cognitive(n),
        nesting: nestingDepth(n),
        resolution: "ast",
      });
      if (n.body) awaitInLoop(n, name, sf, out.hits);
    }
    if (!input.isTest) sourceChecks(n, sf, here, out.hits);
    ts.forEachChild(n, (c) => visit(c, here));
  };
  visit(sf, undefined);

  if (!input.isTest) {
    // Unused imports: a binding whose name occurs nowhere but in its own import.
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause) continue;
      const clause = st.importClause;
      const names: string[] = [];
      if (clause.name) names.push(clause.name.text);
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) names.push(nb.name.text);
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) names.push(el.name.text);
      for (const nm of names) {
        const own = nb && ts.isNamedImports(nb) ? nb.elements.filter((e) => e.propertyName && ts.isIdentifier(e.propertyName) && e.propertyName.text === nm).length : 0;
        if ((identifiers.get(nm) ?? 0) - own > 1) continue;
        if (hasJsx && nm === "React") continue; // classic JSX runtime uses it implicitly
        out.hits.push({ rule: "dead-code/unused-import", line: line(st.getStart(sf)), detail: `${nm} from ${(st.moduleSpecifier as ts.StringLiteral).text}` });
      }
    }
  } else {
    out.test = typeScriptTestFacts(input, sf, line);
  }
}

function sourceChecks(n: ts.Node, sf: ts.SourceFile, fn: string | undefined, hits: PatternHit[]): void {
  const line = (): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const sym = fn ? { symbol: fn } : {};
  if (ts.isCatchClause(n) && n.block.statements.length === 0) {
    const inner = n.block.getText(sf).slice(1, -1);
    if (!/\/\/|\/\*/.test(inner)) hits.push({ rule: "reliability/empty-catch", line: line(), detail: `${fn ? `${fn}: ` : ""}catch block is empty and has no comment`, ...sym });
  } else if (ts.isDebuggerStatement(n)) hits.push({ rule: "quality/debug-leftover", line: line(), detail: "debugger statement", ...sym });
  else if (ts.isIfStatement(n) || ts.isSwitchStatement(n)) {
    const d = duplicateBranches(n, sf);
    if (d) hits.push({ rule: "quality/duplicate-branches", line: line(), detail: `${fn ? `${fn}: ` : ""}${d}`, ...sym });
  } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
    const method = n.expression.name.text;
    const arg = n.arguments[0];
    const asyncArg = arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && arg.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    if (asyncArg && method === "forEach") hits.push({ rule: "reliability/async-foreach", line: line(), detail: `${fn ? `${fn}: ` : ""}forEach does not wait for the async callback; its rejections go unhandled`, ...sym });
    if (asyncArg && method === "map" && n.parent && ts.isExpressionStatement(n.parent)) hits.push({ rule: "reliability/discarded-async-map", line: line(), detail: `${fn ? `${fn}: ` : ""}the promises returned by map(async …) are discarded`, ...sym });
  } else if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Promise") {
    const arg = n.arguments?.[0];
    if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && arg.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) hits.push({ rule: "reliability/async-promise-executor", line: line(), detail: `${fn ? `${fn}: ` : ""}an exception inside an async executor never rejects the promise`, ...sym });
  } else if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isCaseClause(n) || ts.isDefaultClause(n) || ts.isModuleBlock(n)) {
    const stmts = n.statements;
    for (let i = 0; i < stmts.length - 1; i += 1) {
      if (!TERMINATORS(stmts[i]!)) continue;
      const next = stmts.slice(i + 1).find((s) => !HOISTED(s));
      if (next) hits.push({ rule: "dead-code/unreachable", line: sf.getLineAndCharacterOfPosition(next.getStart(sf)).line + 1, detail: `${fn ? `${fn}: ` : ""}statement after ${ts.SyntaxKind[stmts[i]!.kind].replace(/Statement$/, "").toLowerCase()} can never run`, ...sym });
      break;
    }
  }
}

function awaitInLoop(fn: FnLike, name: string, sf: ts.SourceFile, hits: PatternHit[]): void {
  let found: number | undefined;
  const inLoop = (n: ts.Node, loop: boolean): void => {
    if (found !== undefined || isFnLike(n)) return;
    if (loop && ts.isAwaitExpression(n)) {
      found = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      return;
    }
    const isForAwait = ts.isForOfStatement(n) && Boolean(n.awaitModifier);
    ts.forEachChild(n, (c) => inLoop(c, (loop || isLoop(n)) && !isForAwait));
  };
  ts.forEachChild(fn.body!, (c) => inLoop(c, false));
  if (found !== undefined) hits.push({ rule: "reliability/await-in-loop", line: found, detail: `${name}: awaits inside a loop run one after another`, symbol: name });
}

// ─── tests ──────────────────────────────────────────────────────────

const MOCK = /\b(?:jest|vi)\.(?:mock|fn|spyOn)\(|\bsinon\.\w+\(|\bmock\.(?:patch|fn|method)\b|@patch\b|\bMagicMock\(|\bMock\(|\bspyOn\(|\bmockk?\(|\bMockito\.|\bgomock\b|\bnock\(/g;
const HOOKS = /\b(?:beforeEach|afterEach|beforeAll|afterAll|before|after)\s*\(|\bdef\s+(?:setUp|tearDown|setup_method|teardown_method)\b|@pytest\.fixture|\bt\.Cleanup\(|@(?:BeforeEach|AfterEach|Before|After)\b/;
const FAILURE_PATH = /\.toThrow|\.rejects\b|assert\.(?:throws|rejects)\(|\bexpect\([^)]*\)\.to\.throw|pytest\.raises|assertRaises|assertThrows|should_panic|\bis_err\(\)|\bErrorIs\(|\bassert\.Error\(|\brequire\.Error\(|(?:status|statusCode)\)?\s*[,.]\s*(?:toBe|toEqual|equal|strictEqual)?\(?\s*4\d\d|\b(?:400|401|403|404|409|422)\b/g;
const ASSERT_CALL = /^(?:expect|assert|should|chai|sinon\.assert|expectTypeOf|t\.(?:is|not|true|false|truthy|falsy|deepEqual|equal|same|throws|ok|notOk|match|pass|fail|plan|assert|snapshot|strictEqual|deepStrictEqual|rejects)|verify|check)\b/;
const FRAMEWORKS: [RegExp, string][] = [
  [/from ["']vitest["']/, "vitest"],
  [/from ["']@jest\/globals["']|\bjest\./, "jest"],
  [/from ["']node:test["']|require\(["']node:test["']\)/, "node:test"],
  [/from ["']mocha["']|\bdescribe\(/, "mocha-style"],
  [/^\s*import pytest|^\s*from pytest\b/m, "pytest"],
  [/^\s*import unittest|^\s*from unittest\b/m, "unittest"],
  [/"testing"\s*$|^\s*import\s+"testing"/m, "go test"],
  [/org\.junit/, "JUnit"],
  [/#\[test\]/, "cargo test"],
  [/@playwright\/test/, "playwright"],
  [/\bcypress\b|\bcy\./, "cypress"],
];

function testCallName(e: ts.Expression): { base: string; modifier?: string } | undefined {
  if (ts.isIdentifier(e)) return { base: e.text };
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) return { base: e.expression.text, modifier: e.name.text };
  if (ts.isCallExpression(e)) return testCallName(e.expression); // it.each(table)(…)
  if (ts.isPropertyAccessExpression(e) && ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression)) return { base: e.expression.expression.text, modifier: e.name.text };
  return undefined;
}

function typeScriptTestFacts(input: FileInput, sf: ts.SourceFile, lineOf: (pos: number) => number): TestFileFacts {
  const facts = emptyTestFacts(input);
  const localFns = new Set<string>();
  ts.forEachChild(sf, function collect(n) {
    if (ts.isFunctionDeclaration(n) && n.name) localFns.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) localFns.add(n.name.text);
    ts.forEachChild(n, collect);
  });
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const c = testCallName(n.expression);
      if (c && ["it", "test", "xit", "xtest", "fit", "specify"].includes(c.base)) {
        const skipped = c.base === "xit" || c.base === "xtest" || c.modifier === "skip" || c.modifier === "todo";
        const focused = c.base === "fit" || c.modifier === "only";
        facts.cases += 1;
        if (skipped) facts.skipped += 1;
        if (focused) facts.focused += 1;
        const fn = n.arguments.find((a): a is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (fn && !skipped) {
          if (ts.isBlock(fn.body) && fn.body.statements.length === 0) facts.empty += 1;
          else if (!hasAssertion(fn.body, sf, localFns)) facts.assertionless += 1;
        }
      }
      if (c && ["describe", "suite", "context"].includes(c.base) && c.modifier === "only") facts.focused += 1;
      if (c && ["xdescribe"].includes(c.base)) facts.skipped += 1;
      if (c && c.base === "fdescribe") facts.focused += 1;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  void lineOf;
  fillTextFacts(facts, input.lines);
  return facts;
}

function hasAssertion(body: ts.Node, sf: ts.SourceFile, localFns: Set<string>): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const text = n.expression.getText(sf);
      const head = text.split("(")[0]!;
      if (ASSERT_CALL.test(head) || /(?:^|\.)(?:assert\w*|expect\w*|should\w*|verify\w*|check\w*)$/i.test(head) || localFns.has(head)) found = true;
    }
    if (ts.isThrowStatement(n)) found = true;
    ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

function emptyTestFacts(input: FileInput): TestFileFacts {
  return { path: input.path, cases: 0, assertions: 0, skipped: 0, focused: 0, empty: 0, assertionless: 0, tautologies: 0, mocks: 0, hooks: false, failurePath: 0, category: "unit", categoryBasis: "default", productionFiles: 0 };
}

function fillTextFacts(f: TestFileFacts, lines: readonly string[]): void {
  const text = lines.slice(0, 20_000).join("\n");
  const framework = FRAMEWORKS.find(([re]) => re.test(text))?.[1];
  if (framework) f.framework = framework;
  else delete f.framework;
  f.assertions = (text.match(/\bexpect\(|\bassert(?:\w*)[.(\s!]|\bshould\.|\bself\.assert\w*\(|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail)\b|\brequire\.\w+\(|\bassert_eq!|\bassert_ne!|\bassertThat\(/g) ?? []).length;
  f.mocks = (text.match(MOCK) ?? []).length;
  f.hooks = HOOKS.test(text);
  f.failurePath = (text.match(FAILURE_PATH) ?? []).length;
  f.tautologies = lines.filter((l) => TAUTOLOGY.test(l)).length;
  const [category, basis] = classify(f.path, text);
  f.category = category;
  f.categoryBasis = basis;
}

const PATH_CATEGORY: [RegExp, TestFileFacts["category"]][] = [
  [/(^|[/._-])(e2e|end-to-end|cypress|playwright)([/._-]|$)/i, "e2e"],
  [/(^|[/._-])(integration|integ|it)([/._-]|$)/i, "integration"],
  [/(^|[/._-])(contract|pact)s?([/._-]|$)/i, "contract"],
  [/(^|[/._-])(smoke)([/._-]|$)/i, "smoke"],
  [/(^|[/._-])(regression)s?([/._-]|$)/i, "regression"],
  [/(^|[/._-])(security|sec)([/._-]|$)/i, "security"],
  [/(^|[/._-])(perf|performance|bench|benchmark|load)s?([/._-]|$)/i, "performance"],
  [/(^|[/._-])(api)([/._-]|$)/i, "api"],
  [/(^|[/._-])(db|database)([/._-]|$)/i, "database"],
  [/(^|[/._-])(components?)([/._-]|$)/i, "component"],
  [/(^|[/._-])(unit)([/._-]|$)/i, "unit"],
];
const CONTENT_CATEGORY: [RegExp, TestFileFacts["category"]][] = [
  [/@playwright\/test|\bcypress\b|\bpuppeteer\b|\bselenium\b|\bwebdriver\b/i, "e2e"],
  [/\bsupertest\b|\brequest\(app\)|\bTestClient\(|\bhttptest\.New|\bMockMvc\b/, "api"],
  [/@testing-library\/|\benzyme\b|\bmount\(\s*</, "component"],
  [/\btestcontainers\b|\bsqlite3?\b|\bprisma\b|\bknex\b|\bmongoose\b|\bpsycopg|\bsqlalchemy\b|\bDataJpaTest\b/i, "database"],
  [/\bpact\b/i, "contract"],
  [/\bstartServer\(|\.listen\(|\bhttp\.request\(|\bfetch\(\s*[`"']https?:\/\/(?:127\.0\.0\.1|localhost)/, "integration"],
];

function classify(path: string, text: string): [TestFileFacts["category"], TestFileFacts["categoryBasis"]] {
  const p = PATH_CATEGORY.find(([re]) => re.test(path));
  if (p) return [p[1], "path"];
  const c = CONTENT_CATEGORY.find(([re]) => re.test(text));
  if (c) return [c[1], "content"];
  return ["unit", "default"];
}

// ─── heuristic languages ────────────────────────────────────────────

/** Remove comments and string contents so keywords inside them are not counted. */
function codeOnly(line: string, language: Language): string {
  let s = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "\"\"");
  if (language === "python") s = s.replace(/#.*$/, "");
  else s = s.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
  return s;
}

const DECISIONS: Record<string, RegExp> = {
  python: /\b(?:if|elif|for|while|except|and|or|case)\b/g,
  go: /\b(?:if|for|case)\b|&&|\|\|/g,
  java: /\b(?:if|for|while|case|catch)\b|&&|\|\||\?(?![.>:]|\s*(?:extends|super)\b)/g,
  rust: /\b(?:if|for|while|loop)\b|=>|&&|\|\|/g,
};
const PY_BLOCK = /^\s*(?:async\s+)?(if|for|while|try|with|match|elif|else|except|finally|case)\b.*:\s*(?:#.*)?$/;
const BRACE_CONTROL = /\b(if|for|while|switch|match|loop|try|catch|else|select|do)\b[^{};]*\{/g;

function analyzeHeuristic(input: FileInput, out: FileAnalysisResult): void {
  const { lines, language } = input;
  const code = lines.map((l) => codeOnly(l, language));
  if (!input.isTest) {
    for (const n of input.functions) {
      const loc = n.location;
      if (!loc?.endLine || loc.endLine < loc.line || loc.endLine - loc.line > 2000) continue;
      const body = code.slice(loc.line - 1, loc.endLine);
      const decisions = body.slice(language === "python" ? 1 : 0).join("\n").match(DECISIONS[language] ?? /$^/g)?.length ?? 0;
      const matches = language === "rust" ? (body.join("\n").match(/\bmatch\b/g)?.length ?? 0) : 0;
      out.functions.push({
        name: n.name,
        kind: n.kind === "method" ? "method" : "function",
        path: input.path,
        line: loc.line,
        endLine: loc.endLine,
        lines: loc.endLine - loc.line + 1,
        params: paramCount(n, language),
        cyclomatic: 1 + Math.max(0, decisions - matches),
        nesting: language === "python" ? pyNesting(body) : braceNesting(body),
        resolution: "heuristic",
      });
    }
    out.hits.push(...heuristicReliability(input, code));
  } else {
    out.test = heuristicTestFacts(input);
  }
  if (language === "python" && !input.isTest && !/(^|\/)__init__\.py$/.test(input.path)) out.hits.push(...pyUnusedImports(code));
}

function paramCount(n: GraphNode, language: Language): number {
  const sig = n.signature ?? "";
  const short = n.name.split(".").pop()!;
  let at = sig.indexOf(`${short}(`);
  if (at < 0) at = sig.indexOf(`${short}<`);
  const open = at >= 0 ? sig.indexOf("(", at) : sig.indexOf("(");
  if (open < 0) return 0;
  let depth = 0;
  let cur = "";
  const parts: string[] = [];
  for (let i = open; i < sig.length; i += 1) {
    const ch = sig[i]!;
    if ("([{<".includes(ch)) depth += 1;
    if (")]}>".includes(ch)) depth -= 1;
    if (depth === 0) break;
    if (ch === "," && depth === 1) {
      parts.push(cur);
      cur = "";
    } else if (i > open) cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p && !/^(?:self|cls|&?(?:mut\s+)?self|\*|\/)$/.test(p) && !(language === "python" && /^\*\*?$/.test(p))).length;
}

function pyNesting(body: string[]): number {
  const indent = (l: string): number => l.length - l.trimStart().length;
  const stack: { indent: number; add: number }[] = [];
  let max = 0;
  const first = body.slice(1).find((l) => l.trim());
  const fnIndent = first ? indent(first) : 0;
  for (const l of body.slice(1)) {
    if (!l.trim()) continue;
    const i = indent(l);
    while (stack.length && stack.at(-1)!.indent >= i) stack.pop();
    const m = PY_BLOCK.exec(l);
    if (m) {
      const kw = m[1]!;
      const add = kw === "with" || kw === "case" ? 0 : kw === "try" || kw === "except" || kw === "finally" ? (i === fnIndent ? 0 : 1) : 1;
      stack.push({ indent: i, add });
      max = Math.max(max, stack.reduce((s, x) => s + x.add, 0));
    }
  }
  return max;
}

function braceNesting(body: string[]): number {
  let max = 0;
  const stack: number[] = [];
  let first = true;
  for (const l of body) {
    // Control braces open a level; any other brace (the function body, literals, closures) does not.
    const controls: number[] = [];
    for (const m of l.matchAll(BRACE_CONTROL)) controls.push(m.index! + m[0].length - 1);
    for (let i = 0; i < l.length; i += 1) {
      if (l[i] === "{") {
        const control = !first && controls.includes(i);
        first = false;
        stack.push(control ? 1 : 0);
        max = Math.max(max, stack.reduce((s, x) => s + x, 0));
      } else if (l[i] === "}") stack.pop();
    }
  }
  return max;
}

function heuristicReliability(input: FileInput, code: string[]): PatternHit[] {
  const out: PatternHit[] = [];
  const { language, lines } = input;
  const next = (i: number): string | undefined => code.slice(i + 1, i + 6).find((l) => l.trim())?.trim();
  for (let i = 0; i < Math.min(code.length, 20_000); i += 1) {
    const l = code[i]!;
    if (language === "python") {
      if (/^\s*except\s*:/.test(l)) out.push({ rule: "reliability/bare-except", line: i + 1, detail: "bare except catches everything, including KeyboardInterrupt and SystemExit" });
      else if (/^\s*except\s+(?:Exception|BaseException)\b[^:]*:\s*(?:pass|\.\.\.)?\s*$/.test(l)) {
        const n = /:\s*(pass|\.\.\.)\s*$/.test(l) ? "pass" : next(i);
        if (n === "pass" || n === "..." || n === "continue") out.push({ rule: "reliability/swallowed-exception", line: i + 1, detail: "catches Exception and ignores it" });
      }
      const call = /\b(requests\.(?:get|post|put|patch|delete|head|request)|urllib\.request\.urlopen|urlopen)\(/.exec(l);
      if (call && !callHas(code, i, "timeout")) out.push({ rule: "reliability/missing-timeout", line: i + 1, detail: `${call[1]}(…) without a timeout can hang forever` });
      const open = /^\s*(\w+)\s*=\s*open\(/.exec(l);
      if (open && !code.slice(i + 1, i + 200).some((x) => x.includes(`${open[1]}.close()`))) out.push({ rule: "reliability/missing-cleanup", line: i + 1, detail: `file opened into ${open[1]} outside a with block and never closed here` });
    } else if (language === "go") {
      if (/\bhttp\.(?:Get|Post|Head|PostForm)\(/.test(l)) out.push({ rule: "reliability/missing-timeout", line: i + 1, detail: "http.Get/Post use the default client, which has no timeout" });
    } else if (language === "java") {
      if (/\bcatch\s*\([^)]*\)\s*\{\s*\}/.test(l) || (/\bcatch\s*\([^)]*\)\s*\{\s*$/.test(l) && next(i) === "}" && !/\/\/|\/\*/.test(lines[i + 1] ?? ""))) out.push({ rule: "reliability/empty-catch", line: i + 1, detail: "catch block is empty" });
    }
  }
  return out;
}

/** Does the call starting on line `i` mention `word` before its parentheses close? */
function callHas(code: string[], i: number, word: string): boolean {
  let depth = 0;
  let started = false;
  for (let j = i; j < Math.min(code.length, i + 15); j += 1) {
    for (const ch of code[j]!) {
      if (ch === "(") {
        depth += 1;
        started = true;
      } else if (ch === ")") depth -= 1;
    }
    if (code[j]!.includes(word)) return true;
    if (started && depth <= 0) return false;
  }
  return false;
}

function pyUnusedImports(code: string[]): PatternHit[] {
  const text = code.join("\n");
  if (/__all__/.test(text)) return [];
  const out: PatternHit[] = [];
  for (let i = 0; i < code.length; i += 1) {
    const l = code[i]!;
    let names: string[] = [];
    const from = /^from\s+[\w.]+\s+import\s+([^()]+)$/.exec(l.trim());
    const imp = /^import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)$/.exec(l.trim());
    if (from && !from[1]!.includes("*")) names = from[1]!.split(",").map((x) => x.trim().split(/\s+as\s+/).pop()!.trim());
    else if (imp) names = imp[1]!.split(",").map((x) => (x.includes(" as ") ? x.split(/\s+as\s+/)[1]!.trim() : x.trim().split(".")[0]!));
    for (const nm of names.filter((x) => /^\w+$/.test(x))) {
      const uses = (text.match(new RegExp(`\\b${nm}\\b`, "g")) ?? []).length;
      if (uses <= 1) out.push({ rule: "dead-code/unused-import", line: i + 1, detail: `${nm} is imported but never used` });
    }
  }
  return out;
}

function heuristicTestFacts(input: FileInput): TestFileFacts {
  const facts = emptyTestFacts(input);
  const { lines, language } = input;
  const text = lines.join("\n");
  const CASE: Record<string, RegExp> = { python: /^\s*(?:async\s+)?def\s+test_?\w*\s*\(/gm, go: /^func\s+(?:Test|Benchmark|Fuzz)\w*\(/gm, java: /@(?:Test|ParameterizedTest|RepeatedTest)\b/g, rust: /#\[(?:tokio::)?test\]/g };
  const SKIP: Record<string, RegExp> = { python: /@(?:pytest\.mark\.skip|unittest\.skip)\w*|pytest\.skip\(/g, go: /\bt\.Skip(?:f|Now)?\(/g, java: /@(?:Disabled|Ignore)\b/g, rust: /#\[ignore\]/g };
  facts.cases = (text.match(CASE[language] ?? /$^/g) ?? []).length;
  facts.skipped = (text.match(SKIP[language] ?? /$^/g) ?? []).length;
  const ASSERT: Record<string, RegExp> = { python: /\bassert\b|\.assert\w*\(|pytest\.raises|\bfail\(/, go: /\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\b|\bassert\.|\brequire\./, java: /\bassert\w*\(|\bverify\(|\bfail\(/, rust: /\bassert(?:_eq|_ne)?!|\bpanic!|should_panic/ };
  for (const n of input.functions) {
    const short = n.name.split(".").pop()!;
    const isCase = language === "python" ? /^test/.test(short) : language === "go" ? /^Test/.test(short) : false;
    if (!isCase || !n.location?.endLine) continue;
    const body = lines.slice(n.location.line, n.location.endLine).map((l) => codeOnly(l, language)).filter((l) => l.trim());
    const meaningful = body.filter((l) => !/^\s*(?:pass|\.\.\.|""""""|""|\}|)\s*$/.test(l));
    if (!meaningful.length) facts.empty += 1;
    else if (!meaningful.some((l) => ASSERT[language]!.test(l))) facts.assertionless += 1;
  }
  fillTextFacts(facts, lines);
  return facts;
}
