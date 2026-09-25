import test from 'node:test';
import assert from 'node:assert/strict';
import {createReader, InspectionError, parseQuery, validateData} from '../lib/inspections.js';
import {createHandler} from '../api/inspections.js';

const time = '2026-09-25T09:15:00Z';
const current = Date.parse(time);
const id = '2026-09-25T09-15-00Z-example';
const base = 'https://raw.githubusercontent.com/AdamZmy/Automated-Screeps/main/operations/inspections/';
const summary = {id, kind: 'scheduled', startedAt: time, updatedAt: time, completedAt: null, status: 'running', title: '巡检', summary: '观察', tick: null, issueNumbers: [4]};
const root = {schemaVersion: 1, updatedAt: time, days: ['2026-09-25'], runs: [summary]};
const day = {schemaVersion: 1, updatedAt: time, day: '2026-09-25', runs: [summary]};
const run = {
  schemaVersion: 1, ...Object.fromEntries(Object.entries(summary).filter(([key]) => !['tick', 'issueNumbers'].includes(key))),
  game: {shard: 'shard1', rooms: ['W21N26'], version: null, tick: null, fetchedAt: null},
  findings: [{severity: 'warning', title: '供能不足', detail: '等待确认', evidence: ['tick 100'], issue: 4}],
  tasks: [{issue: 4, title: '确认供能', status: 'verifying', progress: '开始观察', next: '复查遥测', owner: '协调者'}],
  actions: [{at: time, description: '读取遥测', status: 'done', result: '已读取'}],
  checks: [{name: '持续运行', result: 'pending', detail: '等待下一轮'}],
  next: ['复查'], references: [{label: 'Issue', url: 'https://github.com/AdamZmy/Automated-Screeps/issues/4'}, {label: '监控', url: 'https://screeps-energy-observatory.vercel.app/#layout'}]
};
const json = data => new Response(JSON.stringify(data));
const isError = code => error => error instanceof InspectionError && error.code === code;
function response() {
  return {
    statusCode: 200, headers: {}, body: undefined, ended: false,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; this.ended = true; return this; },
    end() { this.ended = true; return this; }
  };
}

test('selectors produce only the fixed root, UTC day, and batch paths', () => {
  assert.deepEqual(parseQuery(), {type: 'root', path: 'index.json'});
  assert.deepEqual(parseQuery('/api/inspections?day=2024-02-29'), {type: 'day', day: '2024-02-29', path: '2024-02-29/index.json'});
  assert.equal(parseQuery(`/api/inspections?id=${id}`).path, `2026-09-25/${id}.json`);
});

test('query traversal, unknown parameters, duplicate selectors, invalid dates and malicious URLs never fetch', async () => {
  let calls = 0;
  const read = createReader({fetchImpl: async () => { calls++; return json(root); }});
  const queries = [
    '?day=../secret', '?day=%2e%2e%2fsecret', '?id=..%252fsecret', '?url=https://evil.example',
    '?day=2026-09-25&day=2026-09-25', `?id=${id}&day=2026-09-25`, '?day[]=2026-09-25',
    '?day=2026-02-29', '?day=2026-13-01', '?day=', `?id=${id}.json`, '?id=2026-09-25T25-00-00Z-invalid',
    '?id=2026-09-25T09-15-00Z-UPPER', '?id=2026-09-25T09-15-00Z-' + 'x'.repeat(97),
    '?id=https%3A%2F%2Fevil.example', '?day=%', '?day=2026-09-25#hidden', '?day=2026-09-25%00', '?other=value',
    '?day=2026-09-25&__proto__=anything'
  ];
  for (const query of queries) await assert.rejects(read('/api/inspections' + query), isError('INVALID_QUERY'), query);
  for (const url of ['https://evil.example/api/inspections', '//evil.example/api/inspections', '/api/inspections/../../secret', '/other?day=2026-09-25']) {
    await assert.rejects(read(url), isError('INVALID_QUERY'), url);
  }
  assert.equal(calls, 0);
});

test('normal root, day and batch detail are wrapped and unknown measurements stay null', async () => {
  const paths = [];
  const read = createReader({now: () => current, fetchImpl: async url => {
    paths.push(url);
    return json(url === base + 'index.json' ? root : url.endsWith('/index.json') ? day : run);
  }});
  for (const [query, data] of [['', root], ['?day=2026-09-25', day], [`?id=${id}`, run]]) {
    assert.deepEqual(await read('/api/inspections' + query), {ok: true, source: 'github', fetchedAt: new Date(current).toISOString(), stale: false, data});
  }
  assert.deepEqual(paths, [base + 'index.json', base + '2026-09-25/index.json', base + `2026-09-25/${id}.json`]);
});

