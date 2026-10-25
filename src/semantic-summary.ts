import { spawn } from "node:child_process";
import { join } from "node:path";
import type { CodeGraph } from "./graph.js";
import { SUMMARY_VERSION } from "./model.js";
import { readJson, stateDir, writeJsonAtomic } from "./persistence.js";

/**
 * Optional, opt-in semantic summaries produced by a caller-supplied provider.
 * Nothing in Feature 1 calls a provider implicitly; basic operation never
 * needs one. Each cached summary records its model and the content hash of
 * the source file it was generated from, and is reported stale as soon as that
 * hash (or SUMMARY_VERSION) changes.
 */
export interface SummaryProvider {
  /** Provider identifier, e.g. "command". */
  name: string;
  /** Model identifier as reported by the provider. */
  model: string;
  summarize(prompt: string): Promise<string>;
}

export interface SemanticSummary {
  nodeId: string;
  text: string;
  provider: string;
  model: string;
  sourceHash: string;
  summaryVersion: string;
  createdAt: string;
}

export type SummaryStatus = "fresh" | "stale" | "missing";

interface SummaryStore {
  summaryVersion: string;
  entries: Record<string, SemanticSummary>;
}

const storePath = (root: string, dir?: string): string => join(stateDir(root, dir), "summaries.json");

export function loadSummaries(root: string, dir?: string): Record<string, SemanticSummary> {
  const read = readJson<SummaryStore>(storePath(root, dir));
  if (!read.ok || typeof read.value?.entries !== "object" || read.value.entries === null) return {};
  return read.value.entries;
}

export function summaryStatus(entry: SemanticSummary | undefined, currentHash: string | undefined): SummaryStatus {
  if (!entry) return "missing";
  return entry.summaryVersion === SUMMARY_VERSION && currentHash !== undefined && entry.sourceHash === currentHash ? "fresh" : "stale";
}

/** Node ids whose cached semantic summary no longer matches the source (or whose node is gone). */
export function staleSummaryNodes(root: string, graph: CodeGraph, hashes: ReadonlyMap<string, string>, dir?: string): string[] {
  const out: string[] = [];
  for (const [id, entry] of Object.entries(loadSummaries(root, dir))) {
    const node = graph.node(id);
    const hash = node?.path ? hashes.get(node.path) : undefined;
    if (summaryStatus(entry, hash) !== "fresh") out.push(id);
  }
  return out.sort();
}

/** A fresh semantic summary for a node, or undefined. Stale entries are never returned. */
export function freshSemanticSummary(
  summaries: Record<string, SemanticSummary>,
  nodeId: string,
  currentHash: string | undefined,
): SemanticSummary | undefined {
  const entry = summaries[nodeId];
  return summaryStatus(entry, currentHash) === "fresh" ? entry : undefined;
}

export interface GenerateResult {
  generated: string[];
  reused: string[];
  failed: { nodeId: string; error: string }[];
}

/**
 * Generate and cache summaries for the given nodes. Fresh cache entries are
 * reused; provider failures are collected, never thrown.
 */
export async function generateSemanticSummaries(
  root: string,
  requests: { nodeId: string; prompt: string; sourceHash: string }[],
  provider: SummaryProvider,
  dir?: string,
): Promise<GenerateResult> {
  const entries = loadSummaries(root, dir);
  const result: GenerateResult = { generated: [], reused: [], failed: [] };
  for (const req of requests) {
    if (summaryStatus(entries[req.nodeId], req.sourceHash) === "fresh") {
      result.reused.push(req.nodeId);
      continue;
    }
    try {
      const text = (await provider.summarize(req.prompt)).trim().slice(0, 600);
      if (!text) throw new Error("provider returned empty text");
      entries[req.nodeId] = {
        nodeId: req.nodeId,
        text,
        provider: provider.name,
        model: provider.model,
        sourceHash: req.sourceHash,
        summaryVersion: SUMMARY_VERSION,
        createdAt: new Date().toISOString(),
      };
      result.generated.push(req.nodeId);
    } catch (error) {
      result.failed.push({ nodeId: req.nodeId, error: (error as Error).message });
    }
  }
  writeJsonAtomic(storePath(root, dir), { summaryVersion: SUMMARY_VERSION, entries } satisfies SummaryStore);
  return result;
}

export function summaryPrompt(deterministic: string, excerpt: string): string {
  return [
    "Summarize what this code does in at most two sentences. State only what the code shows.",
    "",
    `Structure: ${deterministic}`,
    "",
    "Source:",
    excerpt,
  ].join("\n");
}

/**
 * Provider that pipes the prompt to a user-configured shell command and reads
 * the summary from stdout (e.g. a local model CLI). Explicit opt-in only.
 */
export function commandProvider(command: string, model = command, timeoutMs = 60_000): SummaryProvider {
  return {
    name: "command",
    model,
    summarize: (prompt) =>
      new Promise((resolvePromise, reject) => {
        const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
        let out = "";
        let err = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        child.stdout.on("data", (d: Buffer) => (out += d.toString()));
        child.stderr.on("data", (d: Buffer) => (err += d.toString()));
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolvePromise(out);
          else reject(new Error(`exit ${code}: ${err.trim().slice(0, 200)}`));
        });
        child.stdin.end(prompt);
      }),
  };
}
