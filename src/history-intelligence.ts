import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { inferArchitecture, readArchitectureState } from "./architecture.js";
import type { AdrMaintenanceReport, ArchitectureConfig, ArchitectureSnapshot, ArchitectureTimeline, ChangeDigest, CodeGraph, DeveloperCheckpoint, GitCommitRecord, GitOwnershipRecord, TeamKnowledgeGraph } from "./model.js";
import { mapConcurrent } from "./concurrency.js";
import { atomicWriteJson } from "./persistence.js";

const execFileAsync = promisify(execFile);

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "decision";
}

function architectureFingerprint(config: ArchitectureConfig): string { return createHash("sha256").update(JSON.stringify(config)).digest("hex"); }

function snapshotDirectory(graph: CodeGraph): string {
  return path.join(graph.repository.root, ".fehm", "history", "architecture");
}

export async function recordArchitectureSnapshot(graph: CodeGraph): Promise<{ path: string; snapshot: ArchitectureSnapshot; created: boolean }> {
  const state = await readArchitectureState(graph);
  const proposal = await inferArchitecture(graph);
  const config = state.contract ?? proposal.config;
  const snapshot: ArchitectureSnapshot = {
    id: `${graph.generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}-${graph.repository.fingerprint.slice(0, 10)}`,
    generatedAt: graph.generatedAt,
    repositoryFingerprint: graph.repository.fingerprint,
    source: state.contract ? "approved" : "inferred",
    technologies: proposal.detectedTechnologies,
    config,
  };
  const directory = snapshotDirectory(graph);
  await mkdir(directory, { recursive: true });
  const files = (await readdir(directory)).filter((item) => item.endsWith(".json")).sort();
  const latestPath = files.length ? path.join(directory, files[files.length - 1] as string) : undefined;
  if (latestPath) {
    try {
      const latest = JSON.parse(await readFile(latestPath, "utf8")) as ArchitectureSnapshot;
      if (latest.repositoryFingerprint === snapshot.repositoryFingerprint && latest.source === snapshot.source) return { path: latestPath, snapshot: latest, created: false };
    } catch { /* a malformed historical record does not prevent a new snapshot */ }
  }
  const destination = path.join(directory, `${snapshot.id}.json`);
  await atomicWriteJson(destination, snapshot);
  return { path: destination, snapshot, created: true };
}

function timelineEvents(snapshots: ArchitectureSnapshot[]): ArchitectureTimeline["events"] {
  const events: ArchitectureTimeline["events"] = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    const before = snapshots[index - 1] as ArchitectureSnapshot;
    const after = snapshots[index] as ArchitectureSnapshot;
    const beforeLayers = new Set(before.config.layers.map((item) => item.name));
    const afterLayers = new Set(after.config.layers.map((item) => item.name));
    for (const layer of afterLayers) if (!beforeLayers.has(layer)) events.push({ at: after.generatedAt, kind: "layer-added", detail: layer });
    for (const layer of beforeLayers) if (!afterLayers.has(layer)) events.push({ at: after.generatedAt, kind: "layer-removed", detail: layer });
    const dependencies = (snapshot: ArchitectureSnapshot): Set<string> => new Set(Object.entries(snapshot.config.allowedDependencies ?? {}).flatMap(([source, targets]) => targets.map((target) => `${source} -> ${target}`)));
    const beforeDependencies = dependencies(before);
    const afterDependencies = dependencies(after);
    for (const dependency of afterDependencies) if (!beforeDependencies.has(dependency)) events.push({ at: after.generatedAt, kind: "dependency-added", detail: dependency });
    for (const dependency of beforeDependencies) if (!afterDependencies.has(dependency)) events.push({ at: after.generatedAt, kind: "dependency-removed", detail: dependency });
    if (before.source !== after.source && before.source !== "git-history" && after.source !== "git-history") events.push({ at: after.generatedAt, kind: "approval-changed", detail: `${before.source} -> ${after.source}` });
  }
  return events;
}

