import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BriefingFacts } from "../codebase-briefing/facts.js";
import { FehmEngine } from "../engine.js";
import { buildArchitectureModel } from "./model.js";
import type { ArchitectureModel, ArchNode, ArchRelationship, DeltaStatus } from "./types.js";
import { layoutEdge, layoutNode, plural, type Availability, type ViewContext, type ViewResult } from "./view-kit.js";

/**
 * Architecture delta: the architecture at a git revision against the working
 * tree (or the previous commit when the tree is clean). Both sides are the
 * same semantic model, compared by stable id at module level: modules and
 * relationships are added, removed or changed (files or weight), and
 * unchanged neighbours are kept as context. No image comparison, no guessing.
 */

const MAX_NODES = 40;
const REF = /^(HEAD(~\d{1,4}|\^{1,4})?|[0-9a-f]{7,40}|[A-Za-z0-9][\w./-]{0,99})$/;

interface Snapshot {
  commit: string;
  model: ArchitectureModel;
  hashes: Map<string, string>;
}

const snapshots = new Map<string, Snapshot>();

function git(root: string, args: string[], input?: Buffer): Buffer {
  return execFileSync("git", ["-C", root, ...args], { stdio: ["pipe", "pipe", "ignore"], maxBuffer: 1 << 30, timeout: 60_000, ...(input ? { input } : {}) });
}

export function gitInfo(root: string): { top: string; sub: string; dirty: boolean; commits: { hash: string; short: string; subject: string }[] } | undefined {
  try {
    const top = git(root, ["rev-parse", "--show-toplevel"]).toString().trim();
    // Git's own prefix (symlinked temp dirs make a computed relative path wrong).
    const sub = git(root, ["rev-parse", "--show-prefix"]).toString().trim().replace(/\/$/, "");
    const log = git(root, ["log", "-n", "15", "--format=%H%x09%h%x09%s", "--", "."]).toString().trim();
    const commits = log ? log.split("\n").map((l) => {
      const [hash, short, subject] = l.split("\t") as [string, string, string];
      return { hash, short, subject };
    }) : [];
    const dirty = git(root, ["status", "--porcelain", "--", "."]).toString().trim().length > 0;
    return { top, sub, dirty, commits };
  } catch {
    return undefined;
  }
}

export function deltaAvailability(ctx: ViewContext): Availability {
  const info = gitInfo(ctx.engine.root);
  if (!info) return { available: false, reason: "The repository is not a git working tree (or git is not installed)." };
  if (!info.commits.length) return { available: false, reason: "No commits touch this directory yet." };
  const options = [
    ...(info.dirty ? [{ id: "HEAD", label: "Working tree vs last commit", detail: `${info.commits[0]!.short} ${info.commits[0]!.subject}` }] : []),
    ...info.commits.slice(info.dirty ? 0 : 1).map((c) => ({ id: c.hash, label: `Since ${c.short}: ${c.subject.slice(0, 60)}`, detail: c.hash })),
  ];
  if (!options.length) return { available: false, reason: "Only one commit and no uncommitted changes: nothing to compare." };
  return { available: true, optionLabel: "Compare with", options };
}

/** The semantic model of the repository at a commit (memoized; Feature 3.4 evaluates drift history on it). */
export function modelAtCommit(root: string, commit: string): ArchitectureModel {
  const info = gitInfo(root);
  if (!info) throw new Error("not a git repository");
  return snapshot(root, info.sub, commit).model;
}

