/*
 * Libre relay for the Insulin Dose Calculator – a Cloudflare Worker (the free plan is enough).
 *
 * It signs in to LibreLinkUp with the follower account kept in this Worker's secrets and answers
 * the calculator with ONLY the latest reading: the value (mg/dL), the time it was taken (UTC) and
 * the trend arrow. No names, no history. In KV it keeps only the LibreLinkUp sign-in, the server
 * the account lives on, which person the account follows and any pause after a refused sign-in.
 *
 * This uses LibreLinkUp in an unofficial way. It can stop working whenever Abbott changes LibreLinkUp.
 * The readings are a guide only – the person giving the insulin is responsible for the final dose.
 *
 * Settings (Cloudflare → this Worker → Settings → Variables and Secrets):
 *   LLU_EMAIL       Secret  email of the LibreLinkUp account that follows ONLY the child
 *   LLU_PASSWORD    Secret  its password
 *   RELAY_KEY       Secret  long random key (at least 16 characters); the calculator must send it
 *   ALLOWED_ORIGIN  Text    optional – default https://markwendelllontocdotcom.github.io
 *   LLU_REGION      Text    optional – e.g. ae (normally found automatically)
 *   LLU_VERSION     Text    optional – default 4.16.0
 *   LLU_PRODUCT     Text    optional – default llu.ios
 *   LLU_PATIENT_ID  Text    optional – only needed when the account follows more than one person
 * Required binding (Settings → Bindings → KV namespace), variable name LIBRE_KV. Without it every copy of
 * the Worker that Cloudflare starts would sign in again and could not keep the pause after a refused sign-in.
 */

const DEFAULTS = {
  origin: 'https://markwendelllontocdotcom.github.io',
  version: '4.16.0',
  product: 'llu.ios'
};
const READING_CACHE_MS = 20 * 1000;        // the same answer is reused for 20 s (the calculator asks once a minute)
const LOGIN_BLOCK_MS = 10 * 60 * 1000;     // after a refused sign-in, wait 10 min (repeated tries can lock the account)
const SHORT_BLOCK_MS = 2 * 60 * 1000;      // "too many requests" or terms to accept
const UPSTREAM_BLOCK_MS = 3 * 60 * 1000;   // LibreLinkUp not answering as expected
const SESSION_RENEW_MS = 10 * 60 * 1000;   // sign in again when the token has less than 10 min left
const KV_SESSION = 'llu-session-v1';
const KV_BLOCK = 'llu-block-v1';
const KV_HOST = 'llu-host-v1';
const KV_PATIENT = 'llu-patient-v1';
const KEEP_SECONDS = 365 * 24 * 3600;
const MIN_KEY_LENGTH = 16;

// Kept while Cloudflare keeps this copy of the Worker running; KV is what counts
let memory = { session: null, reading: null, signingIn: null };

export function resetMemory() {
  memory = { session: null, reading: null, signingIn: null };
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return json({ ok: false, reason: 'relay' }, 500, corsHeaders(request));
    }
  }
};

export async function handle(request, env, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  // Browsers may read the answer (so the calculator can say what is wrong); only the right address gets a reading
  const cors = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: Object.assign({}, cors, {
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Max-Age': '86400'
      })
    });
  }

  if (url.pathname === '/' && request.method === 'GET') return infoPage(env);
  if (url.pathname !== '/latest') return json({ ok: false, reason: 'not_found' }, 404, cors);
  if (request.method !== 'GET') return json({ ok: false, reason: 'method' }, 405, cors);
  if (origin && origin !== allowedOrigin(env)) return json({ ok: false, reason: 'origin' }, 403, cors);

  if (missingSettings(env).length || relayKey(env).length < MIN_KEY_LENGTH) return json({ ok: false, reason: 'setup' }, 500, cors);
  const auth = request.headers.get('Authorization') || '';
  const sent = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!sameText(sent, relayKey(env))) return json({ ok: false, reason: 'key' }, 401, cors);

  return json(await latestReading(env, now), 200, cors);
}

