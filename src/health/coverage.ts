import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, posix, relative, sep } from "node:path";
import type { Finding } from "../findings/model.js";
import { makeFinding } from "./rules.js";
import type { CoverageArtifact, CoverageFile, CoverageFormat, CoverageReport, Protection, Ratio } from "./types.js";

/**
 * Runtime coverage from artifacts the project's own tooling wrote. Fehm never
 * runs the tests to produce them. An artifact older than the files it
 * describes is still read, but those files are marked stale.
 */

const CANDIDATES: [string, CoverageFormat][] = [
  ["coverage/lcov.info", "lcov"],
  ["lcov.info", "lcov"],
  ["coverage/lcov/lcov.info", "lcov"],
  ["coverage/coverage-final.json", "istanbul-final"],
  ["coverage/cobertura-coverage.xml", "cobertura"],
  ["coverage.xml", "cobertura"],
  ["cobertura.xml", "cobertura"],
  ["target/site/jacoco/jacoco.xml", "jacoco"],
  ["build/reports/jacoco/test/jacocoTestReport.xml", "jacoco"],
  ["coverage.out", "go-profile"],
  ["cover.out", "go-profile"],
  ["coverage.json", "coverage-py-json"],
  ["coverage/coverage-summary.json", "istanbul-summary"],
  ["coverage-summary.json", "istanbul-summary"],
];
/** Line-level formats first: they let Fehm map coverage onto individual symbols. */
const PRIORITY: CoverageFormat[] = ["lcov", "istanbul-final", "cobertura", "jacoco", "go-profile", "coverage-py-json", "istanbul-summary"];
const UNREADABLE: [string, string][] = [
  [".coverage", "coverage.py data file (SQLite): run `coverage json` or `coverage xml` so Fehm can read it."],
  ["target/jacoco.exec", "JaCoCo binary data: generate the XML report (jacoco:report) so Fehm can read it."],
  ["build/jacoco/test.exec", "JaCoCo binary data: generate the XML report (jacocoTestReport) so Fehm can read it."],
];

interface Parsed {
  files: Map<string, CoverageFile>;
  lines: Map<string, Map<number, number>>;
}

export interface CoverageResult {
  report: CoverageReport["runtime"];
  detected: CoverageReport["detected"];
  /** Line hits per repository path (line-level formats only). */
  lines: Map<string, Map<number, number>>;
  hashes: string[];
}