/** Resolve a revision to a full commit hash (only safe revision syntax is accepted). */
export function resolveCommit(root: string, ref: string): string | undefined {
  if (!REF.test(ref) || ref.startsWith("-")) return undefined;
  try {
    return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run `fn` on the repository's tree at a commit, extracted into a temporary
 * directory that is removed afterwards (Feature 3.4 analyses drift on it).
 */
export function withCommitTree<T>(root: string, commit: string, fn: (dir: string) => T): T {
  const info = gitInfo(root);
  if (!info) throw new Error("not a git repository");
  const dir = mkdtempSync(join(tmpdir(), "fehm-tree-"));
  try {
    const tar = git(root, ["archive", "--format=tar", info.sub ? `${commit}:${info.sub}` : commit]);
    execFileSync("tar", ["-x", "-C", dir], { input: tar, stdio: ["pipe", "ignore", "ignore"], maxBuffer: 1 << 30 });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Build (or reuse) the semantic model of the repository at a commit. */
function snapshot(root: string, sub: string, commit: string): Snapshot {
  const key = `${root}\u0000${commit}`;
  const hit = snapshots.get(key);
  if (hit) return hit;
  const dir = mkdtempSync(join(tmpdir(), "fehm-delta-"));
  try {
    const tar = git(root, ["archive", "--format=tar", sub ? `${commit}:${sub}` : commit]);
    execFileSync("tar", ["-x", "-C", dir], { input: tar, stdio: ["pipe", "ignore", "ignore"], maxBuffer: 1 << 30 });
    const engine = FehmEngine.open(dir, { stateDirectory: join(dir, ".fehm-delta-state") });
    const model = buildArchitectureModel(engine, new BriefingFacts(engine));
    const snap = { commit, model, hashes: new Map(engine.fileHashes()) };
    if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(key, snap);
    return snap;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function deltaView(ctx: ViewContext, focus?: string): ViewResult {
  const info = gitInfo(ctx.engine.root);
  if (!info) return { error: "not a git repository" };
  const ref = focus || (info.dirty ? "HEAD" : info.commits[1]?.hash ?? "HEAD");
  if (!REF.test(ref) || ref.startsWith("-")) return { error: "invalid revision" };
  let commit: string;
  try {
    commit = git(ctx.engine.root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).toString().trim();
  } catch {
    return { error: `unknown revision ${ref}` };
  }
  let base: Snapshot;
  try {
    base = snapshot(ctx.engine.root, info.sub, commit);
  } catch (e) {
    return { error: `could not read ${ref}: ${(e as Error).message.split("\n")[0]}` };
  }
  const cur = ctx.model;
  const curHashes = ctx.engine.fileHashes();
  const baseById = new Map(base.model.nodes.map((n) => [n.id, n]));
  const inScope = (n: ArchNode): boolean => n.level === 3 || n.tier !== 1;
  const curNodes = cur.nodes.filter(inScope);
  const baseNodes = base.model.nodes.filter(inScope);
  const status = new Map<string, DeltaStatus>();
  const changedFiles = new Map<string, number>();
  for (const n of curNodes) {
    const old = baseById.get(n.id);
    if (!old) {
      status.set(n.id, "added");
      continue;
    }
    const files = new Set([...n.files, ...old.files]);
    let diff = 0;
    for (const f of files) if (curHashes.get(f) !== base.hashes.get(f)) diff += 1;
    changedFiles.set(n.id, diff);
    status.set(n.id, diff ? "changed" : "unchanged");
  }
  for (const n of baseNodes) if (!status.has(n.id)) status.set(n.id, "removed");

  const scopeIds = new Set([...curNodes, ...baseNodes].map((n) => n.id));
  const relIn = (m: ArchitectureModel): Map<string, ArchRelationship> => new Map(m.relationships.filter((r) => scopeIds.has(r.source) && scopeIds.has(r.target)).map((r) => [r.id, r]));
  const curRels = relIn(cur);
  const baseRels = relIn(base.model);
  const rels: ArchRelationship[] = [];
  for (const [id, r] of curRels) {
    const old = baseRels.get(id);
    const st: DeltaStatus = !old ? "added" : old.type !== r.type || Math.abs(old.weight - r.weight) / Math.max(old.weight, r.weight) >= 0.5 ? "changed" : "unchanged";
    // Added and removed edges are told apart by stroke and dash (never colour alone); only a weight change needs words.
    const { label: _l, ...rest } = r;
    void _l;
    rels.push({ ...rest, status: st, ...(st === "changed" && old ? { label: `${old.weight} → ${r.weight}` } : {}) });
  }
  for (const [id, r] of baseRels) {
    if (curRels.has(id)) continue;
    const { label: _l, ...rest } = r;
    void _l;
    rels.push({ ...rest, status: "removed" });
  }

  // Show what changed plus the unchanged endpoints of changed relationships.
  const changedRels = rels.filter((r) => r.status !== "unchanged");
  const keep = new Set<string>([...status].filter(([, s]) => s !== "unchanged").map(([id]) => id));
  for (const r of changedRels) (keep.add(r.source), keep.add(r.target));
  const priority = (id: string): number => ({ added: 0, removed: 0, changed: 1, unchanged: 2 })[status.get(id) ?? "unchanged"];
  const ids = [...keep].sort((a, b) => priority(a) - priority(b) || (a < b ? -1 : 1)).slice(0, MAX_NODES);
  const shown = new Set(ids);
  const label = ref === "HEAD" ? "last commit" : commit.slice(0, 7);
  const summary = (s: DeltaStatus): number => [...status.values()].filter((x) => x === s).length;
  const relSummary = (s: DeltaStatus): number => rels.filter((r) => r.status === s).length;
  const counts = `${summary("added")} modules added, ${summary("removed")} removed, ${summary("changed")} changed; ${relSummary("added")} dependencies added, ${relSummary("removed")} removed, ${relSummary("changed")} changed`;
  if (!shown.size) return { error: `No architecture-level changes since ${label} (${counts}).` };
  const nodes: ArchNode[] = ids.map((id) => {
    const n = cur.nodes.find((x) => x.id === id) ?? baseById.get(id)!;
    const st = status.get(id) ?? "unchanged";
    const extra = st === "changed" ? [`${plural(changedFiles.get(id) ?? 0, "file")} changed since ${label}`] : st === "added" ? [`new since ${label}`] : st === "removed" ? [`removed since ${label}`] : ["unchanged (context)"];
    return { ...n, status: st, role: { ...n.role, reasons: [...extra, ...n.role.reasons] } };
  });
  const shownRels = rels.filter((r) => shown.has(r.source) && shown.has(r.target) && (r.status !== "unchanged" || (status.get(r.source) !== "unchanged" && status.get(r.target) !== "unchanged")));
  const notes = [`Compared with ${ref === "HEAD" ? `the last commit (${commit.slice(0, 7)})` : commit.slice(0, 7)}: ${counts}.`, "Module-level comparison of the same semantic model; unchanged modules are shown only as endpoints of changed dependencies."];
  if (keep.size > ids.length) notes.push(`Showing ${ids.length} of ${keep.size} affected nodes.`);
  return {
    view: "delta",
    focus: ref,
    title: `Architecture delta since ${label}`,
    nodes,
    relationships: shownRels,
    input: {
      view: "delta",
      focus: ref,
      nodes: nodes.map((n) => layoutNode(n, n.tier === 0 ? "top" : n.tier === 3 ? "bottom" : "middle", { subtitle: n.status === "unchanged" ? "unchanged" : n.status! })),
      edges: shownRels.map((r) => layoutEdge(r)),
      boundaries: [],
    },
    path: [{ id: "system", name: cur.repository.name }, { id: ref, name: `Since ${label}` }],
    notes,
  };
}
