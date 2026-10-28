import ts from 'typescript';
import type { PromptRole } from './types.js';
export interface AssetPrompt { text: string; line: number; role: PromptRole; complete: boolean; name: string; }
const keyPattern = /^(?:system(?:_prompt|_message)?|developer(?:_prompt)?|user_prompt|prompt|instructions?|template)$/i;
const roleOf = (key: string): PromptRole => /system/i.test(key) ? 'system' : /developer|instruction/i.test(key) ? 'developer' : 'user';
/** JSON is syntax traversed; other serialized formats are conservative, labelled lexical candidates. */
export function assetPrompts(path: string, source: string): AssetPrompt[] {
  const out: AssetPrompt[] = [];
  const line = (offset: number): number => source.slice(0, offset).split('\n').length;
  if (/\.json$/i.test(path)) {
    const sf = ts.parseJsonText(path, source);
    let valid = true;
    try { JSON.parse(source); } catch { valid = false; }
    const walk = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const props = node.properties.filter(ts.isPropertyAssignment);
        const key = (p: ts.PropertyAssignment) => p.name.getText(sf).replace(/^["']|["']$/g, '');
        const role = props.find(p => key(p) === 'role')?.initializer;
        for (const prop of props) {
          const name = key(prop), value = prop.initializer;
          if (!keyPattern.test(name) && !(name === 'content' && role && ts.isStringLiteral(role))) continue;
          if (!ts.isStringLiteral(value)) continue;
          const r = name === 'content' && role && ts.isStringLiteral(role) ? role.text : roleOf(name);
          out.push({ name, text: value.text, line: line(value.getStart(sf)), role: ['system','developer','user','assistant','tool','context'].includes(r) ? r as PromptRole : 'user', complete: valid });
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
    if (!out.length && !valid && /prompt|instructions|messages/i.test(source)) out.push({ name: 'Malformed prompt configuration', text: '[Unresolved malformed JSON prompt configuration]', line: 1, role: 'user', complete: false });
    return out;
  }
  if (/\.(?:ya?ml|toml)$/i.test(path)) {
    const pattern = /(?:^|\n)[ \t-]*["']?(system_prompt|user_prompt|developer_prompt|instructions?|prompt|template|content)["']?\s*[:=]\s*("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'[^']*'|[|>][-+]?\s*\n(?:[ \t]+[^\n]*(?:\n|$))+)/g;
    for (const m of source.matchAll(pattern)) {
      const key = m[1]!, raw = m[2]!;
      if (key === 'content' && !/\brole\s*[:=]\s*["']?(system|developer|user|assistant|tool)\b/.test(source.slice(Math.max(0,m.index!-100),m.index!))) continue;
      let text = raw;
      if (/^["']{3}/.test(raw)) text = raw.slice(3,-3);
      else if (raw.startsWith('"')) { try { text = JSON.parse(raw) as string; } catch { text = raw.slice(1,-1); } }
      else if (raw.startsWith("'")) text = raw.slice(1,-1);
      else text = raw.replace(/^[|>][-+]?\s*\n/, '');
      out.push({ name: key, text, line: line(m.index! + m[0].indexOf(key)), role: roleOf(key), complete: !/^[|>]/.test(raw) });
    }
  }
  return out;
}
