import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.woff':'font/woff','.png':'image/png','.svg':'image/svg+xml','.xml':'application/xml','.txt':'text/plain'};
export function createServer() {
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(pathname.includes('\\') || pathname.includes('\0')) throw new Error('invalid path');
      let target=path.resolve(root,'.'+pathname);
      if(target!==root && !target.startsWith(root+path.sep)) throw new Error('outside root');
      if((await stat(target)).isDirectory()) {
        if(!pathname.endsWith('/')) {res.writeHead(301,{Location:pathname+'/'});res.end();return;}
        target=path.join(target,'index.html');
      }
      const body=await readFile(target);
      res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'});
      res.end(req.method==='HEAD'?undefined:body);
    } catch {
      res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});
      const body=await readFile(path.join(root,'404.html')).catch(()=>Buffer.from('Build the website first.'));
      res.end(req.method==='HEAD'?undefined:body);
    }
  });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const server=createServer();
  server.listen(Number(process.env.PORT || 4321),'127.0.0.1',()=>console.log(`Fehm website: http://127.0.0.1:${server.address().port}`));
}
