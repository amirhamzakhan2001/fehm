import type { PromptFragment } from './types.js';
interface Literal {
    start: number;
    end: number;
    text: string;
}
export interface PythonPrompt {
    line: number;
    call: string;
    fragments: PromptFragment[];
    complete: boolean;
    context: string;
}
/** Bounded lexical reconstruction, not a Python parser. Unknown expressions stay unresolved. */
export function pythonPrompts(path: string, source: string): PythonPrompt[] {
    const literals: Literal[] = [...source.matchAll(/(?:[fFrRuU])?("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/g)].map(m => ({ start: m.index!, end: m.index! + m[0].length, text: /^(?:"""|''')/.test(m[1]!) ? m[1]!.slice(3, -3) : m[1]!.slice(1, -1) }));
    const literalAt = new Map(literals.map(l => [l.start, l]));
    const masked = source.split('');
    for (const l of literals)
        for (let i = l.start; i < l.end; i++)
            if (masked[i] !== '\n')
                masked[i] = ' ';
    let clean = masked.join('').replace(/#[^\n]*/g, m => ' '.repeat(m.length));
    const lineAt = (at: number): number => source.slice(0, at).split('\n').length;
    const endExpression = (start: number, close?: string): number => {
        let depth = 0;
        for (let i = start; i < source.length; i++) {
            const ch = clean[i]!;
            if ('([{'.includes(ch))
                depth++;
            if (')]}'.includes(ch)) {
                if (depth === 0)
                    return i;
                depth--;
            }
            if (depth === 0 && (ch === ',' || (!close && ch === '\n')))
                return i;
        }
        return source.length;
    };
    const defs = [...clean.matchAll(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/gm)].map(m => ({ start: m.index! + m[1]!.lastIndexOf('\n') + 1, indent: m[1]!.split('\n').at(-1)!.length }));
    const scope = (at: number): {
        start: number;
        end: number;
    } => {
        const def = [...defs].reverse().find(d => d.start <= at && !clean.slice(d.start, at).split('\n').slice(1).some(l => l.trim() && l.length - l.trimStart().length <= d.indent));
        if (!def)
            return { start: 0, end: source.length };
        const lines = clean.slice(def.start).split('\n');
        let end = def.start + lines[0]!.length + 1;
        for (const l of lines.slice(1)) {
            if (l.trim() && l.length - l.trimStart().length <= def.indent)
                break;
            end += l.length + 1;
        }
        return { start: def.start, end };
    };
    const assignments = [...clean.matchAll(/^([ \t]*)([A-Za-z_]\w*)[ \t]*=/gm)].map(m => ({ name: m[2]!, start: m.index!, value: m.index! + m[0].length, scope: scope(m.index! + m[0].length) }));
    const resolve = (start: number, end: number, role: PromptFragment['role'] = 'user', seen = new Set<number>()): {
        fragments: PromptFragment[];
        complete: boolean;
    } => {
        while (/\s/.test(source[start] ?? '') && start < end)
            start++;
        while (/\s/.test(source[end - 1] ?? '') && end > start)
            end--;
        if (seen.has(start) || seen.size > 40)
            return { fragments: [], complete: false };
        const next = new Set(seen).add(start);
        const literal = literalAt.get(start);
        if (literal && literal.end === end)
            return { fragments: [{ role, text: literal.text, path, line: lineAt(start), resolved: true }], complete: true };
        const expr = source.slice(start, end).trim();
        if (/^[A-Za-z_]\w*$/.test(expr)) {
            const current = scope(start);
            const assignment = assignments.filter(a => a.name === expr && a.start < start && (a.scope.start === 0 || a.scope.start === current.start)).at(-1);
            if (assignment)
                return resolve(assignment.value, endExpression(assignment.value), role, next);
            return { fragments: [{ role, text: '{' + expr + '}', path, line: lineAt(start), resolved: false }], complete: false };
        }
        // Top-level concatenation. Do not split plus signs inside literals or containers.
        let depth = 0;
        const cuts: number[] = [];
        for (let i = start; i < end; i++) {
            const c = clean[i]!;
            if ('([{'.includes(c))
                depth++;
            else if (')]}'.includes(c))
                depth--;
            else if (c === '+' && depth === 0)
                cuts.push(i);
        }
        if (cuts.length) {
            const edges = [start - 1, ...cuts, end];
            const parts = edges.slice(0, -1).map((s, i) => resolve(s + 1, edges[i + 1]!, role, seen));
            for (const part of parts.slice(1))
                if (part.fragments[0])
                    part.fragments[0].separator = "";
            return { fragments: parts.flatMap(p => p.fragments), complete: parts.every(p => p.complete) };
        }
        if (source[start] === '[') {
            const parts: ReturnType<typeof resolve>[] = [];
            let at = start + 1;
            while (at < end - 1) {
                while (/[\s,]/.test(source[at] ?? '') && at < end - 1)
                    at++;
                if (at >= end - 1)
                    break;
                const stop = endExpression(at, ']');
                parts.push(resolve(at, stop, role, next));
                at = stop + 1;
            }
            return { fragments: parts.flatMap(p => p.fragments), complete: parts.every(p => p.complete) };
        }
        if (source[start] === '{') {
            const region = source.slice(start, end);
            const rr = /["']role["']\s*:\s*["'](system|developer|user|assistant|tool)["']/.exec(region)?.[1];
            const content = /["']content["']\s*:\s*/.exec(region);
            if (content) {
                const at = start + content.index + content[0].length;
                return resolve(at, endExpression(at, '}'), (rr ?? role) as PromptFragment['role'], next);
            }
        }
        return { fragments: [{ role, text: '{' + expr.slice(0, 160) + '}', path, line: lineAt(start), resolved: false }], complete: false };
    };
    const out: PythonPrompt[] = [];
    const callPattern = /\b([\w.]+(?:chat\.completions\.create|responses\.create|messages\.(?:create|stream)|generate_content|generateContent|invoke_model|converse)|(?:llm|model|chain|agent|assistant|ai_service|llm_service)\.(?:invoke|ainvoke|generate|complete|run|ask))\s*\(/g;
    for (const match of clean.matchAll(callPattern)) {
        const start = match.index! + match[0].length;
        let at = start;
        const parts: ReturnType<typeof resolve>[] = [];
        while (at < source.length) {
            while (/[\s,]/.test(source[at] ?? '') && at < source.length)
                at++;
            if (source[at] === ')')
                break;
            const end = endExpression(at, ')');
            const arg = source.slice(at, end);
            const named = /^(messages|prompt|input|contents|system|system_prompt|instructions)\s*=\s*/.exec(arg);
            if (named)
                parts.push(resolve(at + named[0].length, end, /system/.test(named[1]!) ? 'system' : named[1] === 'instructions' ? 'developer' : 'user'));
            else if (!/^\w+\s*=/.test(arg))
                parts.push(resolve(at, end));
            if (end <= at || source[end] === ')')
                break;
            at = end + 1;
        }
        const s = scope(match.index!);
        const context = source.slice(s.start, s.end);
        // Agent constructor configuration, limited to the actual receiver binding.
        const receiver = match[1]!.split('.')[0]!;
        const config = assignments.filter(a => a.name === receiver && a.start < match.index! && (a.scope.start === 0 || a.scope.start === s.start)).at(-1);
        if (config) {
            const end = endExpression(config.value);
            const text = source.slice(config.value, end);
            const instruction = /\b(system_prompt|instructions|system)\s*=\s*/.exec(text);
            if (instruction) {
                const value = config.value + instruction.index + instruction[0].length;
                parts.push(resolve(value, endExpression(value, ')'), 'system'));
            }
        }
        out.push({ line: lineAt(match.index!), call: match[1]!, fragments: parts.flatMap(p => p.fragments), complete: parts.length > 0 && parts.every(p => p.complete), context });
    }
    return out;
}
