import {gunzipSync} from 'node:zlib';

const MAX_BYTES = 8 * 1024 * 1024;
const TTL = 120_000;
const SECRET_KEY = /token|password|secret|authorization|cookie|credentials|apikey/i;
export class UpstreamError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

export function decodeMemory(data) {
  if (typeof data === 'string') {
    if (data.startsWith('gz:')) data = gunzipSync(Buffer.from(data.slice(3), 'base64'), {maxOutputLength: MAX_BYTES}).toString('utf8');
    if (data.length > MAX_BYTES) throw new UpstreamError('MEMORY_SIZE', '遥测超过安全大小限制。');
    data = JSON.parse(data);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UpstreamError('MEMORY_FORMAT', '尚未收到有效的游戏遥测。');
  return data;
}

function clean(value, secret, depth = 0) {
  if (depth > 16) return null;
  if (typeof value === 'string') return secret ? value.split(secret).join('[redacted]') : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 1000).map(v => clean(v, secret, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !k.startsWith('_')&&!SECRET_KEY.test(k)).map(([k,v]) => [k,clean(v,secret,depth+1)]));
  return value;
}

export function publicSnapshot(frontier, fetchedAt, secret = '') {
  const telemetry = frontier.telemetry || {}, energy = frontier.energy || {}, status = frontier.status || {};
  const names = new Set([...Object.keys(telemetry.rooms || {}), ...(status.rooms || []).map(r => r.name)]);
  const rooms = {};
  const fields = ['tick','rcl','progress','total','upgradeRate','upgradeEMA','stagnant','roleCounts','capacity','storage','buffers','dropped','upkeep','harvestPotential','constructionSites','planComplete','builtExtensions','mining','roads','hauling','economy'];
  for (const name of names) {
    if (!/^[WE]\d+[NS]\d+$/.test(name)) continue;
    const input = telemetry.rooms?.[name] || {};
    rooms[name] = Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k,input[k]]));
    rooms[name].spawnEnergy = input.energy ?? null;
    rooms[name].construction = input.constructionByType || {};
    rooms[name].history = (input.history || []).slice(-60);
    rooms[name].energy = energy.rooms?.[name] || null;
  }
  const capturedAt = energy.capturedAt || telemetry.capturedAt || null;
  return clean({ok:true,source:'screeps-api',shard:'shard1',username:'AdamZmy',fetchedAt,capturedAt,
    tick:energy.tick || telemetry.tick || status.tick || null,version:status.version || null,
    refreshSeconds:120,staleAfter:capturedAt?Number(capturedAt)+300_000:null,stale:!capturedAt || Date.parse(fetchedAt)-Number(capturedAt)>300_000,
    cpu:{used:status.cpu ?? null,average:telemetry.cpuEMA ?? null,bucket:telemetry.bucket ?? status.bucket ?? null,limit:20,performance:frontier.performance || null},
    rooms,alerts:telemetry.alerts || {},ledgerVersion:energy.version || null}, secret);
}

export function createReader({fetchImpl = fetch, now = Date.now, token = () => process.env.SCREEPS_TOKEN} = {}) {
  let cache = null, expires = 0, pending = null, lastError = null, retryAt = 0;
  const age = snapshot => ({...snapshot,stale:snapshot.stale||!snapshot.capturedAt||now()-Number(snapshot.capturedAt)>300_000});
  async function readFresh() {
    const secret = token()?.trim();
    if (!secret) throw new UpstreamError('NOT_CONFIGURED', '服务端尚未配置 Screeps 访问凭据。', 503);
    const response = await fetchImpl('https://screeps.com/api/user/memory?shard=shard1&path=frontier', {
      headers:{'X-Token':secret,Accept:'application/json'}, redirect:'error', signal:AbortSignal.timeout(12_000)
    });
    if (response.status===401 || response.status===403) throw new UpstreamError('AUTH_REQUIRED','Screeps 凭据或读取权限失效，需要维护者更新。',503);
    if (response.status===429) {
      const error=new UpstreamError('RATE_LIMITED','Screeps 请求限流，稍后自动重试。',503);
      const value=response.headers?.get('retry-after');
      const milliseconds=value&&/^\d+(\.\d+)?$/.test(value.trim())?Number(value)*1000:Date.parse(value)-now();
      error.retryAfterMs=Number.isFinite(milliseconds)?Math.max(300_000,milliseconds):300_000;
      throw error;
    }
    if (!response.ok) throw new UpstreamError('UPSTREAM_FAILED','Screeps 暂时无法提供遥测。');
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new UpstreamError('MEMORY_SIZE','遥测超过安全大小限制。');
    const payload = JSON.parse(text);
    if (payload.ok !== 1 || payload.error) throw new UpstreamError('UPSTREAM_REJECTED','Screeps 未接受遥测读取请求。');
    const snapshot = publicSnapshot(decodeMemory(payload.data),new Date(now()).toISOString(),secret);
    cache = snapshot; expires = now()+TTL; lastError=null;
    return snapshot;
  }
  return async function read() {
    if (cache && now()<expires) return age(cache);
    if (now()<retryAt && lastError) {
      if (cache) return {...cache,stale:true,upstreamError:{code:lastError.code,message:lastError.message}};
      throw lastError;
    }
    if (!pending) pending = readFresh().catch(error => {
      lastError = error instanceof UpstreamError ? error : new UpstreamError('UPSTREAM_UNAVAILABLE','遥测暂时不可用；已有读数会标记为过期。');
      retryAt=now()+(lastError.retryAfterMs||(lastError.code==='RATE_LIMITED'?300_000:60_000));
      if (cache) return {...cache,stale:true,upstreamError:{code:lastError.code,message:lastError.message}};
      throw lastError;
    }).finally(()=>{pending=null;});
    return pending;
  };
}