/* ---------------- The latest reading ---------------- */

async function latestReading(env, now) {
  if (memory.reading && now - memory.reading.at < READING_CACHE_MS) return memory.reading.body;
  const body = await fetchLatest(env, now);
  memory.reading = { at: now, body };
  return body;
}

async function fetchLatest(env, now) {
  const cred = await credentialTag(env);
  const block = await kvGet(env, KV_BLOCK);
  if (block && block.cred === cred && block.until > now) return fail(block.reason, Math.ceil((block.until - now) / 1000));

  const cfg = { product: env.LLU_PRODUCT || DEFAULTS.product, version: env.LLU_VERSION || DEFAULTS.version };
  let session = await loadSession(env, cred, now);
  if (session && session.version) cfg.version = session.version;
  let signedInNow = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!session) {
      if (signedInNow) return await blockFor(env, cred, 'upstream', LOGIN_BLOCK_MS, now); // at most one sign-in per request
      const result = await signInOnce(env, cfg, cred, now);
      if (!result.ok) {
        if (result.version && attempt < 2) { cfg.version = result.version; continue; }
        return result.reason === 'version' ? await blockFor(env, cred, 'upstream', UPSTREAM_BLOCK_MS, now) : result;
      }
      session = result.session;
      signedInNow = true;
    }

    const res = await callLLU(session.host + '/llu/connections', { headers: headers(cfg, session) });
    if (res.status === 401) {
      await dropSession(env);
      // A token we just got is refused: something changed at LibreLinkUp – pause instead of signing in again and again
      if (signedInNow) return await blockFor(env, cred, 'upstream', LOGIN_BLOCK_MS, now);
      session = null;                              // the saved token expired: sign in again (once)
      continue;
    }
    if (res.version && attempt < 2) {              // LibreLinkUp wants a newer app version
      cfg.version = res.version;                   // saved with the sign-in below once it works
      continue;
    }
    if (res.busy) return await blockFor(env, cred, 'busy', SHORT_BLOCK_MS, now);
    if (!res.ok || !res.body || (res.body.status !== undefined && res.body.status !== 0)) {
      return await blockFor(env, cred, 'upstream', UPSTREAM_BLOCK_MS, now);
    }
    if (session.version !== cfg.version) {
      session.version = cfg.version;
      await saveSession(env, session, now);
    }
    return await pickReading(res.body.data, env, cred, now);
  }
  return await blockFor(env, cred, 'upstream', UPSTREAM_BLOCK_MS, now);
}

async function pickReading(list, env, cred, now) {
  if (!Array.isArray(list)) return fail('upstream');
  if (list.length === 0) return fail('no_follow');
  let conn;
  if (env.LLU_PATIENT_ID) {
    conn = list.find((c) => c && String(c.patientId) === String(env.LLU_PATIENT_ID).trim());
    if (!conn) return fail('patient');
  } else if (list.length > 1) {
    return fail('many');                              // never guess whose reading it is
  } else {
    conn = list[0];
    // Remember whom the account follows; if that ever changes, stop rather than show someone else's reading
    const id = conn && conn.patientId !== undefined && conn.patientId !== null ? String(conn.patientId) : '';
    const pinned = await kvGet(env, KV_PATIENT);
    if (pinned && pinned.cred === cred && pinned.patientId !== id) return fail('patient_changed');
    if (!pinned || pinned.cred !== cred) await kvPut(env, KV_PATIENT, { cred, patientId: id }, KEEP_SECONDS);
  }
  const gm = conn && conn.glucoseMeasurement;
  const bg = gm ? Number(gm.ValueInMgPerDl) : NaN;
  if (!gm || !Number.isFinite(bg) || !gm.FactoryTimestamp) return fail('no_reading');
  const trend = Number(gm.TrendArrow);
  return {
    ok: true,
    bg,
    ts: String(gm.FactoryTimestamp),                  // UTC, e.g. "10/16/2026 1:05:12 PM"
    trend: Number.isInteger(trend) && trend >= 1 && trend <= 5 ? trend : null,
    fetchedAt: new Date(now).toISOString()            // lets the calculator check the phone's clock
  };
}