const HISTORY_LAYER_HINTS: Array<[string, string[]]> = [
  ["frontend", ["components", "frontend", "pages", "ui", "views", "web"]],
  ["api", ["api", "controllers", "handlers", "routes"]],
  ["services", ["domain", "services", "usecases"]],
  ["database", ["database", "db", "migrations", "models", "prisma", "schema"]],
  ["testing", ["__tests__", "test", "tests"]],
  ["infrastructure", ["deploy", "deployment", "infra", "terraform", "k8s", "kubernetes"]],
];

function historicalConfig(paths: string[], imports: string[]): ArchitectureConfig {
  const layerNames = new Set<string>();
  const layerFor = (file: string): string => {
    const parts = file.toLowerCase().split("/");
    const hinted = HISTORY_LAYER_HINTS.find(([, hints]) => hints.some((hint) => parts.includes(hint)))?.[0];
    return hinted ?? (parts[0] === "src" && parts[1] ? parts[1] : parts[0] || "root");
  };
  for (const file of paths.filter((item) => /\.(?:[cm]?[jt]sx?)$/.test(item))) layerNames.add(layerFor(file));
  const layers = [...layerNames].sort().map((name) => ({ name, patterns: [`${name === "root" ? "*" : `**/${name}/**`}`] }));
  const allowedDependencies = Object.fromEntries(layers.map((layer) => [layer.name, [] as string[]]));
  for (const line of imports) {
    const match = /^(.+?):\d+:(?:.*?from\s*|\s*import\s*\()['"]([^'"]+)/.exec(line);
    if (!match || !match[2]?.startsWith(".")) continue;
    const source = match[1] as string;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(source), match[2]));
    const from = layerFor(source); const to = layerFor(target);
    if (from !== to && allowedDependencies[from] && !allowedDependencies[from].includes(to)) allowedDependencies[from].push(to);
  }
  for (const values of Object.values(allowedDependencies)) values.sort();
  return { version: 1, layers, allowedDependencies, intent: Object.fromEntries(layers.map((layer) => [layer.name, `Historical module ${layer.name}.`])) };
}

async function reconstructGitArchitecture(graph: CodeGraph, limit: number): Promise<ArchitectureSnapshot[]> {
  try {
    const log = await execFileAsync("git", ["log", `-n${Math.max(2, limit)}`, "--format=%H%x1f%aI%x1f%s"], { cwd: graph.repository.root, maxBuffer: 4 * 1024 * 1024 });
    const commits = log.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hash = "", generatedAt = "", subject = ""] = line.split("\x1f"); return { hash, generatedAt, subject };
    }).reverse();
    const snapshots: ArchitectureSnapshot[] = [];
    for (const commit of commits) {
      const tree = await execFileAsync("git", ["ls-tree", "-r", "--name-only", commit.hash], { cwd: graph.repository.root, maxBuffer: 10 * 1024 * 1024 });
      let importLines: string[] = [];
      try {
        const grep = await execFileAsync("git", ["grep", "-n", "-E", "(from|import\\()[[:space:]]*['\"]", commit.hash, "--", "*.ts", "*.tsx", "*.js", "*.jsx"], { cwd: graph.repository.root, maxBuffer: 20 * 1024 * 1024 });
        importLines = grep.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.replace(new RegExp(`^${commit.hash}:`), ""));
      } catch { /* commits without matching imports are valid */ }
      const paths = tree.stdout.split(/\r?\n/).filter(Boolean);
      snapshots.push({ id: `git-${commit.hash.slice(0, 12)}`, generatedAt: commit.generatedAt, repositoryFingerprint: commit.hash, source: "git-history", commit: { hash: commit.hash, subject: commit.subject }, technologies: [], config: historicalConfig(paths, importLines) });
    }
    return snapshots;
  } catch { return []; }
}

export async function readArchitectureTimeline(graph: CodeGraph, options: { includeGit?: boolean; gitLimit?: number } = {}): Promise<ArchitectureTimeline> {
  const directory = snapshotDirectory(graph);
  let files: string[];
  try { files = (await readdir(directory)).filter((item) => item.endsWith(".json")).sort(); } catch { files = []; }
  const snapshots: ArchitectureSnapshot[] = [];
  for (const file of files) {
    try { snapshots.push(JSON.parse(await readFile(path.join(directory, file), "utf8")) as ArchitectureSnapshot); } catch { /* skip invalid snapshot */ }
  }
  const gitSnapshots = options.includeGit === false ? [] : await reconstructGitArchitecture(graph, options.gitLimit ?? 40);
  const combined = [...gitSnapshots, ...snapshots].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  return { snapshots: combined, events: timelineEvents(combined) };
}

async function markdownFiles(directory: string): Promise<string[]> {
  try { return (await readdir(directory)).filter((item) => item.endsWith(".md")).map((item) => path.join(directory, item)); } catch { return []; }
}

export async function maintainAdrDrafts(graph: CodeGraph): Promise<AdrMaintenanceReport> {
  const timeline = await readArchitectureTimeline(graph);
  const currentArchitecture = await inferArchitecture(graph);
  const currentArchitectureFingerprint = architectureFingerprint(currentArchitecture.config);
  const adrDirectory = path.join(graph.repository.root, "docs", "adr");
  const draftDirectory = path.join(graph.repository.root, ".fehm", "adr-drafts");
  await mkdir(draftDirectory, { recursive: true });
  const existing = [...await markdownFiles(adrDirectory), ...await markdownFiles(draftDirectory)];
  const contents = await Promise.all(existing.map(async (file) => ({ file, content: await readFile(file, "utf8") })));
  const drafts: AdrMaintenanceReport["drafts"] = contents.filter((item) => item.file.startsWith(draftDirectory)).flatMap((item) => {
    const identity = /Architecture event:\s*(layer-added|layer-removed|dependency-added|dependency-removed|approval-changed):([^\n]+)/.exec(item.content);
    const at = /- Detected:\s*([^\n]+)/.exec(item.content)?.[1]?.trim();
    return identity && at ? [{ path: item.file, event: { at, kind: identity[1] as ArchitectureTimeline["events"][number]["kind"], detail: identity[2]?.trim() ?? "" } }] : [];
  });
  const accepted = contents.filter((item) => item.file.startsWith(adrDirectory) && /- Status:\s*accepted/i.test(item.content)).at(-1)?.file;
  for (const event of timeline.events.slice(-20)) {
    if (event.kind === "approval-changed") continue;
    const identity = `${event.kind}:${event.detail}`;
    if (contents.some((item) => item.content.includes(`Architecture event: ${identity}`))) continue;
    const destination = path.join(draftDirectory, `${event.at.slice(0, 10)}-${slug(`${event.kind}-${event.detail}`)}.md`);
    const content = `# Architecture change: ${event.detail}\n\n- Status: draft\n- Detected: ${event.at}\n- Architecture event: ${identity}\n- Repository fingerprint: \`${graph.repository.fingerprint}\`\n- Architecture fingerprint: \`${currentArchitectureFingerprint}\`${accepted ? `\n- Supersedes candidate: \`${path.basename(accepted)}\`` : ""}\n\n## Context\n\nfehm detected this architecture change while refreshing the codebase graph or reconstructing Git architecture history.\n\n## Decision required\n\nReview whether this change is intentional. If accepted, move this draft into \`docs/adr/\`, document the rationale, and update the approved architecture contract when necessary.\n\n## Consequences to review\n\n- Dependency direction and coupling\n- Migration and rollback requirements\n- Test and runtime coverage\n- Security and ownership boundaries\n`;
    await writeFile(destination, content, "utf8");
    drafts.push({ path: destination, event });
    contents.push({ file: destination, content });
  }
  const stale = contents.filter((item) => item.file.startsWith(adrDirectory)).flatMap((item) => {
    const status = /- Status:\s*([^\n]+)/i.exec(item.content)?.[1]?.trim().toLowerCase();
    if (status === "deprecated" || status === "superseded") return [];
    const fingerprint = /Architecture fingerprint:\s*`([^`]+)`/.exec(item.content)?.[1];
    return fingerprint && fingerprint !== currentArchitectureFingerprint
      ? [{ path: item.file, reason: "architecture structure changed after this ADR; revalidate consequences and lifecycle status" }]
      : [];
  });
  return { generatedAt: new Date().toISOString(), drafts, stale, current: contents.filter((item) => item.file.startsWith(adrDirectory) && !/- Status:\s*(?:deprecated|superseded)/i.test(item.content) && !stale.some((entry) => entry.path === item.file)).map((item) => item.file) };
}

export async function generateAdr(
  graph: CodeGraph,
  title: string,
  decision: string,
  options: { context?: string; consequences?: string; status?: "proposed" | "accepted" | "deprecated" | "superseded" } = {},
): Promise<string> {
  if (!title.trim() || !decision.trim()) throw new Error("ADR title and decision are required");
  const directory = path.join(graph.repository.root, "docs", "adr");
  await mkdir(directory, { recursive: true });
  const existing = (await readdir(directory)).filter((item) => /^\d{4}-/.test(item));
  const number = String(Math.max(0, ...existing.map((item) => Number(item.slice(0, 4)) || 0)) + 1).padStart(4, "0");
  const destination = path.join(directory, `${number}-${slug(title)}.md`);
  const architecture = await inferArchitecture(graph);
  const content = `# ${title.trim()}\n\n- Status: ${options.status ?? "proposed"}\n- Date: ${new Date().toISOString().slice(0, 10)}\n- Repository fingerprint: \`${graph.repository.fingerprint}\`\n- Architecture fingerprint: \`${architectureFingerprint(architecture.config)}\`\n\n## Context\n\n${options.context?.trim() || `fehm detected ${architecture.config.layers.length} layers: ${architecture.config.layers.map((item) => item.name).join(", ")}.`}\n\n## Decision\n\n${decision.trim()}\n\n## Consequences\n\n${options.consequences?.trim() || "Document operational, migration, testing, and rollback consequences before accepting this decision."}\n\n## Verification\n\n- [ ] Architecture contract updated if dependency rules changed.\n- [ ] Affected tests identified and passing.\n- [ ] Runtime and security implications reviewed.\n`;
  await writeFile(destination, content, "utf8");
  return destination;
}

