/**
 * OVRFLIGHT API - Cloudflare Worker `ovrflight-api`
 *
 * One sky, one source of truth. Receives telemetry from any operator,
 * holds live aircraft in per-area Durable Object cells, serves "who is
 * near me" in under 5 seconds, and logs every flight.
 *
 * Architecture (see flight/SPEC.md §5):
 *   POST /v1/telemetry -> auth by API key -> GeoCell DO (in-memory live state)
 *   GET  /v1/nearby    -> query the 3x3 cells covering the radius -> filter -> format
 *   Flight summaries land in D1 on flight end; full raw track always archives to R2.
 *   D1 is never touched on the per-position hot path.
 *
 * Bindings: DB (D1 ovrflight) · TRACKS (R2 ovrflight-tracks) · CELLS (DO GeoCell)
 * No secrets required. API keys are hashed at rest.
 */

const CELL_DEG = 0.04;          // grid cell size in degrees (~2.7 mi)
const STALE_S = 30;             // seconds of silence before an aircraft leaves the map
const FLIGHT_CLOSE_S = 90;      // seconds of silence before a flight is closed + archived
const MAX_RADIUS_MI = 2;        // cap for nearby queries
const SESSION_DAYS = 30;
const MAX_TRACK_POINTS = 20000; // per-flight track buffer cap in the DO

/* ============================== helpers ============================== */

const CORS = {
  'Access-Control-Allow-Origin': '*', // v1 open-data mode; tighten with auth hardening
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
const err = (message, status = 400) => json({ error: message }, status);

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
  const hex = (a) => [...new Uint8Array(a)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex(salt)}:${hex(bits)}`;
}
async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = (stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
  const hex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === hashHex;
}

function distMi(lat1, lon1, lat2, lon2) {
  const R = 3958.8, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const cellKey = (lat, lon) =>
  `${Math.floor(lat / CELL_DEG)}_${Math.floor(lon / CELL_DEG)}`;

function cellsAround(lat, lon) {
  const ci = Math.floor(lat / CELL_DEG), cj = Math.floor(lon / CELL_DEG);
  const keys = [];
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) keys.push(`${ci + i}_${cj + j}`);
  return keys;
}

/* ==================== NTHSKY SSO (ACCESS-STANDARD §9, NORMATIVE) ====================
   One account across the network. The hub signs a 60-second HMAC ticket; we
   verify it offline with NTHSKY_SSO_KEY (the same secret the hub signs with -
   deliberately NOT the federation key, so either can rotate alone).

   The four rules that make the login BEHAVE correctly, not just verify:
     §9.1 map the hub role onto our ladder, prefer claims.site_role, cap below owner
     §9.2 merge by email - same person, keep users.id stable, elevate never downgrade
     §9.3 failures are specific on screen AND written to app_errors
     §9.6 the callback runs in a hostile DOM (frontend side)
   Reference implementations: ovr3d worker/worker.js, ovrops src/worker.js.       */

const SSO_SITE = 'ovrflight';

// Our ladder: super_admin > staff > user. `super_admin` is this site's own
// bootstrap owner and is NEVER granted over SSO, so a hub compromise cannot
// mint an OVRFLIGHT owner.
const LOCAL_ROLES = ['user', 'staff', 'super_admin'];
const SSO_RANK = { user: 0, staff: 1, super_admin: 2 };

function ssoB64urlDecode(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ssoHmacHex(key, data) {
  const ck = await crypto.subtle.importKey('raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// No early exit on the first mismatched character, so the compare leaks no
// position information.
function ssoTimingSafeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function ssoVerifyTicket(env, ticket) {
  const parts = String(ticket || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: 'Malformed ticket' };
  const [body, sig] = parts;
  const expect = await ssoHmacHex(env.NTHSKY_SSO_KEY, body);
  if (!ssoTimingSafeEq(expect, String(sig).toLowerCase())) return { ok: false, error: 'Bad signature' };
  let claims;
  try { claims = JSON.parse(ssoB64urlDecode(body)); }
  catch (e) { return { ok: false, error: 'Bad claims' }; }
  if (!claims || typeof claims !== 'object') return { ok: false, error: 'Bad claims' };
  if (claims.v !== 1) return { ok: false, error: 'Unsupported ticket version' };
  if (!claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return { ok: false, error: 'Ticket expired' };
  if (claims.site !== SSO_SITE) return { ok: false, error: 'Ticket was issued for a different site' };
  return { ok: true, claims };
}

// §9.1 - the hub DESIGNATES (claims.site_role), we still CAP. An unrecognized
// designation falls back to our default map rather than inventing a role, and
// the owner role is unreachable this way. The hub currently sends null for
// ovrflight (no grid row), so the fallback is what runs until one is added -
// and adding it then needs no code change here.
function ssoMapHubRole(c) {
  const hubRole = String((c && c.role) || '').toLowerCase();
  const fallback = (hubRole === 'admin' || hubRole === 'super_admin') ? 'staff'
    : (hubRole === 'team' || (c && c.internal)) ? 'staff'
    : 'user';
  const wanted = String((c && c.site_role) || '').toLowerCase() || fallback;
  return (LOCAL_ROLES.includes(wanted) && wanted !== 'super_admin') ? wanted : fallback;
}

// §9.3 - never fail opaquely. A failure the admin can read beats one only the
// user can describe. Best-effort: telemetry must never block the auth path.
async function logAppError(env, { message, source, context }) {
  try {
    await env.DB.prepare(
      'INSERT INTO app_errors (id, message, source, context) VALUES (?, ?, ?, ?)'
    ).bind(uid(), String(message).slice(0, 2000), source || 'worker', context || null).run();
  } catch (e) { console.error('app_errors write failed:', e.message, '| original:', message); }
}

// §9.2 - MERGE by email. An SSO arrival is the SAME PERSON as the local account
// holding that email: reuse the row so every foreign key (orgs, api_keys,
// flights, missions, sessions) survives the link. Raise the role if the hub says
// higher, never lower it - a deliberate local grant outranks an inherited one.
// Never create a second account for an email we already know.
async function ssoUpsertUser(env, c) {
  const em = String((c && c.email) || '').toLowerCase().trim();
  if (!em) return { error: 'Ticket carries no email', status: 400 };
  const mappedRole = ssoMapHubRole(c);

  let u = await env.DB.prepare(
    `SELECT id, email, name, platform_role, designation, designation_status, nthsky_uid
     FROM users WHERE email = ?`).bind(em).first();

  if (u) {
    const newRole = (SSO_RANK[mappedRole] || 0) > (SSO_RANK[u.platform_role] || 0)
      ? mappedRole : u.platform_role;
    const nuid = (c && c.uid) || u.nthsky_uid || null;
    await env.DB.prepare(
      `UPDATE users SET nthsky_uid = ?, platform_role = ?, last_login = datetime('now')
       WHERE id = ?`).bind(nuid, newRole, u.id).run();
    u.platform_role = newRole;
    u.nthsky_uid = nuid;
  } else {
    // New arrivals land as commercial/active so they can operate immediately.
    // Note this grants NO flight-data trust: computeTrust() keys off Part 107
    // verification and public-safety designation, not network identity, so an
    // SSO arrival still reports as `unverified` until their aviation
    // credentials are checked. Network standing is not aviation standing.
    const id = uid();
    const name = String((c && c.name) || '').trim() || em.split('@')[0];
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, name, designation, designation_status,
         platform_role, nthsky_uid, last_login)
       VALUES (?, ?, NULL, ?, 'commercial', 'active', ?, ?, datetime('now'))`)
      .bind(id, em, name, mappedRole, (c && c.uid) || null).run();
    u = { id, email: em, name, platform_role: mappedRole, designation: 'commercial',
      designation_status: 'active', nthsky_uid: (c && c.uid) || null };
  }
  return { user: u };
}

