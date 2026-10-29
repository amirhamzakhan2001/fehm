import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { FehmEngine } from '../src/engine.js';
import { makeRepo, tempDir } from './helpers.js';
import { savedGraphStatus } from '../src/installation.js';

test('SDK stdio: discovery, bounded evidence, schemas, graph states and independent repositories',async()=>{
 const root=makeRepo({'auth.ts':'export function authenticateUser(token: string) { return validateToken(token); }\nexport function validateToken(token: string) { return token.length > 0; }'});
 FehmEngine.open(root);
 const saved=readFileSync(join(root,'.fehm/graph.json'),'utf8');
 const loader=pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href, cli=resolve('src/cli.ts');
 const actual=new StdioClientTransport({command:process.execPath,args:['--import',loader,cli,'mcp','--root',root],cwd:tempDir('outside '),stderr:'pipe'});
 const client=new Client({name:'fehm-acceptance',version:'1.0'});let stderr='';actual.stderr?.on('data',b=>stderr+=b);
 try{
  await client.connect(actual);const list=await client.listTools();
  assert.deepEqual(list.tools.map(t=>t.name).sort(),['fehm_context','fehm_focus','fehm_practices','fehm_relationships','fehm_search','fehm_system_map']);
  const packet=await client.callTool({name:'fehm_context',arguments:{query:'authenticateUser',budget:1500}});
  assert.ok(!packet.isError,JSON.stringify(packet));assert.match(JSON.stringify(packet),/auth.ts/);
  assert.ok(!(await client.callTool({name:'fehm_practices',arguments:{}})).isError);
  assert.ok((await client.callTool({name:'fehm_context',arguments:{query:'x',budget:-1}})).isError);
  assert.equal(readFileSync(join(root,'.fehm/graph.json'),'utf8'),saved);
  writeFileSync(join(root,'auth.ts'),'export function changed() {}');assert.equal(savedGraphStatus(root).state,'stale');
  assert.ok((await client.callTool({name:'fehm_context',arguments:{query:'auth'}})).isError);
  FehmEngine.open(root);assert.ok(!(await client.callTool({name:'fehm_search',arguments:{query:'changed'}})).isError);
  const otherGraph=FehmEngine.open(makeRepo({'different.ts':'export const different=1'})).graph.toJSON();
  writeFileSync(join(root,'.fehm/graph.json'),JSON.stringify(otherGraph));assert.equal(savedGraphStatus(root).state,'corrupt');
  assert.ok((await client.callTool({name:'fehm_context',arguments:{query:'different'}})).isError);
  writeFileSync(join(root,'.fehm/graph.json'),'{');assert.ok((await client.callTool({name:'fehm_practices',arguments:{}})).isError);
  assert.equal(readFileSync(join(root,'.fehm/graph.json'),'utf8'),'{','MCP must not repair state');
  assert.doesNotMatch(stderr,/SyntaxError|Unhandled/);
 }finally{await client.close();}
 const other=makeRepo({'other.ts':'export const other = 1'});assert.equal(savedGraphStatus(other).state,'missing');assert.ok(!existsSync(join(other,'.fehm')));
 for(let i=0;i<2;i++){
  const c=new Client({name:'repeat',version:'1'});const t=new StdioClientTransport({command:process.execPath,args:['--import',loader,cli,'mcp','--root',other],stderr:'pipe'});
  try{await c.connect(t);const r=await c.callTool({name:'fehm_context',arguments:{query:'other'}});assert.ok(r.isError);assert.match(JSON.stringify(r),/missing/);}finally{await c.close();}
 }
});
