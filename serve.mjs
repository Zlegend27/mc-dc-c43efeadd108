import http from 'http'; import fs from 'fs'; import path from 'path';
const dir=path.dirname(new URL(import.meta.url).pathname.replace(/^\//,''));
http.createServer((req,res)=>{
  let f=decodeURIComponent(req.url.split('?')[0]); if(f==='/')f='/opener-texter.html';
  const p=path.join(dir,f);
  fs.readFile(p,(e,d)=>{ if(e){res.writeHead(404);res.end('nf');return;} res.writeHead(200,{'content-type':f.endsWith('.html')?'text/html':'text/plain'}); res.end(d); });
}).listen(8731,()=>console.log('serving on http://localhost:8731'));
