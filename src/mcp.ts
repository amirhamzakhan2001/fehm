import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readOnlyEngine } from './installation.js';
import { buildHealthReport, FEHM_VERSION } from './health/health.js';
import type { FehmEngine } from './engine.js';

const query = z.string().trim().min(1).max(2000);
const annotations = {readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false};
const MAX_BYTES=96*1024;
const outputSchema={root:z.string(),fresh:z.literal(true),data:z.unknown()};
export function createMcpServer(root: string, stateDirectory?: string): McpServer {
  const server = new McpServer({name:'fehm',version:FEHM_VERSION});
  const run = (work: (engine: FehmEngine)=>unknown) => {
    try {
      const engine=readOnlyEngine(root,stateDirectory);
      const value=work(engine);
      if (!engine.freshness().fresh) throw new Error('Source changed during the query. Scan again and retry.');
      const result={root:engine.root,fresh:true,data:value};
      const text=JSON.stringify(result);
      const response={content:[{type:'text' as const,text}],structuredContent:result};
      if(Buffer.byteLength(JSON.stringify(response))>MAX_BYTES)throw new Error('Result exceeds 96 KiB. Narrow the query or use the CLI report.');
      return response;
    } catch(error) {return {isError:true,content:[{type:'text' as const,text:(error as Error).message}]};}
  };
  server.registerTool('fehm_context',{description:'Focused source evidence with estimated token budget; requires a fresh saved graph.',inputSchema:{query,budget:z.number().int().min(100).max(12000).default(4000)},outputSchema,annotations},({query,budget})=>run(e=>e.context(query,{budget})));
  server.registerTool('fehm_search',{description:'Ranked local lexical and graph retrieval. No external model.',inputSchema:{query,limit:z.number().int().min(1).max(50).default(10)},outputSchema,annotations},({query,limit})=>run(e=>e.search(query,{limit})));
  server.registerTool('fehm_relationships',{description:'Direct observed and inferred relationships with provenance and confidence.',inputSchema:{query},outputSchema,annotations},({query})=>run(e=>e.relationships(query)));
  server.registerTool('fehm_focus',{description:'Symbol or file and its direct relationships.',inputSchema:{query},outputSchema,annotations},({query})=>run(e=>e.focus(query)));
  server.registerTool('fehm_system_map',{description:'Current structural system map, not a runtime trace.',inputSchema:{},outputSchema,annotations},()=>run(e=>e.systemMap()));
  server.registerTool('fehm_practices',{description:'Current static project-health findings and engineering evidence. Does not execute tests or reproduce the removed legacy practice engine.',inputSchema:{},outputSchema,annotations},()=>run(e=>{
    const report=buildHealthReport({engine:e,dryRun:true});
    return {implementation:'current-project-health',scope:'static evidence, not executed checks',findings:report.findings.slice(0,50),totalFindings:report.findings.length,truncated:report.findings.length>50};
  }));
  return server;
}
export async function startMcp(root:string,stateDirectory?:string):Promise<void>{
  const server=createMcpServer(root,stateDirectory);
  const transport=new StdioServerTransport();
  await server.connect(transport);
  for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{void server.close().then(()=>process.exit(0));});
  await new Promise<void>(resolve=>{transport.onclose=resolve;});
}
