const SOURCE = 'https://raw.githubusercontent.com/AdamZmy/Automated-Screeps/main/operations/inspections/';
const MAX_BYTES = 256 * 1024;
const INDEX_BYTES = {root: 1024 * 1024, day: 8 * 1024 * 1024};
const CACHE_TTL = 30_000;
const RETRY_DELAY = 10_000;
const MAX_ENTRIES = 64;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_ACTIVE_FETCHES = 8;
const KINDS = ['scheduled', 'manual', 'backfill', 'setup'];
const STATUSES = ['running', 'completed', 'blocked', 'skipped', 'failed'];
const SUMMARY_KEYS = ['id', 'kind', 'startedAt', 'updatedAt', 'completedAt', 'status', 'title', 'summary', 'tick', 'issueNumbers'];
const RUN_KEYS = ['schemaVersion', 'id', 'kind', 'startedAt', 'updatedAt', 'completedAt', 'status', 'title', 'summary', 'game', 'findings', 'tasks', 'actions', 'checks', 'next', 'references'];

export class InspectionError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function validId(value) {
  if (typeof value !== 'string' || value.length > 96 || !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[a-z0-9-]+$/.test(value)) return false;
  return validTime(value.slice(0, 13) + ':' + value.slice(14, 16) + ':' + value.slice(17, 20));
}

function invalidQuery() {
  return new InspectionError('INVALID_QUERY', '仅支持有效 UTC 日期 day 或巡检批次 id，且二者不能同时使用。', 400);
}