interface RawCommit { hash?: string; author: string; date: string; subject?: string; parents?: string[]; reviewers?: string[]; files: string[] }

async function detailedGitHistory(root: string): Promise<{ commits: RawCommit[]; branches: string[] }> {
  try {
    const [log, branch] = await Promise.all([
      execFileAsync("git", ["log", "-n500", "--date=iso-strict", "--format=@@@%H%x1f%an%x1f%aI%x1f%s%x1f%P%x1f%(trailers:key=Reviewed-by,valueonly,separator=%x1e)", "--name-only"], { cwd: root, maxBuffer: 20 * 1024 * 1024 }),
      execFileAsync("git", ["branch", "--all", "--format=%(refname:short)"], { cwd: root, maxBuffer: 2 * 1024 * 1024 }),
    ]);
    const commits: RawCommit[] = [];
    let current: RawCommit | undefined;
    for (const line of log.stdout.split(/\r?\n/)) {
      if (line.startsWith("@@@")) {
        if (current) commits.push(current);
        const [hash = "", author = "unknown", date = "", subject = "", parents = "", reviewers = ""] = line.slice(3).split("\x1f");
        current = { hash, author, date, subject, parents: parents.split(/\s+/).filter(Boolean), reviewers: reviewers.split("\x1e").map((item) => item.trim()).filter(Boolean), files: [] };
      } else if (current && line.trim()) current.files.push(line.trim().split(path.sep).join("/"));
    }
    if (current) commits.push(current);
    return { commits, branches: branch.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) };
  } catch { return { commits: [], branches: [] }; }
}

