import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import handler from './api/telemetry.js';
import inspections from './api/inspections.js';
const base=path.resolve('public');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  res.status=code=>(res.statusCode=code,res);res.json=data=>res.end(JSON.stringify(data));
  if(req.url.startsWith('/api/telemetry')) return handler(req,res);
  if(/^\/api\/inspections(?:\?|$)/.test(req.url)) return inspections(req,res);
  try {
    const url=new URL(req.url,'http://localhost'),target=path.resolve(base,'.'+(url.pathname==='/'?'/index.html':url.pathname==='/logs'?'/logs.html':decodeURIComponent(url.pathname)));
    if(!target.startsWith(base+path.sep)) throw new Error('invalid path');
    const data=await fs.readFile(target);res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');res.end(data);
  }catch{res.statusCode=404;res.end('Not found');}
}).listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('Dashboard available at http://127.0.0.1:4173'));
