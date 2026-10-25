import { posix } from "node:path";
import type { LayoutInputBoundary } from "./layout.js";
import type { ArchEvidence, ArchNode, ArchNodeType, ArchRelationship } from "./types.js";
import { layoutEdge, layoutNode, mergeRelations, node, relation, type Availability, type ViewContext, type ViewResult } from "./view-kit.js";
import { arr, obj, parseYamlDocuments, str, type Yaml } from "./yaml.js";

/**
 * Deployment view: where the code runs, as declared by configuration —
 * docker-compose services, Dockerfiles, Kubernetes workloads / Services /
 * Ingresses, hosting-platform files and CI deploy steps. Datastores and
 * gateways are recognised by image name; build contexts map containers back
 * to the code components they package. Nothing is inferred from package
 * names: a cloud SDK in the code is not a deployment.
 */

const DB_IMAGE = /(^|\/)(postgres|postgis|mysql|mariadb|mongo|mongodb|redis|valkey|memcached|cassandra|scylla|cockroach|clickhouse|elasticsearch|opensearch|neo4j|couchdb|dynamodb-local|minio|rabbitmq|kafka|zookeeper|nats|timescale|influxdb|sqlserver|mssql|oracle)(:|$|-)/i;
const GATEWAY_IMAGE = /(^|\/)(nginx|traefik|caddy|haproxy|envoy|kong|apache|httpd)(:|$|-)/i;
const PLATFORM_LABEL: Record<string, string> = { vercel: "Vercel", now: "Vercel", netlify: "Netlify", fly: "Fly.io", render: "Render", app: "Google App Engine", serverless: "Serverless Framework", railway: "Railway", amplify: "AWS Amplify", firebase: "Firebase Hosting", wrangler: "Cloudflare Workers", heroku: "Heroku", apprunner: "AWS App Runner" };
const CI_DEPLOY: [RegExp, string][] = [
  [/\bkubectl\s+(apply|rollout|set\s+image)|\bhelm\s+(upgrade|install)|\bkustomize\b/, "kubernetes"],
  [/\bdocker\s+(push|buildx\s+build.*--push)|docker\/build-push-action/, "docker"],
  [/\bvercel(\s+deploy|\s+--prod)|amondnet\/vercel-action/, "Vercel"],
  [/\bnetlify\s+deploy|nwtgck\/actions-netlify/, "Netlify"],
  [/\bfly(ctl)?\s+deploy|superfly\/flyctl-actions/, "Fly.io"],
  [/\bgcloud\s+(run|app|functions)\s+deploy/, "Google Cloud"],
  [/\baws\s+(ecs|lambda|s3\s+sync|cloudformation)|aws-actions\//, "AWS"],
  [/\bserverless\s+deploy|\bsls\s+deploy/, "Serverless Framework"],
  [/\bwrangler\s+(deploy|publish)|cloudflare\/wrangler-action/, "Cloudflare Workers"],
  [/\brailway\s+up/, "Railway"],
  [/\bheroku\s+(container:push|deploy)|akhileshns\/heroku-deploy/, "Heroku"],
];

interface Group {
  id: string;
  title: string;
  members: Set<string>;
}

export function deploymentAvailability(ctx: ViewContext): Availability {
  const files = ctx.facts.configFiles.filter((c) => c.kind === "docker" || c.kind === "compose" || c.kind === "kubernetes" || c.kind === "platform");
  if (!files.length) return { available: false, reason: "No Dockerfile, compose file, Kubernetes manifest or hosting-platform configuration was found." };
  return { available: true };
}

export function deploymentView(ctx: ViewContext): ViewResult {
  const { facts } = ctx;
  const nodes = new Map<string, { n: ArchNode; rank: number; group?: string }>();
  const rels: ArchRelationship[] = [];
  const groups: Group[] = [];
  const notes: string[] = ["Declared by configuration files; cloud resources are never inferred from package names."];
  const put = (n: ArchNode, rank: number, group?: Group): string => {
    if (!nodes.has(n.id)) nodes.set(n.id, { n, rank, ...(group ? { group: group.id } : {}) });
    group?.members.add(n.id);
    return n.id;
  };
  const internet = (): string => put(node("deploy:internet", "actor", "Internet / clients", { tier: 0, confidence: "strong", reasons: ["ports or ingress exposed by configuration"] }), 0);
  const kindOf = (image: string | undefined): ArchNodeType => (image && DB_IMAGE.test(image) ? "database" : image && GATEWAY_IMAGE.test(image) ? "gateway" : "container");
  const rankOf = (base: number, type: ArchNodeType): number => base + (type === "gateway" ? 0 : type === "database" ? 2 : 1);
  const ev = (path: string, line: number | undefined, detail: string): ArchEvidence => ({ path, ...(line ? { line } : {}), provenance: "declared", detail });
  const lineOf = (path: string, re: RegExp): number | undefined => {
    const i = facts.lines(path).findIndex((l) => re.test(l));
    return i >= 0 ? i + 1 : undefined;
  };
  const codeIn = (dir: string): ArchNode[] => {
    const d = dir.replace(/^\.\/?/, "").replace(/\/$/, "");
    const comps = ctx.model.components.map((id) => ctx.byId.get(id)!).filter((c) => !d || c.files.some((f) => f.startsWith(`${d}/`)));
    // A build of the whole repository runs its entry points, not every library component.
    if (!d) return comps.filter((c) => c.type === "api" || c.type === "cli" || c.type === "worker" || c.type === "frontend");
    return comps;
  };
  const CODE_RANK = 1000;
  const runs = (from: string, dir: string, evidence: ArchEvidence): void => {
    for (const c of codeIn(dir).slice(0, 6)) rels.push(relation(from, put(c, CODE_RANK), "deploys", { label: "runs", evidence: [evidence], confidence: "strong" }));
  };
  let base = 1;
  const nextBase = (): number => {
    const b = base;
    base += 3;
    return b;
  };

  // ── docker-compose ─────────────────────────────────────────────
  const composeDockerfiles = new Set<string>();
  const built = new Set<string>();
  for (const file of facts.configOf("compose")) {
    const doc = obj(parseYamlDocuments(facts.lines(file.path).join("\n"))[0]);
    const services = obj(doc.services);
    const names = Object.keys(services);
    if (!names.length) continue;
    const dir = posix.dirname(file.path);
    const group: Group = { id: `boundary:compose:${file.path}`, title: `Compose: ${file.path}`, members: new Set() };
    groups.push(group);
    const b = nextBase();
    const idOf = (svc: string): string => `deploy:compose:${file.path}:${svc}`;
    for (const name of names) {
      const s = obj(services[name]);
      const image = str(s.image);
      const build = typeof s.build === "string" ? s.build : str(obj(s.build).context);
      const type = kindOf(image);
      const line = lineOf(file.path, new RegExp(`^\\s{1,4}${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`));
      const at = ev(file.path, line, `service ${name}${image ? ` (image ${image})` : ""}${build ? ` (build ${build})` : ""}`);
      const n = node(idOf(name), type, name, { confidence: "verified", reasons: [`compose service in ${file.path}`, ...(image ? [`image ${image}`] : []), ...(build ? [`built from ${build}`] : [])], evidence: [at], files: [file.path], tier: type === "database" ? 3 : 1, technologies: image ? [image] : [] });
      put(n, rankOf(b, type), group);
      const ports = arr(s.ports).map((p) => str(p) ?? str(obj(p).published)).filter((p): p is string => Boolean(p));
      if (ports.length) rels.push(relation(internet(), n.id, "exposes", { label: ports.slice(0, 2).join(", "), evidence: [at], confidence: "verified" }));
      const deps = Array.isArray(s.depends_on) ? s.depends_on.map((d) => str(d)).filter((d): d is string => Boolean(d)) : Object.keys(obj(s.depends_on));
      for (const d of deps) if (services[d] !== undefined) rels.push(relation(n.id, idOf(d), "uses", { label: "depends on", evidence: [at], confidence: "verified" }));
      // Connection strings naming another service (`postgres://db:5432`, `REDIS_HOST=cache`).
      const env = Array.isArray(s.environment) ? s.environment.map((e) => str(e) ?? "") : Object.entries(obj(s.environment)).map(([k, v]) => `${k}=${str(v) ?? ""}`);
      for (const other of names) {
        if (other === name || deps.includes(other)) continue;
        const re = new RegExp(`(//|@|=)${other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([:/]|$)`);
        const hit = env.find((e) => re.test(e));
        if (hit) rels.push(relation(n.id, idOf(other), "uses", { label: "connects", evidence: [ev(file.path, lineOf(file.path, new RegExp(hit.split("=")[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))), hit.replace(/:[^:@/]*@/, ":***@"))], confidence: "strong" }));
      }
      if (build) {
        const ctxDir = posix.normalize(posix.join(dir, build));
        const dockerfile = posix.join(ctxDir === "." ? "" : ctxDir, str(obj(s.build).dockerfile) ?? "Dockerfile");
        composeDockerfiles.add(posix.normalize(dockerfile));
        built.add(n.id);
        runs(n.id, ctxDir === "." ? "" : ctxDir, at);
      }
    }
  }

  // ── Dockerfiles not built by a compose service ─────────────────
  const standalone = facts.configOf("docker").filter((d) => !composeDockerfiles.has(d.path));
  if (standalone.length) {
    const group: Group = { id: "boundary:images", title: "Container images", members: new Set() };
    groups.push(group);
    const b = nextBase();
    for (const d of standalone) {
      const lines = facts.lines(d.path);
      const from = [...lines].reverse().map((l) => /^\s*FROM\s+(\S+)/i.exec(l)?.[1]).find(Boolean);
      const expose = lines.flatMap((l) => /^\s*EXPOSE\s+(.+)$/i.exec(l)?.[1]?.split(/\s+/) ?? []);
      const cmd = lines.map((l) => /^\s*(CMD|ENTRYPOINT)\s+(.+)$/i.exec(l)?.[2]).filter(Boolean).pop();
      const dir = posix.dirname(d.path);
      const at = ev(d.path, lineOf(d.path, /^\s*FROM\s/i), `FROM ${from ?? "?"}`);
      const n = node(`deploy:docker:${d.path}`, "container", dir === "." ? "Container image" : `${posix.basename(dir)} image`, { confidence: "verified", reasons: [`Dockerfile ${d.path}`, ...(from ? [`base ${from}`] : []), ...(cmd ? [`runs ${cmd.slice(0, 60)}`] : [])], evidence: [at], files: [d.path], technologies: from ? [from] : [] });
      put(n, rankOf(b, "container"), group);
      built.add(n.id);
      if (expose.length) rels.push(relation(internet(), n.id, "exposes", { label: expose.slice(0, 2).join(", "), evidence: [ev(d.path, lineOf(d.path, /^\s*EXPOSE\s/i), `EXPOSE ${expose.join(" ")}`)], confidence: "verified" }));
      runs(n.id, dir === "." ? "" : dir, at);
    }
  }

  // ── Kubernetes ─────────────────────────────────────────────────
  interface K8s {
    kind: string;
    name: string;
    ns: string;
    doc: { [k: string]: Yaml };
    path: string;
  }
  const manifests: K8s[] = [];
  for (const file of facts.configOf("kubernetes")) {
    for (const d of parseYamlDocuments(facts.lines(file.path).join("\n"))) {
      const doc = obj(d);
      const kind = str(doc.kind);
      const meta = obj(doc.metadata);
      const name = str(meta.name);
      if (kind && name) manifests.push({ kind, name, ns: str(meta.namespace) ?? "default", doc, path: file.path });
    }
  }
  const namespaces = [...new Set(manifests.map((m) => m.ns))].sort();
  for (const ns of namespaces) {
    const group: Group = { id: `boundary:k8s:${ns}`, title: `Kubernetes namespace: ${ns}`, members: new Set() };
    groups.push(group);
    const b = nextBase();
    const inNs = manifests.filter((m) => m.ns === ns);
    const workloads = new Map<string, { id: string; labels: Record<string, string> }>();
    for (const m of inNs) {
      if (!/^(Deployment|StatefulSet|DaemonSet|Job|CronJob|ReplicaSet|Pod)$/.test(m.kind)) continue;
      const spec = obj(m.doc.spec);
      const template = m.kind === "CronJob" ? obj(obj(obj(obj(spec.jobTemplate).spec).template)) : m.kind === "Pod" ? m.doc : obj(spec.template);
      const podSpec = obj(template.spec);
      const containers = arr(podSpec.containers).map((c) => obj(c));
      const images = containers.map((c) => str(c.image)).filter((x): x is string => Boolean(x));
      const type = images.some((i) => DB_IMAGE.test(i)) ? "database" : "container";
      const at = ev(m.path, lineOf(m.path, new RegExp(`name:\\s*${m.name}\\b`)), `${m.kind} ${m.name}`);
      const replicas = str(spec.replicas);
      const id = `deploy:k8s:${ns}:${m.kind}:${m.name}`;
      put(node(id, type, m.name, { confidence: "verified", reasons: [`${m.kind} in ${m.path}`, ...images.map((i) => `image ${i}`), ...(replicas ? [`${replicas} replicas`] : [])], evidence: [at], files: [m.path], tier: type === "database" ? 3 : 1, technologies: images }), rankOf(b, type), group);
      const labels: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj(obj(template.metadata).labels))) labels[k] = str(v) ?? "";
      workloads.set(m.name, { id, labels });
    }
    const services = new Map<string, string>();
    for (const m of inNs) {
      if (m.kind !== "Service") continue;
      const spec = obj(m.doc.spec);
      const type = str(spec.type) ?? "ClusterIP";
      const at = ev(m.path, lineOf(m.path, new RegExp(`name:\\s*${m.name}\\b`)), `Service ${m.name} (${type})`);
      const id = `deploy:k8s:${ns}:Service:${m.name}`;
      const ports = arr(spec.ports).map((p) => str(obj(p).port)).filter((p): p is string => Boolean(p));
      put(node(id, "gateway", `${m.name} service`, { confidence: "verified", reasons: [`Service (${type}) in ${m.path}`, ...(ports.length ? [`ports ${ports.join(", ")}`] : [])], evidence: [at], files: [m.path] }), rankOf(b, "gateway"), group);
      services.set(m.name, id);
      if (type === "LoadBalancer" || type === "NodePort") rels.push(relation(internet(), id, "exposes", { label: type, evidence: [at], confidence: "verified" }));
      const selector = obj(spec.selector);
      for (const w of workloads.values()) {
        const match = Object.entries(selector).length > 0 && Object.entries(selector).every(([k, v]) => w.labels[k] === str(v));
        if (match) rels.push(relation(id, w.id, "routes", { label: "selects", evidence: [at], confidence: "verified" }));
      }
    }
    for (const m of inNs) {
      if (m.kind !== "Ingress") continue;
      const at = ev(m.path, lineOf(m.path, new RegExp(`name:\\s*${m.name}\\b`)), `Ingress ${m.name}`);
      const id = `deploy:k8s:${ns}:Ingress:${m.name}`;
      put(node(id, "gateway", `${m.name} ingress`, { confidence: "verified", reasons: [`Ingress in ${m.path}`], evidence: [at], files: [m.path] }), rankOf(b, "gateway") - 0, group);
      rels.push(relation(internet(), id, "exposes", { label: "HTTP(S)", evidence: [at], confidence: "verified" }));
      for (const rule of arr(obj(m.doc.spec).rules)) {
        const host = str(obj(rule).host);
        for (const p of arr(obj(obj(rule).http).paths)) {
          const backend = obj(obj(p).backend);
          const svc = str(obj(backend.service).name) ?? str(backend.serviceName);
          const target = svc ? services.get(svc) : undefined;
          if (target) rels.push(relation(id, target, "routes", { label: `${host ?? ""}${str(obj(p).path) ?? "/"}`.slice(0, 32), evidence: [at], confidence: "verified" }));
        }
      }
    }
  }

  // ── hosting platforms ──────────────────────────────────────────
  const platforms = facts.configOf("platform");
  if (platforms.length) {
    const group: Group = { id: "boundary:platforms", title: "Hosting platforms", members: new Set() };
    groups.push(group);
    const b = nextBase();
    for (const p of platforms) {
      const key = posix.basename(p.path).toLowerCase().replace(/\.(ya?ml|json|toml)$/, "");
      const label = PLATFORM_LABEL[key] ?? p.label;
      const id = `deploy:platform:${label}`;
      const at = ev(p.path, 1, `${label} configuration`);
      put(node(id, "platform", label, { confidence: "verified", reasons: [`configured by ${p.path}`], evidence: [at], files: [p.path] }), b + 1, group);
      rels.push(relation(internet(), id, "exposes", { label: "hosted", evidence: [at], confidence: "strong" }));
      runs(id, posix.dirname(p.path) === "." ? "" : posix.dirname(p.path), at);
    }
  }

  // ── CI deploy steps ────────────────────────────────────────────
  for (const ci of facts.configOf("ci")) {
    const lines = facts.lines(ci.path);
    const targets = new Map<string, number>();
    lines.forEach((l, i) => {
      for (const [re, target] of CI_DEPLOY) if (re.test(l) && !targets.has(target)) targets.set(target, i + 1);
    });
    if (!targets.size) continue;
    const id = `deploy:ci:${ci.path}`;
    put(node(id, "platform", `CI: ${posix.basename(ci.path)}`, { confidence: "verified", reasons: [`deploy steps in ${ci.path}`], evidence: [...targets].map(([t, line]) => ev(ci.path, line, `deploys to ${t}`)), files: [ci.path], tier: 0 }), 0);
    for (const [target, line] of targets) {
      const at = ev(ci.path, line, `deploys to ${target}`);
      const matches = [...nodes.values()].filter((x) => (target === "kubernetes" ? x.n.id.startsWith("deploy:k8s:") && x.n.type === "container" : target === "docker" ? built.has(x.n.id) : x.n.id === `deploy:platform:${target}`));
      if (!matches.length && target !== "kubernetes" && target !== "docker") {
        const pid = put(node(`deploy:platform:${target}`, "platform", target, { confidence: "strong", reasons: [`deploy command in ${ci.path}`], evidence: [at] }), base);
        rels.push(relation(id, pid, "deploys", { label: "deploys", evidence: [at], confidence: "strong" }));
      }
      for (const m of matches.slice(0, 6)) rels.push(relation(id, m.n.id, "deploys", { label: "deploys", evidence: [at], confidence: "strong" }));
    }
  }

  if (!nodes.size) return { error: "no deployment configuration could be read" };
  const merged = mergeRelations(rels);
  const shown = [...nodes.values()];
  const boundaries: LayoutInputBoundary[] = groups.filter((g) => g.members.size).map((g) => ({ id: g.id, title: g.title, members: [...g.members] }));
  // Groups own disjoint rank ranges; code components sit below everything.
  const maxRank = Math.max(...shown.filter((x) => x.rank < CODE_RANK).map((x) => x.rank), 0);
  if (shown.some((x) => x.rank === CODE_RANK)) notes.push("Code components at the bottom are what the containers and platforms build and run.");
  return {
    view: "deployment",
    title: "Deployment",
    nodes: shown.map((x) => x.n),
    relationships: merged,
    input: {
      view: "deployment",
      nodes: shown.map((x) => layoutNode(x.n, "middle", { rank: x.rank === CODE_RANK ? maxRank + 1 : x.rank, ...(x.rank === CODE_RANK ? { context: true } : {}) })),
      edges: merged.map((r) => layoutEdge(r)),
      boundaries,
    },
    path: [{ id: "system", name: ctx.model.repository.name }, { id: "deployment", name: "Deployment" }],
    notes,
  };
}
