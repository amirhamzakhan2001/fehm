import { isAbsolute, relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import type { FehmEngine } from '../engine.js';
import type { FailureFrame, FailureInput } from './types.js';
import { redact } from '../guardrails/workflow.js';

export const MAX_INPUT_BYTES = 128 * 1024;
export function sanitize(text: string): string {
  return redact(text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}
export function validateInput(value: unknown): FailureInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a failure input object');
  const v = value as Record<string, unknown>;
  for (const key of ['text', 'runId', 'evidenceId', 'failureRevision']) if (v[key] !== undefined && typeof v[key] !== 'string') throw new Error(`Invalid ${key}`);
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_INPUT_BYTES) throw new Error('Failure input exceeds 128 KiB');
  const out: FailureInput = {};
  if (typeof v.text === 'string') out.text = sanitize(v.text);
  if (v.runId !== undefined || v.evidenceId !== undefined) {
    if (typeof v.runId !== 'string' || typeof v.evidenceId !== 'string' || !/^[a-f0-9-]{36}$/.test(v.runId) || !/^[a-f0-9-]{36}$/.test(v.evidenceId)) throw new Error('A valid run ID and evidence ID are required together');
    out.runId = v.runId; out.evidenceId = v.evidenceId;
  }
  if (typeof v.failureRevision === 'string' && v.failureRevision) {
    if (!/^[a-f0-9]{7,64}$/i.test(v.failureRevision)) throw new Error('Failure revision must be a commit hash');
    out.failureRevision = v.failureRevision.toLowerCase();
  }
  if (v.location !== undefined) {
    const l = v.location as Record<string, unknown>;
    if (!l || typeof l.path !== 'string' || !l.path || l.path.length > 4096 || !Number.isSafeInteger(l.line) || Number(l.line) < 1) throw new Error('Location requires a path and positive line number');
    out.location = {path:l.path, line:Number(l.line)};
  }
  if (!out.text?.trim() && !out.location && !out.runId) throw new Error('Provide failure text, a location, or recorded check evidence');
  return out;
}
/** Only indexed regular paths contained in the repository can be read. */
export function safeIndexedPath(engine: FehmEngine, path: string): boolean {
  if (!engine.fileHashes().has(path) || /(^|\/)\.env(?:\.|$)/i.test(path)) return false;
  try {
    const base = realpathSync(engine.root), abs = realpathSync(resolve(base, path));
    const rel = relative(base, abs);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  } catch { return false; }
}
export function parseFrames(input: FailureInput): FailureFrame[] {
  const out: FailureFrame[] = [];
  if (input.location) out.push({raw:`${input.location.path}:${input.location.line}`, inputLine:0, ...input.location, status:'unresolved', candidates:[]});
  for (const [i, raw] of (input.text ?? '').split('\n').entries()) {
    if (out.length >= 100) break;
    const py = /^\s*File "(.+)", line (\d+)(?:,|$)/.exec(raw);
    const node = /^\s*at (?:.*? \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(raw);
    const m = py ?? node;
    if (!m) continue;
    const frame: FailureFrame = {raw, inputLine:i + 1,path:m[1]!,line:Number(m[2]),status:'unresolved',candidates:[]};
    if (node) frame.column = Number(node[3]);
    out.push(frame);
  }
  return out;
}
export function resolveFrames(engine: FehmEngine, frames: FailureFrame[]): FailureFrame[] {
  const paths = [...engine.fileHashes().keys()];
  return frames.map(original => {
    const f = {...original, candidates:[] as string[]};
    let path = f.path.replaceAll('\\', '/');
    if (path.startsWith('file://')) { try { path = decodeURIComponent(new URL(path).pathname); } catch { f.status='invalid'; return f; } }
    if (path.includes('\0') || path.split('/').includes('..') || !Number.isSafeInteger(f.line) || f.line < 1 || /^[a-z]+:\/\//i.test(path)) { f.status='invalid'; return f; }
    path = path.replace(/^\.\//, '');
    const rel = relative(engine.root, path).replaceAll('\\','/');
    const exact = paths.includes(path) ? path : isAbsolute(path) && paths.includes(rel) ? rel : undefined;
    let candidates = exact ? [exact] : paths.filter(p => path.endsWith(`/${p}`) || (!path.includes('/') && p.split('/').at(-1) === path));
    candidates = candidates.filter(p => safeIndexedPath(engine,p));
    f.candidates = candidates.slice(0,20);
    if (candidates.length !== 1) { f.status = candidates.length ? 'ambiguous' : 'unresolved'; return f; }
    const found = candidates[0]!, lines = engine.sourceLines(found);
    if (!lines || f.line > lines.length) { f.status='invalid'; return f; }
    f.status='resolved'; f.resolvedPath=found; f.mapping=exact ? 'exact' : 'suffix';
    const symbols = engine.graph.nodes().filter(n => n.path === found && n.location && n.location.line <= f.line && (n.location.endLine ?? n.location.line) >= f.line);
    symbols.sort((a,b) => ((a.location!.endLine ?? a.location!.line) - a.location!.line) - ((b.location!.endLine ?? b.location!.line) - b.location!.line));
    f.nodeId = symbols[0]?.id ?? `file:${found}`;
    return f;
  });
}
