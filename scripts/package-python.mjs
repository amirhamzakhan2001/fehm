import { cp, mkdir, readFile, rm, readdir, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const target=path.join(root,'build/fehm-runtime');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const py=await readFile(path.join(root,'pyproject.toml'),'utf8');
if(!py.includes(`version = "${pkg.version}"`)) throw new Error('Synchronize Python and npm versions');
await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
for(const name of ['dist','skills','assets/ontology','integrations','third_party/licenses','LICENSE','THIRD_PARTY_NOTICES.md']) await cp(path.join(root,name),path.join(target,name),{recursive:true,filter:source=>!source.endsWith(".DS_Store")});
await cp(path.join(root,'package-lock.json'),path.join(target,'package-lock.json'));
await writeFile(path.join(target,'package.json'),JSON.stringify({...pkg,scripts:{}},null,2)+'\n');
// Install exactly the production lockfile tree; do not copy developer node_modules.
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:target,stdio:'inherit',shell:process.platform==='win32'});
await rm(path.join(target,'node_modules/.bin'),{recursive:true,force:true});
const files={};
async function walk(dir){for(const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
 const f=path.join(dir,item.name);if((await lstat(f)).isSymbolicLink()) throw new Error('Unexpected runtime symlink: '+f);
 if(item.isDirectory())await walk(f);else {const name=path.relative(target,f).split(path.sep).join('/');
 if(/\.(node|exe|dll|dylib|so)$/.test(name))throw new Error('Native asset requires platform wheel: '+name);
 files[name]=createHash('sha256').update(await readFile(f)).digest('hex');}
}}
await walk(target);
await writeFile(path.join(target,'runtime-manifest.json'),JSON.stringify({version:pkg.version,files},null,2)+'\n');
console.log(`Prepared Fehm ${pkg.version}: ${Object.keys(files).length} verified runtime files`);
