// Automated tests for the Libre relay (libre-relay/worker.js) with a pretend LibreLinkUp.
// Run from the app folder with:  node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { handle, resetMemory } = await import('../libre-relay/worker.js');

const ORIGIN = 'https://markwendelllontocdotcom.github.io';
const KEY = 'Abcdefghijkmnopqrstuvwx';
const USER_ID = '6edac496-d24e-11ec-8e5d-0242ac110002';
const T0 = Date.parse('2026-10-16T13:00:00Z');

function fakeKV() {
  const store = new Map();
  return {
    store,
    async get(k, type) { const v = store.get(k); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); }
  };
}

let kv = fakeKV();
function baseEnv(extra) {
  return Object.assign({ LLU_EMAIL: 'follower@example.com', LLU_PASSWORD: 'secret-pass', RELAY_KEY: KEY, LIBRE_KV: kv }, extra || {});
}
// As if Cloudflare started a fresh copy of the Worker (only KV is left)
const restart = () => resetMemory();

function measurement(bg, ts, trend) {
  return { FactoryTimestamp: ts, Timestamp: 'local', ValueInMgPerDl: bg, Value: bg, TrendArrow: trend, isHigh: false, isLow: false, MeasurementColor: 1, GlucoseUnits: 1, type: 1 };
}
function connection(patientId, bg, ts, trend) {
  return { id: 'c-' + patientId, patientId, firstName: 'Child', lastName: 'Name', targetLow: 70, targetHigh: 180, glucoseMeasurement: measurement(bg, ts, trend) };
}

