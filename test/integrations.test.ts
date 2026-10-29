import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { integrationPlatforms, manageIntegration } from '../src/integrations.js';
import { tempDir } from './helpers.js';
import { readFileSync } from 'node:fs';
import { mcpConfig, renderMcpConfig } from '../src/installation.js';

test('first-party skill: seven platforms, both scopes, idempotence, dry run and owned removal',async()=>{
 const base=tempDir('fehm install ü '),home=path.join(base,'home'),cwd=path.join(base,'repo');
 await mkdir(cwd);await writeFile(path.join(cwd,'AGENTS.md'),'Keep this');
 for(const platform of Object.keys(integrationPlatforms))for(const project of [false,true]){
  const options={platform,project,home,cwd};
  const dry=await manageIntegration('install',{...options,dryRun:true});
  assert.equal(dry.state,'missing');await assert.rejects(readFile(dry.path),{code:'ENOENT'});
  const r=await manageIntegration('install',options);assert.ok(r.path.startsWith(project?cwd:home));assert.match(r.path,/fehm[/\\]SKILL.md$/);
  const content=await readFile(r.path,'utf8');assert.match(content,/name: fehm/);
  await manageIntegration('install',options);assert.equal(await readFile(r.path,'utf8'),content);
  assert.equal((await manageIntegration('status',options)).state,'current');
  const sibling=path.join(path.dirname(r.path),'user.txt');await writeFile(sibling,'Keep');
  await manageIntegration('uninstall',{...options,dryRun:true});assert.equal(await readFile(r.path,'utf8'),content);
  await manageIntegration('uninstall',options);assert.equal((await manageIntegration('status',options)).state,'missing');assert.equal(await readFile(sibling,'utf8'),'Keep');
 }
 assert.equal(await readFile(path.join(cwd,'AGENTS.md'),'utf8'),'Keep this');
});

test('custom entrypoints, backups, symlinks and unknown platforms are protected',async()=>{
 const cwd=tempDir(),options={cwd,platform:'claude',project:true};
 await assert.rejects(manageIntegration('install',{...options,platform:'typo'}),/Unknown platform/);
 const r=await manageIntegration('install',options);const original=await readFile(r.path,'utf8');
 await writeFile(r.path,original.replace('FEHM repository evidence','My instructions'));
 assert.equal((await manageIntegration('status',options)).state,'customized');
 await assert.rejects(manageIntegration('install',options),/Preserving/);
 await assert.rejects(manageIntegration('uninstall',options),/Preserving/);
 await manageIntegration('install',{...options,force:true});
 const backups=(await readdir(path.dirname(r.path))).filter(p=>p.endsWith('.bak'));assert.equal(backups.length,1);
 assert.match(await readFile(path.join(path.dirname(r.path),backups[0]!),'utf8'),/My instructions/);
 const other=tempDir();await symlink(path.join(cwd,'.claude'),path.join(other,'.claude'),'dir');
 await assert.rejects(manageIntegration('install',{...options,cwd:other}),/symlink/);
});

test('MCP configs preserve spaces and use client-specific schemas without writing settings',()=>{
 const root=tempDir('project ü ');
 for(const platform of ['claude','cursor','gemini','generic']){
  const cfg=JSON.parse(mcpConfig(platform,root));assert.equal(cfg.mcpServers.fehm.command,process.execPath);assert.equal(cfg.mcpServers.fehm.args.at(-1),root);
 }
 assert.equal(JSON.parse(mcpConfig('vscode',root)).servers.fehm.type,'stdio');
 assert.deepEqual(JSON.parse(mcpConfig('copilot',root)).mcpServers.fehm.tools,['*']);
 assert.match(mcpConfig('codex',root),/^\[mcp_servers.fehm\]/);
 assert.throws(()=>mcpConfig('bad',root),/Unknown platform/);
 assert.throws(()=>mcpConfig('claude',root,'relative'),/absolute/);
});


test('documented MCP fixtures match the configuration renderer',()=>{
 const fixtures=JSON.parse(readFileSync(new URL('../integrations/mcp-examples.json',import.meta.url),'utf8'));
 for(const [platform,value] of Object.entries(fixtures)){
  const generated=renderMcpConfig(platform,'/absolute/path/to/bin/fehm',['mcp','--root','/absolute/path/to/project']);
  if(platform==='codex')assert.equal(generated,value);else assert.deepEqual(JSON.parse(generated),JSON.parse(value as string));
 }
});


test('forced uninstall never claims an unmarked user skill',async()=>{
 const options={platform:'claude',project:true,cwd:tempDir()};
 const result=await manageIntegration('install',options);await writeFile(result.path,'My unrelated skill');
 await assert.rejects(manageIntegration('uninstall',{...options,force:true}),/unmanaged/);
 assert.equal(await readFile(result.path,'utf8'),'My unrelated skill');
});