export function readCoverage(root: string, indexed: readonly string[], extra: string[], manifestDirs: string[]): CoverageResult {
  const detected: CoverageReport["detected"] = [];
  const found: { path: string; format: CoverageFormat }[] = [];
  const dirs = ["", ...manifestDirs.filter((d) => d && d !== ".")];
  for (const dir of dirs) {
    for (const [rel, format] of CANDIDATES) {
      const p = dir ? posix.join(dir, rel) : rel;
      if (existsSync(join(root, p)) && !found.some((f) => f.path === p)) found.push({ path: p, format });
    }
    for (const [rel, problem] of UNREADABLE) {
      const p = dir ? posix.join(dir, rel) : rel;
      if (existsSync(join(root, p))) detected.push({ path: p, format: "unsupported", problem });
    }
  }
  for (const p of extra) {
    if (!existsSync(join(root, p))) {
      detected.push({ path: p, format: "unknown", problem: "Listed in .fehm/health.json but does not exist." });
      continue;
    }
    const format = sniff(join(root, p));
    if (format) found.unshift({ path: p, format });
    else detected.push({ path: p, format: "unknown", problem: "Not a recognised coverage format (LCOV, Istanbul JSON, Cobertura or JaCoCo XML, Go profile, coverage.py JSON)." });
  }
  const resolver = pathResolver(root, indexed);
  const usable: { path: string; format: CoverageFormat; parsed: Parsed; mtime: number; unmatched: number; hash: string }[] = [];
  for (const f of found) {
    const abs = join(root, f.path);
    let text: string;
    try {
      if (statSync(abs).size > 64 * 1024 * 1024) {
        detected.push({ path: f.path, format: f.format, problem: "Larger than 64 MB; not read." });
        continue;
      }
      text = readFileSync(abs, "utf8");
    } catch (e) {
      detected.push({ path: f.path, format: f.format, problem: `Unreadable: ${(e as Error).message}` });
      continue;
    }
    let parsed: { parsed: Parsed; unmatched: number };
    try {
      parsed = parse(f.format, text, resolver);
    } catch (e) {
      detected.push({ path: f.path, format: f.format, problem: `Could not be parsed: ${(e as Error).message}` });
      continue;
    }
    if (!parsed.parsed.files.size) {
      detected.push({ path: f.path, format: f.format, problem: parsed.unmatched ? `None of its ${parsed.unmatched} files match an indexed file.` : "Contains no file records." });
      continue;
    }
    usable.push({ ...f, parsed: parsed.parsed, mtime: statSync(abs).mtimeMs, unmatched: parsed.unmatched, hash: `${f.path}:${statSync(abs).mtimeMs}:${text.length}` });
  }
  if (!usable.length) return { report: undefined, detected, lines: new Map(), hashes: [] };
  usable.sort((a, b) => PRIORITY.indexOf(a.format) - PRIORITY.indexOf(b.format));
  const primary = usable[0]!;
  for (const u of usable.slice(1)) detected.push({ path: u.path, format: u.format, problem: `Also present; ${primary.path} is used (${primary.format === u.format ? "listed first" : "finer-grained format"}).` });

  const staleFiles: string[] = [];
  for (const path of primary.parsed.files.keys()) {
    try {
      if (statSync(join(root, path)).mtimeMs > primary.mtime + 1000) staleFiles.push(path);
    } catch {
      /* deleted since: not indexed either */
    }
  }
  const artifact: CoverageArtifact = { path: primary.path, format: primary.format, modifiedAt: new Date(primary.mtime).toISOString(), files: primary.parsed.files.size, staleFiles: staleFiles.sort() };
  const files = [...primary.parsed.files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const totals: NonNullable<CoverageReport["runtime"]>["totals"] = {};
  for (const k of ["lines", "statements", "functions", "branches"] as const) {
    const withK = files.filter((f) => f[k]);
    if (withK.length) totals[k] = ratio(withK.reduce((s, f) => s + f[k]!.covered, 0), withK.reduce((s, f) => s + f[k]!.total, 0));
  }
  return { report: { artifacts: [artifact], totals, files, unmatchedRecords: primary.unmatched }, detected, lines: primary.parsed.lines, hashes: usable.map((u) => u.hash) };
}

export function ratio(covered: number, total: number): Ratio {
  return { covered, total, pct: total ? Math.round((covered / total) * 1000) / 10 : 100 };
}

function sniff(abs: string): CoverageFormat | undefined {
  let head: string;
  try {
    head = readFileSync(abs, "utf8").slice(0, 4000);
  } catch {
    return undefined;
  }
  if (/^(?:TN:|SF:)/m.test(head)) return "lcov";
  if (/^mode:\s*(?:set|count|atomic)/.test(head)) return "go-profile";
  if (/<coverage\b[^>]*line-rate/.test(head)) return "cobertura";
  if (/<report\b/.test(head) && /jacoco|<package\b|<sessioninfo\b/i.test(head)) return "jacoco";
  if (/"statementMap"/.test(head)) return "istanbul-final";
  if (/"executed_lines"|"meta"\s*:\s*\{[^}]*"format"/.test(head)) return "coverage-py-json";
  if (/"total"\s*:\s*\{\s*"lines"/.test(head)) return "istanbul-summary";
  return undefined;
}

type Resolve = (p: string) => string | undefined;

/** Map an artifact's file path (absolute, relative, or module-qualified) to an indexed repository path. */
function pathResolver(root: string, indexed: readonly string[]): Resolve {
  const set = new Set(indexed);
  const byBase = new Map<string, string[]>();
  for (const p of indexed) {
    const b = posix.basename(p);
    byBase.set(b, [...(byBase.get(b) ?? []), p]);
  }
  return (raw: string) => {
    let p = raw.replace(/\\/g, "/").replace(/^file:\/\//, "");
    if (isAbsolute(p) || /^[A-Za-z]:\//.test(p)) {
      const rel = relative(root, p).split(sep).join("/");
      if (!rel.startsWith("..")) p = rel;
    }
    p = p.replace(/^\.\//, "");
    if (set.has(p)) return p;
    const candidates = (byBase.get(posix.basename(p)) ?? []).filter((c) => p.endsWith(`/${c}`) || c.endsWith(`/${p}`));
    return candidates.length === 1 ? candidates[0] : undefined;
  };
}

function parse(format: CoverageFormat, text: string, resolve: Resolve): { parsed: Parsed; unmatched: number } {
  const files = new Map<string, CoverageFile>();
  const lines = new Map<string, Map<number, number>>();
  let unmatched = 0;
  const lineMap = (path: string): Map<number, number> => {
    let m = lines.get(path);
    if (!m) lines.set(path, (m = new Map()));
    return m;
  };
  const hit = (path: string, line: number, count: number): void => {
    const m = lineMap(path);
    m.set(line, Math.max(m.get(line) ?? 0, count));
  };
  const finishLines = (path: string, extra: Partial<CoverageFile> = {}): void => {
    const m = lines.get(path);
    const f: CoverageFile = { path, ...(files.get(path) ?? {}), ...extra };
    if (m && m.size) f.lines = ratio([...m.values()].filter((h) => h > 0).length, m.size);
    files.set(path, f);
  };

  switch (format) {
    case "lcov": {
      let cur: string | undefined;
      let fn = { f: 0, h: 0 };
      let br = { f: 0, h: 0 };
      let lf = { f: 0, h: 0 };
      let skip = false;
      for (const raw of text.split(/\r?\n/)) {
        const l = raw.trim();
        if (l.startsWith("SF:")) {
          cur = resolve(l.slice(3));
          skip = !cur;
          if (skip) unmatched += 1;
          fn = { f: 0, h: 0 };
          br = { f: 0, h: 0 };
          lf = { f: 0, h: 0 };
        } else if (skip || !cur) continue;
        else if (l.startsWith("DA:")) {
          const [ln, count] = l.slice(3).split(",");
          hit(cur, Number(ln), Number(count) || 0);
        } else if (l.startsWith("FNF:")) fn.f = Number(l.slice(4));
        else if (l.startsWith("FNH:")) fn.h = Number(l.slice(4));
        else if (l.startsWith("BRF:")) br.f = Number(l.slice(4));
        else if (l.startsWith("BRH:")) br.h = Number(l.slice(4));
        else if (l.startsWith("LF:")) lf.f = Number(l.slice(3));
        else if (l.startsWith("LH:")) lf.h = Number(l.slice(3));
        else if (l === "end_of_record") {
          const extra: Partial<CoverageFile> = {};
          if (fn.f) extra.functions = ratio(fn.h, fn.f);
          if (br.f) extra.branches = ratio(br.h, br.f);
          finishLines(cur, extra);
          if (!lines.get(cur)?.size && lf.f) files.set(cur, { ...files.get(cur)!, lines: ratio(lf.h, lf.f) });
          cur = undefined;
        }
      }
      break;
    }
    case "istanbul-final": {
      const raw = JSON.parse(text) as Record<string, { path?: string; statementMap: Record<string, { start: { line: number } }>; s: Record<string, number>; fnMap?: Record<string, unknown>; f?: Record<string, number>; b?: Record<string, number[]> }>;
      for (const [key, v] of Object.entries(raw)) {
        const path = resolve(v.path ?? key);
        if (!path) {
          unmatched += 1;
          continue;
        }
        const s = Object.entries(v.s ?? {});
        for (const [id, count] of s) {
          const start = v.statementMap[id]?.start.line;
          if (start) hit(path, start, count);
        }
        const f = Object.values(v.f ?? {});
        const b = Object.values(v.b ?? {}).flat();
        finishLines(path, {
          statements: ratio(s.filter(([, c]) => c > 0).length, s.length),
          ...(f.length ? { functions: ratio(f.filter((c) => c > 0).length, f.length) } : {}),
          ...(b.length ? { branches: ratio(b.filter((c) => c > 0).length, b.length) } : {}),
        });
      }
      break;
    }
    case "istanbul-summary": {
      const raw = JSON.parse(text) as Record<string, Record<string, { total: number; covered: number }>>;
      for (const [key, v] of Object.entries(raw)) {
        if (key === "total") continue;
        const path = resolve(key);
        if (!path) {
          unmatched += 1;
          continue;
        }
        const f: CoverageFile = { path };
        for (const k of ["lines", "statements", "functions", "branches"] as const) if (v[k] && typeof v[k].total === "number") f[k] = ratio(v[k].covered, v[k].total);
        files.set(path, f);
      }
      break;
    }
    case "cobertura": {
      const sources = [...text.matchAll(/<source>([^<]*)<\/source>/g)].map((m) => m[1]!.trim());
      const branches = new Map<string, { c: number; t: number }>();
      for (const cls of text.matchAll(/<class\b[^>]*\bfilename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g)) {
        const name = cls[1]!;
        const path = resolve(name) ?? sources.map((s) => resolve(`${s.replace(/\/$/, "")}/${name}`)).find(Boolean);
        if (!path) {
          unmatched += 1;
          continue;
        }
        for (const ln of cls[2]!.matchAll(/<line\b([^>]*)\/?>/g)) {
          const attrs = ln[1]!;
          const n = Number(/\bnumber="(\d+)"/.exec(attrs)?.[1]);
          const h = Number(/\bhits="(\d+)"/.exec(attrs)?.[1] ?? 0);
          if (n) hit(path, n, h);
          const cc = /condition-coverage="[^"(]*\((\d+)\/(\d+)\)"/.exec(attrs);
          if (cc) {
            const b = branches.get(path) ?? { c: 0, t: 0 };
            b.c += Number(cc[1]);
            b.t += Number(cc[2]);
            branches.set(path, b);
          }
        }
      }
      for (const path of lines.keys()) {
        const b = branches.get(path);
        finishLines(path, b ? { branches: ratio(b.c, b.t) } : {});
      }
      break;
    }
    case "jacoco": {
      for (const pkg of text.matchAll(/<package\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/package>/g)) {
        for (const sf of pkg[2]!.matchAll(/<sourcefile\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/sourcefile>/g)) {
          const path = resolve(pkg[1] ? `${pkg[1]}/${sf[1]}` : sf[1]!);
          if (!path) {
            unmatched += 1;
            continue;
          }
          let bc = 0;
          let bt = 0;
          for (const ln of sf[2]!.matchAll(/<line\b([^>]*)\/>/g)) {
            const a = ln[1]!;
            const num = (k: string): number => Number(new RegExp(`\\b${k}="(\\d+)"`).exec(a)?.[1] ?? 0);
            hit(path, num("nr"), num("ci"));
            bc += num("cb");
            bt += num("cb") + num("mb");
          }
          const counter = (type: string): Ratio | undefined => {
            const m = new RegExp(`<counter\\b[^>]*type="${type}"[^>]*missed="(\\d+)"[^>]*covered="(\\d+)"`).exec(sf[2]!);
            return m ? ratio(Number(m[2]), Number(m[1]) + Number(m[2])) : undefined;
          };
          const methods = counter("METHOD");
          const instr = counter("INSTRUCTION");
          finishLines(path, { ...(bt ? { branches: ratio(bc, bt) } : {}), ...(methods ? { functions: methods } : {}), ...(instr ? { statements: instr } : {}) });
        }
      }
      break;
    }
    case "go-profile": {
      const stmts = new Map<string, { c: number; t: number }>();
      for (const l of text.split(/\r?\n/).slice(1)) {
        const m = /^(.+):(\d+)\.\d+,(\d+)\.\d+ (\d+) (\d+)$/.exec(l.trim());
        if (!m) continue;
        const path = resolve(m[1]!);
        if (!path) {
          unmatched += 1;
          continue;
        }
        const count = Number(m[5]);
        for (let ln = Number(m[2]); ln <= Number(m[3]); ln += 1) hit(path, ln, count);
        const s = stmts.get(path) ?? { c: 0, t: 0 };
        s.t += Number(m[4]);
        if (count > 0) s.c += Number(m[4]);
        stmts.set(path, s);
      }
      for (const [path, s] of stmts) finishLines(path, { statements: ratio(s.c, s.t) });
      break;
    }
    case "coverage-py-json": {
      const raw = JSON.parse(text) as { files?: Record<string, { executed_lines?: number[]; missing_lines?: number[]; summary?: { num_branches?: number; covered_branches?: number } }> };
      for (const [key, v] of Object.entries(raw.files ?? {})) {
        const path = resolve(key);
        if (!path) {
          unmatched += 1;
          continue;
        }
        for (const l of v.executed_lines ?? []) hit(path, l, 1);
        for (const l of v.missing_lines ?? []) hit(path, l, 0);
        const b = v.summary?.num_branches ? { branches: ratio(v.summary.covered_branches ?? 0, v.summary.num_branches) } : {};
        finishLines(path, b);
      }
      break;
    }
  }
  return { parsed: { files, lines }, unmatched };
}

/** Structural test protection summarized per file (symbols reached by tests through the graph). */
export function structuralCoverage(symbols: { id: string; path?: string }[], protection: Map<string, Protection>): CoverageReport["structural"] {
  const byFile = new Map<string, { symbols: number; protected: number }>();
  let direct = 0;
  let transitive = 0;
  let none = 0;
  for (const s of symbols) {
    const p = protection.get(s.id) ?? "none";
    if (p === "direct" || p === "runtime") direct += 1;
    else if (p === "transitive") transitive += 1;
    else none += 1;
    if (!s.path) continue;
    const f = byFile.get(s.path) ?? { symbols: 0, protected: 0 };
    f.symbols += 1;
    if (p !== "none") f.protected += 1;
    byFile.set(s.path, f);
  }
  return { symbols: symbols.length, direct, transitive, none, files: [...byFile].map(([path, v]) => ({ path, ...v })).sort((a, b) => a.protected / a.symbols - b.protected / b.symbols || b.symbols - a.symbols || a.path.localeCompare(b.path)) };
}

export function coverageFindings(runtime: CoverageReport["runtime"], sources: Set<string>): Finding[] {
  if (!runtime) return [];
  const out: Finding[] = [];
  const art = runtime.artifacts[0]!;
  const low = runtime.files.filter((f) => sources.has(f.path) && f.lines && f.lines.total >= 20 && f.lines.pct < 50).sort((a, b) => a.lines!.pct - b.lines!.pct || b.lines!.total - a.lines!.total);
  if (low.length) {
    out.push(
      makeFinding("coverage/low-file-coverage", {
        id: "coverage:low-files",
        title: `${low.length} source ${low.length === 1 ? "file has" : "files have"} under 50% line coverage`,
        message: `Measured by ${art.path} (${art.format}). Files with fewer than 20 instrumented lines are not listed.`,
        why: "Lines no test executes can break without any test failing.",
        action: "Start with the least-covered files that other code depends on (see Technical debt hotspots).",
        confidence: "verified",
        evidence: low.map((f) => ({ type: "coverage", path: f.path, detail: `${f.lines!.pct}% of ${f.lines!.total} lines${art.staleFiles.includes(f.path) ? " (file changed after the artifact)" : ""}`, confidence: art.staleFiles.includes(f.path) ? "inferred" : "verified" })),
      }),
    );
  }
  if (art.staleFiles.length) {
    out.push(
      makeFinding("coverage/stale-artifact", {
        id: "coverage:stale",
        title: `Coverage artifact is older than ${art.staleFiles.length} ${art.staleFiles.length === 1 ? "file" : "files"} it describes`,
        message: `${art.path} was written ${art.modifiedAt}; these files changed afterwards, so their coverage numbers may be wrong.`,
        why: "Coverage from an old run describes old code.",
        action: "Re-run the test suite with coverage, then refresh.",
        confidence: "verified",
        evidence: art.staleFiles.map((p) => ({ type: "coverage", path: p, detail: "modified after the coverage artifact" })),
      }),
    );
  }
  return out;
}
