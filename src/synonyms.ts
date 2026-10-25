/**
 * Deterministic synonym groups — Fehm's LLM-free "semantic" signal.
 *
 * Upstream: rohitg00/agentmemory @ bcf4f0d00d1c71e9221287a4778e4122ce2d7574
 * File:     src/state/synonyms.ts  (Apache-2.0; attribution in THIRD_PARTY_NOTICES.md)
 * Changes:  import path; added FEHM_SYNONYM_GROUPS (code-domain groups, marked
 *           below) which are registered by the same loop as the upstream groups.
 */
import { stem } from "./stemmer.js";

const SYNONYM_GROUPS: string[][] = [
  ["auth", "authentication", "authn", "authenticating"],
  ["authz", "authorization", "authorizing"],
  ["db", "database", "datastore"],
  ["perf", "performance", "latency", "throughput", "slow", "bottleneck"],
  ["optim", "optimization", "optimizing", "optimise", "query-optimization"],
  ["k8s", "kubernetes", "kube"],
  ["config", "configuration", "configuring", "setup"],
  ["deps", "dependencies", "dependency"],
  ["env", "environment"],
  ["fn", "function"],
  ["impl", "implementation", "implementing"],
  ["msg", "message", "messaging"],
  ["repo", "repository"],
  ["req", "request"],
  ["res", "response"],
  ["ts", "typescript"],
  ["js", "javascript"],
  ["pg", "postgres", "postgresql"],
  ["err", "error", "errors"],
  ["api", "endpoint", "endpoints"],
  ["ci", "continuous-integration"],
  ["cd", "continuous-deployment"],
  ["test", "testing", "tests"],
  ["doc", "documentation", "docs"],
  ["infra", "infrastructure"],
  ["deploy", "deployment", "deploying"],
  ["cache", "caching", "cached"],
  ["log", "logging", "logs"],
  ["monitor", "monitoring"],
  ["observe", "observability"],
  ["sec", "security", "secure"],
  ["validate", "validation", "validating"],
  ["migrate", "migration", "migrations"],
  ["debug", "debugging"],
  ["container", "containerization", "docker"],
  ["crash", "crashloop", "crashloopbackoff"],
  ["webhook", "webhooks", "callback"],
  ["middleware", "mw"],
  ["paginate", "pagination"],
  ["serialize", "serialization"],
  ["encrypt", "encryption"],
  ["hash", "hashing"],
];

// Fehm addition: code-domain groups not covered upstream.
const FEHM_SYNONYM_GROUPS: string[][] = [
  ["login", "signin", "logon", "auth"],
  ["pay", "payment", "billing", "checkout", "charge"],
  ["user", "account", "profile"],
  ["conn", "connection", "connect", "pool"],
  ["handler", "controller", "route", "router"],
  ["util", "utility", "helper"],
  ["session", "token", "jwt"],
];

const synonymMap = new Map<string, Set<string>>();

for (const group of [...SYNONYM_GROUPS, ...FEHM_SYNONYM_GROUPS]) {
  const stemmed = group.map(t => stem(t.toLowerCase()));
  for (const s of stemmed) {
    if (!synonymMap.has(s)) synonymMap.set(s, new Set());
    for (const other of stemmed) {
      if (other !== s) synonymMap.get(s)!.add(other);
    }
  }
}

export function getSynonyms(stemmedTerm: string): string[] {
  const syns = synonymMap.get(stemmedTerm);
  return syns ? [...syns] : [];
}
