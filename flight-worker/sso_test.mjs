/**
 * OVRFLIGHT - NTHSKY SSO conformance test (ACCESS-STANDARD §9.5)
 *
 * Extracts the REAL functions out of worker.js and drives them against an
 * in-memory D1 stub that THROWS on unrecognized SQL, so a query-shape change
 * fails loudly here instead of passing a forgiving mock and breaking in prod.
 *
 * Run: node flight-worker/sso_test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'worker.js'), 'utf8');

/* ---- extract the real implementation ---- */
function grab(name, kind = 'function') {
  const re = kind === 'const'
    ? new RegExp(`const ${name} = [\\s\\S]*?;\\n`)
    : new RegExp(`(async )?function ${name}\\([\\s\\S]*?\\n\\}\\n`);
  const m = src.match(re);
  if (!m) throw new Error('could not extract ' + name);
  return m[0];
}

const bundle = [
  'const SSO_SITE = "ovrflight";',
  'const LOCAL_ROLES = ["user","staff","super_admin"];',
  'const SSO_RANK = { user: 0, staff: 1, super_admin: 2 };',
  'let uidCounter = 0;',
  'const uid = () => "id-" + (++uidCounter);',
  grab('ssoB64urlDecode'),
  grab('ssoHmacHex'),
  grab('ssoTimingSafeEq'),
  grab('ssoVerifyTicket'),
  grab('ssoMapHubRole'),
  grab('logAppError'),
  grab('ssoUpsertUser'),
  'export { ssoVerifyTicket, ssoMapHubRole, ssoUpsertUser, ssoHmacHex };',
].join('\n');

const mod = await import('data:text/javascript;base64,' + Buffer.from(bundle).toString('base64'));
const { ssoVerifyTicket, ssoMapHubRole, ssoUpsertUser, ssoHmacHex } = mod;

/* ---- D1 stub: recognizes exactly the queries the real code issues ---- */
function makeDB(users = []) {
  const state = { users: users.map((u) => ({ ...u })), errors: [] };
  const db = {
    prepare(sql) {
      const q = sql.replace(/\s+/g, ' ').trim();
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() {
          if (/^SELECT id, email, name, platform_role, designation, designation_status, nthsky_uid FROM users WHERE email = \?$/.test(q)) {
            return state.users.find((u) => u.email === args[0]) || null;
          }
          throw new Error('UNRECOGNIZED SQL (first): ' + q);
        },
        async run() {
          if (/^UPDATE users SET nthsky_uid = \?, platform_role = \?, last_login = datetime\('now'\) WHERE id = \?$/.test(q)) {
            const u = state.users.find((x) => x.id === args[2]);
            if (!u) throw new Error('UPDATE hit no row');
            u.nthsky_uid = args[0]; u.platform_role = args[1]; u.last_login = 'now';
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO users \(id, email, password_hash, name, designation, designation_status, platform_role, nthsky_uid, last_login\)/.test(q)) {
            state.users.push({ id: args[0], email: args[1], name: args[2],
              platform_role: args[3], nthsky_uid: args[4],
              designation: 'commercial', designation_status: 'active' });
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO app_errors/.test(q)) {
            state.errors.push({ message: args[1], context: args[3] });
            return { meta: { changes: 1 } };
          }
          throw new Error('UNRECOGNIZED SQL (run): ' + q);
        },
      };
      return api;
    },
  };
  return { env: { DB: db, NTHSKY_SSO_KEY: KEY }, state };
}

/* ---- helpers ---- */
const KEY = 'test-sso-key-do-not-use-in-production';
const b64url = (s) => Buffer.from(s).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function mint(claims, key = KEY) {
  const body = b64url(JSON.stringify(claims));
  const sig = await ssoHmacHex(key, body);
  return body + '.' + sig;
}
const now = () => Math.floor(Date.now() / 1000);
const baseClaims = (over = {}) => ({
  v: 1, uid: 'hub-1', email: 'person@nthsky.net', name: 'A Person',
  internal: false, role: 'user', site: 'ovrflight',
  iat: now(), exp: now() + 60, ...over,
});

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + name); }
}
async function section(title, fn) { console.log('\n' + title); await fn(); }

/* ================================ tests ================================ */

await section('Ticket verification', async () => {
  const { env } = makeDB();
  let v = await ssoVerifyTicket(env, await mint(baseClaims()));
  check('valid ticket accepted', v.ok === true);
  check('claims come back', v.claims && v.claims.email === 'person@nthsky.net');

  v = await ssoVerifyTicket(env, await mint(baseClaims(), 'wrong-key'));
  check('bad signature rejected', v.ok === false && v.error === 'Bad signature');

  v = await ssoVerifyTicket(env, await mint(baseClaims({ exp: now() - 1 })));
  check('expired ticket rejected', v.ok === false && v.error === 'Ticket expired');

  v = await ssoVerifyTicket(env, await mint(baseClaims({ site: 'ovr3d' })));
  check('foreign site rejected', v.ok === false && /different site/.test(v.error));

  v = await ssoVerifyTicket(env, await mint(baseClaims({ v: 2 })));
  check('wrong version rejected', v.ok === false && /Unsupported/.test(v.error));

  for (const bad of ['', 'nodot', 'a.b.c', '.sig', 'body.']) {
    v = await ssoVerifyTicket(env, bad);
    check('malformed rejected: ' + JSON.stringify(bad), v.ok === false);
  }

  const body = b64url('not json at all');
  v = await ssoVerifyTicket(env, body + '.' + await ssoHmacHex(KEY, body));
  check('unparseable claims rejected', v.ok === false && v.error === 'Bad claims');

  // A correctly signed non-object payload must not sneak through.
  const nul = b64url('null');
  v = await ssoVerifyTicket(env, nul + '.' + await ssoHmacHex(KEY, nul));
  check('null claims rejected', v.ok === false);
});

