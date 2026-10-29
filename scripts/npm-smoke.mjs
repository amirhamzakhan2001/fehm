import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root=process.cwd(),base=await mkdtemp(path.join(tmpdir(),'fehm npm ü '));
const npm=process.platform==='win32'?'npm.cmd':'npm';
const run=(args,cwd)=>execFileSync(npm,args,{cwd,encoding:'utf8',shell:process.platform==='win32'});
try{
 const packed=JSON.parse(run(['pack','--ignore-scripts','--json','--pack-destination',base],root))[0];
 if(packed.files.some(f=>f.path.startsWith('website/')||f.path.startsWith('.fehm/')))throw new Error('Unexpected package data');
 const app=path.join(base,'app');await mkdir(app);run(['install','--ignore-scripts','--no-audit','--no-fund',path.join(base,packed.filename)],app);
 const project=path.join(base,'project');await mkdir(project);await writeFile(path.join(project,'auth.ts'),'export function authenticateUser() {return true;}');
 const cli=path.join(app,'node_modules/fehm/dist/cli.js');
 const output=execFileSync(process.execPath,[cli,'scan',project],{cwd:base,encoding:'utf8'});
 if(!output)throw new Error('No scan output');
 const doctor=JSON.parse(execFileSync(process.execPath,[cli,'doctor','--root',project,'--json'],{cwd:base,encoding:'utf8'}));
 if(!doctor.ok||doctor.index.state!=='fresh')throw new Error('Installed runtime failed doctor');
 const client=new Client({name:'npm-smoke',version:'1'});
 try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[cli,'mcp','--root',project],cwd:base,stderr:'pipe'}));
  const result=await client.callTool({name:'fehm_context',arguments:{query:'authenticateUser'}});if(result.isError)throw new Error(JSON.stringify(result));
 }finally{await client.close();}
 console.log(JSON.stringify({package:packed.filename,files:packed.entryCount,bytes:packed.size,installedCLI:true,installedMCP:true}));
}finally{await rm(base,{recursive:true,force:true});}