// Public signup switch, held in D1 so it flips instantly with no deploy.
// FAILS CLOSED on purpose: a missing row, an unreadable table or any D1 hiccup
// means no public signup. The cost of being wrong that way is someone waiting
// for an invite; the cost of the other way is strangers landing in a product
// whose org controls are not finished. SSO arrivals are unaffected - they are
// vetted at the hub, which is the whole point of the network gate.
async function signupsOpen(env) {
  try {
    const r = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'signups_open'`).first();
    return !!r && String(r.v) === 'true';
  } catch (e) { return false; }
}

// §7 - the network gates signup. Ask the hub before creating a local account.
// Fail-open on an unreachable hub: availability beats purity, and the SSO path
// reconciles identities later by email match.
async function ssoCheckEmail(env, email) {
  if (!env.NTHSKY_SSO_KEY) return null;
  try {
    const r = await fetch('https://nthsky.ai/api/sso/check-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
        Authorization: 'Bearer ' + env.NTHSKY_SSO_KEY },
      body: JSON.stringify({ email, site: SSO_SITE }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

/* ============================== auth ============================== */

async function sessionUser(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token.startsWith('ovf_')) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`).bind(token).first();
  return row || null;
}

async function apiKeyOrg(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !token.startsWith('ovf_')) return null;
  const keyHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT k.id AS key_id, k.scopes, o.id AS org_id, o.name AS org_name, o.kind AS org_kind,
            o.feed_enabled, u.designation, u.designation_status, u.part107_verified
     FROM api_keys k JOIN organizations o ON o.id = k.org_id
     JOIN users u ON u.id = k.created_by
     WHERE k.key_hash = ? AND k.revoked_at IS NULL`).bind(keyHash).first();
  if (row) {
    // fire-and-forget usage stamp
    await env.DB.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`)
      .bind(row.key_id).run();
  }
  return row || null;
}

// Either a logged-in user or a valid API key. Everything requires one of the two.
async function caller(request, env) {
  const user = await sessionUser(request, env);
  if (user) return { kind: 'user', user };
  const key = await apiKeyOrg(request, env);
  if (key) return { kind: 'key', key };
  return null;
}

/* ============================== formats out ============================== */

function toGeoJSON(list) {
  return {
    type: 'FeatureCollection',
    features: list.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: { ...a, lat: undefined, lon: undefined },
    })),
  };
}

// TAK Cursor-on-Target XML. Drones as friendly UAS, helicopters as friendly rotary.
function toCoT(list) {
  const esc = (s) => String(s ?? '').replace(/[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const events = list.map((a) => {
    const type = a.cls === 'heli' ? 'a-f-A-H-H' : 'a-f-A-M-F-Q';
    const time = a.ts || nowIso();
    const stale = new Date(Date.parse(time) + STALE_S * 1000).toISOString();
    const hae = (a.alt_msl_ft != null ? a.alt_msl_ft : (a.alt_agl_ft || 0)) * 0.3048;
    return `  <event version="2.0" uid="OVRFLIGHT.${esc(a.id)}" type="${type}" how="m-g"` +
      ` time="${time}" start="${time}" stale="${stale}">\n` +
      `    <point lat="${a.lat}" lon="${a.lon}" hae="${hae.toFixed(1)}" ce="15.0" le="25.0"/>\n` +
      `    <detail><contact callsign="${esc(a.label || a.id)}"/>` +
      `<track course="${a.heading ?? 0}" speed="${a.speed_mps ?? 0}"/>` +
      `<remarks>${esc((a.org_name || 'unverified') + ' via OVRFLIGHT')}</remarks></detail>\n` +
      `  </event>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<events>\n${events.join('\n')}\n</events>\n`;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(rows, cols) {
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))]
    .join('\n') + '\n';
}

/* ============================== visibility ============================== */

// v1 open-data mode with the framework in place (SPEC §2, §9).
// Floor rule: every valid caller sees presence. Hobbyists only see personal-kind orgs.
// Orgs with feed off are hidden from everyone. ADS-B is public data: visible to all.
function visibleTo(viewer, aircraft) {
  if (!aircraft.feed_enabled) return false;
  if (aircraft.source === 'adsb') return true;
  const designation =
    viewer.kind === 'user' ? viewer.user.designation : viewer.key.designation;
  if (designation === 'hobbyist') return aircraft.org_kind === 'personal';
  return true;
}

/* ============================== trust + abuse guards ============================== */

// Trust ladder (SPEC §8): 'observed' = heard by an independent receiver
// (ADS-B, Remote ID gear); 'verified' = self-reported by an FAA-checked
// operator; 'unverified' = self-reported, no checks yet. The map shows all
// three, differently, and consumers can filter to verified-and-up.
function computeTrust(u) {
  if (['police', 'fire', 'first_responder'].includes(u.designation) &&
      u.designation_status === 'active') return 'verified';
  if (u.part107_verified) return 'verified';
  return 'unverified';
}

// Concurrent live aircraft an org may have in one grid cell. Fake swarms are
// co-located by nature, so a per-cell cap kills them without bothering real
// fleets spread across a region. Receiver-observed data is uncapped.
function cellCapFor(p) {
  if (p.source === 'adsb' || p.trust === 'observed') return Infinity;
  if (['police', 'fire', 'first_responder'].includes(p.designation) &&
      p.trust === 'verified') return 100;
  if (p.trust === 'verified') return 25;
  if (p.designation === 'hobbyist') return 2;
  return 5;
}

// Per-caller request throttle. In-memory per isolate: approximate on purpose;
// it blunts floods without a storage round-trip on the hot path.
const rateWindows = new Map();
function rateLimited(id, perMinute) {
  const now = Date.now();
  const w = rateWindows.get(id);
  if (!w || now - w.t > 60000) { rateWindows.set(id, { t: now, n: 1 }); return false; }
  w.n++;
  if (rateWindows.size > 10000) rateWindows.clear(); // bound memory
  return w.n > perMinute;
}

/* ============================== ingest core ============================== */

// Single path into the live grid, shared by /v1/telemetry, /v1/ingest/cot,
// and the ADS-B connector.
async function pushToCell(env, p) {
  const cell = cellKey(p.lat, p.lon);
  const stub = env.CELLS.get(env.CELLS.idFromName(cell));
  const res = await stub.fetch('https://cell/update', {
    method: 'POST', body: JSON.stringify({ ...p, cell }),
  });
  return res.json();
}

// Minimal CoT (Cursor-on-Target) XML parser: enough for position events from
// TAK-integrated platforms (DroneSense, ATAK, etc). Regex-based on purpose;
// Workers have no XML DOM and CoT events are flat.
function parseCoT(xml) {
  const attr = (s, name) => {
    const m = s.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : null;
  };
  const out = [];
  for (const ev of xml.match(/<event\b[\s\S]*?<\/event>/g) || []) {
    const point = (ev.match(/<point\b[^>]*\/?>/) || [null])[0];
    if (!point) continue;
    const lat = Number(attr(point, 'lat')), lon = Number(attr(point, 'lon'));
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const uid = attr(ev, 'uid') || 'cot-unknown';
    const type = attr(ev, 'type') || '';
    const track = (ev.match(/<track\b[^>]*\/?>/) || [null])[0];
    const contact = (ev.match(/<contact\b[^>]*\/?>/) || [null])[0];
    const hae = Number(attr(point, 'hae'));
    out.push({
      aircraft: uid,
      label: (contact && attr(contact, 'callsign')) || uid,
      // -H- in the CoT air type = rotary wing; UAS types (-F-Q) and the rest map to drone
      cls: /-A-H/.test(type) ? 'heli' : 'drone',
      lat, lon,
      alt_msl_ft: isFinite(hae) ? Math.round(hae * 3.28084) : null,
      alt_agl_ft: null,
      heading: track ? Number(attr(track, 'course')) || null : null,
      speed_mps: track ? Number(attr(track, 'speed')) || null : null,
      ts: attr(ev, 'time') || nowIso(),
    });
  }
  return out;
}

/* ============================== Durable Object: GeoCell ============================== */

// Live state is write-through: an in-memory map for speed, mirrored to the DO's
// SQLite storage so an evicted/restarted cell resumes with nothing lost. Track
// points persist in chunks of 25 (`trk:<flight>:<seq>`); at most the current
// in-memory chunk tail is at risk on eviction.
const TRACK_CHUNK = 25;

// Singleton index of which cells currently hold live aircraft, so /v1/live can
// answer "all my active flights, nationwide" without scanning every cell on
// the planet. Cells self-report (throttled) on updates and after alarm sweeps.
export class CellRegistry {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/report' && request.method === 'POST') {
      const { cell, n } = await request.json();
      if (!cell) return err('cell required');
      if (n > 0) await this.state.storage.put('c:' + cell, { n, ts: Date.now() });
      else await this.state.storage.delete('c:' + cell);
      return json({ ok: true });
    }
    if (url.pathname === '/active') {
      const m = await this.state.storage.list({ prefix: 'c:' });
      const now = Date.now(), cells = [], dead = [];
      for (const [k, v] of m) {
        if (now - v.ts < 120000 && v.n > 0) cells.push(k.slice(2));
        else dead.push(k);
      }
      if (dead.length) await this.state.storage.delete(dead);
      return json({ cells });
    }
    return err('not found', 404);
  }
}