/* ---------------- Signing in ---------------- */

// Requests arriving together share one sign-in
function signInOnce(env, cfg, cred, now) {
  if (!memory.signingIn) {
    memory.signingIn = signIn(env, cfg, cred, now).finally(() => { memory.signingIn = null; });
  }
  return memory.signingIn;
}

async function signIn(env, cfg, cred, now) {
  const saved = await kvGet(env, KV_HOST);
  let host = regionHost(env.LLU_REGION) || (saved && saved.cred === cred && regionHost(saved.region)) || 'https://api.libreview.io';
  for (let hop = 0; hop < 3; hop++) {
    const res = await callLLU(host + '/llu/auth/login', {
      method: 'POST',
      headers: headers(cfg, null),
      body: JSON.stringify({ email: String(env.LLU_EMAIL).trim(), password: String(env.LLU_PASSWORD) })
    });
    if (res.version) return { ok: false, reason: 'version', version: res.version };
    const body = res.body;
    const d = (body && body.data) || {};

    // A lock-out says how long it lasts – honour that before anything else
    const lockout = d.data && Number(d.data.lockout);
    if ((body && body.status === 429) || lockout > 0) {
      return await blockFor(env, cred, 'locked', (lockout > 0 ? Math.max(lockout * 1000, SHORT_BLOCK_MS) : LOGIN_BLOCK_MS), now);
    }
    if (res.busy) return await blockFor(env, cred, 'busy', SHORT_BLOCK_MS, now);
    if (!body) return await blockFor(env, cred, 'upstream', UPSTREAM_BLOCK_MS, now);

    if (d.redirect && d.region) {                      // the account lives on another LibreLinkUp server
      const next = regionHost(d.region);
      if (!next) return await blockFor(env, cred, 'upstream', UPSTREAM_BLOCK_MS, now);
      host = next;
      continue;
    }
    if (body.status === 2) return await blockFor(env, cred, 'login', LOGIN_BLOCK_MS, now);
    if (body.status === 4 || d.step) return await blockFor(env, cred, 'terms', SHORT_BLOCK_MS, now);
    const token = d.authTicket && d.authTicket.token;
    const userId = d.user && d.user.id;
    if (body.status !== 0 || !token || !userId) return await blockFor(env, cred, 'upstream', UPSTREAM_BLOCK_MS, now);

    const expiresSec = Number(d.authTicket.expires);
    const session = {
      cred,
      host,
      token: String(token),
      accountId: await sha256Hex(String(userId)),   // LibreLinkUp wants the SHA-256 of the user id
      expires: Number.isFinite(expiresSec) && expiresSec > 0 ? expiresSec * 1000 : now + 60 * 60 * 1000,
      version: cfg.version
    };
    await saveSession(env, session, now);
    const region = (/^https:\/\/api-([a-z0-9]+)\.libreview\.io$/.exec(host) || [])[1] || '';
    if (region) await kvPut(env, KV_HOST, { cred, region }, KEEP_SECONDS);
    return { ok: true, session };
  }
  return await blockFor(env, cred, 'upstream', UPSTREAM_BLOCK_MS, now);
}

async function loadSession(env, cred, now) {
  const usable = (s) => s && s.cred === cred && s.token && s.host && s.expires - now >= SESSION_RENEW_MS;
  if (usable(memory.session)) return memory.session;
  const s = await kvGet(env, KV_SESSION);
  if (!usable(s)) return null;
  memory.session = s;
  return s;
}

async function saveSession(env, session, now) {
  memory.session = session;
  await kvPut(env, KV_SESSION, session, (session.expires - now) / 1000);
}

async function dropSession(env) {
  memory.session = null;
  try { await env.LIBRE_KV.delete(KV_SESSION); } catch (e) { /* ignore */ }
}

