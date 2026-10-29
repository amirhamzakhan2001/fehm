import { createHash } from 'node:crypto';
import ts from 'typescript';
import { blob } from './git.js';
import type { FileChange, HistoryCategory, MemoryEvent } from './types.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 20);
interface SymbolFact { name: string; fingerprint: string; line: number }
function symbols(path: string, text: string): SymbolFact[] {
  if (!/\.[cm]?[jt]sx?$/.test(path)) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: SymbolFact[] = [];
  function walk(node: ts.Node, scope: string) {
    const named = node as ts.NamedDeclaration;
    const declaration = ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isVariableDeclaration(node);
    const name = declaration && named.name ? `${scope}${named.name.getText(source)}` : '';
    if (name) found.push({ name, fingerprint: hash(node.getText(source)), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    ts.forEachChild(node, child => walk(child, name && (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) ? `${name}.` : scope));
  }
  walk(source, ''); return found;
}
export function semanticChanges(root: string, before: string | null, after: string, files: FileChange[]): { events: MemoryEvent[]; warnings: string[] } {
  const events: MemoryEvent[] = [], warnings: string[] = [];
  const emit = (f: FileChange, category: HistoryCategory, type: string, entity: string, old: string | null, next: string | null, provenance: MemoryEvent['provenance'], evidence: string) => {
    events.push({ id: hash([after, f.path, type, entity, old, next].join('\0')), commit: after, category, type, path: f.path, entity, before: old, after: next, provenance, confidence: provenance === 'heuristic' ? 0.65 : 1, evidence });
  };
  for (const f of files.slice(0, 300)) {
    const action = f.status[0] === 'A' ? 'CREATED' : f.status[0] === 'D' ? 'DELETED' : f.oldPath ? 'MOVED' : 'MODIFIED';
    emit(f, 'code', `FILE_${action}`, f.path, action === 'CREATED' ? null : f.oldPath ?? f.path, action === 'DELETED' ? null : f.path, 'git', `Git ${f.status}; compared with ${before ?? 'empty tree'}`);
    const hints: [HistoryCategory, RegExp][] = [
      ['tests', /(^|\/)(__tests__|tests?|spec)(\/|\.)|[._](test|spec)\./i], ['prompts', /prompt|instruction/i],
      ['security', /auth|secur|permission|guard/i], ['database', /migration|schema|database/i],
      ['architecture', /architect|repository|middleware|service/i], ['api', /route|controller|api\//i],
      ['ai', /agent|llm|embedding|retriev|rag\b/i], ['documentation', /\.(md|rst)$/i],
      ['configuration', /\.(ya?ml|toml|json)$/i],
    ];
    for (const [category, pattern] of hints) if (pattern.test(f.path)) emit(f, category, `${category.toUpperCase()}_FILE_${action}`, f.path, null, null, 'heuristic', `Path matches ${category} convention; does not establish behavior or a finding lifecycle`);
    try {
      const old = f.status[0] === 'A' ? '' : blob(root, before, f.oldPath ?? f.path);
      const next = f.status[0] === 'D' ? '' : blob(root, after, f.path);
      const a = new Map(symbols(f.oldPath ?? f.path, old).map(s => [s.name, s]));
      const b = new Map(symbols(f.path, next).map(s => [s.name, s]));
      for (const name of new Set([...a.keys(), ...b.keys()])) {
        const x = a.get(name), y = b.get(name);
        if (x?.fingerprint === y?.fingerprint && !f.oldPath) continue;
        const type = !x ? 'SYMBOL_CREATED' : !y ? 'SYMBOL_DELETED' : f.oldPath && x.fingerprint === y.fingerprint ? 'SYMBOL_MOVED' : 'SYMBOL_MODIFIED';
        emit(f, 'code', type, name, x?.fingerprint ?? null, y?.fingerprint ?? null, 'ast', `Declaration syntax at ${f.path}:${y?.line ?? x?.line}; exact source fingerprint`);
      }
      if (/(^|\/)package.json$/.test(f.path)) {
        const dependencies = (s: string): Map<string, string> => {
          const p = s ? JSON.parse(s) as Record<string, unknown> : {};
          const entries: [string, string][] = [];
          for (const kind of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
            const group = p[kind];
            if (group && typeof group === 'object') for (const [key, value] of Object.entries(group)) if (typeof value === 'string') entries.push([`${kind}:${key}`, value]);
          }
          return new Map(entries);
        };
        const x = dependencies(old), y = dependencies(next);
        for (const name of new Set([...x.keys(), ...y.keys()])) if (x.get(name) !== y.get(name)) emit(f, 'dependencies', !x.has(name) ? 'DEPENDENCY_ADDED' : !y.has(name) ? 'DEPENDENCY_REMOVED' : 'DEPENDENCY_VERSION_CHANGED', name, x.get(name) ?? null, y.get(name) ?? null, 'ast', 'Parsed package.json declared version; not an installed version or upgrade claim');
      }
      if (/(^|\/)(adr|decisions)\/.*\.(md|txt)$/i.test(f.path)) emit(f, 'architecture', 'DOCUMENTED_DECISION_CHANGED', f.path, old ? hash(old) : null, next ? hash(next) : null, 'git', 'Versioned decision document changed; rationale remains in the source document');
    } catch (e) { warnings.push(`${f.path}: ${(e as Error).message.split('\n')[0]}`); }
  }
  if (files.length > 300) warnings.push('Semantic analysis limited to first 300 changed files');
  return { events, warnings };
}
