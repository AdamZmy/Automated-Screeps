import {createReader, UpstreamError} from '../lib/telemetry.js';
const read = createReader();
export default async function handler(request, response) {
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options','nosniff');
  if (!['GET','HEAD'].includes(request.method)) {
    response.setHeader('Allow','GET, HEAD');
    return response.status(405).json({ok:false,error:{code:'METHOD_NOT_ALLOWED',message:'此端点只提供只读遥测。'}});
  }
  if (new URL(request.url,'https://dashboard.invalid').search) return response.status(400).json({ok:false,error:{code:'INVALID_QUERY',message:'遥测端点不接受查询参数。'}});
  try {
    const result = await read();
    response.setHeader('Cache-Control','public, max-age=15, s-maxage=120');
    response.setHeader('Vercel-CDN-Cache-Control','public, s-maxage=120');
    if (request.method==='HEAD') return response.status(200).end();
    return response.status(200).json(result);
  } catch (error) {
    response.setHeader('Cache-Control','public, max-age=15, s-maxage=60');
    const safe = error instanceof UpstreamError ? error : new UpstreamError('UNAVAILABLE','遥测暂时不可用。');
    return response.status(safe.status).json({ok:false,source:'screeps-api',fetchedAt:new Date().toISOString(),error:{code:safe.code,message:safe.message}});
  }
}