export class GeoCell {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.aircraft = new Map(); // key -> meta record (+ buf: unflushed points)
    this.hydrated = false;
  }

  async hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    const metas = await this.state.storage.list({ prefix: 'ac:' });
    for (const [k, v] of metas) this.aircraft.set(k.slice(3), { ...v, buf: [] });
  }

  closeAfterS() {
    const n = Number(this.env.FLIGHT_CLOSE_S);
    return isFinite(n) && n > 0 ? n : FLIGHT_CLOSE_S;
  }

  liveCount() {
    const now = Date.now();
    return [...this.aircraft.values()].filter((r) => now - r.seen <= STALE_S * 1000).length;
  }

  async reportToRegistry(force = false) {
    if (!this.cellName) this.cellName = await this.state.storage.get('cellName');
    if (!this.cellName) return;
    const now = Date.now();
    if (!force && this.lastReport && now - this.lastReport < 10000) return;
    this.lastReport = now;
    try {
      await this.env.REGISTRY.get(this.env.REGISTRY.idFromName('global'))
        .fetch('https://reg/report', {
          method: 'POST',
          body: JSON.stringify({ cell: this.cellName, n: this.liveCount() }),
        });
    } catch (e) {
      // best-effort: nearby still works without the registry, but log it
      console.error('registry report failed', this.cellName, e.message);
    }
  }

  async fetch(request) {
    await this.hydrate();
    const url = new URL(request.url);

    if (url.pathname === '/update' && request.method === 'POST') {
      const p = await request.json();
      const key = `${p.org_id}:${p.aircraft}`;
      let rec = this.aircraft.get(key);
      const isNew = !rec;
      if (!rec) {
        // Anti-swarm cap: bound how many live aircraft one org can claim in
        // this cell, scaled by trust tier (SPEC §8).
        const cap = cellCapFor(p);
        const now = Date.now();
        const orgLive = [...this.aircraft.values()].filter((r) =>
          r.org_id === p.org_id && now - r.seen <= STALE_S * 1000).length;
        if (orgLive >= cap) {
          return json({ ok: false,
            error: `live aircraft cap for this area reached (${cap}); verify your account to raise it` });
        }
        rec = {
          id: key, flight_id: uid(), started_at: p.ts || nowIso(),
          org_id: p.org_id, org_name: p.org_name, org_kind: p.org_kind,
          designation: p.designation, feed_enabled: p.feed_enabled,
          aircraft: p.aircraft, label: p.label || p.aircraft, cls: p.cls || 'drone',
          source: p.source || 'api', trust: p.trust || 'unverified',
          max_alt: 0, dist_m: 0, point_count: 0, chunk_seq: 0, buf: [],
        };
        this.aircraft.set(key, rec);
      }
      if (rec.point_count > 0 && p.lat != null) {
        rec.dist_m += distMi(rec.lat, rec.lon, p.lat, p.lon) * 1609.34;
      }
      Object.assign(rec, {
        lat: p.lat, lon: p.lon, alt_agl_ft: p.alt_agl_ft ?? null,
        alt_msl_ft: p.alt_msl_ft ?? null, heading: p.heading ?? null,
        speed_mps: p.speed_mps ?? null, ts: p.ts || nowIso(), seen: Date.now(),
        feed_enabled: p.feed_enabled,
        label: p.label || rec.label,
        trust: p.trust || rec.trust,
      });
      rec.max_alt = Math.max(rec.max_alt, p.alt_agl_ft || 0);

      if (rec.point_count < MAX_TRACK_POINTS) {
        rec.buf.push({ lat: p.lat, lon: p.lon, alt: p.alt_agl_ft ?? null, ts: rec.ts });
        rec.point_count++;
        // The partial chunk is rewritten every update so storage always holds
        // the complete track; a recycled cell instance loses nothing.
        await this.state.storage.put(
          `trk:${rec.flight_id}:${String(rec.chunk_seq).padStart(6, '0')}`, rec.buf);
        if (rec.buf.length >= TRACK_CHUNK) {
          rec.chunk_seq++;
          rec.buf = [];
        }
      }
      const { buf, ...meta } = rec;
      await this.state.storage.put('ac:' + key, meta);
      if (p.cell && !this.cellName) {
        this.cellName = p.cell;
        await this.state.storage.put('cellName', p.cell);
      }
      await this.state.storage.setAlarm(Date.now() + 20000);
      await this.reportToRegistry(isNew);
      return json({ ok: true, flight_id: rec.flight_id });
    }

    if (url.pathname === '/query') {
      const now = Date.now();
      const live = [...this.aircraft.values()]
        .filter((r) => now - r.seen <= STALE_S * 1000)
        .map(({ buf, seen, chunk_seq, ...pub }) => pub);
      return json({ aircraft: live });
    }

    return err('not found', 404);
  }

  // Alarm sweeps: close + archive flights that have gone silent.
  async alarm() {
    await this.hydrate();
    const now = Date.now();
    for (const [key, rec] of this.aircraft) {
      if (now - rec.seen < this.closeAfterS() * 1000) continue;
      try {
        // Storage holds the full track including the current partial chunk;
        // do not add the in-memory buf or warm instances would double-count.
        const chunks = await this.state.storage.list({ prefix: `trk:${rec.flight_id}:` });
        const points = [...chunks.values()].flat();
        const trackRef = `tracks/${rec.flight_id}.json`;
        await this.env.TRACKS.put(trackRef, JSON.stringify({
          flight_id: rec.flight_id, org_id: rec.org_id, aircraft: rec.aircraft,
          class: rec.cls, started_at: rec.started_at, ended_at: rec.ts,
          points,
        }));
        const durationS = Math.max(0,
          Math.round((Date.parse(rec.ts) - Date.parse(rec.started_at)) / 1000));
        await this.env.DB.prepare(
          `INSERT INTO flights (id, org_id, aircraft_key, class, started_at, ended_at,
             duration_s, max_alt_agl_ft, distance_m, point_count, track_ref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(rec.flight_id, rec.org_id, rec.aircraft, rec.cls, rec.started_at, rec.ts,
            durationS, rec.max_alt, Math.round(rec.dist_m), points.length, trackRef)
          .run();
        this.aircraft.delete(key);
        await this.state.storage.delete('ac:' + key);
        await this.state.storage.delete([...chunks.keys()]);
      } catch (e) {
        // Archive failed (transient D1/R2 issue): keep the record and retry
        // on the next alarm rather than losing the flight.
        console.error('flight archive failed, will retry', rec.flight_id, e.message);
      }
    }
    await this.reportToRegistry(true);
    if (this.aircraft.size) await this.state.storage.setAlarm(Date.now() + 20000);
  }
}

/* ============================== main router ============================== */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // NOTE: the stale-bookmark redirect to the canonical domain lives in
    // flight/index.html, NOT here. Static assets are served ahead of this
    // script, so a browser hitting `/` on workers.dev never reaches the worker
    // and a redirect written at this layer would silently never fire.

    try {
      if (path === '/health') {
        return json({ ok: true, service: 'ovrflight-api', time: nowIso(),
          signups_open: await signupsOpen(env) });
      }

      /* ---------- NTHSKY federation ---------- */
      // Network standard: the NTHSKY hub reads AND manages this site's build
      // board over the shared secret. Board lives in D1 `platform_tasks`
      // (schema.sql).
      //   GET   /api/nthsky/tasks      -> {site, tasks:[...]} open board (?all=1 for full history)
      //   POST  /api/nthsky/tasks      -> create {title, details?, section?, priority?, needs?}
      //   PATCH /api/nthsky/tasks/{id} -> update title/details/section/priority/status/needs
      const nthskyMatch = path.match(/^\/api\/nthsky\/tasks(?:\/([^/]+))?$/);
      if (nthskyMatch) {
        if (!env.NTHSKY_FEDERATION_KEY) return err('Federation key not armed on this worker', 503);
        const fedAuth = request.headers.get('Authorization') || '';
        if (fedAuth !== `Bearer ${env.NTHSKY_FEDERATION_KEY}`) return err('Unauthorized', 401);

        if (method === 'GET' && !nthskyMatch[1]) {
          const openOnly = url.searchParams.get('all') !== '1';
          const r = await env.DB.prepare(
            'SELECT id, title, details, section, priority, status, needs, updated_at FROM platform_tasks ' +
            (openOnly ? "WHERE status NOT IN ('done','dropped') " : '') +
            'ORDER BY COALESCE(priority, 9), section, updated_at DESC'
          ).all();
          return json({ site: 'ovrflight', tasks: r.results || [] });
        }
        if (method === 'POST' && !nthskyMatch[1]) {
          const b = await request.json();
          if (!b.title) return err('title required', 400);
          const id = 'ovrflight-' + uid().slice(0, 8);
          await env.DB.prepare(
            'INSERT INTO platform_tasks (id, title, details, section, priority, status, needs, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(id, String(b.title), b.details || null, b.section || 'general', b.priority ?? null, b.status || 'open', b.needs || null, b.created_by || 'hub').run();
          return json({ ok: true, id });
        }
        if (method === 'PATCH' && nthskyMatch[1]) {
          const b = await request.json();
          const sets = [], vals = [];
          for (const f of ['title', 'details', 'section', 'priority', 'status', 'needs']) {
            if (f in b) { sets.push(f + ' = ?'); vals.push(b[f]); }
          }
          if (!sets.length) return err('No fields to update', 400);
          sets.push("updated_at = datetime('now')");
          if (b.status === 'done') sets.push("done_at = datetime('now')");
          const r = await env.DB.prepare('UPDATE platform_tasks SET ' + sets.join(', ') + ' WHERE id = ?')
            .bind(...vals, nthskyMatch[1]).run();
          if (!r.meta || !r.meta.changes) return err('Task not found', 404);
          return json({ ok: true });
        }
        return err('Method not allowed', 405);
      }


      /* ---------- auth ---------- */

      if (path === '/v1/auth/signup' && method === 'POST') {
        // Public signup is closed while the organization access model (roles,
        // team/org-share visibility, org validation) is still being built -
        // board tasks ovrflight-18..25. Existing accounts and NTHSKY SSO are
        // unaffected. Every refusal names the door to knock on (§7).
        if (!(await signupsOpen(env))) {
          return err('OVRFLIGHT is not open for public signup yet. If you have an ' +
            'NTHSKY account, use Sign in with NTHSKY. Otherwise contact NTHSKY for access.', 403);
        }
        const b = await request.json();
        const { email, password, name } = b;
        let designation = b.designation || 'commercial';
        if (!email || !password || !name) return err('email, password, name required');
        if (password.length < 8) return err('password must be at least 8 characters');
        const allowed = ['hobbyist', 'commercial', 'first_responder', 'police', 'fire'];
        if (!allowed.includes(designation)) return err('invalid designation');

        const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
          .bind(email.toLowerCase()).first();
        if (exists) return err('an account with that email already exists', 409);

        // ACCESS-STANDARD §7 - all access is gated at nthsky.ai. Ask the hub
        // before minting a local account so one person keeps one network
        // identity. Every refusal names the door to knock on. A null answer
        // (hub down or key unarmed) falls through to local signup by design.
        const hubCheck = await ssoCheckEmail(env, email.toLowerCase());
        if (hubCheck && hubCheck.exists) {
          return err(hubCheck.has_access
            ? 'You already have an NTHSKY account - use Sign in with NTHSKY.'
            : 'Please contact your administrator for access.', 409);
        }

        const elevated = ['first_responder', 'police', 'fire'].includes(designation);
        const id = uid();
        // First human account becomes super_admin (bootstrap; NTHSKY team).
        // Excludes the ADS-B connector's system user, which may bootstrap first.
        const count = (await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM users WHERE id != 'system'`).first()).n;
        const role = count === 0 ? 'super_admin' : 'user';
        const part107 = designation === 'commercial'
          ? String(b.part107_cert || '').trim().slice(0, 20) : null;
        if (designation === 'commercial' && !part107)
          return err('Part 107 certificate number required for commercial accounts');
        await env.DB.prepare(
          `INSERT INTO users (id, email, password_hash, name, designation,
             designation_status, platform_role, part107_cert)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, email.toLowerCase(), await hashPassword(password), name,
            designation, elevated ? 'pending' : 'active', role, part107).run();

        if (elevated) {
          await env.DB.prepare(
            `INSERT INTO verifications (id, user_id, requested_designation, agency_name,
               contact_email) VALUES (?, ?, ?, ?, ?)`)
            .bind(uid(), id, designation, b.agency_name || null, b.contact_email || null)
            .run();
        }
        if (part107) {
          // Commercial verification: an admin checks the cert against the FAA
          // Airmen Inquiry and approves; account works normally in the meantime.
          await env.DB.prepare(
            `INSERT INTO verifications (id, user_id, requested_designation, notes)
             VALUES (?, ?, 'commercial_verified', ?)`)
            .bind(uid(), id, 'Part 107 cert: ' + part107).run();
        }
        const token = uid() + uid().replace(/-/g, '');
        const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
        await env.DB.prepare(
          `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent)
           VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(uid(), id, token, expires,
            request.headers.get('CF-Connecting-IP') || '',
            request.headers.get('User-Agent') || '').run();
        return json({
          user: { id, email: email.toLowerCase(), name, designation,
            designation_status: elevated ? 'pending' : 'active', platform_role: role },
          token,
          note: elevated
            ? 'Elevated designation is pending review. You have standard access until approved.'
            : undefined,
        }, 201);
      }

      // ACCESS-STANDARD §3.4-6 - the SSO callback. The browser grabs the ticket
      // from the URL fragment (fragments never reach server logs) and POSTs it
      // here. We verify offline with NTHSKY_SSO_KEY, merge by email, and issue
      // our own ordinary session - nothing about session machinery changes.
      if (path === '/auth/sso' && method === 'POST') {
        if (!env.NTHSKY_SSO_KEY)
          return err('NTHSKY sign-in is not armed on this site yet', 503);
        const { ticket } = await request.json();
        const v = await ssoVerifyTicket(env, String(ticket || ''));
        if (!v.ok) {
          await logAppError(env, { message: 'SSO verify failed: ' + v.error,
            source: 'worker', context: 'auth/sso' });
          return err('NTHSKY sign-in failed: ' + v.error, 401);
        }
        const up = await ssoUpsertUser(env, v.claims);
        if (up.error) {
          await logAppError(env, { message: 'SSO sign-in refused: ' + up.error,
            source: 'worker', context: 'auth/sso' });
          return err(up.error, up.status || 403);
        }
        const u = up.user;
        const token = uid() + uid().replace(/-/g, '');
        const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
        await env.DB.prepare(
          `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent)
           VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(uid(), u.id, token, expires,
            request.headers.get('CF-Connecting-IP') || '',
            request.headers.get('User-Agent') || '').run();
        return json({
          user: { id: u.id, email: u.email, name: u.name, designation: u.designation,
            designation_status: u.designation_status, platform_role: u.platform_role,
            nthsky: !!u.nthsky_uid },
          token,
        });
      }

      if (path === '/v1/auth/login' && method === 'POST') {
        const { email, password } = await request.json();
        const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
          .bind((email || '').toLowerCase()).first();
        if (!user || !(await verifyPassword(password || '', user.password_hash)))
          return err('invalid email or password', 401);
        const token = uid() + uid().replace(/-/g, '');
        const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
        await env.DB.prepare(
          `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent)
           VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(uid(), user.id, token, expires,
            request.headers.get('CF-Connecting-IP') || '',
            request.headers.get('User-Agent') || '').run();
        const { password_hash, ...pub } = user;
        return json({ user: pub, token });
      }

      if (path === '/v1/auth/logout' && method === 'POST') {
        const auth = request.headers.get('Authorization') || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
        return json({ ok: true });
      }

      if (path === '/v1/auth/me') {
        const user = await sessionUser(request, env);
        if (!user) return err('not authenticated', 401);
        const { password_hash, ...pub } = user;
        const orgs = (await env.DB.prepare(
          `SELECT o.id, o.name, o.kind, o.default_visibility, o.feed_enabled, m.org_role
           FROM org_members m JOIN organizations o ON o.id = m.org_id
           WHERE m.user_id = ?`).bind(user.id).all()).results;
        return json({ user: pub, orgs });
      }

      /* ---------- orgs + keys ---------- */

      if (path === '/v1/orgs' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return err('not authenticated', 401);
        const { name, kind } = await request.json();
        if (!name) return err('name required');
        const k = ['commercial', 'agency', 'dept', 'personal'].includes(kind) ? kind : 'commercial';
        const id = uid();
        await env.DB.prepare(
          `INSERT INTO organizations (id, name, kind, created_by) VALUES (?, ?, ?, ?)`)
          .bind(id, name, k, user.id).run();
        await env.DB.prepare(
          `INSERT INTO org_members (user_id, org_id, org_role) VALUES (?, ?, 'admin')`)
          .bind(user.id, id).run();
        return json({ org: { id, name, kind: k, org_role: 'admin' } }, 201);
      }

      const orgPatch = path.match(/^\/v1\/orgs\/([\w-]+)$/);
      if (orgPatch && method === 'PATCH') {
        const user = await sessionUser(request, env);
        if (!user) return err('not authenticated', 401);
        const member = await env.DB.prepare(
          `SELECT org_role FROM org_members WHERE user_id = ? AND org_id = ?`)
          .bind(user.id, orgPatch[1]).first();
        if (!member || member.org_role !== 'admin')
          return err('must be an org admin', 403);
        const b = await request.json();
        const sets = [], vals = [];
        if (['all', 'team', 'org_share'].includes(b.default_visibility)) {
          sets.push('default_visibility = ?'); vals.push(b.default_visibility);
        }
        if (b.feed_enabled === 0 || b.feed_enabled === 1) {
          sets.push('feed_enabled = ?'); vals.push(b.feed_enabled);
        }
        if (typeof b.name === 'string' && b.name.trim()) {
          sets.push('name = ?'); vals.push(b.name.trim());
        }
        if (!sets.length) return err('nothing to update');
        await env.DB.prepare(
          `UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`)
          .bind(...vals, orgPatch[1]).run();
        return json({ ok: true });
      }

      if (path === '/v1/keys' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return err('not authenticated', 401);
        const { org_id, label } = await request.json();
        const member = await env.DB.prepare(
          `SELECT org_role FROM org_members WHERE user_id = ? AND org_id = ?`)
          .bind(user.id, org_id || '').first();
        if (!member || member.org_role !== 'admin')
          return err('must be an org admin to create keys', 403);
        const secret = 'ovf_' + uid().replace(/-/g, '') + uid().replace(/-/g, '').slice(0, 16);
        const id = uid();
        await env.DB.prepare(
          `INSERT INTO api_keys (id, org_id, created_by, label, key_hash)
           VALUES (?, ?, ?, ?, ?)`)
          .bind(id, org_id, user.id, label || 'default', await sha256Hex(secret)).run();
        return json({
          key: { id, label: label || 'default', org_id },
          secret, // shown exactly once
          note: 'Store this key now. It is hashed on our side and cannot be shown again.',
        }, 201);
      }

      if (path === '/v1/keys' && method === 'GET') {
        const user = await sessionUser(request, env);
        if (!user) return err('not authenticated', 401);
        const rows = (await env.DB.prepare(
          `SELECT k.id, k.org_id, k.label, k.scopes, k.last_used_at, k.revoked_at, k.created_at
           FROM api_keys k JOIN org_members m ON m.org_id = k.org_id
           WHERE m.user_id = ?`).bind(user.id).all()).results;
        return json({ keys: rows });
      }

      const keyDel = path.match(/^\/v1\/keys\/([\w-]+)$/);
      if (keyDel && method === 'DELETE') {
        const user = await sessionUser(request, env);
        if (!user) return err('not authenticated', 401);
        await env.DB.prepare(
          `UPDATE api_keys SET revoked_at = datetime('now')
           WHERE id = ? AND org_id IN
             (SELECT org_id FROM org_members WHERE user_id = ? AND org_role = 'admin')`)
          .bind(keyDel[1], user.id).run();
        return json({ ok: true });
      }

      /* ---------- telemetry in (the hero) ---------- */

      if (path === '/v1/telemetry' && method === 'POST') {
        const key = await apiKeyOrg(request, env);
        if (!key) return err('valid API key required (Authorization: Bearer ovf_...)', 401);
        if (!key.scopes.includes('ingest')) return err('key lacks ingest scope', 403);
        if (rateLimited('k:' + key.key_id, 120))
          return err('rate limit exceeded: 120 requests per minute per key', 429);

        let body = await request.json();
        const points = Array.isArray(body) ? body : [body];
        if (points.length > 100) return err('max 100 points per batch');
        const trust = computeTrust(key);

        const results = [];
        for (const p of points) {
          const lat = Number(p.lat), lon = Number(p.lon);
          if (!isFinite(lat) || lat < -90 || lat > 90 ||
              !isFinite(lon) || lon < -180 || lon > 180)
            return err('invalid lat/lon');
          if (!p.aircraft) return err('aircraft id required');
          const cls = ['drone', 'heli', 'fixed_wing'].includes(p.class) ? p.class : 'drone';

          results.push(await pushToCell(env, {
            aircraft: String(p.aircraft), label: p.label, cls,
            lat, lon,
            alt_agl_ft: p.alt_agl_ft != null ? Number(p.alt_agl_ft) : null,
            alt_msl_ft: p.alt_msl_ft != null ? Number(p.alt_msl_ft) : null,
            heading: p.heading != null ? Number(p.heading) : null,
            speed_mps: p.speed_mps != null ? Number(p.speed_mps) : null,
            ts: p.ts || nowIso(),
            org_id: key.org_id, org_name: key.org_name, org_kind: key.org_kind,
            designation: key.designation, feed_enabled: key.feed_enabled,
            trust,
          }));
        }
        const ok = results.filter((r) => r.ok);
        return json({
          ok: true, accepted: ok.length, rejected: results.length - ok.length,
          flights: ok.map((r) => r.flight_id),
          ...(ok.length < results.length
            ? { note: results.find((r) => !r.ok)?.error } : {}),
        });
      }

      /* ---------- browser position report (Start Flight) ---------- */
      // Session-authed so any signed-in pilot can report from a phone or
      // laptop without juggling API keys. Same ingest core as everything else.

      if (path === '/v1/report' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return err('not authenticated', 401);
        if (rateLimited('u:' + user.id, 40))
          return err('rate limit exceeded', 429);
        const b = await request.json();
        const lat = Number(b.lat), lon = Number(b.lon);
        if (!isFinite(lat) || lat < -90 || lat > 90 ||
            !isFinite(lon) || lon < -180 || lon > 180)
          return err('invalid lat/lon');
        const org = await env.DB.prepare(
          `SELECT o.id, o.name, o.kind, o.feed_enabled
           FROM org_members m JOIN organizations o ON o.id = m.org_id
           WHERE m.user_id = ? LIMIT 1`).bind(user.id).first();
        if (!org) return err('create or join an organization first');
        const cls = ['drone', 'heli', 'fixed_wing'].includes(b.class) ? b.class : 'drone';
        const r = await pushToCell(env, {
          aircraft: String(b.aircraft || 'pilot-' + user.id.slice(0, 8)),
          label: b.label || b.aircraft || user.name,
          cls, lat, lon,
          alt_agl_ft: b.alt_agl_ft != null ? Number(b.alt_agl_ft) : null,
          alt_msl_ft: null,
          heading: b.heading != null ? Number(b.heading) : null,
          speed_mps: b.speed_mps != null ? Number(b.speed_mps) : null,
          ts: nowIso(),
          org_id: org.id, org_name: org.name, org_kind: org.kind,
          designation: user.designation, feed_enabled: org.feed_enabled,
          source: 'web', trust: computeTrust(user),
        });
        if (!r.ok) return err(r.error || 'rejected', 429);
        return json({ ok: true, flight_id: r.flight_id });
      }

      /* ---------- CoT ingest (DroneSense / TAK bridge) ---------- */
      // Accepts Cursor-on-Target XML: single <event>, several, or an <events>
      // wrapper. Point a TAK feed or DroneSense TAK integration at this URL.

      if (path === '/v1/ingest/cot' && method === 'POST') {
        const key = await apiKeyOrg(request, env);
        if (!key) return err('valid API key required (Authorization: Bearer ovf_...)', 401);
        if (!key.scopes.includes('ingest')) return err('key lacks ingest scope', 403);
        if (rateLimited('k:' + key.key_id, 120))
          return err('rate limit exceeded: 120 requests per minute per key', 429);
        const cotTrust = computeTrust(key);
        const xml = await request.text();
        const points = parseCoT(xml);
        if (!points.length) return err('no CoT position events found in body');
        if (points.length > 100) return err('max 100 events per post');
        const results = [];
        for (const p of points) {
          results.push(await pushToCell(env, {
            ...p,
            org_id: key.org_id, org_name: key.org_name, org_kind: key.org_kind,
            designation: key.designation, feed_enabled: key.feed_enabled,
            trust: cotTrust,
          }));
        }
        const okCot = results.filter((r) => r.ok);
        return json({ ok: true, accepted: okCot.length,
          rejected: results.length - okCot.length,
          flights: okCot.map((r) => r.flight_id) });
      }

      /* ---------- nearby (live out) ---------- */

      if (path === '/v1/nearby' && method === 'GET') {
        const who = await caller(request, env);
        if (!who) return err('sign in or use an API key', 401);
        const lat = parseFloat(url.searchParams.get('lat'));
        const lon = parseFloat(url.searchParams.get('lon'));
        if (!isFinite(lat) || !isFinite(lon)) return err('lat and lon required');
        const radius = Math.min(Number(url.searchParams.get('radius_mi')) || 1, MAX_RADIUS_MI);

        const cells = cellsAround(lat, lon);
        const responses = await Promise.all(cells.map(async (c) => {
          const stub = env.CELLS.get(env.CELLS.idFromName(c));
          const r = await stub.fetch('https://cell/query');
          return (await r.json()).aircraft || [];
        }));
        // An aircraft crossing a cell boundary exists in two cells until the old
        // one goes stale; keep only the freshest report per aircraft id.
        const freshest = new Map();
        for (const a of responses.flat()) {
          const prev = freshest.get(a.id);
          if (!prev || Date.parse(a.ts) > Date.parse(prev.ts)) freshest.set(a.id, a);
        }
        let list = [...freshest.values()]
          .filter((a) => visibleTo(who, a))
          .filter((a) => url.searchParams.get('verified_only') !== '1' || a.trust !== 'unverified')
          .map((a) => ({ ...a, dist_mi: +distMi(lat, lon, a.lat, a.lon).toFixed(3) }))
          .filter((a) => a.dist_mi <= radius)
          .sort((a, b) => a.dist_mi - b.dist_mi);

        const format = url.searchParams.get('format') || 'json';
        if (format === 'geojson') return json(toGeoJSON(list));
        if (format === 'cot')
          return new Response(toCoT(list),
            { headers: { 'Content-Type': 'application/xml', ...CORS } });
        if (format === 'csv') {
          const cols = ['id', 'label', 'cls', 'org_name', 'lat', 'lon', 'alt_agl_ft',
            'heading', 'speed_mps', 'dist_mi', 'ts'];
          return new Response(toCSV(list, cols),
            { headers: { 'Content-Type': 'text/csv', ...CORS } });
        }
        return json({ center: { lat, lon }, radius_mi: radius, count: list.length, aircraft: list });
      }

      /* ---------- live (global, for the dashboard) ---------- */
      // All active aircraft visible to the caller, nationwide. Optional filters:
      // org_id, q (label/id search), lat+lon+radius_mi (up to 500 mi).

      if (path === '/v1/live' && method === 'GET') {
        const who = await caller(request, env);
        if (!who) return err('sign in or use an API key', 401);
        const reg = env.REGISTRY.get(env.REGISTRY.idFromName('global'));
        const { cells } = await (await reg.fetch('https://reg/active')).json();
        const responses = await Promise.all(cells.slice(0, 300).map((c) =>
          env.CELLS.get(env.CELLS.idFromName(c)).fetch('https://cell/query')
            .then((r) => r.json()).catch(() => ({ aircraft: [] }))));
        const freshest = new Map();
        for (const a of responses.flatMap((r) => r.aircraft || [])) {
          const prev = freshest.get(a.id);
          if (!prev || Date.parse(a.ts) > Date.parse(prev.ts)) freshest.set(a.id, a);
        }
        let list = [...freshest.values()].filter((a) => visibleTo(who, a));
        if (url.searchParams.get('verified_only') === '1')
          list = list.filter((a) => a.trust !== 'unverified');
        const orgId = url.searchParams.get('org_id');
        if (orgId) list = list.filter((a) => a.org_id === orgId);
        const q = (url.searchParams.get('q') || '').toLowerCase();
        if (q) list = list.filter((a) =>
          (a.label || '').toLowerCase().includes(q) ||
          (a.aircraft || '').toLowerCase().includes(q) ||
          (a.org_name || '').toLowerCase().includes(q));
        // parseFloat, not Number: Number(null) is 0, which would silently
        // geo-filter to a point in the Atlantic when no lat/lon is passed.
        const lat = parseFloat(url.searchParams.get('lat'));
        const lon = parseFloat(url.searchParams.get('lon'));
        if (isFinite(lat) && isFinite(lon)) {
          const radius = Math.min(Number(url.searchParams.get('radius_mi')) || 100, 500);
          list = list.map((a) => ({ ...a, dist_mi: +distMi(lat, lon, a.lat, a.lon).toFixed(1) }))
            .filter((a) => a.dist_mi <= radius);
        }
        list.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
        return json({ count: list.length, aircraft: list.slice(0, 500) });
      }

      /* ---------- stats (dashboard aggregates) ---------- */

      if (path === '/v1/stats' && method === 'GET') {
        const user = await sessionUser(request, env);
        if (!user) return err('not authenticated', 401);
        const orgId = url.searchParams.get('org_id');
        if (!orgId) return err('org_id required');
        if (user.platform_role !== 'super_admin') {
          const member = await env.DB.prepare(
            `SELECT 1 x FROM org_members WHERE user_id = ? AND org_id = ?`)
            .bind(user.id, orgId).first();
          if (!member) return err('not a member of that org', 403);
        }
        const totals = await env.DB.prepare(
          `SELECT COUNT(*) flights, COALESCE(SUM(duration_s),0) duration_s,
             COALESCE(SUM(distance_m),0) distance_m,
             COUNT(DISTINCT aircraft_key) aircraft, MAX(ended_at) last_flight
           FROM flights WHERE org_id = ? AND deleted_by_owner = 0`).bind(orgId).first();
        const today = await env.DB.prepare(
          `SELECT COUNT(*) n FROM flights WHERE org_id = ? AND deleted_by_owner = 0
           AND started_at >= date('now')`).bind(orgId).first();
        const byDay = (await env.DB.prepare(
          `SELECT date(started_at) day, COUNT(*) n FROM flights
           WHERE org_id = ? AND deleted_by_owner = 0
             AND started_at >= datetime('now','-7 days')
           GROUP BY 1 ORDER BY 1`).bind(orgId).all()).results;
        const members = (await env.DB.prepare(
          `SELECT u.name, u.email, u.designation, m.org_role
           FROM org_members m JOIN users u ON u.id = m.user_id
           WHERE m.org_id = ? ORDER BY m.org_role, u.name`).bind(orgId).all()).results;
        const missions = (await env.DB.prepare(
          `SELECT id, name, status, center_lat, center_lon, radius_m,
             window_start, window_end
           FROM missions WHERE org_id = ? AND status IN ('planned','active')
             AND window_end >= datetime('now') ORDER BY window_start LIMIT 100`)
          .bind(orgId).all()).results;
        const keys = await env.DB.prepare(
          `SELECT COUNT(*) n FROM api_keys WHERE org_id = ? AND revoked_at IS NULL`)
          .bind(orgId).first();
        const adsb = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'adsb_status'`).first();
        return json({
          totals: { ...totals, flights_today: today.n, active_keys: keys.n },
          by_day: byDay, members, missions,
          adsb_status: adsb ? JSON.parse(adsb.v) : null,
        });
      }

      /* ---------- flights ---------- */

      if ((path === '/v1/flights' || path === '/v1/flights.csv') && method === 'GET') {
        const user = await sessionUser(request, env);
        if (!user) return err('not authenticated', 401);
        const rows = (await env.DB.prepare(
          `SELECT f.* FROM flights f JOIN org_members m ON m.org_id = f.org_id
           WHERE m.user_id = ? AND f.deleted_by_owner = 0
           ORDER BY f.started_at DESC LIMIT 500`).bind(user.id).all()).results;
        if (path.endsWith('.csv')) {
          const cols = ['id', 'aircraft_key', 'class', 'started_at', 'ended_at',
            'duration_s', 'max_alt_agl_ft', 'distance_m', 'point_count'];
          return new Response(toCSV(rows, cols), {
            headers: {
              'Content-Type': 'text/csv', ...CORS,
              'Content-Disposition': 'attachment; filename="ovrflight-flights.csv"',
            },
          });
        }
        return json({ flights: rows });
      }

      /* ---------- missions (soft area claim) ---------- */

      if (path === '/v1/missions' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return err('not authenticated', 401);
        const b = await request.json();
        const org = await env.DB.prepare(
          `SELECT org_id FROM org_members WHERE user_id = ? AND org_id = ?`)
          .bind(user.id, b.org_id || '').first();
        if (!org) return err('not a member of that org', 403);
        if (!b.name || !isFinite(b.center_lat) || !isFinite(b.center_lon) ||
            !b.window_start || !b.window_end)
          return err('name, center_lat, center_lon, window_start, window_end required');
        const id = uid();
        await env.DB.prepare(
          `INSERT INTO missions (id, org_id, created_by, name, center_lat, center_lon,
             radius_m, floor_alt_ft, ceiling_alt_ft, window_start, window_end)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, b.org_id, user.id, b.name, b.center_lat, b.center_lon,
            b.radius_m || 800, b.floor_alt_ft || 0, b.ceiling_alt_ft || 400,
            b.window_start, b.window_end).run();
        return json({ mission: { id, ...b } }, 201);
      }

      if (path === '/v1/missions' && method === 'GET') {
        const who = await caller(request, env);
        if (!who) return err('sign in or use an API key', 401);
        const lat = parseFloat(url.searchParams.get('lat'));
        const lon = parseFloat(url.searchParams.get('lon'));
        const radius = Math.min(Number(url.searchParams.get('radius_mi')) || 5, 25);
        const when = url.searchParams.get('when') || nowIso();
        let rows = (await env.DB.prepare(
          `SELECT m.*, o.name AS org_name, o.kind AS org_kind FROM missions m
           JOIN organizations o ON o.id = m.org_id
           WHERE m.status IN ('planned','active') AND m.window_end >= ?
           ORDER BY m.window_start LIMIT 500`).bind(when).all()).results;
        if (isFinite(lat) && isFinite(lon)) {
          rows = rows.filter((m) =>
            distMi(lat, lon, m.center_lat, m.center_lon) <= radius +
              (m.radius_m || 0) / 1609.34);
        }
        return json({ missions: rows });
      }

      /* ---------- verification queue (platform admin) ---------- */

      if (path === '/v1/verifications' && method === 'GET') {
        const user = await sessionUser(request, env);
        if (!user || user.platform_role !== 'super_admin') return err('admin only', 403);
        const rows = (await env.DB.prepare(
          `SELECT v.*, u.email, u.name, u.part107_cert
           FROM verifications v JOIN users u ON u.id = v.user_id
           WHERE v.status = 'pending' ORDER BY v.created_at`).all()).results;
        return json({ verifications: rows });
      }

      const verAct = path.match(/^\/v1\/verifications\/([\w-]+)\/(approve|reject)$/);
      if (verAct && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user || user.platform_role !== 'super_admin') return err('admin only', 403);
        const v = await env.DB.prepare('SELECT * FROM verifications WHERE id = ?')
          .bind(verAct[1]).first();
        if (!v) return err('not found', 404);
        const approved = verAct[2] === 'approve';
        await env.DB.prepare(
          `UPDATE verifications SET status = ?, reviewed_by = ?, reviewed_at = datetime('now')
           WHERE id = ?`)
          .bind(approved ? 'approved' : 'rejected', user.id, v.id).run();
        if (v.requested_designation === 'commercial_verified') {
          if (approved) await env.DB.prepare(
            `UPDATE users SET part107_verified = 1 WHERE id = ?`).bind(v.user_id).run();
        } else {
          await env.DB.prepare(
            `UPDATE users SET designation_status = ? WHERE id = ?`)
            .bind(approved ? 'active' : 'rejected', v.user_id).run();
        }
        return json({ ok: true, status: approved ? 'approved' : 'rejected' });
      }

      return err('not found', 404);
    } catch (e) {
      if (e instanceof SyntaxError) return err('invalid JSON body');
      console.error('unhandled', e.stack || e.message);
      return err('internal error', 500);
    }
  },

  // Cron (every minute): pull ADS-B states from the OpenSky Network for the
  // configured bounding box and feed them through the same ingest path.
  // Public data, visible to every designation. See DEPLOY-FLIGHT.md.
  async scheduled(event, env, ctx) {
    // 💾 The 07:37 UTC tick of the every-minute cron doubles as the nightly D1
    // backup (network standard) - the account is at the Workers Free 5-cron
    // limit, so the backup rides this cron instead of registering its own.
    const d = new Date(event.scheduledTime);
    if (d.getUTCHours() === 7 && d.getUTCMinutes() === 37) ctx.waitUntil(backupD1(env.DB, env.TRACKS, 'ovrflight').catch(() => {}));
    ctx.waitUntil(pullAdsb(env, event.scheduledTime));
  },
};

