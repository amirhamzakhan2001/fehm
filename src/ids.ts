import type { EdgeKind, NodeKind } from "./model.js";

export const repositoryId = (): string => "repository:.";
export const directoryId = (path: string): string => `directory:${path}`;
export const fileId = (path: string): string => `file:${path}`;
export const packageId = (name: string): string => `package:${name}`;
export const symbolId = (kind: NodeKind, path: string, qualifiedName: string): string =>
  `${kind}:${path}#${qualifiedName}`;
export const edgeId = (kind: EdgeKind, source: string, target: string): string => `${kind}|${source}|${target}`;

/** File path encoded in a file or symbol id, if any. */
export function pathOfId(id: string): string | undefined {
  const colon = id.indexOf(":");
  if (colon < 0) return undefined;
  const kind = id.slice(0, colon);
  if (kind === "repository" || kind === "directory" || kind === "package") return undefined;
  const rest = id.slice(colon + 1);
  const hash = rest.indexOf("#");
  return hash < 0 ? rest : rest.slice(0, hash);
}

/** Truncate a doc comment to its first sentence, bounded. */
export function firstSentence(text: string, max = 160): string | undefined {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  const match = /^(.+?[.!?])(\s|$)/.exec(clean);
  const sentence = match ? match[1]! : clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}
