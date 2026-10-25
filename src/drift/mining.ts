import { posix } from "node:path";
import type { ArchitectureModel } from "../architecture/types.js";
import type { BriefingFacts } from "../codebase-briefing/facts.js";
import { stronglyConnected } from "./graph-util.js";
import { frameworkFor, industryFor } from "./knowledge.js";
import { pct, plural, projectConfidence, type Signal } from "./signal.js";
import type { Attention, Confidence, DriftCategory, Evidence, PatternShare, Practice, ProjectContext, ProjectPattern } from "./types.js";
import { CENTRAL_ERROR_HANDLER, RESPONSIBILITY_LABEL, ROLE_LABEL, ROLE_PLURAL, type Responsibility, type Role, type Unit } from "./units.js";

/**
 * Project convention mining (spec §12, §34, §35): find comparable units,
 * measure how they are built, and report a unit only where most comparable
 * units agree and it does not. An outlier is a *candidate*; it becomes a
 * signal only when the pattern is established (enough comparable units, high
 * enough agreement) and was not rejected by the developer.
 *
 * Where the project has too little evidence of its own, a framework
 * convention (medium confidence) or an industry practice (low confidence)
 * can stand in, for a few high-value boundaries only.
 */

const MIN_COMPARABLE = 3;
const RARE = 0.2;
const MAX_PER_PATTERN = 40;

/** Downstream rank of a role: entry points first, foundations last. */
const RANK: Record<Role, number> = { view: 0, component: 0, route: 0, controller: 0, command: 0, worker: 0, middleware: 0.5, hook: 1, service: 1, adapter: 1.5, repository: 2, model: 2.5, util: 3, types: 3, config: 3, module: 1.5 };
const ENTRY = new Set<Role>(["view", "component", "route", "controller", "command", "worker"]);
const FOUNDATION = new Set<Role>(["util", "types", "config", "model", "module"]);

export interface MiningInput {
  units: Unit[];
  facts: BriefingFacts;
  model: ArchitectureModel;
  context: ProjectContext;
  files: string[];
  decisions: Record<string, "approved" | "rejected" | "ignored">;
}

export interface MiningResult {
  patterns: ProjectPattern[];
  signals: Signal[];
  practices: Practice[];
}

const short = (p: string): string => p.split("/").slice(-2).join("/");

