import { edgeId, fileId, firstSentence, symbolId } from "./ids.js";
import { ANALYSIS_VERSION, type FileAnalysis, type GraphEdge, type GraphNode, type ScannedFile } from "./model.js";

/**
 * Markdown headings become `section` nodes nested by level (file defines the
 * top-level sections, a section defines its sub-sections). Relative links to
 * repository paths become pending `references`, resolved exactly by the linker.
 * Headings inside fenced code blocks are ignored.
 */
export function analyzeMarkdownFile(file: ScannedFile, text: string): FileAnalysis {
  const analysis: FileAnalysis = {
    path: file.path,
    hash: file.hash,
    analysisVersion: ANALYSIS_VERSION,
    language: file.language,
    resolution: "ast",
    nodes: [],
    edges: [],
    unresolved: [],
    pending: [],
    dependsOn: [],
    diagnostics: [],
  };
  const lines = text.split(/\r?\n/);
  const fid = fileId(file.path);
  const headings: { level: number; title: string; line: number; id: string }[] = [];
  const used = new Map<string, number>();
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const f = /^\s*(```|~~~)/.exec(line);
    if (f) {
      fence = fence === f[1] ? undefined : fence ?? f[1];
      continue;
    }
    if (fence) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    const title = h[2]!.replace(/`/g, "").trim();
    const n = (used.get(title) ?? 0) + 1;
    used.set(title, n);
    headings.push({ level: h[1]!.length, title, line: i, id: symbolId("section", file.path, n > 1 ? `${title} (${n})` : title) });
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const stack: { level: number; id: string }[] = [];
  for (let k = 0; k < headings.length; k += 1) {
    const h = headings[k]!;
    let end = lines.length - 1;
    for (let j = k + 1; j < headings.length; j += 1) {
      if (headings[j]!.level <= h.level) {
        end = headings[j]!.line - 1;
        break;
      }
    }
    while (stack.length && stack.at(-1)!.level >= h.level) stack.pop();
    const parent = stack.at(-1)?.id ?? fid;
    stack.push({ level: h.level, id: h.id });
    const location = { path: file.path, line: h.line + 1, endLine: end + 1 };
    const firstPara = lines.slice(h.line + 1, Math.min(end + 1, h.line + 8)).find((l) => l.trim() && !/^\s*(#|```|~~~|\||[-*]\s|>)/.test(l));
    const node: GraphNode = {
      id: h.id,
      kind: "section",
      name: h.title,
      path: file.path,
      language: file.language,
      location,
      signature: `${"#".repeat(h.level)} ${h.title}`,
      isTest: file.isTest,
      evidence: { provenance: "ast", confidence: 1, location },
    };
    const doc = firstPara ? firstSentence(firstPara.replace(/[*_`]/g, "")) : undefined;
    if (doc) node.doc = doc;
    nodes.push(node);
    edges.push({ id: edgeId("defines", parent, h.id), kind: "defines", source: parent, target: h.id, evidence: { provenance: "ast", confidence: 1, location } });
  }

  // Links to repository paths, attributed to the section they appear in.
  const owner = (line: number): string => {
    let id = fid;
    for (const h of headings) if (h.line <= line) id = h.id;
    return id;
  };
  fence = undefined;
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const f = /^\s*(```|~~~)/.exec(lines[i]!);
    if (f) {
      fence = fence === f[1] ? undefined : fence ?? f[1];
      continue;
    }
    if (fence) continue;
    for (const m of lines[i]!.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const target = m[1]!;
      if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue; // URLs, mailto:, anchors
      const from = owner(i);
      const key = `${from}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      analysis.pending.push({ kind: "references", fromNode: from, name: target, location: { path: file.path, line: i + 1 }, provenance: "ast", detail: "markdown link" });
    }
  }
  analysis.nodes = nodes.sort((a, b) => (a.id < b.id ? -1 : 1));
  analysis.edges = edges.sort((a, b) => (a.id < b.id ? -1 : 1));
  return analysis;
}