await section('§9.1 role mapping - designate, then cap', async () => {
  check('hub super_admin -> staff', ssoMapHubRole({ role: 'super_admin' }) === 'staff');
  check('hub admin -> staff', ssoMapHubRole({ role: 'admin' }) === 'staff');
  check('hub team -> staff', ssoMapHubRole({ role: 'team' }) === 'staff');
  check('internal flag -> staff', ssoMapHubRole({ role: 'user', internal: true }) === 'staff');
  check('external user -> user', ssoMapHubRole({ role: 'user' }) === 'user');
  check('missing role -> user (pre-v1.1 ticket)', ssoMapHubRole({}) === 'user');

  // v1.2: hub designation preferred over our default map
  check('site_role honored over fallback',
    ssoMapHubRole({ role: 'user', site_role: 'staff' }) === 'staff');
  check('site_role null falls back to map',
    ssoMapHubRole({ role: 'admin', site_role: null }) === 'staff');

  // The cap: SSO must NEVER mint this site's owner, however it is asked.
  check('site_role super_admin capped to fallback',
    ssoMapHubRole({ role: 'super_admin', site_role: 'super_admin' }) === 'staff');
  check('external asking for super_admin capped to user',
    ssoMapHubRole({ role: 'user', site_role: 'super_admin' }) === 'user');
  check('unknown site_role falls back, invents nothing',
    ssoMapHubRole({ role: 'user', site_role: 'wizard' }) === 'user');
});

await section('§9.2 merge by email - elevate, never downgrade', async () => {
  // New arrival
  let { env, state } = makeDB();
  let r = await ssoUpsertUser(env, baseClaims({ role: 'admin' }));
  check('new user created', !r.error && state.users.length === 1);
  check('new user gets mapped role', state.users[0].platform_role === 'staff');
  check('new user linked to hub uid', state.users[0].nthsky_uid === 'hub-1');
  check('new user can operate immediately', state.users[0].designation_status === 'active');

  // Existing local user, hub says higher -> elevate, id stable
  ({ env, state } = makeDB([{ id: 'local-7', email: 'person@nthsky.net',
    name: 'Local Name', platform_role: 'user', designation: 'police',
    designation_status: 'active', nthsky_uid: null }]));
  r = await ssoUpsertUser(env, baseClaims({ role: 'admin' }));
  check('existing row reused, no duplicate', state.users.length === 1);
  check('users.id stays stable (FKs survive)', r.user.id === 'local-7');
  check('role elevated user -> staff', state.users[0].platform_role === 'staff');
  check('nthsky_uid linked on merge', state.users[0].nthsky_uid === 'hub-1');
  check('local designation untouched', state.users[0].designation === 'police');

  // THE important one: a local super_admin is never downgraded by SSO
  ({ env, state } = makeDB([{ id: 'owner-1', email: 'person@nthsky.net',
    name: 'Owner', platform_role: 'super_admin', designation: 'commercial',
    designation_status: 'active', nthsky_uid: null }]));
  r = await ssoUpsertUser(env, baseClaims({ role: 'user' }));
  check('local super_admin NOT downgraded', state.users[0].platform_role === 'super_admin');
  check('super_admin id stable', r.user.id === 'owner-1');

  // staff arriving as external user keeps staff
  ({ env, state } = makeDB([{ id: 's-1', email: 'person@nthsky.net', name: 'S',
    platform_role: 'staff', designation: 'commercial',
    designation_status: 'active', nthsky_uid: 'hub-1' }]));
  await ssoUpsertUser(env, baseClaims({ role: 'user' }));
  check('staff not downgraded to user', state.users[0].platform_role === 'staff');

  // Email is normalized so case can never fork an identity
  ({ env, state } = makeDB([{ id: 'c-1', email: 'person@nthsky.net', name: 'C',
    platform_role: 'user', designation: 'commercial',
    designation_status: 'active', nthsky_uid: null }]));
  r = await ssoUpsertUser(env, baseClaims({ email: '  PERSON@NTHSKY.NET  ' }));
  check('email case/space normalized to one identity',
    state.users.length === 1 && r.user.id === 'c-1');

  // No email = no account
  ({ env, state } = makeDB());
  r = await ssoUpsertUser(env, baseClaims({ email: '' }));
  check('missing email refused', r.error && state.users.length === 0);
  check('missing email is a 400', r.status === 400);
});

await section('§9.3 failures are recorded', async () => {
  const { env, state } = makeDB();
  await logAppErrorProbe(env);
  check('app_errors row written', state.errors.length === 1);
  check('context identifies the auth path', state.errors[0].context === 'auth/sso');
});
async function logAppErrorProbe(env) {
  const fn = new Function('env', 'uid', 'return (' + grab('logAppError') + ')(env, ' +
    '{ message: "probe", source: "worker", context: "auth/sso" })');
  await fn(env, () => 'e-1');
}

/* ================================ report ================================ */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
