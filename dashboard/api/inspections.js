import {createReader, InspectionError, parseQuery} from '../lib/inspections.js';

export function createHandler({read = createReader()} = {}) {
  return async function handler(request, response) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    const send = (status, body) => request.method === 'HEAD' ? response.status(status).end() : response.status(status).json(body);
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return send(405, {ok: false, error: {code: 'METHOD_NOT_ALLOWED', message: '此端点只提供只读巡检日志。'}});
    }
    try {
      parseQuery(request.url);
      const result = await read(request.url);
      if (!result.stale) {
        response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, must-revalidate');
        response.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=15, must-revalidate');
      }
      return send(200, result);
    } catch (error) {
      const safe = error instanceof InspectionError ? error : new InspectionError('UNAVAILABLE', '巡检日志暂时不可用，请稍后重试。');
      return send(safe.status, {ok: false, error: {code: safe.code, message: safe.message}});
    }
  };
}

export default createHandler();