// Pretend LibreLinkUp. Every call is recorded; "script" decides the answers.
function fakeLibre(script) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), method: (init && init.method) || 'GET', headers: (init && init.headers) || {}, body: init && init.body };
    calls.push(call);
    const answer = script(call, calls);
    if (answer instanceof Error) throw answer;
    const status = answer.httpStatus || 200;
    const payload = answer.raw !== undefined ? answer.raw : JSON.stringify(answer.json);
    return new Response(payload, { status, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}
const logins = (calls) => calls.filter((c) => c.url.endsWith('/llu/auth/login')).length;

// A normal account in the UAE region with one connection. Every sign-in gives a new token.
function normalScript(opts) {
  const o = Object.assign({ bg: 142, ts: '10/16/2026 12:58:30 PM', trend: 4, connections: null }, opts || {});
  let tokens = 0;
  return (call) => {
    if (call.url === 'https://api.libreview.io/llu/auth/login') return { json: { status: 0, data: { redirect: true, region: 'ae' } } };
    if (call.url === 'https://api-ae.libreview.io/llu/auth/login') {
      tokens++;
      return { json: { status: 0, data: { user: { id: USER_ID, firstName: 'F' }, authTicket: { token: 'tok-' + tokens, expires: (T0 / 1000) + 3600, duration: 3600000 } } } };
    }
    if (call.url === 'https://api-ae.libreview.io/llu/connections') {
      return { json: { status: 0, data: typeof o.connections === 'function' ? o.connections() : (o.connections || [connection('p1', o.bg, o.ts, o.trend)]) } };
    }
    return { httpStatus: 404, json: { message: 'unknown' } };
  };
}

function req(opts) {
  const o = Object.assign({ path: '/latest', method: 'GET', origin: ORIGIN, key: KEY }, opts || {});
  const headers = {};
  if (o.origin) headers.Origin = o.origin;
  if (o.key !== null) headers.Authorization = 'Bearer ' + o.key;
  return new Request('https://libre-relay.example.workers.dev' + o.path, { method: o.method, headers });
}

async function latest(env, now, opts) {
  const res = await handle(req(opts), env, now);
  return { res, body: await res.json() };
}

test.beforeEach(() => { resetMemory(); kv = fakeKV(); });

test('Relay: browsers may ask, but only the calculator address gets an answer', async () => {
  const pre = await handle(req({ method: 'OPTIONS', key: null }), baseEnv(), T0);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const calls = fakeLibre(normalScript());
  const other = await latest(baseEnv(), T0, { origin: 'https://evil.example' });
  assert.equal(other.res.status, 403);
  assert.deepEqual(other.body, { ok: false, reason: 'origin' });     // readable, so the calculator can say why
  const wrongSetting = await latest(baseEnv({ ALLOWED_ORIGIN: 'https://someone-else.github.io/' }), T0);
  assert.equal(wrongSetting.body.reason, 'origin');
  assert.equal(calls.length, 0);
  // ALLOWED_ORIGIN may be written with a trailing slash
  fakeLibre(normalScript());
  assert.equal((await latest(baseEnv({ ALLOWED_ORIGIN: ORIGIN + '/' }), T0)).body.ok, true);
});

test('Relay: refuses a missing or wrong key and missing settings (KV included)', async () => {
  const calls = fakeLibre(normalScript());
  let r = await latest(baseEnv(), T0, { key: null });
  assert.equal(r.res.status, 401);
  assert.equal(r.body.reason, 'key');
  assert.equal(r.res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  r = await latest(baseEnv(), T0, { key: KEY + 'x' });
  assert.equal(r.res.status, 401);
  r = await latest(baseEnv({ LLU_PASSWORD: '' }), T0);
  assert.equal(r.body.reason, 'setup');
  r = await latest(baseEnv({ LIBRE_KV: undefined }), T0);
  assert.equal(r.body.reason, 'setup');
  r = await latest(baseEnv({ RELAY_KEY: 'short' }), T0, { key: 'short' });
  assert.equal(r.body.reason, 'setup');
  assert.equal(calls.length, 0, 'LibreLinkUp is never asked when the request is refused');
  // A space or line break pasted after the key in Cloudflare does not matter
  fakeLibre(normalScript());
  r = await latest(baseEnv({ RELAY_KEY: KEY + ' \n' }), T0);
  assert.equal(r.body.ok, true);
});

test('Relay: signs in (following the region), sends the right headers and returns only the reading', async () => {
  const calls = fakeLibre(normalScript());
  const { res, body } = await latest(baseEnv(), T0);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(body, { ok: true, bg: 142, ts: '10/16/2026 12:58:30 PM', trend: 4, fetchedAt: '2026-10-16T13:00:00.000Z' });
  assert.deepEqual(calls.map((c) => c.url), [
    'https://api.libreview.io/llu/auth/login',
    'https://api-ae.libreview.io/llu/auth/login',
    'https://api-ae.libreview.io/llu/connections'
  ]);
  assert.deepEqual(JSON.parse(calls[0].body), { email: 'follower@example.com', password: 'secret-pass' });
  assert.equal(calls[0].headers.product, 'llu.ios');
  assert.equal(calls[0].headers.version, '4.16.0');
  assert.equal(calls[0].headers.authorization, undefined);
  const conn = calls[2].headers;
  assert.equal(conn.authorization, 'Bearer tok-1');
  assert.equal(conn['account-id'], createHash('sha256').update(USER_ID).digest('hex'));
  assert.equal(conn.version, '4.16.0');
  assert.doesNotMatch(JSON.stringify(body), /Child|Name|p1|tok-1/);
});

test('Relay: LLU_REGION skips the redirect, and the server found is remembered', async () => {
  let calls = fakeLibre(normalScript());
  assert.equal((await latest(baseEnv({ LLU_REGION: 'AE' }), T0)).body.ok, true);
  assert.equal(calls[0].url, 'https://api-ae.libreview.io/llu/auth/login');
  assert.equal(calls.length, 2);
  // Without LLU_REGION: the first sign-in follows the redirect, later ones go straight to the right server
  kv = fakeKV(); restart();
  calls = fakeLibre(normalScript());
  await latest(baseEnv(), T0);
  await kv.delete('llu-session-v1'); restart();
  await latest(baseEnv(), T0 + 60000);
  assert.deepEqual(calls.slice(3).map((c) => c.url), ['https://api-ae.libreview.io/llu/auth/login', 'https://api-ae.libreview.io/llu/connections']);
});

test('Relay: reuses the answer for 20 s and the sign-in after that (also after a restart)', async () => {
  const calls = fakeLibre(normalScript());
  await latest(baseEnv(), T0);
  assert.equal(calls.length, 3);
  await latest(baseEnv(), T0 + 15000);
  assert.equal(calls.length, 3, 'same answer within 20 s');
  assert.equal((await latest(baseEnv(), T0 + 61000)).body.ok, true);
  assert.equal(calls.length, 4, 'only /llu/connections, no new sign-in');
  restart();
  assert.equal((await latest(baseEnv(), T0 + 122000)).body.ok, true);
  assert.equal(calls.length, 5, 'the sign-in kept in KV is used by a fresh copy');
  // A different account in the settings does not use the stored sign-in
  restart();
  await latest(baseEnv({ LLU_EMAIL: 'other@example.com' }), T0 + 183000);
  assert.equal(calls[5].url, 'https://api.libreview.io/llu/auth/login');
});

test('Relay: requests arriving together share one sign-in', async () => {
  const calls = fakeLibre(normalScript());
  const all = await Promise.all([0, 1, 2].map(() => handle(req(), baseEnv(), T0).then((r) => r.json())));
  assert.ok(all.every((b) => b.ok));
  assert.equal(logins(calls), 2, 'one sign-in (2 calls because of the region redirect)');
});

test('Relay: an expired saved token leads to one new sign-in', async () => {
  let refuse = false;
  const normal = normalScript();
  const calls = fakeLibre((call) => {
    if (call.url.endsWith('/llu/connections') && refuse && call.headers.authorization === 'Bearer tok-1') {
      return { httpStatus: 401, json: { message: 'Unauthorized' } };
    }
    return normal(call);
  });
  await latest(baseEnv(), T0);                      // signs in with tok-1
  refuse = true;
  const { body } = await latest(baseEnv(), T0 + 61000);
  assert.equal(body.ok, true);
  assert.deepEqual(calls.slice(3).map((c) => c.url.replace('https://', '') + (c.headers.authorization ? ' ' + c.headers.authorization : '')), [
    'api-ae.libreview.io/llu/connections Bearer tok-1',
    'api-ae.libreview.io/llu/auth/login',
    'api-ae.libreview.io/llu/connections Bearer tok-2'
  ]);
});

test('Relay: if even a brand-new token is refused it pauses 10 minutes instead of signing in again and again', async () => {
  const normal = normalScript();
  const calls = fakeLibre((call) => (call.url.endsWith('/llu/connections') ? { httpStatus: 401, json: { message: 'AccountIdMismatch' } } : normal(call)));
  let r = await latest(baseEnv(), T0);
  assert.deepEqual(r.body, { ok: false, reason: 'upstream', retryAfter: 600 });
  assert.equal(logins(calls), 2);
  for (let m = 1; m <= 9; m++) {
    restart();                                      // even in fresh copies of the Worker
    r = await latest(baseEnv(), T0 + m * 60000);
    assert.equal(r.body.reason, 'upstream');
  }
  assert.equal(logins(calls), 2, 'no further sign-ins during the pause');
});

test('Relay: uses a newer app version when LibreLinkUp asks for one (status 920)', async () => {
  const normal = normalScript();
  const calls = fakeLibre((call) => {
    if (call.headers.version === '4.16.0') return { httpStatus: 403, json: { status: 920, data: { minimumVersion: '4.18.0' } } };
    return normal(call);
  });
  const { body } = await latest(baseEnv(), T0);
  assert.equal(body.ok, true);
  assert.equal(calls[0].headers.version, '4.16.0');
  assert.ok(calls.slice(1).every((c) => c.headers.version === '4.18.0'));
  restart();
  await latest(baseEnv(), T0 + 61000);
  assert.equal(calls[calls.length - 1].headers.version, '4.18.0', 'the newer version is remembered');
});

test('Relay: wrong password pauses 10 minutes (even in fresh copies), a changed password is tried straight away', async () => {
  const calls = fakeLibre((call) => {
    if (call.url.endsWith('/llu/auth/login')) return { json: { status: 2, error: { message: 'incorrect username/password' } } };
    return { httpStatus: 500, json: {} };
  });
  let r = await latest(baseEnv(), T0);
  assert.deepEqual(r.body, { ok: false, reason: 'login', retryAfter: 600 });
  assert.equal(calls.length, 1);
  for (let m = 1; m <= 9; m++) {
    restart();
    r = await latest(baseEnv(), T0 + m * 60000);
    assert.equal(r.body.reason, 'login');
  }
  assert.equal(r.body.retryAfter, 60);
  assert.equal(calls.length, 1, 'no new sign-in while paused');
  restart();
  await latest(baseEnv({ LLU_PASSWORD: 'fixed-pass' }), T0 + 9.5 * 60000);
  assert.equal(calls.length, 2, 'a changed password is tried straight away');
  restart();
  await latest(baseEnv(), T0 + 21 * 60000);
  assert.equal(calls.length, 3, 'the old password is tried again after the pause');
});

test('Relay: terms, lock-out (either way LibreLinkUp says it), "too many requests" and odd answers are paused', async () => {
  fakeLibre(() => ({ json: { status: 4, data: { step: { type: 'tou', componentName: 'AcceptDocument' } } } }));
  assert.deepEqual((await latest(baseEnv(), T0)).body, { ok: false, reason: 'terms', retryAfter: 120 });
  kv = fakeKV(); restart();
  fakeLibre(() => ({ json: { status: 429, data: { code: 60, data: { lockout: 300 }, message: 'locked' } } }));
  assert.deepEqual((await latest(baseEnv(), T0)).body, { ok: false, reason: 'locked', retryAfter: 300 });
  kv = fakeKV(); restart();
  fakeLibre(() => ({ httpStatus: 429, json: { status: 429, data: { code: 60, data: { lockout: 900 }, message: 'locked' } } }));
  assert.deepEqual((await latest(baseEnv(), T0)).body, { ok: false, reason: 'locked', retryAfter: 900 });
  kv = fakeKV(); restart();
  fakeLibre(() => ({ httpStatus: 430, raw: 'Too many' }));
  assert.deepEqual((await latest(baseEnv(), T0)).body, { ok: false, reason: 'busy', retryAfter: 120 });
  kv = fakeKV(); restart();
  const calls = fakeLibre(() => ({ json: { status: 7, data: {} } }));
  assert.deepEqual((await latest(baseEnv(), T0)).body, { ok: false, reason: 'upstream', retryAfter: 180 });
  restart();
  await latest(baseEnv(), T0 + 60000);
  assert.equal(calls.length, 1, 'not asked again during the 3-minute pause');
});

test('Relay: never guesses whose reading it is', async () => {
  const two = [connection('p1', 142, '10/16/2026 12:58:30 PM', 4), connection('p2', 250, '10/16/2026 12:59:00 PM', 5)];
  fakeLibre(normalScript({ connections: two }));
  assert.equal((await latest(baseEnv(), T0)).body.reason, 'many');
  restart();
  fakeLibre(normalScript({ connections: two }));
  assert.equal((await latest(baseEnv({ LLU_PATIENT_ID: 'p2' }), T0)).body.bg, 250);
  restart();
  fakeLibre(normalScript({ connections: two }));
  assert.equal((await latest(baseEnv({ LLU_PATIENT_ID: 'p9' }), T0)).body.reason, 'patient');
  restart();
  fakeLibre(normalScript({ connections: [] }));
  assert.equal((await latest(baseEnv(), T0)).body.reason, 'no_follow');
  restart();
  fakeLibre(normalScript({ connections: [{ patientId: 'p1' }] }));
  assert.equal((await latest(baseEnv(), T0)).body.reason, 'no_reading');
});

test('Relay: stops if the one person the account follows is ever someone else', async () => {
  let who = 'p1';
  fakeLibre(normalScript({ connections: () => [connection(who, who === 'p1' ? 142 : 300, '10/16/2026 12:58:30 PM', 4)] }));
  assert.equal((await latest(baseEnv(), T0)).body.bg, 142);
  who = 'p7';
  restart();
  assert.equal((await latest(baseEnv(), T0 + 61000)).body.reason, 'patient_changed');
  // LLU_PATIENT_ID decides when it is set
  restart();
  assert.equal((await latest(baseEnv({ LLU_PATIENT_ID: 'p7' }), T0 + 122000)).body.bg, 300);
});

test('Relay: odd trend numbers are dropped and network failures are reported', async () => {
  fakeLibre(normalScript({ trend: 9 }));
  assert.equal((await latest(baseEnv(), T0)).body.trend, null);
  kv = fakeKV(); restart();
  fakeLibre(() => new Error('offline'));
  assert.equal((await latest(baseEnv(), T0)).body.reason, 'upstream');
  kv = fakeKV(); restart();
  fakeLibre(() => ({ raw: '<html>maintenance</html>' }));
  assert.equal((await latest(baseEnv(), T0)).body.reason, 'upstream');
});

test('Relay: the address on its own shows set-up help and never a reading', async () => {
  const calls = fakeLibre(normalScript());
  let res = await handle(new Request('https://libre-relay.example.workers.dev/'), {}, T0);
  let text = await res.text();
  assert.match(text, /Not set up yet\. Missing: LLU_EMAIL, LLU_PASSWORD, RELAY_KEY, LIBRE_KV \(KV binding\)/);
  assert.match(text, /\n[A-Za-z2-9]{24}\n/);
  assert.match(text, /KV binding LIBRE_KV: MISSING/);
  res = await handle(new Request('https://libre-relay.example.workers.dev/'), baseEnv(), T0);
  text = await res.text();
  assert.match(text, /Running/);
  assert.match(text, /KV binding LIBRE_KV: yes/);
  assert.doesNotMatch(text, new RegExp(KEY));
  assert.equal(calls.length, 0);
  res = await handle(req({ path: '/other' }), baseEnv(), T0);
  assert.equal(res.status, 404);
});

test('Relay: the info page shows the last LibreLinkUp problem (no secrets) and when it works again', async () => {
  const info = async () => (await handle(new Request('https://libre-relay.example.workers.dev/'), baseEnv(), T0)).text();
  assert.match(await info(), /LibreLinkUp: no problems noted\./);
  // LibreLinkUp refuses the brand-new token
  const normal = normalScript();
  fakeLibre((call) => (call.url.endsWith('/llu/connections') ? { httpStatus: 401, json: { message: 'AccountIdMismatch' } } : normal(call)));
  await latest(baseEnv(), T0);
  let text = await info();
  assert.match(text, /Last LibreLinkUp problem \(2026-10-16T13:00:00\.000Z, UTC\): upstream at connections – HTTP 401, "AccountIdMismatch"/);
  assert.doesNotMatch(text, /follower@example\.com|secret-pass|tok-1|Abcdefghijk/);
  // A page that is not JSON (e.g. "Access denied") is summed up by its title
  kv = fakeKV(); restart();
  fakeLibre(() => ({ httpStatus: 403, raw: '<html><head><title>Access Denied</title></head><body>…</body></html>' }));
  await latest(baseEnv(), T0);
  assert.match(await info(), /upstream at sign-in – HTTP 403, "Access Denied"/);
  // Working again: noted once, not on every reading
  kv = fakeKV(); restart();
  await kv.put('llu-last-v1', JSON.stringify({ ok: false, at: 'x', reason: 'upstream', step: 'sign-in', http: 403, status: null, message: 'Access Denied' }));
  const calls = fakeLibre(normalScript());
  let writes = 0;
  const put = kv.put.bind(kv);
  kv.put = async (k, v) => { if (k === 'llu-last-v1') writes++; return put(k, v); };
  await latest(baseEnv(), T0);
  await latest(baseEnv(), T0 + 61000);
  await latest(baseEnv(), T0 + 122000);
  assert.equal(writes, 1);
  assert.match(await info(), /LibreLinkUp: working again since 2026-10-16T13:00:00\.000Z/);
  // The relay says who it is to LibreLinkUp
  assert.equal(calls[0].headers['user-agent'], 'LibreLinkUp/4.16.0');
});