async function blockFor(env, cred, reason, ms, now) {
  await kvPut(env, KV_BLOCK, { reason, cred, until: now + ms }, ms / 1000);
  return fail(reason, Math.ceil(ms / 1000));
}

/* ---------------- Talking to LibreLinkUp ---------------- */

function headers(cfg, session) {
  const h = {
    accept: 'application/json',
    'content-type': 'application/json',
    'cache-control': 'no-cache',
    product: cfg.product,
    version: cfg.version
  };
  if (session) {
    h.authorization = 'Bearer ' + session.token;
    h['account-id'] = session.accountId;
  }
  return h;
}

// Returns { ok, status, body, busy, version }
async function callLLU(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    return { ok: false, status: 0, body: null };
  }
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  const out = { ok: res.ok, status: res.status, body };
  if (res.status === 429 || res.status === 430) out.busy = true;
  const min = body && body.status === 920 && body.data && body.data.minimumVersion;
  if (min && /^\d+(\.\d+){1,3}$/.test(String(min))) out.version = String(min);
  return out;
}

function regionHost(region) {
  const r = String(region || '').trim().toLowerCase();
  return /^[a-z0-9]{2,6}$/.test(r) ? 'https://api-' + r + '.libreview.io' : null;
}

/* ---------------- Small helpers ---------------- */

function fail(reason, retryAfter) {
  const out = { ok: false, reason };
  if (retryAfter) out.retryAfter = retryAfter;
  return out;
}

function relayKey(env) {
  return String(env.RELAY_KEY || '').trim();
}

function missingSettings(env) {
  const missing = ['LLU_EMAIL', 'LLU_PASSWORD', 'RELAY_KEY'].filter((k) => !String(env[k] || '').trim());
  if (!env.LIBRE_KV) missing.push('LIBRE_KV (KV binding)');
  return missing;
}

function allowedOrigin(env) {
  return String(env.ALLOWED_ORIGIN || DEFAULTS.origin).trim().replace(/\/+$/, '');
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }, extra || {})
  });
}

// Compares two texts in a way that takes the same time wherever they differ
function sameText(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0 && x.length >= MIN_KEY_LENGTH;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A short fingerprint of the account settings, so changing the email or password starts afresh
async function credentialTag(env) {
  return (await sha256Hex(String(env.LLU_EMAIL || '').trim() + '\n' + String(env.LLU_PASSWORD || ''))).slice(0, 16);
}

async function kvGet(env, key) {
  if (!env.LIBRE_KV) return null;
  try { return await env.LIBRE_KV.get(key, 'json'); } catch (e) { return null; }
}

async function kvPut(env, key, value, ttlSeconds) {
  if (!env.LIBRE_KV) return;
  try {
    await env.LIBRE_KV.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) });
  } catch (e) { /* ignore */ }
}

function randomKey() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => letters[b % letters.length]).join('');
}

// What you see when you open the Worker's address in a browser (never shows any reading)
function infoPage(env) {
  const missing = missingSettings(env);
  const shortKey = relayKey(env) !== '' && relayKey(env).length < MIN_KEY_LENGTH;
  const lines = ['Libre relay for the Insulin Dose Calculator', ''];
  if (missing.length) lines.push('Not set up yet. Missing: ' + missing.join(', ') + '.');
  else if (shortKey) lines.push('RELAY_KEY is too short. Use at least ' + MIN_KEY_LENGTH + ' characters.');
  else lines.push('Running. It only answers the calculator and only with the relay key.');
  if (relayKey(env).length < MIN_KEY_LENGTH) {
    lines.push('', 'A new random key you can use as RELAY_KEY (a different one every time this page loads):', randomKey());
  }
  lines.push('', 'Calculator address allowed: ' + allowedOrigin(env));
  lines.push('KV binding LIBRE_KV: ' + (env.LIBRE_KV ? 'yes' : 'MISSING'));
  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}
