import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
const runtime=path.resolve('build/fehm-runtime');
const manifest=JSON.parse(await readFile(path.join(runtime,'runtime-manifest.json'),'utf8'));
const lock=JSON.parse(await readFile(path.join(runtime,'package-lock.json'),'utf8'));
const entries=[];
for(const [name,pkg] of Object.entries(lock.packages)){
 if(!name || pkg.dev)continue;
 const dir=path.join(runtime,name);await access(dir);
 const files=await readdir(dir);const notices=files.filter(f=>/^(licen[sc]e|copying|notice)/i.test(f));
 if(!pkg.license || !notices.length)throw new Error(`Review missing license/notice: ${name}`);
 entries.push({name,version:pkg.version,license:pkg.license,notices});
}
for(const name of ['THIRD_PARTY_NOTICES.md','skills/licenses/superpowers-LICENSE.txt','skills/source-map.json','third_party/licenses/agentmemory-LICENSE.txt','third_party/licenses/codebase-memory-mcp-LICENSE.txt','third_party/licenses/Graft-LICENSE.txt','third_party/licenses/skylos-LICENSE.txt'])if(!manifest.files[name])throw new Error('Missing attribution: '+name);
console.log(JSON.stringify({dependencies:entries.length,entries},null,2));