export async function buildTeamKnowledgeGraph(graph: CodeGraph): Promise<TeamKnowledgeGraph> {
  const { commits, branches } = await detailedGitHistory(graph.repository.root);
  const byFile = new Map<string, Map<string, number>>();
  const lastChanged = new Map<string, string>();
  const authorCommits = new Map<string, number>();
  const authorFiles = new Map<string, Set<string>>();
  for (const commit of commits) {
    authorCommits.set(commit.author, (authorCommits.get(commit.author) ?? 0) + 1);
    for (const file of new Set(commit.files)) {
      if (!lastChanged.has(file) && commit.date) lastChanged.set(file, commit.date);
      const ownership = byFile.get(file) ?? new Map<string, number>();
      ownership.set(commit.author, (ownership.get(commit.author) ?? 0) + 1);
      byFile.set(file, ownership);
      const files = authorFiles.get(commit.author) ?? new Set<string>();
      files.add(file);
      authorFiles.set(commit.author, files);
    }
  }
  let blameAvailable = false;
  const blameOwners = new Map<string, Map<string, number>>();
  const blameResults = await mapConcurrent([...byFile.keys()].slice(0, 120), 4, async filePath => {
    try {
      const blame = await execFileAsync("git", ["blame", "--line-porcelain", "--", filePath], { cwd: graph.repository.root, maxBuffer: 8 * 1024 * 1024 });
      const authors = new Map<string, number>();
      for (const match of blame.stdout.matchAll(/^author (.+)$/gm)) authors.set(match[1] as string, (authors.get(match[1] as string) ?? 0) + 1);
      if (authors.size) return [filePath, authors] as const;
    } catch { /* untracked or binary files do not have blame */ }
    return undefined;
  });
  for (const entry of blameResults) if (entry) {
    blameOwners.set(entry[0], entry[1]);
    blameAvailable = true;
  }
  const ownership: GitOwnershipRecord[] = [...byFile].map(([filePath, commitOwners]) => {
    const owners = blameOwners.get(filePath) ?? commitOwners;
    const total = [...owners.values()].reduce((sum, value) => sum + value, 0);
    const ranked = [...owners].sort((a, b) => b[1] - a[1]).map(([author, count]) => ({ author, commits: count, percent: Math.round(count / Math.max(1, total) * 100) }));
    const lastChangedAt = lastChanged.get(filePath);
    return { path: filePath, owners: ranked, busFactor: Math.max(1, ranked.filter((owner) => owner.percent >= 20).length), ...(lastChangedAt ? { lastChangedAt } : {}) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const authors = [...authorCommits].map(([name, count]) => {
    const areas = new Map<string, number>();
    for (const file of authorFiles.get(name) ?? []) {
      const area = file.split("/")[0] || "root";
      areas.set(area, (areas.get(area) ?? 0) + (byFile.get(file)?.get(name) ?? 0));
    }
    return { name, commits: count, files: authorFiles.get(name)?.size ?? 0, expertise: [...areas].map(([area, score]) => ({ area, score })).sort((a, b) => b.score - a.score).slice(0, 8) };
  }).sort((a, b) => b.commits - a.commits);
  const sharedKnowledgeRisks = ownership.filter((item) => item.busFactor === 1 && (item.owners[0]?.percent ?? 0) >= 70).map((item) => ({ path: item.path, owner: item.owners[0]?.author ?? "unknown", reason: `${item.owners[0]?.percent ?? 0}% of recent changes belong to one author` }));
  const pullRequests: TeamKnowledgeGraph["pullRequests"] = commits.filter((commit) => (commit.parents?.length ?? 0) > 1 || /(?:merge pull request|\(#\d+\)|\bpr\s*#?\d+)/i.test(commit.subject ?? "")).map((commit) => ({
    ...(/#(\d+)/.exec(commit.subject ?? "")?.[1] ? { number: Number(/#(\d+)/.exec(commit.subject ?? "")?.[1]) } : {}),
    hash: commit.hash ?? "", subject: commit.subject ?? "", author: commit.author, date: commit.date, files: commit.files, status: "merged", source: "merge-commit", ...(commit.parents?.[0] ? { base: commit.parents[0] } : {}), ...(commit.parents?.[1] ? { head: commit.parents[1] } : {}), ...(commit.reviewers?.length ? { reviewers: commit.reviewers } : {}),
  }));
  try {
    const refs = await execFileAsync("git", ["for-each-ref", "--format=%(refname)|%(objectname)|%(subject)", "refs/pull", "refs/merge-requests"], { cwd: graph.repository.root, maxBuffer: 2 * 1024 * 1024 });
    for (const line of refs.stdout.split(/\r?\n/).filter(Boolean)) {
      const [ref = "", hash = "", subject = ""] = line.split("|"); const number = Number(/(?:pull|merge-requests)\/(\d+)/.exec(ref)?.[1] ?? 0) || undefined;
      if (pullRequests.some((item) => item.hash === hash || number && item.number === number)) continue;
      let author = "unknown"; let date = ""; let files: string[] = []; let base: string | undefined;
      try { const meta = (await execFileAsync("git", ["show", "-s", "--format=%an%x1f%aI", hash], { cwd: graph.repository.root })).stdout.trim().split("\x1f"); author = meta[0] ?? author; date = meta[1] ?? date; } catch { /* keep ref metadata */ }
      try { base = (await execFileAsync("git", ["merge-base", "HEAD", hash], { cwd: graph.repository.root })).stdout.trim(); files = (await execFileAsync("git", ["diff", "--name-only", `${base}..${hash}`], { cwd: graph.repository.root })).stdout.split(/\r?\n/).filter(Boolean); } catch { /* orphan PR refs are still represented */ }
      pullRequests.push({ ...(number ? { number } : {}), hash, subject, author, date, files, status: "open", source: "local-ref", ...(base ? { base } : {}), head: hash });
    }
  } catch { /* pull-request refs are provider/repository dependent */ }
  return { authors, ownership, sharedKnowledgeRisks, branches, pullRequests, blameAvailable };
}

function checkpointPath(graph: CodeGraph, name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "default";
  return path.join(graph.repository.root, ".fehm", "sessions", `${safe}.json`);
}

export async function saveDeveloperCheckpoint(graph: CodeGraph, name = "default"): Promise<DeveloperCheckpoint> {
  let commit: string | undefined;
  try { commit = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: graph.repository.root })).stdout.trim(); } catch { /* Git is optional */ }
  const checkpoint: DeveloperCheckpoint = { name, createdAt: new Date().toISOString(), ...(commit ? { commit } : {}), repositoryFingerprint: graph.repository.fingerprint };
  const destination = checkpointPath(graph, name); await atomicWriteJson(destination, checkpoint);
  return checkpoint;
}

function parseDigestLog(output: string): GitCommitRecord[] {
  const commits: GitCommitRecord[] = []; let current: GitCommitRecord | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("@@@")) { if (current) commits.push(current); const [hash = "", author = "", date = "", subject = ""] = line.slice(3).split("\x1f"); current = { hash, author, date, subject, files: [] }; }
    else if (current && line.trim()) current.files.push(line.trim());
  }
  if (current) commits.push(current); return commits;
}