/* ========== 💾 NIGHTLY D1 → R2 BACKUP (network standard) ==========
   Dumps every table as JSON to backups/db-<name>/<YYYY-MM-DD>/ in the bound
   bucket, writes a _manifest.json with row counts, and prunes dumps older
   than BACKUP_KEEP_DAYS. Restore = re-INSERT rows. */
const BACKUP_KEEP_DAYS = 30;
async function backupD1(db, bucket, dbName) {
  const day = new Date().toISOString().slice(0, 10);
  const prefix = `backups/db-${dbName}/`;
  const tables = ((await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
  ).all()).results || []).map(r => r.name);
  const manifest = { db: dbName, day, created_at: new Date().toISOString(), tables: {} };
  for (const t of tables) {
    const rows = [];
    for (let off = 0; ; off += 2000) {
      const page = ((await db.prepare(`SELECT * FROM "${t}" LIMIT 2000 OFFSET ${off}`).all()).results) || [];
      rows.push(...page);
      if (page.length < 2000) break;
    }
    await bucket.put(`${prefix}${day}/${t}.json`, JSON.stringify(rows), { httpMetadata: { contentType: 'application/json' } });
    manifest.tables[t] = rows.length;
  }
  await bucket.put(`${prefix}${day}/_manifest.json`, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
  const cutoff = new Date(Date.now() - BACKUP_KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  let cursor;
  do {
    const l = await bucket.list({ prefix, cursor });
    const old = (l.objects || []).filter(o => (o.key.slice(prefix.length).split('/')[0] || '') < cutoff);
    for (let i = 0; i < old.length; i += 40) await Promise.all(old.slice(i, i + 40).map(o => bucket.delete(o.key)));
    cursor = l.truncated ? l.cursor : null;
  } while (cursor);
  return manifest;
}

/* ============================== ADS-B connector (OpenSky) ============================== */

const ADSB_ORG = 'org_adsb';

async function openskyToken(env) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return null;
  const cached = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'opensky_token'`).first();
  if (cached) {
    const t = JSON.parse(cached.v);
    if (t.exp > Date.now() + 60000) return t.token;
  }
  const res = await fetch(
    'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.OPENSKY_CLIENT_ID,
        client_secret: env.OPENSKY_CLIENT_SECRET,
      }),
    });
  if (!res.ok) { console.error('opensky token failed', res.status); return null; }
  const d = await res.json();
  await env.DB.prepare(
    `INSERT INTO meta (k, v) VALUES ('opensky_token', ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`)
    .bind(JSON.stringify({ token: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000 }))
    .run();
  return d.access_token;
}

async function pullAdsb(env, scheduledTime) {
  if (env.ADSB_ENABLED !== 'true') return;
  const token = await openskyToken(env);
  // Anonymous credits are scarce (~400/day): poll every 5th minute without
  // credentials, every minute with them (~1440/day against 4000 credits).
  const minute = new Date(scheduledTime).getUTCMinutes();
  if (!token && minute % 5 !== 0) return;

  const [lamin, lomin, lamax, lomax] =
    (env.ADSB_BBOX || '35.30,-82.85,35.85,-82.25').split(',').map(Number);

  // Bootstrap the system org that ADS-B flights log under.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, email, password_hash, name, designation, platform_role)
     VALUES ('system', 'system@ovrflight.internal', NULL, 'OVRFLIGHT System', 'commercial', 'staff')`).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO organizations (id, name, kind, created_by)
     VALUES ('${ADSB_ORG}', 'ADS-B Network (OpenSky)', 'commercial', 'system')`).run();

  const putStatus = (s) => env.DB.prepare(
    `INSERT INTO meta (k, v) VALUES ('adsb_status', ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`)
    .bind(JSON.stringify({ ts: nowIso(), auth: !!token, ...s })).run();

  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}` +
    `&lamax=${lamax}&lomax=${lomax}&extended=1`;
  let res;
  try {
    res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  } catch (e) {
    await putStatus({ ok: false, error: 'fetch failed: ' + e.message });
    return;
  }
  if (!res.ok) {
    console.error('opensky states failed', res.status);
    await putStatus({ ok: false, http: res.status });
    return;
  }
  const data = await res.json();
  await putStatus({ ok: true, http: 200, aircraft: (data.states || []).length });

  for (const s of data.states || []) {
    // states/all vector: 0 icao24, 1 callsign, 5 lon, 6 lat, 7 baro alt (m),
    // 8 on_ground, 9 velocity (m/s), 10 true_track, 13 geo alt (m), 17 category
    const [icao24, callsign, , , , lon, lat, baroAlt, onGround, vel, track] = s;
    const geoAlt = s[13], category = s[17];
    if (onGround || lat == null || lon == null) continue;
    const altM = geoAlt != null ? geoAlt : baroAlt;
    await pushToCell(env, {
      aircraft: `adsb-${icao24}`,
      label: (callsign || '').trim() || icao24.toUpperCase(),
      cls: category === 8 ? 'heli' : 'fixed_wing',
      lat, lon,
      alt_msl_ft: altM != null ? Math.round(altM * 3.28084) : null,
      alt_agl_ft: null,
      heading: track != null ? Math.round(track) : null,
      speed_mps: vel != null ? +vel.toFixed(1) : null,
      ts: nowIso(),
      org_id: ADSB_ORG, org_name: 'ADS-B Network', org_kind: 'commercial',
      designation: 'commercial', feed_enabled: 1,
      source: 'adsb', trust: 'observed',
    });
  }
}
