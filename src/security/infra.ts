import { posix } from "node:path";
import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FindingEvidence } from "../findings/model.js";
import { secFinding } from "./rules.js";
import type { SecurityFinding } from "./types.js";

/**
 * Container, Kubernetes and infrastructure-as-code checks, read line by line
 * from the files 3.2 classifies (Dockerfiles, Compose, Kubernetes manifests)
 * plus Terraform and CloudFormation templates. Every finding points at the
 * line that sets the value.
 */

type Hit = { rule: string; path: string; line: number; detail: string; severity?: SecurityFinding["severity"] };

export interface InfraResult {
  findings: SecurityFinding[];
  files: { docker: number; compose: number; kubernetes: number; iac: number };
}

const SECRET_NAME = /(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;

export function analyzeInfra(facts: BriefingFacts, skip: (p: string) => boolean): InfraResult {
  const hits: Hit[] = [];
  const docker = facts.configOf("docker").map((c) => c.path).filter((p) => !skip(p));
  const compose = facts.configOf("compose").map((c) => c.path).filter((p) => !skip(p));
  const k8s = facts.configOf("kubernetes").map((c) => c.path).filter((p) => !skip(p));
  const iac = facts.files.map((f) => f.path).filter((p) => !skip(p) && (/\.tf$|\.tf\.json$/.test(p) || (/\.(?:ya?ml|json|template)$/.test(p) && /AWSTemplateFormatVersion|Type:\s*["']?AWS::/.test(facts.lines(p).slice(0, 200).join("\n")))));
  for (const p of docker) hits.push(...dockerfile(p, facts.lines(p)));
  for (const p of compose) hits.push(...composeFile(p, facts.lines(p)));
  for (const p of k8s) hits.push(...kubernetes(p, facts.lines(p)));
  for (const p of iac) hits.push(...(p.endsWith(".tf") || p.endsWith(".tf.json") ? terraform(p, facts.lines(p)) : cloudformation(p, facts.lines(p))));
  return { findings: group(hits), files: { docker: docker.length, compose: compose.length, kubernetes: k8s.length, iac: iac.length } };
}

const TEXT: Record<string, { title: (n: number) => string; why: string; action: string }> = {
  "sec/docker-root": { title: (n) => `${n} ${n === 1 ? "container runs" : "containers run"} as root`, why: "A process running as root inside a container turns any code-execution bug into root in the container, one step from the host.", action: "Add a non-root USER (Dockerfile), `user:` (Compose) or `runAsNonRoot: true` (Kubernetes)." },
  "sec/docker-mutable-image": { title: (n) => `${n} ${n === 1 ? "image reference is" : "image references are"} mutable (latest or untagged)`, why: "The same build can pull different code on different days, including a compromised release.", action: "Pin to a version tag, ideally with an @sha256 digest." },
  "sec/docker-remote-add": { title: (n) => `${n} remote ${n === 1 ? "download is" : "downloads are"} executed or added without verification`, why: "A changed or intercepted remote file ends up in the image unnoticed.", action: "Download with a pinned checksum, or copy a vendored file." },
  "sec/docker-secret": { title: (n) => `${n} ${n === 1 ? "secret is" : "secrets are"} baked into an image build`, why: "ENV and ARG values are stored in the image layers and history; anyone who can pull the image can read them.", action: "Use build secrets (--mount=type=secret) or runtime environment variables." },
  "sec/docker-no-healthcheck": { title: (n) => `${n} ${n === 1 ? "image exposes" : "images expose"} a port without a HEALTHCHECK`, why: "Without a health check an unhealthy container keeps receiving traffic.", action: "Add a HEALTHCHECK, or rely on the orchestrator's probes." },
  "sec/compose-privileged": { title: (n) => `${n} privileged or host-level container ${n === 1 ? "setting" : "settings"}`, why: "Privileged mode, host namespaces, the Docker socket or host-root mounts give the container control of the host.", action: "Remove the setting, or grant only the specific capability or device needed." },
  "sec/k8s-privileged": { title: (n) => `${n} privileged or host-namespace pod ${n === 1 ? "setting" : "settings"}`, why: "These settings break the isolation between the pod and the node.", action: "Remove them, or restrict with a PodSecurity admission policy." },
  "sec/k8s-root": { title: (n) => `${n} ${n === 1 ? "workload does" : "workloads do"} not require a non-root user`, why: "Without runAsNonRoot, an image that runs as root does so in the cluster.", action: "Set securityContext.runAsNonRoot: true and a non-zero runAsUser." },
  "sec/k8s-rbac-wildcard": { title: (n) => `${n} RBAC ${n === 1 ? "rule grants" : "rules grant"} wildcard or cluster-admin access`, why: "Wildcard verbs or resources grant far more than any workload needs; a compromised pod inherits it.", action: "List the exact resources and verbs required." },
  "sec/k8s-secret-literal": { title: (n) => `${n} Kubernetes ${n === 1 ? "Secret has" : "Secrets have"} values committed`, why: "Secret data in a manifest is only base64-encoded; it is readable by anyone with the repository.", action: "Use sealed-secrets, an external secret store, or inject at deploy time." },
  "sec/k8s-no-limits": { title: (n) => `${n} ${n === 1 ? "workload has" : "workloads have"} no resource limits`, why: "One runaway or attacked pod can starve the node.", action: "Set resources.limits for CPU and memory." },
  "sec/k8s-ingress-no-tls": { title: (n) => `${n} ${n === 1 ? "Ingress has" : "Ingresses have"} no TLS`, why: "Traffic, including credentials and cookies, crosses the network in clear text.", action: "Add a tls: section (for example with cert-manager)." },
  "sec/iac-public-storage": { title: (n) => `${n} storage ${n === 1 ? "resource is" : "resources are"} publicly readable`, why: "Public buckets are a leading cause of data leaks.", action: "Make the bucket private and serve public content through a CDN with an explicit policy." },
  "sec/iac-open-ingress": { title: (n) => `${n} network ${n === 1 ? "rule is" : "rules are"} open to the internet on sensitive ports`, why: "SSH, RDP, database and all-port access from 0.0.0.0/0 is scanned continuously.", action: "Restrict the source range, or use a bastion / VPN / identity-aware proxy." },
  "sec/iac-public-database": { title: (n) => `${n} ${n === 1 ? "database is" : "databases are"} publicly accessible`, why: "A database reachable from the internet is one weak password away from a breach.", action: "Set publicly_accessible = false and reach it from inside the network." },
  "sec/iac-no-encryption": { title: (n) => `${n} ${n === 1 ? "resource disables" : "resources disable"} encryption at rest`, why: "Unencrypted volumes, snapshots and backups expose data if copied.", action: "Enable encryption (KMS-managed keys where possible)." },
  "sec/iac-wildcard-iam": { title: (n) => `${n} IAM ${n === 1 ? "policy grants" : "policies grant"} every action on every resource`, why: "Action * on Resource * is administrator access; any compromise of the principal is total.", action: "Grant the specific actions on the specific resources needed." },
};

function group(hits: Hit[]): SecurityFinding[] {
  const by = new Map<string, Hit[]>();
  for (const h of hits) by.set(h.rule, [...(by.get(h.rule) ?? []), h]);
  const out: SecurityFinding[] = [];
  for (const [rule, list] of by) {
    const t = TEXT[rule]!;
    const worst = list.find((h) => h.severity === "critical")?.severity ?? list.find((h) => h.severity === "high")?.severity;
    out.push(
      secFinding(rule, {
        id: `sec:${rule.slice(4)}`,
        ...(worst ? { severity: worst } : {}),
        title: t.title(list.length),
        message: `${list.length} ${list.length === 1 ? "occurrence" : "occurrences"} in ${new Set(list.map((h) => h.path)).size} ${new Set(list.map((h) => h.path)).size === 1 ? "file" : "files"}.`,
        why: t.why,
        action: t.action,
        confidence: "verified",
        ...(list.length === 1 ? { file: list[0]!.path, line: list[0]!.line } : {}),
        evidence: list.map((h): FindingEvidence => ({ type: "config", path: h.path, line: h.line, detail: h.detail })),
      }),
    );
  }
  return out;
}

const clean = (l: string): string => l.replace(/\s+#.*$/, "").trim();

function mutable(image: string): boolean {
  if (!image || image === "scratch" || image.includes("@sha256:") || image.includes("$")) return false;
  const last = image.split("/").pop()!;
  return !last.includes(":") || last.endsWith(":latest");
}

function dockerfile(path: string, lines: readonly string[]): Hit[] {
  const out: Hit[] = [];
  const stages = new Set<string>();
  let finalStart = 0;
  let user: { line: number; value: string } | undefined;
  let health = false;
  let expose: number | undefined;
  lines.forEach((raw, i) => {
    const l = clean(raw);
    const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(l);
    if (from) {
      if (mutable(from[1]!) && !stages.has(from[1]!.toLowerCase())) out.push({ rule: "sec/docker-mutable-image", path, line: i + 1, detail: `FROM ${from[1]}` });
      if (from[2]) stages.add(from[2].toLowerCase());
      finalStart = i;
      user = undefined;
      health = false;
    }
    const u = /^USER\s+(\S+)/i.exec(l);
    if (u) user = { line: i + 1, value: u[1]! };
    if (/^HEALTHCHECK\b/i.test(l)) health = true;
    if (/^EXPOSE\b/i.test(l)) expose = i + 1;
    if (/^ADD\s+https?:\/\//i.test(l)) out.push({ rule: "sec/docker-remote-add", path, line: i + 1, detail: "ADD from a URL" });
    if (/\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/.test(l)) out.push({ rule: "sec/docker-remote-add", path, line: i + 1, detail: "remote script piped to a shell" });
    const env = /^(ENV|ARG)\s+([A-Za-z_][\w]*)(?:\s*=\s*|\s+)(\S.*)?$/i.exec(l);
    if (env && SECRET_NAME.test(env[2]!) && env[3] && !/^\$|^["']?\$\{/.test(env[3]) && env[3].replace(/["']/g, "").length >= 4) out.push({ rule: "sec/docker-secret", path, line: i + 1, detail: `${env[1]!.toUpperCase()} ${env[2]} has a literal value (••••)` });
  });
  void finalStart;
  if (!user || /^(?:root|0)(?::|$)/.test(user.value)) out.push({ rule: "sec/docker-root", path, line: user?.line ?? 1, detail: user ? `USER ${user.value}` : "no USER instruction in the final stage" });
  if (!health && expose) out.push({ rule: "sec/docker-no-healthcheck", path, line: expose, detail: "EXPOSE without HEALTHCHECK" });
  return out;
}

function composeFile(path: string, lines: readonly string[]): Hit[] {
  const out: Hit[] = [];
  lines.forEach((raw, i) => {
    const l = clean(raw);
    if (/^privileged:\s*true\b/.test(l)) out.push({ rule: "sec/compose-privileged", path, line: i + 1, detail: "privileged: true", severity: "high" });
    if (/^(?:network_mode|pid|ipc):\s*["']?host\b/.test(l)) out.push({ rule: "sec/compose-privileged", path, line: i + 1, detail: l });
    if (/docker\.sock/.test(l)) out.push({ rule: "sec/compose-privileged", path, line: i + 1, detail: "Docker socket mounted into a container", severity: "critical" });
    if (/^-\s*["']?\/:\//.test(l)) out.push({ rule: "sec/compose-privileged", path, line: i + 1, detail: "host root filesystem mounted" });
    if (/^-\s*["']?(?:ALL|SYS_ADMIN|NET_ADMIN|SYS_PTRACE)["']?$/.test(l) && lines.slice(Math.max(0, i - 4), i).some((x) => /cap_add:/.test(x))) out.push({ rule: "sec/compose-privileged", path, line: i + 1, detail: `cap_add ${l.replace(/^-\s*/, "")}` });
    if (/^user:\s*["']?(?:root|0)["']?$/.test(l)) out.push({ rule: "sec/docker-root", path, line: i + 1, detail: l });
    const img = /^image:\s*["']?([^"'\s]+)/.exec(l);
    if (img && mutable(img[1]!)) out.push({ rule: "sec/docker-mutable-image", path, line: i + 1, detail: `image: ${img[1]}` });
  });
  return out;
}

function documents(lines: readonly string[]): { start: number; lines: readonly string[] }[] {
  const docs: { start: number; lines: readonly string[] }[] = [];
  let start = 0;
  for (let i = 0; i <= lines.length; i += 1) {
    if (i === lines.length || /^---\s*$/.test(lines[i]!)) {
      if (i > start) docs.push({ start, lines: lines.slice(start, i) });
      start = i + 1;
    }
  }
  return docs;
}

function kubernetes(path: string, lines: readonly string[]): Hit[] {
  const out: Hit[] = [];
  for (const doc of documents(lines)) {
    const text = doc.lines.join("\n");
    const kind = /^kind:\s*(\w+)/m.exec(text)?.[1] ?? "";
    const at = (re: RegExp): number => doc.start + Math.max(0, doc.lines.findIndex((l) => re.test(l))) + 1;
    const name = /^\s{2}name:\s*(\S+)/m.exec(text)?.[1] ?? kind;
    doc.lines.forEach((raw, j) => {
      const l = clean(raw);
      const line = doc.start + j + 1;
      if (/^(?:privileged|hostNetwork|hostPID|hostIPC|allowPrivilegeEscalation):\s*true\b/.test(l)) out.push({ rule: "sec/k8s-privileged", path, line, detail: `${kind} ${name}: ${l}` });
      if (/^-?\s*hostPath:/.test(l)) out.push({ rule: "sec/k8s-privileged", path, line, detail: `${kind} ${name}: hostPath volume` });
      if (/^-\s*["']?(?:ALL|SYS_ADMIN|NET_ADMIN|SYS_PTRACE)["']?$/.test(l) && doc.lines.slice(Math.max(0, j - 3), j).some((x) => /add:/.test(x))) out.push({ rule: "sec/k8s-privileged", path, line, detail: `${kind} ${name}: adds capability ${l.replace(/^-\s*/, "")}` });
      if (/^runAsUser:\s*0\b/.test(l)) out.push({ rule: "sec/k8s-root", path, line, detail: `${kind} ${name}: runAsUser: 0` });
      const img = /^-?\s*image:\s*["']?([^"'\s]+)/.exec(l);
      if (img && mutable(img[1]!)) out.push({ rule: "sec/docker-mutable-image", path, line, detail: `${kind} ${name}: image ${img[1]}` });
    });
    if (/^(?:Deployment|StatefulSet|DaemonSet|Pod|Job|CronJob|ReplicaSet)$/.test(kind)) {
      if (!/runAsNonRoot:\s*true/.test(text) && !/runAsUser:\s*[1-9]/.test(text)) out.push({ rule: "sec/k8s-root", path, line: at(/^kind:/), detail: `${kind} ${name}: no runAsNonRoot / non-zero runAsUser` });
      if (/containers:/.test(text) && !/limits:/.test(text)) out.push({ rule: "sec/k8s-no-limits", path, line: at(/containers:/), detail: `${kind} ${name}: no resources.limits` });
    }
    if (/^(?:ClusterRole|Role)$/.test(kind) && /(?:verbs|resources|apiGroups):\s*\[?\s*["']\*["']|^\s*-\s*["']\*["']\s*$/m.test(text)) out.push({ rule: "sec/k8s-rbac-wildcard", path, line: at(/["']\*["']/), detail: `${kind} ${name}: wildcard verbs or resources` });
    if (/^(?:ClusterRoleBinding|RoleBinding)$/.test(kind) && /name:\s*cluster-admin\b/.test(text)) out.push({ rule: "sec/k8s-rbac-wildcard", path, line: at(/cluster-admin/), detail: `${kind} ${name}: binds cluster-admin` });
    if (kind === "Secret" && /^(?:data|stringData):\s*$/m.test(text) && /^\s{2}\w[\w.-]*:\s*["']?[^\s"'{][^"'{]{3,}/m.test(text.split(/^(?:data|stringData):\s*$/m)[1] ?? "")) out.push({ rule: "sec/k8s-secret-literal", path, line: at(/^(?:data|stringData):/), detail: `Secret ${name}: values in the manifest (••••)` });
    if (kind === "Ingress" && !/^\s*tls:/m.test(text)) out.push({ rule: "sec/k8s-ingress-no-tls", path, line: at(/^kind:/), detail: `Ingress ${name}: no tls section` });
  }
  return out;
}

const SENSITIVE_PORTS = new Set([0, 22, 23, 1433, 3306, 3389, 5432, 5984, 6379, 9200, 11211, 27017]);

function terraform(path: string, lines: readonly string[]): Hit[] {
  const out: Hit[] = [];
  let resource = "";
  let block: { start: number; lines: string[] } | undefined;
  const flushIngress = (): void => {
    if (!block) return;
    const text = block.lines.join("\n");
    if (/0\.0\.0\.0\/0|::\/0/.test(text)) {
      const from = Number(/from_port\s*=\s*(\d+)/.exec(text)?.[1] ?? 0);
      const to = Number(/to_port\s*=\s*(\d+)/.exec(text)?.[1] ?? from);
      const all = /protocol\s*=\s*["']?(?:-1|all)["']?/.test(text) || (from === 0 && to >= 65535);
      const sensitive = all || [...SENSITIVE_PORTS].some((p) => p && p >= from && p <= to);
      if (sensitive) out.push({ rule: "sec/iac-open-ingress", path, line: block.start, detail: `${resource}: ${all ? "all ports" : `ports ${from}-${to}`} open to 0.0.0.0/0` });
    }
    block = undefined;
  };
  lines.forEach((raw, i) => {
    const l = clean(raw.replace(/\/\/.*$/, ""));
    const r = /^resource\s+"([^"]+)"\s+"([^"]+)"/.exec(l);
    if (r) {
      flushIngress();
      resource = `${r[1]}.${r[2]}`;
      if (/aws_security_group_rule/.test(r[1]!) || /azurerm_network_security_rule|google_compute_firewall/.test(r[1]!)) block = { start: i + 1, lines: [] };
    }
    if (/^ingress\s*\{/.test(l)) {
      flushIngress();
      block = { start: i + 1, lines: [] };
    }
    if (block) {
      block.lines.push(l);
      if (/^\}$/.test(l) && !/aws_security_group_rule|network_security_rule|compute_firewall/.test(resource)) flushIngress();
      if (/type\s*=\s*"egress"/.test(l)) block = undefined;
    }
    if (/\bacl\s*=\s*"public-read(?:-write)?"|\bcontainer_access_type\s*=\s*"(?:blob|container)"|members?\s*=\s*\[?\s*"(?:allUsers|allAuthenticatedUsers)"|\bblock_public_(?:acls|policy)\s*=\s*false|\brestrict_public_buckets\s*=\s*false/.test(l)) out.push({ rule: "sec/iac-public-storage", path, line: i + 1, detail: `${resource}: ${l}` });
    if (/\bpublicly_accessible\s*=\s*true/.test(l)) out.push({ rule: "sec/iac-public-database", path, line: i + 1, detail: `${resource}: publicly_accessible = true`, severity: "critical" });
    if (/\b(?:storage_encrypted|encrypted|enable_encryption|encryption_enabled)\s*=\s*false/.test(l)) out.push({ rule: "sec/iac-no-encryption", path, line: i + 1, detail: `${resource}: ${l}` });
    if (/["']?Action["']?\s*[:=]\s*\[?\s*"\*"|\bactions\s*=\s*\[\s*"\*"\s*\]/.test(l) && lines.slice(Math.max(0, i - 6), i + 8).some((x) => /["']?Resource["']?\s*[:=]\s*\[?\s*"\*"|\bresources\s*=\s*\[\s*"\*"\s*\]/.test(x))) out.push({ rule: "sec/iac-wildcard-iam", path, line: i + 1, detail: `${resource}: Action * on Resource *` });
  });
  flushIngress();
  void posix;
  return out;
}

function cloudformation(path: string, lines: readonly string[]): Hit[] {
  const out: Hit[] = [];
  lines.forEach((raw, i) => {
    const l = clean(raw);
    if (/PubliclyAccessible:\s*["']?true/i.test(l)) out.push({ rule: "sec/iac-public-database", path, line: i + 1, detail: "PubliclyAccessible: true", severity: "critical" });
    if (/AccessControl:\s*PublicRead|PublicAccessBlockConfiguration/.test(l) && /PublicRead/.test(l)) out.push({ rule: "sec/iac-public-storage", path, line: i + 1, detail: l });
    if (/CidrIpv?6?:\s*["']?(?:0\.0\.0\.0\/0|::\/0)/.test(l)) {
      const ctx = lines.slice(Math.max(0, i - 6), i + 6).join("\n");
      const from = Number(/FromPort:\s*["']?(-?\d+)/.exec(ctx)?.[1] ?? -1);
      if (from === -1 || from === 0 || SENSITIVE_PORTS.has(from)) out.push({ rule: "sec/iac-open-ingress", path, line: i + 1, detail: `open to the internet${from > 0 ? ` on port ${from}` : ""}` });
    }
    if (/(?:StorageEncrypted|Encrypted):\s*["']?false/i.test(l)) out.push({ rule: "sec/iac-no-encryption", path, line: i + 1, detail: l });
    if (/Action:\s*["']\*["']/.test(l) && lines.slice(Math.max(0, i - 6), i + 6).some((x) => /Resource:\s*["']\*["']/.test(x))) out.push({ rule: "sec/iac-wildcard-iam", path, line: i + 1, detail: "Action * on Resource *" });
  });
  return out;
}