export function minePatterns(input: MiningInput): MiningResult {
  const { units, facts, model, context } = input;
  const patterns: ProjectPattern[] = [];
  const signals: Signal[] = [];
  const practices = [...frameworkFor(context.frameworks.map((f) => f.id)), ...industryFor(context.primaryType, context.projectTypes.map((t) => t.type))];
  const unitOf = new Map(units.map((u) => [u.path, u]));
  const linkEvidence = new Map<string, Evidence>();
  for (const l of model.codeLinks) {
    const e = l.evidence[0];
    if (e) linkEvidence.set(`${l.source}\u0000${l.target}`, { path: e.path, ...(e.line ? { line: e.line } : {}), ...(e.nodeId ? { nodeId: e.nodeId } : {}), ...(e.detail ? { detail: e.detail } : {}) });
  }
  const depEvidence = (from: string, to: string): Evidence => linkEvidence.get(`${from}\u0000${to}`) ?? { path: from, detail: `depends on ${to}` };
  const categoryOfExternal = new Map<string, string>();
  for (const p of facts.packages) if (p.info) categoryOfExternal.set(`external:${p.name}`, p.info.category);
  const outsideName = (id: string): string => model.nodes.find((n) => n.id === id)?.name ?? id;

  /** Register a pattern; returns whether its deviations may be reported. */
  const pattern = (p: Omit<ProjectPattern, "confidence" | "established" | "frequency" | "decision" | "outliers"> & { outliers?: string[] }): ProjectPattern => {
    const frequency = p.comparable ? p.matching / p.comparable : 0;
    const decision = input.decisions[p.id];
    const confidence: Confidence = decision === "approved" ? "high" : projectConfidence(p.comparable, frequency);
    const full: ProjectPattern = { ...p, frequency: Math.round(frequency * 1000) / 1000, confidence, established: decision === "approved" || (confidence !== "low" && decision !== "rejected" && decision !== "ignored"), outliers: p.outliers ?? [], ...(decision ? { decision } : {}) };
    patterns.push(full);
    return full;
  };
  const basisOf = (p: ProjectPattern): "approved-pattern" | "project-pattern" => (p.decision === "approved" ? "approved-pattern" : "project-pattern");
  const statsOf = (p: ProjectPattern) => ({ comparable: p.comparable, matching: p.matching, frequency: p.frequency, unitLabel: p.unitLabel });
  const distribution = (counts: Map<string, number>, n: number): PatternShare[] => [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([label, count]) => ({ label, count, share: Math.round((count / n) * 1000) / 1000 }));
  const examples = (list: Unit[], pick: (u: Unit) => Evidence | undefined = (u) => ({ path: u.path })): Evidence[] => list.map(pick).filter((e): e is Evidence => Boolean(e)).slice(0, 4);
  const practiceFor = (kind: string, source: "framework" | "industry"): Practice | undefined => practices.find((p) => p.source === source && p.measuredBy === kind);

  const byRole = new Map<Role, Unit[]>();
  for (const u of units) if (!u.compositionRoot) byRole.set(u.role, [...(byRole.get(u.role) ?? []), u]);

  // ─── dependency classes ───────────────────────────────────────────
  const classOfOutside = (id: string): string => (id === "store:database" ? "database" : id === "store:filesystem" ? "filesystem" : id === "external:http" ? "external HTTP" : `${categoryOfExternal.get(id) ?? "external"} SDK`);
  const classesOf = (u: Unit): Map<string, Evidence[]> => {
    const out = new Map<string, Evidence[]>();
    for (const d of u.fileDeps) {
      const r = unitOf.get(d)?.role;
      if (!r) continue;
      const k = `role:${r}`;
      out.set(k, [...(out.get(k) ?? []), depEvidence(u.path, d)]);
    }
    for (const [id, e] of u.outside) {
      const k = classOfOutside(id);
      out.set(k, [...(out.get(k) ?? []), { ...e, detail: `${e.detail ?? ""} → ${outsideName(id)}`.trim() }]);
    }
    return out;
  };
  const classLabel = (c: string): string => (c.startsWith("role:") ? ROLE_LABEL[c.slice(5) as Role] : c.charAt(0).toUpperCase() + c.slice(1));
  const classesByUnit = new Map(units.map((u) => [u.path, classesOf(u)]));
  const dominantDownstream = (r: Role): { cls: string; share: number } | undefined => {
    const list = byRole.get(r) ?? [];
    if (!list.length) return undefined;
    const counts = new Map<string, number>();
    for (const u of list) for (const c of classesByUnit.get(u.path)!.keys()) if (c.startsWith("role:") && RANK[c.slice(5) as Role] > RANK[r] && !FOUNDATION.has(c.slice(5) as Role)) counts.set(c, (counts.get(c) ?? 0) + 1);
    // Ties go to the nearest layer (a controller using services and repositories delegates to services).
    const best = [...counts].sort((a, b) => b[1] - a[1] || RANK[a[0].slice(5) as Role] - RANK[b[0].slice(5) as Role] || (a[0] < b[0] ? -1 : 1))[0];
    return best && best[1] / list.length >= 0.5 ? { cls: best[0], share: best[1] / list.length } : undefined;
  };
  const commonChain = (r: Role): string[] => {
    const chain = [ROLE_LABEL[r]];
    const seen = new Set<Role>([r]);
    let cur = r;
    for (let i = 0; i < 3; i += 1) {
      const d = dominantDownstream(cur);
      if (!d) break;
      const next = d.cls.slice(5) as Role;
      if (seen.has(next)) break;
      seen.add(next);
      chain.push(ROLE_LABEL[next]);
      cur = next;
    }
    const last = byRole.get(cur) ?? [];
    if (last.length && last.filter((u) => u.outside.has("store:database")).length / last.length >= 0.5) chain.push("Database");
    return chain;
  };

  // ─── D1: dependency pattern per role ──────────────────────────────
  // Direction and bypass between roles only mean something where the project is organised in role layers;
  // elsewhere a file called `model.ts` or `views.ts` is not an MVC role.
  const roleLayered = context.architectureSignals.some((a) => ["layered", "mvc", "clean", "hexagonal"].includes(a.id));
  for (const [role, list] of byRole) {
    if (list.length < MIN_COMPARABLE || role === "module" || role === "types") continue;
    const n = list.length;
    const counts = new Map<string, number>();
    for (const u of list) for (const c of classesByUnit.get(u.path)!.keys()) counts.set(c, (counts.get(c) ?? 0) + 1);
    const down = dominantDownstream(role);
    const p = pattern({
      id: `dependency:${role}`,
      kind: "dependency",
      name: `${ROLE_LABEL[role]} dependencies`,
      category: "pattern",
      statement: down ? `${ROLE_PLURAL[role]} depend on ${ROLE_PLURAL[down.cls.slice(5) as Role]}` : `How ${ROLE_PLURAL[role]} depend on other code`,
      unitLabel: ROLE_PLURAL[role],
      comparable: n,
      matching: down ? Math.round(down.share * n) : n,
      distribution: distribution(new Map([...counts].map(([c, k]) => [classLabel(c), k])), n),
      dominant: down ? commonChain(role).join(" → ") : "no dominant dependency",
      examples: examples(list.filter((u) => !down || classesByUnit.get(u.path)!.has(down.cls))),
    });
    for (const [cls, k] of counts) {
      if (k / n > RARE || n - k < MIN_COMPARABLE) continue;
      const targetRole = cls.startsWith("role:") ? (cls.slice(5) as Role) : undefined;
      const outside = !targetRole;
      const directional = roleLayered && targetRole !== undefined && targetRole !== "module" && targetRole !== "types";
      const upward = directional && RANK[targetRole!] < RANK[role] && targetRole !== role;
      const bypass = directional && ENTRY.has(role) && targetRole === "repository" && Boolean(down) && down!.cls !== cls;
      if (!outside && !upward && !bypass) continue;
      const confidence = projectConfidence(n, (n - k) / n);
      const sub = pattern({
        id: `dependency:${role}:${cls}`,
        kind: "dependency",
        name: `${ROLE_PLURAL[role]} → ${classLabel(cls)}`,
        category: "dependency",
        statement: `${ROLE_PLURAL[role]} do not depend on ${classLabel(cls).toLowerCase()} directly`,
        unitLabel: ROLE_PLURAL[role],
        comparable: n,
        matching: n - k,
        distribution: [{ label: "no direct dependency", count: n - k, share: (n - k) / n }, { label: `depends on ${classLabel(cls).toLowerCase()}`, count: k, share: k / n }],
        dominant: `no direct ${classLabel(cls).toLowerCase()} dependency`,
        examples: examples(list.filter((u) => !classesByUnit.get(u.path)!.has(cls))),
        outliers: list.filter((u) => classesByUnit.get(u.path)!.has(cls)).map((u) => u.path),
      });
      if (!sub.established || confidence === "low") continue;
      for (const u of list.filter((x) => classesByUnit.get(x.path)!.has(cls))) {
        const ev = classesByUnit.get(u.path)!.get(cls)!;
        const category: DriftCategory = cls === "database" ? "database" : outside ? "external-service" : bypass ? "layer" : "dependency";
        const targetId = outside ? [...u.outside.keys()].find((id) => classOfOutside(id) === cls) : undefined;
        signals.push({
          subject: `${u.path}|${targetId ?? cls}`,
          category,
          source: "project",
          basis: basisOf(sub),
          confidence: sub.decision === "approved" ? "high" : confidence,
          attention: cls === "filesystem" ? "low" : outside || bypass || upward ? "moderate" : "low",
          title: `${short(u.path)} → ${classLabel(cls)}: ${upward ? "depends against the usual direction" : bypass ? "bypasses the usual layer" : "reached directly"}`,
          observed: `${ROLE_LABEL[role]} ${short(u.path)} depends on ${classLabel(cls).toLowerCase()} directly (${plural(ev.length, "reference")}).`,
          baseline: `${n - k} of ${n} ${ROLE_PLURAL[role]} do not${down ? `; ${pct(down.share)} go through ${ROLE_PLURAL[down.cls.slice(5) as Role]}` : ""}.`,
          explanation: `Project convention: ${n - k} of ${n} comparable ${ROLE_PLURAL[role]} (${pct((n - k) / n)}) have no direct dependency on ${classLabel(cls).toLowerCase()}; this one does.`,
          impact: upward ? "A dependency against the usual direction couples foundation code to the code that uses it; changes then ripple both ways." : cls === "database" ? "Direct persistence coupling: storage details leak into code that other units expect to be persistence-free." : outside ? "Third-party details spread to a place the rest of the project keeps free of them; replacing or mocking the service gets harder." : "The usual layer is skipped, so logic the layer holds is duplicated or bypassed.",
          suggestion: { text: down ? `Possible restructuring: route this through ${ROLE_PLURAL[down.cls.slice(5) as Role]}, as comparable ${ROLE_PLURAL[role]} do.` : `Possible restructuring: move the ${classLabel(cls).toLowerCase()} access behind the boundary comparable ${ROLE_PLURAL[role]} use.`, chain: commonChain(role) },
          commonChain: commonChain(role),
          observedChain: [ROLE_LABEL[role], classLabel(cls)],
          unit: u.path,
          ...(targetId ? { target: targetId } : targetRole ? { target: u.fileDeps.find((d) => unitOf.get(d)?.role === targetRole)! } : {}),
          pattern: sub.id,
          kind: "dependency",
          stats: statsOf(sub),
          evidence: ev.slice(0, 6),
        });
      }
    }
    void p;
  }

  // ─── D2/D3: which roles own database and external-service access ──
  const family = (r: Role): string => (r === "repository" || r === "model" ? "data access (repositories / models)" : ROLE_PLURAL[r]);
  const ownership = (kind: "db-access" | "sdk-access", touches: (u: Unit) => string[], what: string, category: DriftCategory, attention: Attention): void => {
    const users = units.filter((u) => touches(u).length);
    if (!users.length) return;
    const counts = new Map<string, number>();
    for (const u of users) counts.set(family(u.role), (counts.get(family(u.role)) ?? 0) + 1);
    const [dom, k] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
    const entryUsers = users.filter((u) => ENTRY.has(u.role));
    // The client the dominant units build on (a db module, an SDK wrapper) is part of that boundary, not an outlier.
    const owners = users.filter((u) => family(u.role) === dom);
    const infrastructure = (u: Unit): boolean => !ENTRY.has(u.role) && owners.filter((o) => o.fileDeps.includes(u.path)).length >= Math.max(1, owners.length / 2);
    const p = pattern({
      id: `${kind}`,
      kind,
      name: `${what} ownership`,
      category,
      statement: `${what} happens in ${dom}`,
      unitLabel: `units with ${what.toLowerCase()}`,
      comparable: users.length,
      matching: k,
      distribution: distribution(counts, users.length),
      dominant: dom,
      examples: examples(users.filter((u) => family(u.role) === dom), (u) => touches(u).map((id) => u.outside.get(id))[0]),
      outliers: users.filter((u) => family(u.role) !== dom && !infrastructure(u)).map((u) => u.path),
    });
    if (users.length >= MIN_COMPARABLE && p.established) {
      for (const u of users.filter((x) => family(x.role) !== dom && !infrastructure(x)).slice(0, MAX_PER_PATTERN)) {
        for (const id of touches(u)) {
          const e = u.outside.get(id)!;
          const entry = ENTRY.has(u.role);
          signals.push({
            subject: `${u.path}|${id}`,
            category: entry ? category : "abstraction",
            source: "project",
            basis: basisOf(p),
            confidence: p.confidence,
            attention: entry ? raise2(attention) : attention,
            title: `${short(u.path)} reaches ${outsideName(id)} outside the usual ${kind === "db-access" ? "persistence" : "integration"} boundary`,
            observed: `${ROLE_LABEL[u.role]} ${short(u.path)} → ${outsideName(id)}`,
            baseline: `${k} of ${users.length} units with ${what.toLowerCase()} are ${dom}.`,
            explanation: `Project convention: ${pct(k / users.length)} of ${what.toLowerCase()} happens in ${dom}; this ${ROLE_LABEL[u.role].toLowerCase()} does it itself.`,
            impact: kind === "db-access" ? "Persistence boundary weakened: queries outside the data layer are missed by changes to the schema or the data-access conventions." : "Integration details spread: retries, credentials and error mapping get implemented in more than one place.",
            suggestion: { text: `Possible restructuring: move the ${outsideName(id)} access into ${dom} and call that instead.`, chain: entry ? commonChain(u.role) : [ROLE_LABEL[u.role], dom, outsideName(id)] },
            commonChain: entry ? commonChain(u.role) : [ROLE_LABEL[u.role], dom, outsideName(id)],
            observedChain: [ROLE_LABEL[u.role], outsideName(id)],
            unit: u.path,
            target: id,
            pattern: p.id,
            kind,
            stats: statsOf(p),
            evidence: [e],
          });
        }
      }
      return;
    }
    // Too little project evidence: framework convention (medium) or industry practice (low) — entry points only,
    // and never when the project's entry points routinely do it (that is the project's convention).
    const entries = units.filter((u) => ENTRY.has(u.role)).length;
    // "Entry points here routinely do it" is itself a convention only with enough entry points to compare.
    if (entryUsers.length && (entries < MIN_COMPARABLE || entryUsers.length / entries < 0.5)) {
      const fw = practiceFor(kind, "framework") ?? practiceFor("dependency", "framework");
      const ind = practiceFor(kind, "industry");
      const basisPractice = fw ?? ind;
      if (!basisPractice) return;
      for (const u of entryUsers.slice(0, MAX_PER_PATTERN)) {
        for (const id of touches(u)) {
          signals.push({
            subject: `${u.path}|${id}`,
            category: fw ? "framework" : category,
            source: fw ? "framework" : "industry",
            basis: fw ? "framework" : "industry",
            confidence: fw ? "medium" : "low",
            attention,
            title: `${short(u.path)} reaches ${outsideName(id)} from an entry point`,
            observed: `${ROLE_LABEL[u.role]} ${short(u.path)} → ${outsideName(id)}`,
            baseline: basisPractice.statement,
            explanation: fw ? `Framework convention (${context.frameworks.find((f) => f.id === fw.framework)?.label ?? fw.framework}): ${fw.statement} The project itself has too few comparable units to confirm it.` : `Industry practice: ${basisPractice.statement} The project has too little evidence of its own convention.`,
            impact: kind === "db-access" ? "Direct persistence coupling in request-handling code." : "Third-party details in request-handling code.",
            suggestion: { text: "Possible restructuring: move the access into a service or data-access module the entry point calls." },
            commonChain: [ROLE_LABEL[u.role], "Service", kind === "db-access" ? "Repository" : "Client", outsideName(id)],
            observedChain: [ROLE_LABEL[u.role], outsideName(id)],
            unit: u.path,
            target: id,
            kind,
            evidence: [u.outside.get(id)!],
          });
        }
      }
    }
  };
  ownership("db-access", (u) => (u.outside.has("store:database") ? ["store:database"] : []), "Database access", "database", "moderate");
  ownership("sdk-access", (u) => [...u.outside.keys()].filter((id) => id.startsWith("external:")), "External service access", "external-service", "moderate");

  // ─── D4: route handler size ───────────────────────────────────────
  const handlers = units.flatMap((u) => u.handlers.map((h) => ({ u, h })));
  if (handlers.length >= 4) {
    const med = median(handlers.map((x) => x.h.loc));
    const limit = Math.max(3 * med, 40);
    const big = handlers.filter((x) => x.h.loc >= limit);
    const p = pattern({ id: "api-handler", kind: "api-handler", name: "Route handler size", category: "api", statement: `Route handlers stay under ${limit} lines (median ${med})`, unitLabel: "route handlers", comparable: handlers.length, matching: handlers.length - big.length, distribution: [{ label: `under ${limit} lines`, count: handlers.length - big.length, share: (handlers.length - big.length) / handlers.length }, { label: `${limit}+ lines`, count: big.length, share: big.length / handlers.length }], dominant: `median ${med} lines`, examples: handlers.filter((x) => x.h.loc < limit).slice(0, 4).map((x) => ({ path: x.u.path, line: x.h.line, detail: `${x.h.route}: ${x.h.loc} lines` })), outliers: big.map((x) => x.u.path) });
    if (p.established) for (const { u, h } of big) signals.push({ subject: `${u.path}|handler:${h.name}`, category: "api", source: "project", basis: basisOf(p), confidence: p.confidence, attention: "moderate", title: `Route handler ${h.name} holds extensive logic (${h.loc} lines)`, observed: `${h.route} is handled by ${h.name}, ${h.loc} lines long.`, baseline: `Comparable route handlers: median ${med} lines; ${p.matching} of ${p.comparable} stay under ${limit}.`, explanation: `Project convention: ${pct(p.frequency)} of route handlers stay under ${limit} lines.`, impact: "Logic inside the HTTP boundary cannot be reused from other entry points and is harder to test without HTTP.", suggestion: { text: "Possible restructuring: move the handler's work into a service function and keep the handler to parsing, calling and responding." }, unit: u.path, pattern: p.id, kind: "api-handler", stats: statsOf(p), evidence: [{ path: u.path, line: h.line, detail: `${h.name}: ${h.loc} lines` }] });
  }

  // ─── D5: file placement per role, and assets ──────────────────────
  for (const [role, list] of byRole) {
    const named = list.filter((u) => u.roleBasis === "name");
    if (!roleLayered || named.length < 4 || role === "module") continue;
    const keyOf = (u: Unit): string => {
      const dirs = posix.dirname(u.path).split("/").reverse();
      const d = dirs.find((x) => /^(controllers?|handlers?|routes?|services?|repositor(y|ies)|repos?|models?|entities|middlewares?|components?|views?|pages?|hooks?|utils?|helpers?|config|jobs?|workers?|commands?|clients?|adapters?)$/i.test(x));
      return d ? `${d}/` : "feature directories";
    };
    const counts = new Map<string, number>();
    for (const u of named) counts.set(keyOf(u), (counts.get(keyOf(u)) ?? 0) + 1);
    const [dom, k] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
    const off = named.filter((u) => keyOf(u) !== dom);
    const p = pattern({ id: `location:${role}`, kind: "location", name: `${ROLE_LABEL[role]} placement`, category: "file-placement", statement: `${ROLE_PLURAL[role]} live in ${dom}`, unitLabel: `named ${ROLE_PLURAL[role]}`, comparable: named.length, matching: k, distribution: distribution(counts, named.length), dominant: dom, examples: examples(named.filter((u) => keyOf(u) === dom)), outliers: off.map((u) => u.path) });
    if (!p.established || k / named.length < 0.75) continue;
    for (const u of off.slice(0, MAX_PER_PATTERN)) {
      signals.push({ subject: `${u.path}|placement`, category: "file-placement", source: "project", basis: basisOf(p), confidence: p.confidence, attention: "low", title: `${posix.basename(u.path)} is placed outside ${dom}`, observed: `${ROLE_LABEL[role]} ${u.path} is in ${keyOf(u)}.`, baseline: `${k} of ${named.length} ${ROLE_PLURAL[role]} live in ${dom}.`, explanation: `Project convention: ${pct(k / named.length)} of files named as ${ROLE_PLURAL[role]} are in ${dom}; this one is in ${keyOf(u)}.`, impact: "Code placed away from its peers is harder to find and tends to be missed by changes made to the whole group.", suggestion: { text: `Possible organisation: move it next to the other ${ROLE_PLURAL[role]} (${dom}).` }, unit: u.path, pattern: p.id, kind: "location", stats: statsOf(p), evidence: [{ path: u.path, nodeId: `file:${u.path}`, detail: `in ${posix.dirname(u.path)}/` }] });
    }
  }
  const ASSET = /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg)$/i;
  const assets = input.files.filter((f) => ASSET.test(f) && !/(^|\/)(node_modules|dist|build|coverage|docs?|\.github|test|tests|__tests__|fixtures)\//.test(f));
  if (assets.length >= 4) {
    const rootOf = (f: string): string => {
      const segs = f.split("/");
      const i = segs.findIndex((s) => /^(assets|static|public|images|img|icons|fonts|media)$/i.test(s));
      return i >= 0 ? `${segs.slice(0, i + 1).join("/")}/` : `${posix.dirname(f)}/ (alongside code)`;
    };
    const counts = new Map<string, number>();
    for (const a of assets) counts.set(rootOf(a), (counts.get(rootOf(a)) ?? 0) + 1);
    const [dom, k] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
    const off = assets.filter((a) => rootOf(a) !== dom);
    const p = pattern({ id: "assets", kind: "assets", name: "Static asset placement", category: "file-placement", statement: `Static assets live in ${dom}`, unitLabel: "static assets", comparable: assets.length, matching: k, distribution: distribution(counts, assets.length), dominant: dom, examples: assets.filter((a) => rootOf(a) === dom).slice(0, 4).map((path) => ({ path })), outliers: off });
    if (p.established && k / assets.length >= 0.75) for (const a of off.slice(0, MAX_PER_PATTERN)) signals.push({ subject: `${a}|placement`, category: "file-placement", source: "project", basis: basisOf(p), confidence: p.confidence, attention: "low", title: `Static asset ${posix.basename(a)} is outside ${dom}`, observed: `${a} (static asset)`, baseline: `${k} of ${assets.length} static assets are in ${dom}.`, explanation: `Project organisation: ${pct(k / assets.length)} of static assets are kept in ${dom}; this one is nested elsewhere (${rootOf(a)}).`, impact: "Minor: assets spread through implementation folders are easy to duplicate or leave behind.", suggestion: { text: `Possible organisation: ${dom}${posix.basename(a)}` }, pattern: p.id, kind: "assets", stats: statsOf(p), evidence: [{ path: a, detail: "static asset" }], modules: [] });
  }

  // ─── D6: naming per role, provisional names ───────────────────────
  for (const [role, list0] of byRole) {
    // Outside role-layered projects a role word in a file name is not a role: compare only directory- or evidence-based roles.
    const list = roleLayered ? list0 : list0.filter((u) => u.roleBasis !== "name");
    if (list.length < 4 || role === "module") continue;
    const tmpl = (u: Unit): string => `${u.naming.caseStyle}${u.naming.marker === "dot" ? " + .role suffix" : u.naming.marker === "word" ? " + role word" : ""}`;
    const counts = new Map<string, number>();
    for (const u of list) counts.set(tmpl(u), (counts.get(tmpl(u)) ?? 0) + 1);
    const [dom, k] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
    const off = list.filter((u) => tmpl(u) !== dom);
    const p = pattern({ id: `naming:${role}`, kind: "naming", name: `${ROLE_LABEL[role]} naming`, category: "naming", statement: `${ROLE_PLURAL[role]} are named ${dom}`, unitLabel: ROLE_PLURAL[role], comparable: list.length, matching: k, distribution: distribution(counts, list.length), dominant: dom, examples: examples(list.filter((u) => tmpl(u) === dom)), outliers: off.map((u) => u.path) });
    if (!p.established || k / list.length < 0.75) continue;
    for (const u of off.slice(0, MAX_PER_PATTERN)) signals.push({ subject: `${u.path}|naming`, category: "naming", source: "project", basis: basisOf(p), confidence: p.confidence, attention: "low", title: `${posix.basename(u.path)} differs from the naming of other ${ROLE_PLURAL[role]}`, observed: `${posix.basename(u.path)} (${tmpl(u)})`, baseline: `${k} of ${list.length} ${ROLE_PLURAL[role]} are named ${dom}, e.g. ${posix.basename(p.examples[0]?.path ?? "")}.`, explanation: `Organisational convention: ${pct(k / list.length)} of comparable files follow "${dom}".`, impact: "Minor: inconsistent names make files harder to find by convention. Not a correctness issue.", unit: u.path, pattern: p.id, kind: "naming", stats: statsOf(p), evidence: [{ path: u.path, nodeId: `file:${u.path}` }] });
  }
  const provisional = units.filter((u) => u.naming.provisional && !/^v\d+$/i.test(u.naming.provisional));
  if (units.length >= 10 && provisional.length && provisional.length / units.length < 0.1) {
    for (const u of provisional.slice(0, MAX_PER_PATTERN)) signals.push({ subject: `${u.path}|naming`, category: "naming", source: "heuristic", basis: "heuristic", confidence: "medium", attention: "low", title: `${posix.basename(u.path)} has a provisional-looking name`, observed: `File name ends in "${u.naming.provisional}".`, baseline: `${units.length - provisional.length} of ${units.length} source files have no provisional marker (Final, New, Old, Copy, Temp, a number).`, explanation: "Heuristic: names ending in Final / New / Old / Copy / Temp / a number often mark a copy made during a change that was never folded back.", impact: "Minor: parallel copies tend to diverge; readers cannot tell which one is current.", suggestion: { text: "Possible organisation: rename it after its responsibility, or fold it into the file it replaced." }, unit: u.path, kind: "naming", evidence: [{ path: u.path, nodeId: `file:${u.path}` }] });
  }

  // ─── D7: file granularity ─────────────────────────────────────────
  for (const [role, list] of byRole) {
    if (list.length < 5) continue;
    const sizes = list.map((u) => u.loc).sort((a, b) => a - b);
    const med = median(sizes);
    const limit = Math.max(3 * med, 300);
    const big = list.filter((u) => u.loc >= limit && percentile(sizes, u.loc) >= 0.9);
    const p = pattern({ id: `size:${role}`, kind: "size", name: `${ROLE_LABEL[role]} size`, category: "granularity", statement: `${ROLE_PLURAL[role]} have a median of ${med} lines`, unitLabel: ROLE_PLURAL[role], comparable: list.length, matching: list.length - big.length, distribution: [{ label: `under ${limit} lines`, count: list.length - big.length, share: (list.length - big.length) / list.length }, { label: `${limit}+ lines`, count: big.length, share: big.length / list.length }], dominant: `median ${med} lines`, examples: examples(list.filter((u) => u.loc < limit)), outliers: big.map((u) => u.path) });
    if (!p.established) continue;
    for (const u of big) signals.push({ subject: `${u.path}|size`, category: "granularity", source: "project", basis: basisOf(p), confidence: p.confidence, attention: u.loc >= 1000 ? "moderate" : "low", title: `${posix.basename(u.path)} is much larger than comparable ${ROLE_PLURAL[role]} (${u.loc} lines)`, observed: `${u.loc} lines; ${pct(percentile(sizes, u.loc))} percentile among ${ROLE_PLURAL[role]}.`, baseline: `Comparable ${ROLE_PLURAL[role]}: median ${med} lines.`, explanation: `Project distribution: ${list.length} ${ROLE_PLURAL[role]}, median ${med} lines; this file is ${Math.round(u.loc / Math.max(1, med))}× the median. No fixed line limit is applied.`, impact: "Large units tend to accumulate responsibilities; see its responsibilities before deciding.", suggestion: { text: "Possible restructuring: split along the responsibilities it holds, if they are unrelated." }, unit: u.path, pattern: p.id, kind: "size", stats: statsOf(p), evidence: [{ path: u.path, nodeId: `file:${u.path}`, detail: `${u.loc} non-blank lines` }] });
  }
  const allSizes = units.map((u) => u.loc).sort((a, b) => a - b);
  if (units.length >= 20) {
    const projMed = median(allSizes);
    const byDir = new Map<string, Unit[]>();
    for (const u of units) byDir.set(posix.dirname(u.path), [...(byDir.get(posix.dirname(u.path)) ?? []), u]);
    for (const [dir, list] of byDir) {
      const med = median(list.map((u) => u.loc));
      if (list.length < 8 || med > 12 || projMed < 40) continue;
      signals.push({ subject: `dir:${dir}|fragmentation`, category: "granularity", source: "project", basis: "project-pattern", confidence: "medium", attention: "low", title: `${dir}/ is split into ${list.length} very small files (median ${med} lines)`, observed: `${list.length} files, median ${med} lines.`, baseline: `Project median file size: ${projMed} lines.`, explanation: `Project distribution: files elsewhere have a median of ${projMed} lines; this directory's files are far smaller.`, impact: "Minor: one responsibility spread over many tiny files is harder to follow.", suggestion: { text: "Possible organisation: merge files that always change together." }, kind: "size", evidence: list.slice(0, 8).map((u) => ({ path: u.path, detail: `${u.loc} lines` })), modules: [] });
    }
  }

  // ─── D8: responsibilities, module scope, duplication ──────────────
  const respCount = (u: Unit): Responsibility[] => [...u.responsibilities.keys()].filter((r) => r !== "logging" && r !== "configuration");
  for (const [role, list] of byRole) {
    if (list.length < MIN_COMPARABLE) continue;
    const med = median(list.map((u) => respCount(u).length));
    const limit = Math.max(med + 3, 4);
    const heavy = list.filter((u) => respCount(u).length >= limit);
    const p = pattern({ id: `responsibility:${role}`, kind: "responsibility", name: `${ROLE_LABEL[role]} responsibilities`, category: "responsibility", statement: `${ROLE_PLURAL[role]} hold about ${med} ${med === 1 ? "responsibility" : "responsibilities"} each`, unitLabel: ROLE_PLURAL[role], comparable: list.length, matching: list.length - heavy.length, distribution: [{ label: `fewer than ${limit}`, count: list.length - heavy.length, share: (list.length - heavy.length) / list.length }, { label: `${limit} or more`, count: heavy.length, share: heavy.length / list.length }], dominant: `median ${med}`, examples: examples(list.filter((u) => respCount(u).length < limit)), outliers: heavy.map((u) => u.path) });
    if (!p.established) continue;
    for (const u of heavy) {
      const rs = respCount(u);
      signals.push({ subject: `${u.path}|responsibilities`, category: "responsibility", source: "project", basis: basisOf(p), confidence: p.confidence, attention: rs.length >= 6 ? "high" : "moderate", title: `${posix.basename(u.path)} concentrates ${rs.length} responsibilities`, observed: rs.map((r) => RESPONSIBILITY_LABEL[r]).join(", "), baseline: `Comparable ${ROLE_PLURAL[role]}: median ${med} ${med === 1 ? "responsibility" : "responsibilities"}.`, explanation: `Project distribution: ${pct(p.frequency)} of ${ROLE_PLURAL[role]} hold fewer than ${limit}; this one holds ${rs.length}, normally spread across several boundaries.`, impact: "Responsibilities that normally live in separate units change together here; a change to one risks the others.", suggestion: { text: "Possible restructuring: move the responsibilities other comparable units delegate into the units that normally hold them." }, unit: u.path, pattern: p.id, kind: "responsibility", stats: statsOf(p), evidence: rs.map((r) => ({ ...u.responsibilities.get(r)!, detail: `${RESPONSIBILITY_LABEL[r]}: ${u.responsibilities.get(r)!.detail ?? ""}`.trim() })) });
    }
  }
  const modules = facts.modules.filter((m) => m.files.length >= 3);
  if (modules.length >= 4) {
    const scope = (files: string[]): Set<Responsibility> => new Set(files.flatMap((f) => (unitOf.get(f) ? respCount(unitOf.get(f)!) : [])).filter((r) => r !== "validation" && r !== "http"));
    const sizes = modules.map((m) => scope(m.files).size);
    const med = median(sizes);
    const limit = Math.max(med + 3, 5);
    const wide = modules.filter((m) => scope(m.files).size >= limit);
    const p = pattern({ id: "module-scope", kind: "module-scope", name: "Module scope", category: "module-boundary", statement: `Modules span about ${med} kinds of responsibility`, unitLabel: "modules", comparable: modules.length, matching: modules.length - wide.length, distribution: [{ label: `fewer than ${limit}`, count: modules.length - wide.length, share: (modules.length - wide.length) / modules.length }, { label: `${limit} or more`, count: wide.length, share: wide.length / modules.length }], dominant: `median ${med}`, examples: modules.filter((m) => scope(m.files).size < limit).slice(0, 4).map((m) => ({ path: m.files[0]!, detail: m.name })), outliers: wide.map((m) => m.name) });
    if (p.established) for (const m of wide) {
      const rs = [...scope(m.files)];
      signals.push({ subject: `module:${m.name}|scope`, category: "module-boundary", source: "project", basis: basisOf(p), confidence: p.confidence === "high" ? "medium" : p.confidence, attention: "moderate", title: `Module ${m.name} spans ${rs.length} kinds of responsibility`, observed: rs.map((r) => RESPONSIBILITY_LABEL[r]).join(", "), baseline: `Comparable modules: median ${med}.`, explanation: `Project distribution: ${pct(p.frequency)} of modules span fewer than ${limit} kinds of responsibility; this one spans ${rs.length}.`, impact: "A module absorbing unrelated work blurs its boundary; other modules start depending on it for unrelated reasons.", suggestion: { text: "Possible restructuring: move the unrelated responsibilities to the modules that own them elsewhere." }, kind: "module-scope", pattern: p.id, stats: statsOf(p), evidence: rs.map((r) => m.files.map((f) => unitOf.get(f)?.responsibilities.get(r)).find(Boolean)!).filter(Boolean), modules: [`module:${m.name}`] });
    }
  }
  if (context.projectTypes.some((t) => t.type === "backend-service" || t.type === "microservice")) {
    for (const r of ["validation", "auth"] as Responsibility[]) {
      const holders = units.filter((u) => u.responsibilities.has(r) && ["controller", "route", "service", "repository", "middleware", "model"].includes(u.role));
      const roles = [...new Set(holders.map((u) => u.role))];
      if (roles.length < 3) continue;
      signals.push({ subject: `duplication:${r}`, category: "responsibility", source: "heuristic", basis: "heuristic", confidence: "medium", attention: "low", title: `${RESPONSIBILITY_LABEL[r]} is performed in ${roles.length} different layers`, observed: roles.map((x) => `${ROLE_PLURAL[x]} (${holders.filter((u) => u.role === x).length})`).join(", "), baseline: `${RESPONSIBILITY_LABEL[r]} commonly has one home.`, explanation: `${RESPONSIBILITY_LABEL[r]} evidence appears in ${roles.map((x) => ROLE_PLURAL[x]).join(", ")}: overlapping implementations are likely.`, impact: "Fragmented responsibility: rules drift apart between layers and some paths skip them.", suggestion: { text: `Possible restructuring: pick one layer for ${RESPONSIBILITY_LABEL[r].toLowerCase()} and call it from the others.` }, kind: "responsibility", evidence: holders.slice(0, 8).map((u) => u.responsibilities.get(r)!), modules: [] });
    }
  }

  // ─── D9: dependency injection ─────────────────────────────────────
  for (const role of ["service", "controller", "route", "worker", "adapter", "command"] as Role[]) {
    const list = (byRole.get(role) ?? []).filter((u) => u.di.injected.length || u.di.manual.length);
    if (list.length < 4) continue;
    const injected = list.filter((u) => u.di.injected.length && !u.di.manual.length);
    const manual = list.filter((u) => u.di.manual.length);
    const p = pattern({ id: `di:${role}`, kind: "di", name: `${ROLE_LABEL[role]} dependency injection`, category: "dependency-injection", statement: `${ROLE_PLURAL[role]} receive their dependencies (injection)`, unitLabel: `${ROLE_PLURAL[role]} with collaborators`, comparable: list.length, matching: injected.length, distribution: [{ label: "injected", count: injected.length, share: injected.length / list.length }, { label: "constructed manually", count: manual.length, share: manual.length / list.length }], dominant: injected.length >= manual.length ? "injected" : "constructed manually", examples: examples(injected, (u) => u.di.injected[0]), outliers: manual.map((u) => u.path) });
    if (!p.established || injected.length / list.length < 0.75) continue;
    for (const u of manual) signals.push({ subject: `${u.path}|di`, category: "dependency-injection", source: "project", basis: basisOf(p), confidence: p.confidence, attention: "moderate", title: `${posix.basename(u.path)} constructs its collaborators itself`, observed: u.di.manual.map((e) => e.detail).join("; "), baseline: `${injected.length} of ${list.length} comparable ${ROLE_PLURAL[role]} receive their dependencies.`, explanation: `Dependency-injection pattern: ${pct(injected.length / list.length)} of ${ROLE_PLURAL[role]} with collaborators get them injected; this one uses \`new\`.`, impact: "Manually constructed collaborators cannot be replaced in tests or configured centrally.", suggestion: { text: "Possible restructuring: accept the collaborator as a constructor parameter (or through the framework's DI) like comparable units do." }, unit: u.path, pattern: p.id, kind: "di", stats: statsOf(p), evidence: [...u.di.manual.slice(0, 4), ...injected.slice(0, 1).map((x) => ({ ...x.di.injected[0]!, detail: `comparable: ${x.di.injected[0]!.detail ?? ""}` }))] });
  }

  // ─── D10: logging mechanism ───────────────────────────────────────
  const logUnits = units.filter((u) => u.logging.size && !["component", "hook", "view", "command"].includes(u.role));
  if (logUnits.length >= 5 && context.primaryType !== "cli") {
    const counts = new Map<string, number>();
    for (const u of logUnits) for (const m of u.logging.keys()) counts.set(m, (counts.get(m) ?? 0) + 1);
    const [dom, k] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
    // A unit deviates when it logs through any other mechanism, even alongside the dominant one.
    const other = (u: Unit): string | undefined => [...u.logging.keys()].find((m) => m !== dom);
    const mech = (u: Unit): string => other(u) ?? dom;
    const off = logUnits.filter((u) => other(u));
    const p = pattern({ id: "logging", kind: "logging", name: "Logging mechanism", category: "observability", statement: `Code logs through the ${dom}`, unitLabel: "units that log", comparable: logUnits.length, matching: logUnits.length - off.length, distribution: distribution(counts, logUnits.length), dominant: dom, examples: examples(logUnits.filter((u) => mech(u) === dom), (u) => u.logging.get(dom as never)), outliers: off.map((u) => u.path) });
    void k;
    if (p.established && p.frequency >= 0.7) for (const u of off.slice(0, MAX_PER_PATTERN)) signals.push({ subject: `${u.path}|logging`, category: "observability", source: "project", basis: basisOf(p), confidence: p.confidence, attention: "low", title: `${posix.basename(u.path)} logs with ${mech(u)} instead of the ${dom}`, observed: `${mech(u)}: ${u.logging.get(mech(u) as never)?.detail ?? ""}`, baseline: `${logUnits.length - off.length} of ${logUnits.length} logging units use only the ${dom}.`, explanation: `Project convention: logging mechanisms — ${p.distribution.map((d) => `${d.label} ${pct(d.share)}`).join(", ")}.`, impact: "Output from this unit bypasses the project's log routing, levels and correlation.", suggestion: { text: `Possible restructuring: log through the ${dom}.` }, unit: u.path, pattern: p.id, kind: "logging", stats: statsOf(p), evidence: [u.logging.get(mech(u) as never)!] });
  }

  // ─── D11: configuration ───────────────────────────────────────────
  const isConfig = (u: Unit): boolean => u.role === "config" || /(^|\/)(config|settings|env)(\/|\.|$)/i.test(u.path);
  const envSites = units.flatMap((u) => u.env.map((e) => ({ u, e })));
  if (envSites.length >= 4 && units.some(isConfig)) {
    const inConfig = envSites.filter((x) => isConfig(x.u));
    const offUnits = [...new Set(envSites.filter((x) => !isConfig(x.u)).map((x) => x.u))];
    const p = pattern({ id: "config", kind: "config", name: "Configuration access", category: "configuration", statement: "Environment configuration is read in configuration modules", unitLabel: "environment reads", comparable: envSites.length, matching: inConfig.length, distribution: [{ label: "in configuration modules", count: inConfig.length, share: inConfig.length / envSites.length }, { label: "elsewhere", count: envSites.length - inConfig.length, share: 1 - inConfig.length / envSites.length }], dominant: "configuration modules", examples: inConfig.slice(0, 4).map((x) => x.e), outliers: offUnits.map((u) => u.path) });
    if (p.established && inConfig.length / envSites.length >= 0.7) for (const u of offUnits.slice(0, MAX_PER_PATTERN)) signals.push({ subject: `${u.path}|config`, category: "configuration", source: "project", basis: basisOf(p), confidence: p.confidence, attention: "moderate", title: `${posix.basename(u.path)} reads configuration directly`, observed: u.env.map((e) => e.detail).join(", "), baseline: `${inConfig.length} of ${envSites.length} environment reads happen in configuration modules (${[...new Set(inConfig.map((x) => x.u.path))].slice(0, 2).join(", ")}).`, explanation: `Project convention: ${pct(p.frequency)} of environment reads are centralised; this unit reads the environment itself.`, impact: "Configuration embedded in logic is invisible to the configuration module: defaults, validation and documentation diverge.", suggestion: { text: "Possible restructuring: read the value in the configuration module and pass it in." }, unit: u.path, pattern: p.id, kind: "config", stats: statsOf(p), evidence: u.env.slice(0, 6) });
  }
  if (practices.some((x) => x.measuredBy === "config")) {
    for (const u of units.filter((x) => x.hardcoded.length && !isConfig(x) && x.role !== "types")) {
      const creds = u.hardcoded.some((e) => /\*\*\*:\*\*\*@/.test(e.detail ?? ""));
      signals.push({ subject: `${u.path}|hardcoded`, category: "configuration", source: "industry", basis: "industry", confidence: "medium", attention: creds ? "high" : "moderate", title: `${posix.basename(u.path)} contains hard-coded connection settings`, observed: u.hardcoded.map((e) => e.detail).join("; "), baseline: "Industry practice: connection settings come from configuration, not from code.", explanation: "A connection string or local service URL appears as a literal outside configuration modules.", impact: creds ? "Credentials in code end up in version control and every copy of it." : "Environment-specific values in code break when the environment changes.", suggestion: { text: "Possible restructuring: move the value into configuration (environment or settings) and read it there." }, unit: u.path, kind: "config", evidence: u.hardcoded });
    }
  }

  // ─── D12: error handling ──────────────────────────────────────────
  const central = units.flatMap((u) => facts.lines(u.path).map((l, i) => ({ u, l, i })).filter((x) => CENTRAL_ERROR_HANDLER.test(x.l))).slice(0, 3);
  const handlersUnits = units.filter((u) => u.role === "controller" || u.role === "route");
  if (central.length && handlersUnits.length >= MIN_COMPARABLE) {
    const local = handlersUnits.filter((u) => u.localErrors.length);
    const p = pattern({ id: "errors", kind: "errors", name: "Error handling", category: "error-handling", statement: "Request handlers leave error responses to the central handler", unitLabel: "controllers and route modules", comparable: handlersUnits.length, matching: handlersUnits.length - local.length, distribution: [{ label: "central handler", count: handlersUnits.length - local.length, share: 1 - local.length / handlersUnits.length }, { label: "format errors locally", count: local.length, share: local.length / handlersUnits.length }], dominant: `central handler (${short(central[0]!.u.path)}:${central[0]!.i + 1})`, examples: central.map((x) => ({ path: x.u.path, line: x.i + 1, detail: x.l.trim().slice(0, 100) })), outliers: local.map((u) => u.path) });
    if (p.established && p.frequency >= 0.7) for (const u of local) signals.push({ subject: `${u.path}|errors`, category: "error-handling", source: "project", basis: basisOf(p), confidence: p.confidence, attention: "low", title: `${posix.basename(u.path)} formats error responses itself`, observed: u.localErrors.map((e) => e.detail).slice(0, 2).join("; "), baseline: `Central error handler at ${short(central[0]!.u.path)}:${central[0]!.i + 1}; ${p.matching} of ${p.comparable} handlers leave errors to it.`, explanation: `Project pattern: centralised error handling (${pct(p.frequency)} of request handlers).`, impact: "Error responses from this unit can differ in shape, status codes and logging from the rest of the API.", suggestion: { text: "Possible restructuring: throw (or pass to next) and let the central handler format the response." }, unit: u.path, pattern: p.id, kind: "errors", stats: statsOf(p), evidence: [...u.localErrors.slice(0, 3), { path: central[0]!.u.path, line: central[0]!.i + 1, detail: "central error handler" }] });
  }

  // ─── D13: tests ───────────────────────────────────────────────────
  const testable = units.filter((u) => !["types", "config"].includes(u.role) && u.loc >= 8 && !u.compositionRoot);
  if (facts.testFiles.length && testable.length >= 5) {
    const withTest = testable.filter((u) => u.test);
    const layouts = new Map<string, number>();
    for (const u of withTest) layouts.set(u.test!.layout, (layouts.get(u.test!.layout) ?? 0) + 1);
    const domLayout = [...layouts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    const p = pattern({ id: "tests", kind: "tests", name: "Test counterparts", category: "testing", statement: `Source modules have a matching test (${domLayout})`, unitLabel: "source modules (8+ lines)", comparable: testable.length, matching: withTest.length, distribution: [{ label: "matching test found", count: withTest.length, share: withTest.length / testable.length }, { label: "none found", count: testable.length - withTest.length, share: 1 - withTest.length / testable.length }], dominant: domLayout, examples: withTest.slice(0, 4).map((u) => ({ path: u.test!.path, detail: `tests ${u.path}` })), outliers: testable.filter((u) => !u.test).map((u) => u.path) });
    // Per role: "services have tests" can hold even when utilities don't. Project-wide when no role qualifies.
    const scopes: { id: string; list: Unit[]; label: string; pat: ProjectPattern }[] = [];
    for (const [role, list0] of byRole) {
      const list = list0.filter((u) => testable.includes(u));
      if (list.length < 4 || role === "module") continue;
      const k = list.filter((u) => u.test).length;
      scopes.push({ id: role, list, label: ROLE_PLURAL[role], pat: pattern({ id: `tests:${role}`, kind: "tests", name: `${ROLE_LABEL[role]} tests`, category: "testing", statement: `${ROLE_PLURAL[role]} have a matching test (${domLayout})`, unitLabel: ROLE_PLURAL[role], comparable: list.length, matching: k, distribution: [{ label: "matching test found", count: k, share: k / list.length }, { label: "none found", count: list.length - k, share: 1 - k / list.length }], dominant: domLayout, examples: list.filter((u) => u.test).slice(0, 4).map((u) => ({ path: u.test!.path, detail: `tests ${u.path}` })), outliers: list.filter((u) => !u.test).map((u) => u.path) }) });
    }
    if (!scopes.length) scopes.push({ id: "all", list: testable, label: "comparable modules", pat: p });
    for (const sc of scopes) {
      const sp = sc.pat;
      if (!sp.established || sp.frequency < 0.6) continue;
      const missing = sc.list.filter((u) => !u.test).sort((a, b) => b.dependents - a.dependents).slice(0, MAX_PER_PATTERN);
      for (const u of missing) signals.push({ subject: `${u.path}|tests`, category: "testing", source: "project", basis: basisOf(sp), confidence: sp.confidence, attention: u.dependents >= 5 ? "moderate" : "low", title: `No test matching the project convention was found for ${posix.basename(u.path)}`, observed: `No test file named after ${posix.basename(u.path)} was found (${domLayout} layout expected).`, baseline: `${sp.matching} of ${sp.comparable} ${sc.label} have a matching test, mostly ${domLayout}.`, explanation: "Testing organisation: this does not mean the code is untested (it may be covered indirectly); no test structure matching the detected convention was identified.", impact: "Changes to this module may not be caught where tests usually live. Coverage itself is Feature 3.5's job.", suggestion: { text: `Possible organisation: add a ${domLayout} test for it, like comparable ${sc.label}.` }, unit: u.path, pattern: sp.id, kind: "tests", stats: statsOf(sp), evidence: [{ path: u.path, nodeId: `file:${u.path}`, detail: `${u.dependents} dependents` }] });
    }
    if (withTest.length >= 5) {
      const k = layouts.get(domLayout) ?? 0;
      const off = withTest.filter((u) => u.test!.layout !== domLayout);
      const lp = pattern({ id: "test-layout", kind: "tests", name: "Test placement", category: "testing", statement: `Tests are placed ${domLayout}`, unitLabel: "tests with a source counterpart", comparable: withTest.length, matching: k, distribution: distribution(layouts, withTest.length), dominant: domLayout, examples: withTest.filter((u) => u.test!.layout === domLayout).slice(0, 4).map((u) => ({ path: u.test!.path })), outliers: off.map((u) => u.test!.path) });
      if (lp.established && k / withTest.length >= 0.75) for (const u of off.slice(0, MAX_PER_PATTERN)) signals.push({ subject: `${u.test!.path}|test-layout`, category: "testing", source: "project", basis: basisOf(lp), confidence: lp.confidence, attention: "informational", title: `${posix.basename(u.test!.path)} is placed ${u.test!.layout}, unlike most tests`, observed: `${u.test!.path} (${u.test!.layout})`, baseline: `${k} of ${withTest.length} tests are ${domLayout}.`, explanation: "Testing organisation convention.", impact: "Minor: tests outside the usual place are easy to miss when running or maintaining the suite.", pattern: lp.id, kind: "tests", stats: statsOf(lp), evidence: [{ path: u.test!.path }], modules: [] });
    }
  }

  // ─── D14: authentication boundary on routes ───────────────────────
  const routeUnits = units.filter((u) => u.responsibilities.has("http"));
  if (routeUnits.length >= MIN_COMPARABLE) {
    const reaches = (u: Unit): Evidence | undefined => {
      if (u.responsibilities.has("auth")) return u.responsibilities.get("auth");
      for (const d of u.fileDeps) {
        const x = unitOf.get(d);
        if (x?.responsibilities.has("auth")) return { ...x.responsibilities.get("auth")!, detail: `via ${d}` };
        if (x?.role === "middleware" && /auth|guard|session|jwt/i.test(d)) return { path: u.path, detail: `uses ${d}` };
      }
      return undefined;
    };
    const guarded = routeUnits.filter((u) => reaches(u));
    const open = routeUnits.filter((u) => !reaches(u));
    const p = pattern({ id: "auth", kind: "auth", name: "Authentication on routes", category: "security-boundary", statement: "Route modules pass through authentication", unitLabel: "route modules", comparable: routeUnits.length, matching: guarded.length, distribution: [{ label: "reach authentication", count: guarded.length, share: guarded.length / routeUnits.length }, { label: "no authentication found", count: open.length, share: open.length / routeUnits.length }], dominant: guarded.length >= open.length ? "authenticated" : "no authentication", examples: examples(guarded, reaches), outliers: open.map((u) => u.path) });
    if (p.established && p.frequency >= 0.7) for (const u of open) signals.push({ subject: `${u.path}|auth`, category: "security-boundary", source: "project", basis: basisOf(p), confidence: p.confidence, attention: u.outside.has("store:database") && p.confidence === "high" ? "critical" : "high", title: `${posix.basename(u.path)} registers routes without the project's authentication boundary`, observed: `Routes here (${u.responsibilities.get("http")?.detail ?? ""}) reach no authentication code.`, baseline: `${guarded.length} of ${routeUnits.length} route modules reach authentication.`, explanation: "Authentication boundary differs from the project's established route pattern. Public routes may be intentional; detailed analysis is Feature 3.6's job.", impact: "If unintentional, requests reach this code without the checks the other routes get.", suggestion: { text: "Possible restructuring: apply the same middleware / guard / dependency the other routes use, or mark the routes as intentionally public." }, unit: u.path, pattern: p.id, kind: "auth", stats: statsOf(p), evidence: [u.responsibilities.get("http")!] });
  }

  // ─── D15: modules used through their entry point ──────────────────
  const ENTRY_FILE = /^(index\.[cm]?[jt]sx?|__init__\.py|mod\.rs)$/;
  const dirsWithEntry = new Map<string, string>();
  for (const u of units) if (ENTRY_FILE.test(posix.basename(u.path))) dirsWithEntry.set(posix.dirname(u.path), u.path);
  let viaEntry = 0;
  let internal: { from: string; to: string; dir: string }[] = [];
  for (const u of units) {
    for (const d of u.fileDeps) {
      const dir = [...dirsWithEntry.keys()].filter((x) => d === dirsWithEntry.get(x) || d.startsWith(`${x}/`)).sort((a, b) => b.length - a.length)[0];
      if (!dir || u.path.startsWith(`${dir}/`) || dir === "." ) continue;
      if (d === dirsWithEntry.get(dir)) viaEntry += 1;
      else internal.push({ from: u.path, to: d, dir });
    }
  }
  if (viaEntry + internal.length >= 4) {
    const total = viaEntry + internal.length;
    const p = pattern({ id: "module-api", kind: "module-api", name: "Module entry points", category: "module-boundary", statement: "Other modules use a module through its entry file", unitLabel: "cross-module imports into modules with an entry file", comparable: total, matching: viaEntry, distribution: [{ label: "through the entry file", count: viaEntry, share: viaEntry / total }, { label: "into internals", count: internal.length, share: internal.length / total }], dominant: "entry file", examples: [...dirsWithEntry.values()].slice(0, 4).map((path) => ({ path })), outliers: internal.map((x) => x.from) });
    if (p.established && p.frequency >= 0.7) {
      internal = internal.slice(0, MAX_PER_PATTERN);
      for (const x of internal) signals.push({ subject: `${x.from}|${x.to}`, category: "module-boundary", source: "project", basis: basisOf(p), confidence: p.confidence, attention: "moderate", title: `${short(x.from)} reaches into ${x.dir}/ internals`, observed: `${x.from} → ${x.to}`, baseline: `Expected communication: through ${dirsWithEntry.get(x.dir)} (${viaEntry} of ${total} cross-module imports do).`, explanation: `Cross-module responsibility leakage: ${pct(p.frequency)} of imports into modules with an entry file go through it.`, impact: "Internal code of another module becomes part of its de-facto API; refactoring that module breaks this caller.", suggestion: { text: `Possible restructuring: import from ${dirsWithEntry.get(x.dir)}, exporting what is needed there.`, chain: [short(x.from), dirsWithEntry.get(x.dir)!, short(x.to)] }, commonChain: [short(x.from), short(dirsWithEntry.get(x.dir)!), short(x.to)], observedChain: [short(x.from), short(x.to)], unit: x.from, target: x.to, pattern: p.id, kind: "module-api", stats: statsOf(p), evidence: [depEvidence(x.from, x.to)] });
    }
  }

  // ─── D16: module cycles ───────────────────────────────────────────
  const modList = facts.modules;
  const modDeps = new Map<string, Set<string>>();
  for (const u of units) for (const d of u.fileDeps) {
    const a = u.module;
    const b = unitOf.get(d)?.module;
    if (b && a !== b) modDeps.set(a, (modDeps.get(a) ?? new Set()).add(b));
  }
  const sccs = stronglyConnected(modList.map((m) => m.name), (id) => [...(modDeps.get(id) ?? [])]).map((scc) => cyclePath(scc, (id) => [...(modDeps.get(id) ?? [])]));
  const inCycles = new Set(sccs.flat());
  if (modList.length >= 2) {
    const p = pattern({ id: "cycles", kind: "cycles", name: "Module dependency direction", category: "cycle", statement: "Modules depend on each other in one direction", unitLabel: "modules", comparable: modList.length, matching: modList.length - inCycles.size, distribution: [{ label: "not in a cycle", count: modList.length - inCycles.size, share: 1 - inCycles.size / modList.length }, { label: "in a cycle", count: inCycles.size, share: inCycles.size / modList.length }], dominant: "acyclic", examples: modList.filter((m) => !inCycles.has(m.name)).slice(0, 4).map((m) => ({ path: m.files[0]!, detail: m.name })), outliers: [...inCycles] });
    for (const scc of sccs) {
      const members = new Set(scc);
      const edges: Evidence[] = [];
      for (const a of scc) for (const f of modList.find((m) => m.name === a)!.files) for (const d of unitOf.get(f)?.fileDeps ?? []) if (members.has(facts.moduleOf(d)) && facts.moduleOf(d) !== a && edges.length < 8) edges.push(depEvidence(f, d));
      const ind = practiceFor("cycles", "industry");
      signals.push({ subject: `cycle:${[...scc].sort().join("+")}`, category: "cycle", source: p.established ? "project" : "industry", basis: p.established ? basisOf(p) : "industry", confidence: p.established ? p.confidence : "medium", attention: scc.length >= 4 ? "high" : "moderate", title: `Module cycle: ${scc.join(" → ")} → ${scc[0]}`, observed: `${scc.length} modules depend on each other in a cycle (cycle length ${scc.length}).`, baseline: p.established ? `${p.matching} of ${p.comparable} modules are in no cycle.` : ind?.statement ?? "Modules commonly depend in one direction.", explanation: p.established ? `Project convention: ${pct(p.frequency)} of modules take part in no dependency cycle.` : "Industry practice; the project has too few modules outside cycles to establish its own convention.", impact: "Modules in a cycle change, build and test together; the cycle usually hides a missing shared abstraction.", suggestion: { text: "Possible restructuring: find the edge with the fewest references and invert or remove it." }, commonChain: [...scc], observedChain: [...scc, scc[0]!], kind: "cycles", ...(p.established ? { pattern: p.id, stats: statsOf(p) } : {}), evidence: edges, modules: scc.map((m) => `module:${m}`) });
    }
  }

  // ─── D17: monorepo boundaries ─────────────────────────────────────
  const ws = context.workspaces;
  if (ws.length >= 2) {
    const wsOf = (f: string) => ws.filter((w) => f === w.path || f.startsWith(`${w.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
    const pairs: { from: string; to: string; a: (typeof ws)[number]; b: (typeof ws)[number] }[] = [];
    for (const u of units) {
      const a = wsOf(u.path);
      if (!a) continue;
      for (const d of u.fileDeps) {
        const b = wsOf(d);
        if (b && b !== a) pairs.push({ from: u.path, to: d, a, b });
      }
    }
    const appToPkg = pairs.filter((x) => x.a.kind === "app" && x.b.kind !== "app");
    const appToApp = pairs.filter((x) => x.a.kind === "app" && x.b.kind === "app");
    if (pairs.length) {
      const p = pattern({ id: "monorepo", kind: "monorepo", name: "Workspace dependencies", category: "monorepo", statement: "Applications depend on packages, not on other applications", unitLabel: "cross-workspace imports from apps", comparable: appToPkg.length + appToApp.length, matching: appToPkg.length, distribution: [{ label: "app → package", count: appToPkg.length, share: appToPkg.length / Math.max(1, appToPkg.length + appToApp.length) }, { label: "app → app", count: appToApp.length, share: appToApp.length / Math.max(1, appToPkg.length + appToApp.length) }], dominant: "app → package", examples: appToPkg.slice(0, 4).map((x) => depEvidence(x.from, x.to)), outliers: appToApp.map((x) => x.from) });
      const established = p.established || appToPkg.length === 0;
      for (const x of appToApp.slice(0, MAX_PER_PATTERN)) signals.push({ subject: `${x.from}|${x.to}`, category: "monorepo", source: p.established ? "project" : "industry", basis: p.established ? basisOf(p) : "industry", confidence: p.established ? p.confidence : "low", attention: "high", title: `${x.a.path} imports from another application, ${x.b.path}`, observed: `${x.from} → ${x.to}`, baseline: p.established ? `${appToPkg.length} of ${p.comparable} cross-workspace imports from apps go to packages.` : "Industry practice: applications share code through packages.", explanation: established ? "Monorepo boundary: application-to-application imports tie two deployables together." : "", impact: "The two applications can no longer be built, versioned or deployed independently.", suggestion: { text: `Possible restructuring: extract the shared code into a package both applications depend on.`, chain: [x.a.path, "packages/…", x.b.path] }, unit: x.from, target: x.to, kind: "monorepo", ...(p.established ? { pattern: p.id, stats: statsOf(p) } : {}), evidence: [depEvidence(x.from, x.to)] });
    }
  }

  return { patterns, signals, practices };
}

function raise2(a: Attention): Attention {
  return a === "moderate" ? "high" : a;
}

/** An actual cycle through the members of a strongly connected component, as a path (last → first closes it). */
function cyclePath(scc: string[], next: (id: string) => string[]): string[] {
  const members = new Set(scc);
  const start = [...scc].sort()[0]!;
  const path: string[] = [start];
  const seen = new Set([start]);
  const dfs = (cur: string): boolean => {
    for (const n of next(cur).filter((x) => members.has(x)).sort()) {
      if (n === start && path.length > 1) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      path.push(n);
      if (dfs(n)) return true;
      path.pop();
    }
    return false;
  };
  return dfs(start) ? path : scc;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

function percentile(sorted: number[], v: number): number {
  return sorted.filter((x) => x <= v).length / sorted.length;
}
