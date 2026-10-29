import { stripRegexLiterals, stripStrings } from "../codebase-briefing/facts.js";

/**
 * A small structural control-flow reader for one function body: branches,
 * switches, loops, try/catch, returns and throws, with the resolved calls on
 * each line. Brace languages (TS/JS/Java/Go/Rust/C#) are read by brace depth,
 * Python by indentation. It does not evaluate anything; blocks it does not
 * recognise (callbacks, object literals) are flattened into their parent, so
 * a misread can only lose structure, never invent a branch.
 */

export type Stmt =
  | { k: "call"; line: number; names: string[] }
  | { k: "if"; line: number; branches: { cond: string; line: number; body: Stmt[] }[]; otherwise: Stmt[] | null }
  | { k: "switch"; line: number; subject: string; cases: { label: string; line: number; body: Stmt[] }[] }
  | { k: "loop"; line: number; head: string; body: Stmt[] }
  | { k: "try"; line: number; body: Stmt[]; handler: { line: number; param: string; body: Stmt[] } | null; final: Stmt[] | null }
  | { k: "return"; line: number; text: string }
  | { k: "throw"; line: number; text: string };

type If = Extract<Stmt, { k: "if" }>;
type Try = Extract<Stmt, { k: "try" }>;
type Switch = Extract<Stmt, { k: "switch" }>;

export interface BodyInput {
  /** Source lines of the whole file. */
  lines: readonly string[];
  /** 1-based first and last line of the function (declaration through closing line). */
  start: number;
  end: number;
  python: boolean;
  /** Resolved callee names per 1-based line. */
  calls: Map<number, string[]>;
}

const clean = (s: string, max = 48): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function parseBody(input: BodyInput): Stmt[] {
  return input.python ? parsePython(input) : parseBraces(input);
}

// ─── brace languages ────────────────────────────────────────────────

interface Frame {
  close: number;
  list: Stmt[];
  kind: "body" | "if" | "else" | "switch" | "loop" | "do" | "try" | "catch" | "finally" | "plain";
  owner?: Stmt;
}