export async function buildChangeDigest(graph: CodeGraph, name = "default"): Promise<ChangeDigest> {
  let checkpoint: DeveloperCheckpoint;
  try { checkpoint = JSON.parse(await readFile(checkpointPath(graph, name), "utf8")) as DeveloperCheckpoint; } catch { throw new Error(`developer checkpoint '${name}' does not exist; create it before requesting a change digest`); }
  let commits: GitCommitRecord[] = [];
  if (checkpoint.commit) {
    try { commits = parseDigestLog((await execFileAsync("git", ["log", `${checkpoint.commit}..HEAD`, "--date=iso-strict", "--format=@@@%H%x1f%an%x1f%aI%x1f%s", "--name-only"], { cwd: graph.repository.root, maxBuffer: 20 * 1024 * 1024 })).stdout); } catch { /* checkpoint may belong to rewritten history */ }
  }
  const changedFiles = [...new Set(commits.flatMap((commit) => commit.files))].sort();
  const timeline = await readArchitectureTimeline(graph);
  const architectureEvents = timeline.events.filter((event) => event.at > checkpoint.createdAt);
  const team = await buildTeamKnowledgeGraph(graph);
  const ownershipChanges = team.ownership.filter((item) => changedFiles.includes(item.path)).map((item) => `${item.path}: ${item.owners[0]?.author ?? "unknown"} owns ${item.owners[0]?.percent ?? 0}%`);
  const summary = [
    `${commits.length} commit(s) landed since ${checkpoint.createdAt}.`,
    `${changedFiles.length} file(s) changed.`,
    `${architectureEvents.length} architecture event(s) detected.`,
    ...(commits.slice(0, 8).map((commit) => `${commit.hash.slice(0, 8)} ${commit.subject}`)),
  ];
  const digest: ChangeDigest = { checkpoint, generatedAt: new Date().toISOString(), commits, changedFiles, architectureEvents, ownershipChanges, summary };
  const destination = checkpointPath(graph, name).replace(/\.json$/, ".digest.json");
  await atomicWriteJson(destination, digest);
  return digest;
}
