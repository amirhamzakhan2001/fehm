import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { FehmEngine } from './engine.js';
import { loadGraph, cachePath, graphPath } from './indexer.js';
import { ANALYSIS_VERSION, GRAPH_SCHEMA_VERSION } from './model.js';
import { diffScan, scanRepository } from './scanner.js';
import { integrationPlatforms } from './integrations.js';
import { FEHM_VERSION } from './health/health.js';

export function savedGraphStatus(root: string, stateDirectory?: string) {
  const target = resolve(root);
  const file = graphPath(target, stateDirectory);
  if (!existsSync(file) || !existsSync(cachePath(target, stateDirectory))) return { state: 'missing', root: target, graph: file };
  try {
    const graph = loadGraph(target, stateDirectory);
    const cache = JSON.parse(readFileSync(cachePath(target, stateDirectory), 'utf8'));
    if (!graph || realpathSync(graph.root) !== realpathSync(target) || realpathSync(cache.root) !== realpathSync(target)) throw new Error('Graph belongs to another root or is malformed');
    if (cache.schemaVersion !== GRAPH_SCHEMA_VERSION || cache.analysisVersion !== ANALYSIS_VERSION || !cache.files || typeof cache.files !== 'object') throw new Error('Incompatible index');
    const hashes = new Map<string,string>();
    for (const [name, item] of Object.entries(cache.files)) {
      const hash = (item as {hash?: unknown})?.hash;
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid index hash');
      hashes.set(name, hash);
    }
    const scan = scanRepository(target);
    if (scan.errors.length) throw new Error('Source scan incomplete');
    const diff = diffScan(hashes, scan.files);
    const changed = diff.added.length + diff.modified.length + diff.deleted.length;
    return { state: changed ? 'stale' : 'fresh', root: target, graph: file, changed };
  } catch (error) { return { state: 'corrupt', root: target, graph: file, detail: (error as Error).message }; }
}

export function readOnlyEngine(root: string, stateDirectory?: string): FehmEngine {
  const status = savedGraphStatus(root, stateDirectory);
  if (status.state !== 'fresh') throw new Error(`Graph is ${status.state}. Run fehm scan --root ${JSON.stringify(status.root)} before querying MCP.`);
  const engine=FehmEngine.open(status.root, {dryRun:true, ...(stateDirectory ? {stateDirectory} : {})});
  if(engine.sync.mode !== 'cache-hit' || engine.sync.scanErrors.length) throw new Error('Saved index changed or is incompatible. Run fehm scan and retry.');
  return engine;
}

export function doctor(root: string, stateDirectory?: string) {
  const runtime = fileURLToPath(new URL('../', import.meta.url));
  const required = ['dist/cli.js','integrations/fehm/SKILL.md','skills/manifest.json','assets/ontology/fehm_engineering_ontology.json'];
  const missing = required.filter(f=>!existsSync(resolve(runtime,f)));
  const [major=0,minor=0] = process.versions.node.split('.').map(Number);
  const runtimeOK = major > 22 || major === 22 && minor >= 13;
  return {version:FEHM_VERSION, node:process.versions.node, runtime, executable:process.env.FEHM_LAUNCHER ?? process.execPath, missing, runtimeOK, ok:!missing.length && runtimeOK, index:savedGraphStatus(root,stateDirectory)};
}

/** Generate only: never rewrite client settings or register servers implicitly. */
export function mcpConfig(platform: string, root: string, executable?: string, stateDirectory?: string) {
  if (!Object.hasOwn(integrationPlatforms, platform)) throw new Error(`Unknown platform ${platform}`);
  const target=resolve(root);
  if (!statSync(target).isDirectory()) throw new Error('Root must be a directory');
  const launcher=executable ?? process.env.FEHM_LAUNCHER;
  if (launcher && (!isAbsolute(launcher) || !existsSync(launcher) || !statSync(launcher).isFile())) throw new Error('--executable must be an existing absolute executable path');
  const command=launcher ?? process.execPath;
  const args=[...(launcher ? [] : [fileURLToPath(new URL('./cli.js',import.meta.url))]), 'mcp','--root',target,...(stateDirectory ? ['--state-dir',resolve(stateDirectory)] : [])];
  return renderMcpConfig(platform, command, args);
}

export function renderMcpConfig(platform:string,command:string,args:string[]):string {
  const server={command,args};
  if(platform==='codex')return `[mcp_servers.fehm]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`;
  if(platform==='vscode')return JSON.stringify({servers:{fehm:{type:'stdio',...server}}},null,2)+'\n';
  if(platform==='copilot')return JSON.stringify({mcpServers:{fehm:{type:'local',...server,tools:['*']}}},null,2)+'\n';
  return JSON.stringify({mcpServers:{fehm:server}},null,2)+'\n';
}