test('explicit empty indexes succeed; an upstream 404 is an error and never an empty success', async () => {
  const emptyRoot = {...root, days: [], runs: []};
  assert.deepEqual((await createReader({fetchImpl: async () => json(emptyRoot)})()).data, emptyRoot);
  const emptyDay = {...day, runs: []};
  assert.deepEqual((await createReader({fetchImpl: async () => json(emptyDay)})('/api/inspections?day=2026-09-25')).data, emptyDay);
  const missing = createReader({fetchImpl: async () => new Response('PRIVATE UPSTREAM BODY', {status: 404})});
  await assert.rejects(missing(), error => error.code === 'NOT_FOUND' && error.status === 404 && !error.message.includes('PRIVATE'));
});

test('request has no server tokens, authorization, cookies or user headers and refuses redirects', async () => {
  process.env.SCREEPS_TOKEN = 'SCREEPS_SECRET_SENTINEL';
  process.env.GITHUB_TOKEN = 'GITHUB_SECRET_SENTINEL';
  const read = createReader({fetchImpl: async (url, options) => {
    assert.equal(url, base + 'index.json');
    assert.deepEqual(options.headers, {Accept: 'application/json'});
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert(options.signal instanceof AbortSignal);
    assert(!JSON.stringify(options).includes('SECRET_SENTINEL'));
    return json(root);
  }});
  const output = response();
  await createHandler({read})({method: 'GET', url: '/api/inspections', headers: {Authorization: 'USER_SECRET_SENTINEL', Cookie: 'PRIVATE'}}, output);
  assert.equal(output.statusCode, 200);
  assert(!JSON.stringify(output.body).includes('SECRET_SENTINEL'));
});

test('redirect status, redirected response, and unexpected response origins are rejected', async () => {
  const upstreams = [
    new Response('', {status: 302, headers: {Location: 'https://evil.example'}}),
    {redirected: true, status: 200, ok: true},
    {url: 'https://evil.example/index.json', status: 200, ok: true}
  ];
  for (const upstream of upstreams) await assert.rejects(createReader({fetchImpl: async () => upstream})(), isError('UPSTREAM_REDIRECT'));
});

test('references reject external, deceptive, credentialed, insecure and cross-repository URLs', () => {
  for (const url of [
    'javascript:alert(1)', 'http://github.com/AdamZmy/Automated-Screeps', 'https://evil.example',
    'https://github.com.evil.example/AdamZmy/Automated-Screeps', 'https://github.com/Other/Repository',
    'https://github.com/AdamZmy/Automated-Screeps-other', 'https://github.com/AdamZmy/Automated-Screeps/../../Other',
    'https://github.com/AdamZmy/Automated-Screeps/%2e%2e%2fOther', 'https://token@github.com/AdamZmy/Automated-Screeps',
    'https://screeps-energy-observatory.vercel.app.evil.example', 'https://screeps-energy-observatory.vercel.app:444/',
    'https://github.com\\@evil.example/AdamZmy/Automated-Screeps'
  ]) {
    assert.throws(() => validateData({...run, references: [{label: 'bad', url}]}, parseQuery(`/api/inspections?id=${id}`)), isError('INVALID_DATA'), url);
  }
});

test('schema rejects unknown fields at every nesting level instead of relaying private data', () => {
  const selection = parseQuery(`/api/inspections?id=${id}`);
  for (const path of [[], ['game'], ['findings', 0], ['tasks', 0], ['actions', 0], ['checks', 0], ['references', 0]]) {
    const data = structuredClone(run);
    let item = data;
    for (const key of path) item = item[key];
    item.secretToken = 'PRIVATE';
    assert.throws(() => validateData(data, selection), isError('INVALID_DATA'), JSON.stringify(path));
  }
  assert.throws(() => validateData({...root, private: true}, parseQuery()), isError('INVALID_DATA'));
  assert.throws(() => validateData({...root, runs: [{...summary, credentials: 'PRIVATE'}]}, parseQuery()), isError('INVALID_DATA'));
});