function parseBraces({ lines, start, end, calls }: BodyInput): Stmt[] {
  const root: Stmt[] = [];
  let depth = 0;
  let opened = false;
  const frames: Frame[] = [];
  const top = (): Frame => frames[frames.length - 1] ?? { close: -1, list: root, kind: "body" };
  let lastClosed: Frame | undefined;
  let pending: { kind: Frame["kind"]; owner?: Stmt; list: Stmt[] } | undefined;

  const addCalls = (line: number, list: Stmt[]): void => {
    const names = calls.get(line);
    if (names?.length) list.push({ k: "call", line, names: [...names] });
  };
  const closeTo = (): void => {
    while (frames.length && depth <= top().close) lastClosed = frames.pop();
  };

  for (let ln = start; ln <= end && ln <= lines.length; ln += 1) {
    const raw = lines[ln - 1]!;
    let t = stripStrings(stripRegexLiterals(raw)).replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").trim();
    if (!opened) {
      // Skip the signature: the body starts at the first `{`.
      const i = t.indexOf("{");
      if (i < 0) continue;
      opened = true;
      depth = 1;
      frames.push({ close: 0, list: root, kind: "body" });
      t = t.slice(i + 1).trim();
    }
    // Leading closers end blocks before any header on the same line (`} else {`).
    while (t.startsWith("}")) {
      depth -= 1;
      closeTo();
      t = t.slice(1).replace(/^[)\];,\s]+/, "").trim();
    }
    if (depth <= 0) break;
    const cur = top();
    let header: { kind: Frame["kind"]; owner?: Stmt; list: Stmt[] } | undefined;
    let m: RegExpMatchArray | null;
    const text = raw.trim();
    if ((m = /^(?:else\s+)?if\s*\((.*)\)\s*\{?\s*(.*)$/.exec(t)) || (m = /^(?:else\s+)?if\s+(.+?)\s*\{\s*(.*)$/.exec(t))) {
      const elseIf = t.startsWith("else");
      const cond = clean(condText(text, "if"));
      addCalls(ln, cur.list);
      const prev = elseIf && lastClosed?.kind !== undefined ? findIf(cur.list) : undefined;
      let stmt: If;
      if (prev) {
        stmt = prev;
        stmt.branches.push({ cond, line: ln, body: [] });
      } else {
        stmt = { k: "if", line: ln, branches: [{ cond, line: ln, body: [] }], otherwise: null };
        cur.list.push(stmt);
      }
      const body = stmt.branches[stmt.branches.length - 1]!.body;
      if (!t.includes("{")) {
        inline(m[2] ?? "", ln, body, calls);
        continue;
      }
      header = { kind: "if", owner: stmt, list: body };
    } else if (/^else\b/.test(t)) {
      const prev = findIf(cur.list);
      if (prev) {
        prev.otherwise = [];
        if (!t.includes("{")) {
          inline(t.replace(/^else\b/, ""), ln, prev.otherwise, calls);
          continue;
        }
        header = { kind: "else", owner: prev, list: prev.otherwise };
      }
    } else if ((m = /^switch\s*\((.*)\)/.exec(t)) || (m = /^(?:switch|match)\s+(.+?)\s*\{/.exec(t))) {
      addCalls(ln, cur.list);
      const stmt: Switch = { k: "switch", line: ln, subject: clean(m[1] ?? ""), cases: [] };
      cur.list.push(stmt);
      header = { kind: "switch", owner: stmt, list: [] };
    } else if ((m = /^case\s+(.+?)\s*:(.*)$/.exec(t)) || (m = /^(default)\s*:(.*)$/.exec(t))) {
      const sw = frames.slice().reverse().find((f) => f.kind === "switch");
      if (sw) {
        const body: Stmt[] = [];
        (sw.owner as Switch).cases.push({ label: clean(m[1] === "default" ? "default" : stripQuotes(caseLabel(text)), 32), line: ln, body });
        sw.list = body;
        inline(m[2] ?? "", ln, body, calls);
        countBraces(m[2] ?? "");
        continue;
      }
    } else if ((m = /^(for|while)\b\s*\(?(.*?)\)?\s*\{?\s*$/.exec(t)) && !/^while\s*\(.*\)\s*;/.test(t)) {
      addCalls(ln, cur.list);
      const stmt: Stmt = { k: "loop", line: ln, head: clean(`${m[1]} ${condText(text, m[1]!)}`), body: [] };
      cur.list.push(stmt);
      if (!t.includes("{")) continue;
      header = { kind: "loop", owner: stmt, list: stmt.body };
    } else if (/^do\b/.test(t)) {
      const stmt: Stmt = { k: "loop", line: ln, head: "repeat", body: [] };
      cur.list.push(stmt);
      header = { kind: "do", owner: stmt, list: stmt.body };
    } else if ((m = /^while\s*\((.*)\)\s*;/.exec(t)) && lastClosed?.kind === "do") {
      const loop = lastClosed.owner as Extract<Stmt, { k: "loop" }>;
      loop.head = clean(`repeat while ${condText(text, "while")}`);
      continue;
    } else if (/^try\b/.test(t)) {
      const stmt: Try = { k: "try", line: ln, body: [], handler: null, final: null };
      cur.list.push(stmt);
      header = { kind: "try", owner: stmt, list: stmt.body };
    } else if ((m = /^catch\b\s*(?:\(\s*([^)]*)\))?/.exec(t))) {
      const prev = findTry(cur.list);
      if (prev) {
        prev.handler = { line: ln, param: clean(m[1] ?? "error", 24), body: [] };
        header = { kind: "catch", owner: prev, list: prev.handler.body };
      }
    } else if (/^finally\b/.test(t)) {
      const prev = findTry(cur.list);
      if (prev) {
        prev.final = [];
        header = { kind: "finally", owner: prev, list: prev.final };
      }
    } else if ((m = /^return\b(.*)$/.exec(t))) {
      addCalls(ln, cur.list);
      cur.list.push({ k: "return", line: ln, text: clean(m[1] ?? "", 32) });
    } else if (/^throw\b|^panic\(/.test(t)) {
      addCalls(ln, cur.list);
      cur.list.push({ k: "throw", line: ln, text: clean(text, 40) });
    } else addCalls(ln, cur.list);

    // Braces after the header decide what opens and closes on this line.
    const before = depth;
    countBraces(t);
    if (header && depth > before) frames.push({ close: before, list: header.list, kind: header.kind, ...(header.owner ? { owner: header.owner } : {}) });
    // A header whose brace is on the next line (Allman style) opens with that brace.
    else if (header && !t.includes("{")) pending = header;
    else if (depth > before) {
      if (pending) {
        frames.push({ close: before, list: pending.list, kind: pending.kind, ...(pending.owner ? { owner: pending.owner } : {}) });
        pending = undefined;
      } else frames.push({ close: before, list: top().list, kind: "plain" });
    }
    closeTo();
    if (depth <= 0) break;
  }
  return root;

  function countBraces(s: string): void {
    for (const ch of s) {
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        closeTo();
      }
    }
  }
}

function inline(rest: string, ln: number, list: Stmt[], calls: Map<number, string[]>): void {
  const r = rest.trim();
  const names = calls.get(ln);
  if (names?.length) list.push({ k: "call", line: ln, names: [...names] });
  if (/^return\b/.test(r)) list.push({ k: "return", line: ln, text: clean(r.replace(/^return\b/, ""), 32) });
  else if (/^throw\b/.test(r)) list.push({ k: "throw", line: ln, text: clean(r, 40) });
}

function findIf(list: Stmt[]): If | undefined {
  const last = list[list.length - 1];
  return last?.k === "if" ? last : undefined;
}

function findTry(list: Stmt[]): Try | undefined {
  const last = list[list.length - 1];
  return last?.k === "try" ? last : undefined;
}

/** The condition text between the keyword's parentheses on the original line (string contents kept). */
function condText(line: string, keyword: string): string {
  const i = line.indexOf(keyword);
  const rest = i >= 0 ? line.slice(i + keyword.length) : line;
  const open = rest.indexOf("(");
  if (open < 0) return rest.replace(/[{:]\s*$/, "").trim();
  let d = 0;
  for (let j = open; j < rest.length; j += 1) {
    if (rest[j] === "(") d += 1;
    else if (rest[j] === ")") {
      d -= 1;
      if (d === 0) return rest.slice(open + 1, j);
    }
  }
  return rest.slice(open + 1);
}

function caseLabel(line: string): string {
  return /^\s*case\s+(.+?)\s*:/.exec(line)?.[1] ?? line;
}

function stripQuotes(s: string): string {
  return s.replace(/^["'`](.*)["'`]$/, "$1");
}

// ─── Python ─────────────────────────────────────────────────────────

interface PyFrame {
  indent: number;
  list: Stmt[];
}

function parsePython({ lines, start, end, calls }: BodyInput): Stmt[] {
  const root: Stmt[] = [];
  const decl = lines[start - 1] ?? "";
  const baseIndent = decl.length - decl.trimStart().length;
  const frames: PyFrame[] = [{ indent: baseIndent, list: root }];
  const lastAt = new Map<number, Stmt>();
  for (let ln = start + 1; ln <= end && ln <= lines.length; ln += 1) {
    const raw = lines[ln - 1]!;
    const t = stripStrings(raw).replace(/#.*$/, "").trim();
    if (!t) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent <= baseIndent) break;
    while (frames.length > 1 && indent <= frames[frames.length - 1]!.indent) frames.pop();
    const cur = frames[frames.length - 1]!;
    const text = raw.trim();
    const colon = /:\s*$/.test(t);
    const push = (list: Stmt[]): void => void frames.push({ indent, list });
    let m: RegExpMatchArray | null;
    const names = calls.get(ln);
    const addCalls = (list: Stmt[]): void => {
      if (names?.length) list.push({ k: "call", line: ln, names: [...names] });
    };
    if ((m = /^if\s+(.*?):\s*(.*)$/.exec(text))) {
      addCalls(cur.list);
      const stmt: If = { k: "if", line: ln, branches: [{ cond: clean(m[1]!), line: ln, body: [] }], otherwise: null };
      cur.list.push(stmt);
      lastAt.set(indent, stmt);
      if (colon) push(stmt.branches[0]!.body);
      else inline(m[2]!, ln, stmt.branches[0]!.body, new Map());
    } else if ((m = /^elif\s+(.*?):/.exec(text))) {
      const prev = lastAt.get(indent);
      if (prev?.k === "if") {
        const body: Stmt[] = [];
        prev.branches.push({ cond: clean(m[1]!), line: ln, body });
        addCalls(body);
        push(body);
      }
    } else if (/^else\s*:/.test(text)) {
      const prev = lastAt.get(indent);
      if (prev?.k === "if") {
        prev.otherwise = [];
        push(prev.otherwise);
      } else push(cur.list);
    } else if ((m = /^match\s+(.*?):/.exec(text))) {
      const stmt: Switch = { k: "switch", line: ln, subject: clean(m[1]!), cases: [] };
      cur.list.push(stmt);
      lastAt.set(indent, stmt);
      push([]);
    } else if ((m = /^case\s+(.*?):/.exec(text))) {
      const sw = [...lastAt.values()].reverse().find((s) => s.k === "switch") as Switch | undefined;
      const body: Stmt[] = [];
      sw?.cases.push({ label: clean(stripQuotes(m[1]!), 32), line: ln, body });
      push(body);
    } else if ((m = /^(for|while)\s+(.*?):/.exec(text))) {
      addCalls(cur.list);
      const stmt: Stmt = { k: "loop", line: ln, head: clean(`${m[1]} ${m[2]}`), body: [] };
      cur.list.push(stmt);
      push(stmt.body);
    } else if (/^try\s*:/.test(text)) {
      const stmt: Try = { k: "try", line: ln, body: [], handler: null, final: null };
      cur.list.push(stmt);
      lastAt.set(indent, stmt);
      push(stmt.body);
    } else if ((m = /^except\b\s*(.*?):/.exec(text))) {
      const prev = lastAt.get(indent);
      if (prev?.k === "try") {
        prev.handler ??= { line: ln, param: clean(m[1] || "error", 24), body: [] };
        push(prev.handler.body);
      } else push(cur.list);
    } else if (/^finally\s*:/.test(text)) {
      const prev = lastAt.get(indent);
      if (prev?.k === "try") {
        prev.final = [];
        push(prev.final);
      } else push(cur.list);
    } else if ((m = /^return\b(.*)$/.exec(text))) {
      addCalls(cur.list);
      cur.list.push({ k: "return", line: ln, text: clean(m[1]!, 32) });
    } else if (/^raise\b/.test(text)) {
      addCalls(cur.list);
      cur.list.push({ k: "throw", line: ln, text: clean(text, 40) });
    } else {
      addCalls(cur.list);
      if (colon) push(cur.list); // with / def / class inside: flatten
    }
  }
  return root;
}