// Only the fixed API path and these two scalar selectors can produce an upstream path.
export function parseQuery(requestUrl = '/api/inspections') {
  if (typeof requestUrl !== 'string' || requestUrl.length > 512 || !/^\/api\/inspections(?:\?|$)/.test(requestUrl)
    || /[#\u0000-\u0020\u007f]/.test(requestUrl) || /%(?![\da-f]{2})/i.test(requestUrl)) throw invalidQuery();
  const url = new URL(requestUrl, 'https://dashboard.invalid');
  const parameters = [...url.searchParams];
  if (parameters.length === 0) return {type: 'root', path: 'index.json'};
  if (parameters.length !== 1) throw invalidQuery();
  const [name, value] = parameters[0];
  if (name === 'day' && validDay(value)) return {type: 'day', day: value, path: `${value}/index.json`};
  if (name === 'id' && validId(value)) return {type: 'run', id: value, path: `${value.slice(0, 10)}/${value}.json`};
  throw invalidQuery();
}

function formatError() {
  return new InspectionError('INVALID_DATA', '巡检日志格式无效，暂时无法显示。');
}

function requireValue(condition) {
  if (!condition) throw formatError();
}

function object(value, keys) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireValue(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}

function text(value, limit = 4000, nonempty = false) {
  requireValue(typeof value === 'string' && [...value].length <= limit && (!nonempty || value.trim().length > 0));
  requireValue(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
}

function list(value, limit, validate) {
  requireValue(Array.isArray(value) && value.length <= limit);
  value.forEach(validate);
}

function issue(value) {
  requireValue(value === null || (Number.isSafeInteger(value) && value > 0));
}

function tick(value) {
  requireValue(value === null || (Number.isSafeInteger(value) && value >= 0));
}

function core(value) {
  requireValue(validId(value.id) && KINDS.includes(value.kind) && STATUSES.includes(value.status));
  requireValue(validTime(value.startedAt) && validTime(value.updatedAt));
  requireValue(value.id.slice(0, 20) === value.startedAt.slice(0, 19).replace(/:/g, '-') + 'Z');
  requireValue(Date.parse(value.updatedAt) >= Date.parse(value.startedAt));
  if (value.status === 'running') requireValue(value.completedAt === null);
  else requireValue(validTime(value.completedAt) && Date.parse(value.completedAt) >= Date.parse(value.startedAt)
    && Date.parse(value.completedAt) <= Date.parse(value.updatedAt));
  text(value.title, 240, true);
  text(value.summary);
}

function summary(value) {
  object(value, SUMMARY_KEYS);
  core(value);
  tick(value.tick);
  list(value.issueNumbers, 100, (number, index) => {
    issue(number);
    requireValue(number !== null && (index === 0 || value.issueNumbers[index - 1] < number));
  });
}

function reference(value) {
  object(value, ['label', 'url']);
  text(value.label, 240, true);
  text(value.url, 2048, true);
  requireValue(!/[\s\\]/.test(value.url));
  let url;
  try { url = new URL(value.url); } catch { throw formatError(); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.port);
  const authority = value.url.match(/^https:\/\/([^/?#]+)/)?.[1];
  if (authority === 'github.com') {
    const repo = '/AdamZmy/Automated-Screeps';
    requireValue(url.pathname === repo || url.pathname.startsWith(repo + '/'));
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch { throw formatError(); }
    requireValue(!decoded.includes('\\') && !decoded.split('/').some(part => part === '.' || part === '..'));
    requireValue(decoded === repo || decoded.startsWith(repo + '/'));
  } else requireValue(authority === 'screeps-energy-observatory.vercel.app');
}

function run(value) {
  object(value, RUN_KEYS);
  requireValue(value.schemaVersion === 1);
  core(value);
  if (value.game !== null) {
    object(value.game, ['shard', 'rooms', 'version', 'tick', 'fetchedAt']);
    if (value.game.shard !== null) text(value.game.shard, 32, true);
    if (value.game.rooms !== null) {
      list(value.game.rooms, 100, room => {
        text(room, 20, true);
        requireValue(/^[WE]\d+[NS]\d+$/.test(room));
      });
    }
    if (value.game.version !== null) text(value.game.version, 240);
    tick(value.game.tick);
    requireValue(value.game.fetchedAt === null || validTime(value.game.fetchedAt));
  }
  list(value.findings, 100, finding => {
    object(finding, ['severity', 'title', 'detail', 'evidence', 'issue']);
    requireValue(['info', 'warning', 'critical'].includes(finding.severity));
    text(finding.title, 240, true);
    text(finding.detail);
    list(finding.evidence, 50, entry => text(entry));
    issue(finding.issue);
  });
  list(value.tasks, 100, task => {
    object(task, ['issue', 'title', 'status', 'progress', 'next', 'owner']);
    issue(task.issue);
    text(task.title, 240, true);
    requireValue(['planned', 'ready', 'in-progress', 'verifying', 'blocked', 'done'].includes(task.status));
    text(task.progress);
    text(task.next);
    text(task.owner, 240);
  });
  list(value.actions, 100, action => {
    object(action, ['at', 'description', 'status', 'result']);
    requireValue(validTime(action.at) && ['planned', 'in-progress', 'done', 'failed'].includes(action.status));
    text(action.description);
    text(action.result);
  });
  list(value.checks, 100, check => {
    object(check, ['name', 'result', 'detail']);
    text(check.name, 240, true);
    requireValue(['passed', 'failed', 'pending'].includes(check.result));
    text(check.detail);
  });
  list(value.next, 100, item => text(item));
  list(value.references, 100, reference);
}

export function validateData(data, selection) {
  if (selection.type === 'run') {
    run(data);
    requireValue(data.id === selection.id);
    return data;
  }
  object(data, selection.type === 'root' ? ['schemaVersion', 'updatedAt', 'days', 'runs'] : ['schemaVersion', 'updatedAt', 'day', 'runs']);
  requireValue(data.schemaVersion === 1 && validTime(data.updatedAt));
  if (selection.type === 'root') {
    list(data.days, 10000, (day, index) => requireValue(validDay(day) && (index === 0 || data.days[index - 1] > day)));
  } else requireValue(data.day === selection.day);
  const ids = new Set();
  list(data.runs, selection.type === 'root' ? 50 : 10000, (entry, index) => {
    summary(entry);
    requireValue(!ids.has(entry.id));
    ids.add(entry.id);
    requireValue(index === 0 || Date.parse(data.runs[index - 1].startedAt) >= Date.parse(entry.startedAt));
    requireValue(selection.type === 'root' ? data.days.includes(entry.id.slice(0, 10)) : entry.id.slice(0, 10) === selection.day);
  });
  return data;
}

async function readBounded(response, maxBytes) {
  const declared = response.headers?.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new InspectionError('DATA_TOO_LARGE', '巡检日志超过安全大小限制。');
  }
  const reader = response.body?.getReader();
  if (!reader) throw formatError();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new InspectionError('DATA_TOO_LARGE', '巡检日志超过安全大小限制。');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, size)));
  } catch { throw formatError(); }
}

function safeError(error) {
  return error instanceof InspectionError ? error : new InspectionError('UPSTREAM_UNAVAILABLE', 'GitHub 巡检日志暂时无法读取，请稍后重试。');
}

// This reader deliberately does not read environment variables or accept host/header overrides.
export function createReader({fetchImpl = fetch, now = Date.now, timeoutMs = 8_000} = {}) {
  const entries = new Map();
  let activeFetches = 0, cacheBytes = 0;
  async function fresh(selection) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new InspectionError('UPSTREAM_TIMEOUT', 'GitHub 巡检日志读取超时，请稍后重试。', 504));
        controller.abort();
      }, timeoutMs);
    });
    try {
      const data = await Promise.race([deadline, (async () => {
        const url = SOURCE + selection.path;
        const response = await fetchImpl(url, {
          method: 'GET', headers: {Accept: 'application/json'}, credentials: 'omit', redirect: 'error', signal: controller.signal
        });
        if (response.redirected || (response.url && response.url !== url) || (response.status >= 300 && response.status < 400)) {
          throw new InspectionError('UPSTREAM_REDIRECT', '巡检日志来源发生重定向，已拒绝读取。');
        }
        if (response.status === 404) throw new InspectionError('NOT_FOUND', '尚未找到所请求的巡检日志，请确认日期或批次。', 404);
        if (response.status === 429) throw new InspectionError('RATE_LIMITED', 'GitHub 暂时限制读取，请稍后重试。', 503);
        if (!response.ok) throw new InspectionError('UPSTREAM_FAILED', 'GitHub 巡检日志暂时无法读取，请稍后重试。');
        return validateData(await readBounded(response, INDEX_BYTES[selection.type] || MAX_BYTES), selection);
      })()]);
      return {ok: true, source: 'github', fetchedAt: new Date(now()).toISOString(), stale: false, data};
    } finally { clearTimeout(timer); }
  }

  return async function read(requestUrl = '/api/inspections') {
    const selection = parseQuery(requestUrl);
    let entry = entries.get(selection.path);
    if (!entry) {
      if (entries.size >= MAX_ENTRIES) {
        const disposable = [...entries].find(([, item]) => !item.pending);
        if (!disposable) throw new InspectionError('BUSY', '巡检日志读取繁忙，请稍后重试。', 503);
        cacheBytes -= disposable[1].bytes;
        entries.delete(disposable[0]);
      }
      entry = {value: null, bytes: 0, expires: 0, pending: null, error: null, retryAt: 0};
      entries.set(selection.path, entry);
    }
    // Touch the entry so inactive dates are evicted before frequently viewed data.
    entries.delete(selection.path);
    entries.set(selection.path, entry);
    const fallback = () => {
      if (!entry.value) throw entry.error;
      return {...entry.value, stale: true, upstreamError: {code: entry.error.code, message: entry.error.message}};
    };
    if (entry.value && now() < entry.expires) return entry.value;
    if (entry.error && now() < entry.retryAt) return fallback();
    if (!entry.pending) {
      if (activeFetches >= MAX_ACTIVE_FETCHES) {
        entry.error = new InspectionError('BUSY', '巡检日志读取繁忙，请稍后重试。', 503);
        return fallback();
      }
      activeFetches++;
      entry.pending = fresh(selection).then(value => {
        cacheBytes -= entry.bytes;
        entry.bytes = Buffer.byteLength(JSON.stringify(value.data));
        cacheBytes += entry.bytes;
        entry.value = value;
        entry.expires = now() + CACHE_TTL;
        entry.error = null;
        entry.retryAt = 0;
        return value;
      }).catch(error => {
        entry.error = safeError(error);
        entry.retryAt = now() + RETRY_DELAY;
        return fallback();
      }).finally(() => {
        entry.pending = null;
        activeFetches--;
        for (const [key, item] of entries) {
          if (cacheBytes <= MAX_CACHE_BYTES) break;
          if (item.pending || item === entry) continue;
          cacheBytes -= item.bytes;
          entries.delete(key);
        }
      });
    }
    return entry.pending;
  };
}