test('schema checks identity, UTC timestamps, enums, array/string bounds and index consistency', () => {
  const selection = parseQuery(`/api/inspections?id=${id}`);
  const invalidRuns = [
    {...run, schemaVersion: 2}, {...run, id: '2026-09-25T09-15-00Z-other'}, {...run, startedAt: '2026-09-25T10:15:00Z'},
    {...run, updatedAt: '2026-09-25T08:15:00Z'}, {...run, updatedAt: '2026-09-25T09:15:00+00:00'},
    {...run, status: 'completed'}, {...run, completedAt: time}, {...run, kind: 'fake'},
    {...run, title: 'x'.repeat(241)}, {...run, next: Array(101).fill('x')},
    {...run, game: {...run.game, tick: -1}}, {...run, findings: [{...run.findings[0], severity: 'unknown'}]},
    {...run, tasks: [{...run.tasks[0], issue: 0}]}, {...run, checks: [{...run.checks[0], result: true}]}
  ];
  for (const data of invalidRuns) assert.throws(() => validateData(data, selection), isError('INVALID_DATA'));
  for (const data of [
    {...root, days: []}, {...root, days: ['2026-09-25', '2026-09-25']}, {...root, days: ['2026-09-24', '2026-09-25']},
    {...root, runs: [summary, summary]}, {...root, runs: [{...summary, issueNumbers: [4, 4]}]},
    {...root, runs: [{...summary, issueNumbers: [5, 4]}]}, {...root, runs: Array(51).fill(summary)}
  ]) assert.throws(() => validateData(data, parseQuery()), isError('INVALID_DATA'));
  assert.throws(() => validateData({...day, day: '2026-09-24'}, parseQuery('/api/inspections?day=2026-09-25')), isError('INVALID_DATA'));
});

test('terminal statuses and setup entries without game observations are valid', () => {
  for (const status of ['completed', 'blocked', 'skipped', 'failed']) {
    const data = {...run, kind: 'setup', status, completedAt: time, game: null};
    assert.equal(validateData(data, parseQuery(`/api/inspections?id=${id}`)), data);
  }
  const unknownGame = {...run, game: {shard: null, rooms: null, version: null, tick: null, fetchedAt: null}};
  assert.equal(validateData(unknownGame, parseQuery(`/api/inspections?id=${id}`)), unknownGame);
  assert.equal(validateData({...run, summary: '🌍'.repeat(4000)}, parseQuery(`/api/inspections?id=${id}`)).summary.length, 8000);
});

test('day indexes preserve more than 1000 batches within their separate size limit', async () => {
  const runs = Array.from({length: 1001}, (_, index) => {
    const startedAt = new Date(current - index * 1000).toISOString();
    return {...summary, summary: '观察'.repeat(30), startedAt, updatedAt: startedAt, id: startedAt.slice(0, 19).replace(/:/g, '-') + 'Z-example'};
  });
  const data = {...day, runs};
  assert(Buffer.byteLength(JSON.stringify(data)) > 256 * 1024);
  const read = createReader({fetchImpl: async () => json(data)});
  assert.equal((await read('/api/inspections?day=2026-09-25')).data.runs.length, 1001);
});

test('bounded streaming rejects declared and actual oversized bodies, malformed JSON and invalid UTF-8', async () => {
  for (const upstream of [new Response('small', {headers: {'Content-Length': '262145'}}), new Response('中'.repeat(90_000))]) {
    await assert.rejects(createReader({fetchImpl: async () => upstream})(`/api/inspections?id=${id}`), isError('DATA_TOO_LARGE'));
  }
  for (const [query, size] of [['', 1024 * 1024], ['?day=2026-09-25', 8 * 1024 * 1024]]) {
    await assert.rejects(createReader({fetchImpl: async () => new Response('small', {headers: {'Content-Length': String(size + 1)}})})('/api/inspections' + query), isError('DATA_TOO_LARGE'));
  }
  for (const upstream of [new Response('{bad json PRIVATE}'), new Response(new Uint8Array([0xc3, 0x28]))]) {
    await assert.rejects(createReader({fetchImpl: async () => upstream})(), isError('INVALID_DATA'));
  }
});

test('timeout covers both fetch and body streaming and aborts the upstream request', async () => {
  let signal;
  const stalledFetch = createReader({timeoutMs: 10, fetchImpl: async (url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }});
  await assert.rejects(stalledFetch(), error => error.code === 'UPSTREAM_TIMEOUT' && error.status === 504);
  assert.equal(signal.aborted, true);
  const stalledBody = createReader({timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({start() {}}))});
  await assert.rejects(stalledBody(), isError('UPSTREAM_TIMEOUT'));
});

test('failures are safe, briefly throttled, and never publish upstream bodies or exception details', async () => {
  let clock = current, calls = 0;
  const read = createReader({now: () => clock, fetchImpl: async () => { calls++; throw new Error('SECRET_SENTINEL private-host.internal'); }});
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(read(), error => error.code === 'UPSTREAM_UNAVAILABLE' && !error.message.includes('SECRET') && !error.message.includes('internal'));
  assert.equal(calls, 1);
  clock += 10_001;
  await assert.rejects(read());
  assert.equal(calls, 2);
  for (const [status, code] of [[500, 'UPSTREAM_FAILED'], [429, 'RATE_LIMITED']]) {
    await assert.rejects(createReader({fetchImpl: async () => new Response('SECRET_SENTINEL', {status})})(), isError(code));
  }
});

