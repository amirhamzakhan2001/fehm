/**
 * A small YAML reader for deployment configuration (docker-compose,
 * Kubernetes manifests, CI workflows, platform files). It covers block
 * mappings and sequences, compact `- key: value` items, flow collections
 * (`[a, b]`, `{a: b}`), quoted scalars, block scalars (`|`, `>`), comments
 * and `---` documents. Anchors/aliases and tags are read as plain text. It
 * never throws: malformed input yields whatever structure was readable.
 */

export type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml };

interface Line {
  indent: number;
  text: string;
}

export function parseYamlDocuments(source: string): Yaml[] {
  const docs: string[][] = [[]];
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^---(\s|$)/.test(raw)) {
      docs.push([]);
      continue;
    }
    if (/^\.\.\.\s*$/.test(raw)) continue;
    docs[docs.length - 1]!.push(raw);
  }
  return docs.map(parseDoc).filter((d) => d !== null);
}

export function parseYaml(source: string): Yaml {
  return parseYamlDocuments(source)[0] ?? null;
}

function stripComment(s: string): string {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]!;
    if (quote) {
      if (c === quote && s[i - 1] !== "\\") quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]!))) return s.slice(0, i);
  }
  return s;
}

function parseDoc(rawLines: string[]): Yaml {
  const lines: (Line & { raw: string })[] = [];
  for (const raw of rawLines) {
    const noTabs = raw.replace(/\t/g, "  ");
    const text = stripComment(noTabs).trimEnd();
    if (!text.trim()) {
      lines.push({ indent: -1, text: "", raw: noTabs });
      continue;
    }
    lines.push({ indent: text.length - text.trimStart().length, text: text.trim(), raw: noTabs });
  }
  let i = 0;
  const skipBlank = (): void => {
    while (i < lines.length && lines[i]!.indent < 0) i += 1;
  };

  const blockScalar = (parentIndent: number, folded: boolean): string => {
    const out: string[] = [];
    let base = -1;
    while (i < lines.length) {
      const l = lines[i]!;
      const ind = l.raw.length - l.raw.trimStart().length;
      if (l.raw.trim() && ind <= parentIndent) break;
      if (l.raw.trim() && base < 0) base = ind;
      out.push(l.raw.trim() ? l.raw.slice(Math.max(0, base)) : "");
      i += 1;
    }
    return (folded ? out.join(" ") : out.join("\n")).trim();
  };

  const value = (text: string, indent: number): Yaml => {
    const t = text.trim();
    if (t === "|" || t === "|-" || t === "|+") return blockScalar(indent, false);
    if (t === ">" || t === ">-" || t === ">+") return blockScalar(indent, true);
    if (!t) {
      skipBlank();
      const next = lines[i];
      if (next && (next.indent > indent || (next.indent === indent && next.text.startsWith("- ")) || (next.indent === indent && next.text === "-"))) return block(next.indent);
      return null;
    }
    return scalarOrFlow(t);
  };

  function block(indent: number): Yaml {
    skipBlank();
    const first = lines[i];
    if (!first) return null;
    if (first.text === "-" || first.text.startsWith("- ")) {
      const list: Yaml[] = [];
      while (i < lines.length) {
        skipBlank();
        const l = lines[i];
        if (!l || l.indent !== indent || !(l.text === "-" || l.text.startsWith("- "))) break;
        const rest = l.text === "-" ? "" : l.text.slice(2);
        const restTrim = rest.trimStart();
        const itemIndent = indent + 2 + (rest.length - restTrim.length);
        if (restTrim && keyValue(restTrim) && !/^["'[{]/.test(restTrim)) {
          // `- key: value` starts a mapping whose keys align with `key`.
          lines[i] = { indent: itemIndent, text: restTrim, raw: `${" ".repeat(itemIndent)}${restTrim}` };
          list.push(mapping(itemIndent));
        } else {
          i += 1;
          list.push(value(restTrim, indent));
        }
      }
      return list;
    }
    return mapping(indent);
  }

  function mapping(indent: number): Yaml {
    const obj: { [key: string]: Yaml } = {};
    while (i < lines.length) {
      skipBlank();
      const l = lines[i];
      if (!l || l.indent !== indent || l.text.startsWith("- ") || l.text === "-") break;
      const kv = keyValue(l.text);
      i += 1;
      if (!kv) continue;
      obj[kv.key] = value(kv.rest, indent);
    }
    return obj;
  }

  skipBlank();
  if (i >= lines.length) return null;
  const top = lines[i]!;
  if (!keyValue(top.text) && !top.text.startsWith("-")) return scalarOrFlow(top.text);
  return block(top.indent);
}

function keyValue(text: string): { key: string; rest: string } | undefined {
  const m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s:{}[\],#][^:]*?)\s*:(?:\s+(.*)|$)/.exec(text);
  if (!m) return undefined;
  return { key: unquote(m[1]!.trim()), rest: (m[2] ?? "").replace(/^&\S+\s*/, "") };
}

function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function scalarOrFlow(t: string): Yaml {
  const s = t.replace(/^!\S+\s+/, "").replace(/^&\S+\s+/, "");
  if (s.startsWith("[") && s.endsWith("]")) return splitFlow(s.slice(1, -1)).map((x) => scalarOrFlow(x));
  if (s.startsWith("{") && s.endsWith("}")) {
    const obj: { [key: string]: Yaml } = {};
    for (const part of splitFlow(s.slice(1, -1))) {
      const kv = keyValue(part) ?? { key: part.replace(/:$/, ""), rest: "" };
      obj[kv.key] = kv.rest ? scalarOrFlow(kv.rest) : null;
    }
    return obj;
  }
  if (/^["']/.test(s)) return unquote(s);
  if (s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (/^(true|True|TRUE|yes|on)$/.test(s)) return true;
  if (/^(false|False|FALSE|no|off)$/.test(s)) return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function splitFlow(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const c of s) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    if (c === "[" || c === "{") depth += 1;
    if (c === "]" || c === "}") depth -= 1;
    if (c === "," && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ─── typed accessors ────────────────────────────────────────────────

export function obj(v: Yaml | undefined): { [key: string]: Yaml } {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

export function arr(v: Yaml | undefined): Yaml[] {
  return Array.isArray(v) ? v : [];
}

export function str(v: Yaml | undefined): string | undefined {
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : undefined;
}
