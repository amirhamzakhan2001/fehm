import ts from 'typescript';
import { pythonPrompts } from './python.js';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { FehmEngine } from '../engine.js';
import type { BriefingFacts } from '../codebase-briefing/facts.js';
import { redactLine } from '../security/secrets.js';
import type { PromptFragment, PromptRecord, PromptRole, PromptReport } from './types.js';
export const digest = (s: string): string => createHash('sha256').update(s).digest('hex');
const AI_CALL = /(?:\.(?:chat\.completions\.create|completions\.create|responses\.create|messages\.(?:create|stream)|generateContent|generate_content|invoke_model|converse)|\b(?:generateText|streamText|generateObject|streamObject)|\b(?:llm|model|chain|agent|assistant|ai_service|llm_service)\.(?:invoke|ainvoke|generate|complete|run|ask))$/;
const PROMPT_NAME = /prompt|instructions|system_message/i;
const role = (s: string): PromptRole => ['system', 'developer', 'assistant', 'tool', 'context'].includes(s) ? s as PromptRole : 'user';
interface Resolved {
    fragments: PromptFragment[];
    complete: boolean;
}
interface Unit {
    sf: ts.SourceFile;
    path: string;
    bindings: Map<string, ts.Node[]>;
    writes: Map<string, ts.Node[]>;
    imports: Map<string, {
        path: string;
        name: string;
    }>;
}
/** Uses only indexed source and graph references; never walks the repository a second time. */
export function discoverPrompts(engine: FehmEngine, facts: BriefingFacts): {
    prompts: PromptRecord[];
    coverage: PromptReport['coverage'];
} {
    const prompts: PromptRecord[] = [];
    const coverage: PromptReport['coverage'] = { astFiles: 0, heuristicFiles: 0, templateFiles: 0, unsupportedFiles: 0, semantic: 'not-run', behavioral: 'not-run' };
    const units = new Map<string, Unit>();
    for (const file of facts.files) {
        if (file.role === 'test')
            continue;
        if (!/\.[cm]?[jt]sx?$/.test(file.path) || /\.d\.[cm]?ts$/.test(file.path))
            continue;
        const sf = ts.createSourceFile(file.path, facts.lines(file.path).join('\n'), ts.ScriptTarget.Latest, true, /tsx$/.test(file.path) ? ts.ScriptKind.TSX : /jsx$/.test(file.path) ? ts.ScriptKind.JSX : ts.ScriptKind.TS);
        const u: Unit = { sf, path: file.path, bindings: new Map(), writes: new Map(), imports: new Map() };
        const walk = (n: ts.Node): void => {
            if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name))
                u.bindings.set(n.name.text, [...(u.bindings.get(n.name.text) ?? []), n]);
            let written: string | undefined;
            if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
                written = n.left.getText(sf).split(/[.\[]/)[0];
            if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^(push|unshift|splice|pop|shift|sort|reverse)$/.test(n.expression.name.text))
                written = n.expression.expression.getText(sf);
            if (written)
                u.writes.set(written, [...(u.writes.get(written) ?? []), n]);
            if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.startsWith('.')) {
                const base = posix.normalize(posix.join(posix.dirname(file.path), n.moduleSpecifier.text));
                const target = [base, ...['.ts', '.tsx', '.js', '/index.ts', '/index.js'].map(e => base.replace(/\.js$/, '') + e)].find(p => engine.fileHashes().has(p));
                const named = n.importClause?.namedBindings;
                if (target && named && ts.isNamedImports(named))
                    for (const e of named.elements)
                        u.imports.set(e.name.text, { path: target, name: (e.propertyName ?? e.name).text });
            }
            ts.forEachChild(n, walk);
        };
        walk(sf);
        units.set(file.path, u);
    }
    const enclosingScope = (n: ts.Node): ts.Node => { let p = n.parent; while (p && !ts.isSourceFile(p) && !ts.isBlock(p) && !ts.isFunctionLike(p))
        p = p.parent; return p; };
    const ancestor = (scope: ts.Node, n: ts.Node): boolean => { for (let p: ts.Node | undefined = n; p; p = p.parent)
        if (p === scope)
            return true; return false; };
    const binding = (u: Unit, name: string, at: ts.Node): ts.Node | undefined => (u.bindings.get(name) ?? []).filter(n => ancestor(enclosingScope(n), at)).sort((a, b) => b.pos - a.pos)[0];
    const resolve = (u: Unit, n: ts.Node | undefined, r: PromptRole = 'user', seen = new Set<ts.Node>()): Resolved => {
        if (!n || seen.has(n) || seen.size > 60)
            return { fragments: [], complete: false };
        const next = new Set(seen).add(n);
        const line = u.sf.getLineAndCharacterOfPosition(n.getStart(u.sf)).line + 1;
        const fragment = (text: string, complete = true): Resolved => ({ fragments: [{ role: r, text, path: u.path, line, resolved: complete }], complete });
        const recurse = (node: ts.Node | undefined, rr = r): Resolved => resolve(u, node, rr, next);
        const merge = (list: Resolved[]): Resolved => ({ fragments: list.flatMap(x => x.fragments), complete: list.every(x => x.complete) });
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
            return fragment(n.text);
        if (ts.isTemplateExpression(n))
            return fragment(n.head.text + n.templateSpans.map(s => '${' + s.expression.getText(u.sf) + '}' + s.literal.text).join(''));
        if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isAwaitExpression(n))
            return recurse(n.expression);
        if (ts.isIdentifier(n)) {
            const b = binding(u, n.text, n);
            if (b && ts.isVariableDeclaration(b) && b.initializer) {
                if ((u.writes.get(n.text) ?? []).some(w => w.pos > b.pos && w.pos < n.pos && ancestor(enclosingScope(w), n)))
                    return fragment('${' + n.text + ' (modified at runtime)}', false);
                return recurse(b.initializer);
            }
            const imp = u.imports.get(n.text), other = imp && units.get(imp.path);
            if (other && imp) {
                const decl = (other.bindings.get(imp.name) ?? []).find(x => ts.isSourceFile(enclosingScope(x)));
                if (decl && ts.isVariableDeclaration(decl))
                    return resolve(other, decl.initializer, r, next);
            }
            return fragment('${' + n.text + '}', false);
        }
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const a = recurse(n.left), b = recurse(n.right);
            if (b.fragments[0])
                b.fragments[0].separator = "";
            return { complete: a.complete && b.complete, fragments: [...a.fragments, ...b.fragments] };
        }
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'join') {
            const result = recurse(n.expression.expression);
            const delimiter = n.arguments[0];
            if (delimiter && ts.isStringLiteral(delimiter) && (delimiter.text === '' || delimiter.text === '\n')) {
                for (const f of result.fragments.slice(1)) f.separator = delimiter.text;
                return result;
            }
            return {...result, complete:false};
        }
        if (ts.isCallExpression(n) && n.expression.getText(u.sf) === 'JSON.stringify' && n.arguments[0]) {
            const result = recurse(n.arguments[0]);
            return {fragments:result.fragments.map(f=>({...f,role:'user'})),complete:false};
        }
        if (ts.isArrayLiteralExpression(n))
            return merge(n.elements.map(e => recurse(e)));
        if (ts.isObjectLiteralExpression(n)) {
            const props = n.properties.filter(ts.isPropertyAssignment);
            const get = (k: string): ts.Expression | undefined => props.find(p => p.name.getText(u.sf).replace(/["']/g, '') === k)?.initializer ?? n.properties.filter(ts.isShorthandPropertyAssignment).find(p => p.name.text === k)?.name;
            const rr = get('role');
            const content = get('content');
            if (content) {
                const result = recurse(content, rr && ts.isStringLiteral(rr) ? role(rr.text) : r);
                if (rr && !ts.isStringLiteral(rr))
                    result.complete = false;
                return result;
            }
            const result = merge(props.filter(p => /^(messages|prompt|input|contents|system|system_prompt|instructions|instruction)$/.test(p.name.getText(u.sf).replace(/["']/g, ''))).map(p => recurse(p.initializer, /system/.test(p.name.getText()) ? 'system' : /instructions/.test(p.name.getText()) ? 'developer' : r)));
            if (n.properties.some(ts.isSpreadAssignment))
                result.complete = false;
            for (const prop of n.properties.filter(ts.isShorthandPropertyAssignment))
                if (/^(messages|prompt|input|contents|system|system_prompt|instructions|instruction)$/.test(prop.name.text)) {
                    const resolved = recurse(prop.name, /system/.test(prop.name.text) ? 'system' : prop.name.text === 'instructions' ? 'developer' : r);
                    result.fragments.push(...resolved.fragments);
                    result.complete = result.complete && resolved.complete;
                }
            return result;
        }
        return fragment('${' + n.getText(u.sf).slice(0, 160) + '}', false);
    };
    const add = (path: string, line: number, call: string, fragments: PromptFragment[], complete: boolean, context: string, confidence: number, span?: PromptRecord['sourceSpan'], callContext = context, parserEvidence?: boolean): void => {
        const nodes = facts.symbolsIn(path).filter(n => ['function', 'method'].includes(n.kind) && n.location && n.location.line <= line && (n.location.endLine ?? n.location.line) >= line).sort((a, b) => (a.location!.endLine ?? a.location!.line) - a.location!.line - ((b.location!.endLine ?? b.location!.line) - b.location!.line));
        const owner = nodes[0];
        const deps = engine.graph.edgesOf(owner?.id ?? `file:${path}`, 'both', ['calls', 'references', 'uses', 'imports']).map(e => ({ nodeId: e.source === owner?.id || e.source === `file:${path}` ? e.target : e.source, edgeId: e.id, relation: e.kind }));
        const safeFragments = fragments.map(f => ({ ...f, text: f.text.split('\n').map(redactLine).join('\n') }));
        const joined = (fs: PromptFragment[]): string => fs.map((f, i) => (i ? f.separator ?? '\n' : '') + f.text).join('');
        const text = joined(safeFragments);
        const vars = [...new Set([...text.matchAll(/\$\{([^}]+)\}|\{\{\s*([^}]+?)\s*\}\}|(?<!\{)\{([a-zA-Z_]\w*)\}(?!\})/g)].map(m => (m[1] ?? m[2] ?? m[3])!.trim()))];
        const boundary = /request\.|req\.|user_input|userInput|email|document|retriev/i;
        const tools = /\btools\s*[:=]/.test(callContext) ? [...callContext.matchAll(/\bname\s*[:=]\s*["']([^"']+)["']/g)].map(m => m[1]!) : [];
        if (/\btools\s*[:=]/.test(callContext) && !tools.length)
            tools.push('configured tools (names unresolved)');
        const format = (parserEvidence ?? /JSON\.parse\(|json\.loads\(/.test(context)) ? 'json' : 'unknown';
        const enforced = /\bresponse_format\s*[:=][\s\S]{0,200}\b(?:json_schema|json_object)\b|\bjson_schema\s*[:=]|\bwith_structured_output\s*\(|\b(?:generateObject|streamObject)\s*\(/.test(callContext);
        const pkg = facts.packages.filter(p => p.importers.includes(path)).map(p => p.name).find(n => /openai|anthropic|genai|generative|ollama|mistral|groq|cohere|bedrock|langchain|together|vllm/.test(n));
        const id = 'P-' + digest(`${path}:${owner?.id ?? ''}:${line}:${call}`).slice(0, 12);
        const behavioral = safeFragments.some(f => ['system', 'developer'].includes(f.role) && f.text.trim() && f.resolved);
        const p: PromptRecord = {
            id, name: owner?.name ?? posix.basename(path), path, line, fileId: `file:${path}`, ...(owner ? { functionId: owner.id } : {}), call,
            provider: pkg ?? 'unknown/custom', model: /\bmodel(?:Id|_id)?["']?\s*[:=]\s*["']([^"']+)["']/.exec(callContext)?.[1] ?? null,
            kind: tools.length || /agent/i.test(call) ? 'agent' : /retriev|context|sources/i.test(text) ? 'rag' : /classif|categor|sentiment/i.test(text) ? 'classification' : /extract/i.test(text) ? 'extraction' : /transcrib|image|audio|video/i.test(context) ? 'multimodal' : /code|debug/i.test(text) ? 'code' : /moderate|policy|guardrail/i.test(text) ? 'guardrail' : 'generation',
            confidence, reconstruction: complete ? 'complete' : 'partial', fragments: safeFragments, text,
            variables: vars.map(name => ({ name, origin: name, trust: boundary.test(name) ? 'untrusted' : 'unknown', path, line })),
            behavioralInstruction: behavioral ? 'present' : complete ? 'not-detected' : 'unknown', tools,
            outputContract: { format: enforced ? 'json' : format, enforced, evidence: format === 'json' ? ['JSON parser in enclosing function; data association requires review.'] : enforced ? ['Structured output configuration in call context.'] : [] },
            dependencies: deps, testFiles: [...new Set(deps.map(d => engine.graph.node(d.nodeId)?.path).filter((p): p is string => !!p && facts.testFiles.includes(p)))],
            securityFindingIds: [], ontologyNodeIds: [],
            findings: [], score: { static: 0, semantic: null, behavioral: null, composite: 0, dimensions: [], band: 'not evaluated' },
            tokens: { estimated: true, method: 'ceil(UTF-8 bytes / 4); not a model tokenizer', static: 0, dynamic: null, stablePrefix: 0, total: null },
            ...(span && text === joined(fragments) ? { sourceSpan: span } : {}),
        };
        prompts.push(p);
    };
    for (const u of units.values()) {
        coverage.astFiles++;
        const used = new Set<ts.Node>();
        const walk = (n: ts.Node): void => {
            if (ts.isCallExpression(n) && AI_CALL.test(n.expression.getText(u.sf))) {
                const arg = n.arguments[0];
                const result = resolve(u, arg);
                let parent: ts.Node = n;
                while (parent.parent && !ts.isFunctionLike(parent) && !ts.isSourceFile(parent))
                    parent = parent.parent;
                // Receiver configuration contributes instructions, but unrelated functions never do.
                let assigned: ts.Node = n;
                while (ts.isAwaitExpression(assigned.parent) || ts.isParenthesizedExpression(assigned.parent)) assigned = assigned.parent;
                const resultName = ts.isVariableDeclaration(assigned.parent) && ts.isIdentifier(assigned.parent.name) ? assigned.parent.name.text : undefined;
                let parserEvidence = ts.isCallExpression(assigned.parent) && assigned.parent.expression.getText(u.sf) === 'JSON.parse';
                if (resultName) {
                    const inspect = (node: ts.Node): void => {
                        if (node !== parent && ts.isFunctionLike(node)) return;
                        if (ts.isCallExpression(node) && node.pos >= n.pos && node.expression.getText(u.sf) === 'JSON.parse') {
                            const references = (child: ts.Node): void => { if (ts.isIdentifier(child) && child.text === resultName) parserEvidence = true; ts.forEachChild(child,references); };
                            for (const arg of node.arguments) references(arg);
                        }
                        ts.forEachChild(node,inspect);
                    };
                    inspect(parent);
                }
                const receiver = n.expression.getText(u.sf).split('.')[0]!;
                const b = binding(u, receiver, n);
                if (b && ts.isVariableDeclaration(b) && b.initializer && (ts.isCallExpression(b.initializer) || ts.isNewExpression(b.initializer))) {
                    for (const a of b.initializer.arguments ?? []) {
                        const r = resolve(u, a);
                        const behavior = r.fragments.filter(f => ['system', 'developer'].includes(f.role));
                        result.fragments.push(...behavior);
                        if (behavior.some(f => !f.resolved))
                            result.complete = false;
                    }
                }
                if (arg)
                    used.add(arg);
                let literal: ts.Node | undefined = arg;
                if (literal && ts.isIdentifier(literal)) {
                    const d = binding(u, literal.text, literal);
                    literal = d && ts.isVariableDeclaration(d) ? d.initializer : undefined;
                    if (d)
                        used.add(d);
                }
                const span = literal && (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal)) && result.fragments.length === 1 ? { start: literal.getStart(u.sf), end: literal.end, original: literal.getText(u.sf), encoding: 'js' as const } : undefined;
                add(u.path, u.sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, n.expression.getText(), result.fragments, result.complete, parent.getText(u.sf), .95, span, n.getText(u.sf), parserEvidence);
            }
            ts.forEachChild(n, walk);
        };
        const builders = (node: ts.Node): void => {
            if (ts.isFunctionDeclaration(node) && node.name && /prompt$/i.test(node.name.text) && node.body) {
                const returns = (n: ts.Node): void => {
                    if (n !== node.body && ts.isFunctionLike(n)) return;
                    if (ts.isReturnStatement(n) && n.expression) {
                        const r = resolve(u,n.expression);
                        if (r.fragments.some(f=>f.resolved&&f.text.trim().length>=8) && !r.fragments.some(f=>/<!doctype\s+html|<html\b/i.test(f.text))) add(u.path,u.sf.getLineAndCharacterOfPosition(n.getStart()).line+1,'template',r.fragments,r.complete,'',.75);
                    }
                    ts.forEachChild(n,returns);
                };
                returns(node.body);
            }
            ts.forEachChild(node,builders);
        };
        builders(u.sf);
        walk(u.sf);
        for (const [name, declarations] of u.bindings)
            if (PROMPT_NAME.test(name))
                for (const d of declarations) {
                    if (used.has(d) || !ts.isVariableDeclaration(d) || !d.initializer || prompts.some(p => p.fragments.some(f => f.path === u.path && f.line === u.sf.getLineAndCharacterOfPosition(d.initializer!.getStart()).line + 1)))
                        continue;
                    const r = resolve(u, d.initializer, /system/i.test(name) ? 'system' : /instruction/i.test(name) ? 'developer' : 'user');
                if (!r.fragments.some(f => f.resolved && f.text.trim().length >= 8) || r.fragments.some(f => /<!doctype\s+html|<html\b/i.test(f.text))) continue;
                    add(u.path, u.sf.getLineAndCharacterOfPosition(d.getStart()).line + 1, 'template', r.fragments, r.complete, '', .8);
                }
    }
    // Python reconstruction is deliberately labelled heuristic, never AST evidence.
    for (const file of facts.files) {
        if (file.role === 'test' || units.has(file.path))
            continue;
        const source = facts.lines(file.path).join('\n');
        if (/\.py$/.test(file.path)) {
            coverage.heuristicFiles++;
            for (const p of pythonPrompts(file.path, source))
                add(file.path, p.line, p.call, p.fragments, p.complete, p.context, .65);
        }
        else if (/(?:^|\/)(?:prompts?|templates?)\/|\.prompt\.(?:txt|md)$|\.(?:jinja2?|prompt)$/.test(file.path)) {
            coverage.templateFiles++;
            add(file.path, 1, 'template', [{ role: /system/i.test(file.path) ? 'system' : 'user', text: source, path: file.path, line: 1, resolved: true }], true, '', .85, { start: 0, end: source.length, original: source, encoding: 'text' });
        }
        else if (/\.(?:json|ya?ml)$/.test(file.path)) {
            const matches = [...source.matchAll(/["']?(system_prompt|user_prompt|developer_prompt|instructions)["']?\s*:\s*(?:"((?:\\.|[^"\\])*)"|'([^']*)'|[|>]\s*\n((?:[ \t]+[^\n]*\n?)+))/g)];
            for (const m of matches) {
                let text = m[2] ?? m[3] ?? m[4] ?? '';
                if (m[2]) {
                    try {
                        text = JSON.parse('"' + m[2] + '"') as string;
                    }
                    catch { /* retain literal */ }
                }
                const line = source.slice(0, m.index).split('\n').length;
                add(file.path, line, 'template', [{ role: /system/.test(m[1]!) ? 'system' : /developer|instructions/.test(m[1]!) ? 'developer' : 'user', text, path: file.path, line, resolved: true }], true, '', .75);
            }
            if (matches.length)
                coverage.templateFiles++;
        }
        else if (file.role === 'source')
            coverage.unsupportedFiles++;
    }
    return { prompts: prompts.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line), coverage };
}