test('fresh cache deduplicates parallel reads and separately caches each selector', async () => {
  let clock = current, calls = 0;
  const read = createReader({now: () => clock, fetchImpl: async url => { calls++; return json(url === base + 'index.json' ? root : day); }});
  await Promise.all([read(), read(), read()]);
  assert.equal(calls, 1);
  clock += 29_000;
  await read();
  assert.equal(calls, 1);
  await read('/api/inspections?day=2026-09-25');
  assert.equal(calls, 2);
  clock += 1001;
  await read();
  assert.equal(calls, 3);
});

test('parallel requests are bounded even when each asks for a different valid day', async () => {
  const responses = [];
  const read = createReader({fetchImpl: async url => new Promise(resolve => responses.push(() => resolve(json({...day, day: url.slice(base.length, base.length + 10), runs: []}))))});
  const pending = Array.from({length: 8}, (_, index) => read(`/api/inspections?day=2026-09-${String(index + 1).padStart(2, '0')}`));
  await assert.rejects(read('/api/inspections?day=2026-09-09'), isError('BUSY'));
  assert.equal(responses.length, 8);
  responses.forEach(resolve => resolve());
  await Promise.all(pending);
});

test('expired cache is explicitly stale on failure, retains fetchedAt, and recovers after retry', async () => {
  let clock = current, calls = 0;
  const read = createReader({now: () => clock, fetchImpl: async () => {
    calls++;
    return calls === 2 ? new Response('PRIVATE', {status: 404}) : json(root);
  }});
  const first = await read();
  clock += 30_001;
  const stale = await read();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.equal(stale.upstreamError.code, 'NOT_FOUND');
  assert.deepEqual(stale.data, root);
  assert.deepEqual(await read(), stale);
  assert.equal(calls, 2);
  clock += 10_001;
  const recovered = await read();
  assert.equal(recovered.stale, false);
  assert(!Object.hasOwn(recovered, 'upstreamError'));
  assert.notEqual(recovered.fetchedAt, first.fetchedAt);
});

test('handler provides short CDN caching for fresh data and no-store for stale or failed data', async () => {
  const fresh = {ok: true, source: 'github', fetchedAt: time, stale: false, data: root};
  for (const stale of [false, true]) {
    const output = response();
    await createHandler({read: async () => ({...fresh, stale})})({method: 'GET', url: '/api/inspections'}, output);
    assert.equal(output.statusCode, 200);
    assert.equal(output.headers['X-Content-Type-Options'], 'nosniff');
    assert.match(output.headers['Cache-Control'], stale ? /no-store/ : /s-maxage=15/);
    assert.match(output.headers['Vercel-CDN-Cache-Control'], stale ? /no-store/ : /s-maxage=15/);
  }
  const output = response();
  await createHandler({read: async () => { throw new Error('SECRET_SENTINEL'); }})({method: 'GET', url: '/api/inspections'}, output);
  assert.equal(output.statusCode, 502);
  assert.equal(output.headers['Cache-Control'], 'no-store');
  assert.deepEqual(output.body, {ok: false, error: {code: 'UNAVAILABLE', message: '巡检日志暂时不可用，请稍后重试。'}});
});

test('GET and HEAD share validation/status/cache headers; all HEAD responses have no body', async () => {
  for (const [url, read, status] of [
    ['/api/inspections', async () => ({ok: true, stale: false, data: root}), 200],
    ['/api/inspections?unexpected=1', async () => { assert.fail('invalid query must not read'); }, 400],
    ['/api/inspections', async () => { throw new InspectionError('NOT_FOUND', '没有找到', 404); }, 404]
  ]) {
    const handler = createHandler({read}), head = response(), get = response();
    await handler({method: 'HEAD', url}, head);
    await handler({method: 'GET', url}, get);
    assert.equal(head.statusCode, status);
    assert.equal(head.statusCode, get.statusCode);
    assert.deepEqual(head.headers, get.headers);
    assert.equal(head.body, undefined);
    assert.equal(head.ended, true);
    assert(get.body);
  }
});

test('mutating methods are rejected without calling upstream', async () => {
  const handler = createHandler({read: async () => { assert.fail('read must not run'); }});
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const output = response();
    await handler({method, url: '/api/inspections'}, output);
    assert.equal(output.statusCode, 405);
    assert.equal(output.headers.Allow, 'GET, HEAD');
    assert.equal(output.body.error.code, 'METHOD_NOT_ALLOWED');
  }
});
