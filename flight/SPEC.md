# OVRFLIGHT - Technical Spec (v1)

> Turns `BRIEF.md` into concrete decisions: data model, API surface, real-time
> architecture, access model, and the v1 screen list. Still no infrastructure provisioned.
> Read `BRIEF.md` first for the "why". Owner: Rhys Andersen (NTHSKY / OvrWatch).

**Status:** Draft for review. Items marked **[DECISION]** need Rhys's call before build.
**Last updated:** 2026-07-04

---

## 0. Decisions locked so far

1. **Two-track sign-up.** Instant open sign-up gets you the general floor. Elevated
   designations (first responder, police, fire) go through a verification track before the
   designation activates.
2. **Presence-on-the-floor, identity gated.** The map floor shows everyone that something
   is flying at a location (position, altitude, aircraft class, live state). Operator
   identity and mission detail are revealed only per designation and per the broadcaster's
   sharing settings.
3. **API-first.** The direct API push is the v1 hero and the "copy-paste, dummy-proof"
   showcase. Controller-read, GCS-vendor, and MQTT-sniff paths come after the loop is proven.
4. **Commercial accounts are instant** to sign up and post; an optional "verified
   commercial" badge is available via light proof so good actors stand out.
5. **Protected-ops visibility (police/fire/public safety/govt):** always visible to others
   in the same designation class and to qualifying commercial operators. Never fully
   invisible to those groups. Each protected org can toggle its data feed on or off.
   Long-term: this data layer gets encryption at rest (AES-256) and a SOC 2 compliant
   handling posture. Cloudflare already encrypts at rest; SOC 2 is mostly process + access
   control and is a hardening milestone, not v1 code.
6. **Full track storage, always.** Every flight's complete track is stored (R2). A user
   deleting their data deletes their *view* of it only; the platform's copy is never
   deleted. This is a retention-policy commitment and must be stated in the public terms
   of service before launch.
7. **Output formats v1:** JSON + GeoJSON + CSV, **and TAK/CoT now** (not fast-follow). A
   large police department is lined up to test the TAK/CoT feed, so it ships in v1.
8. **Stale timeout:** aircraft drop off the live map after 30 seconds of silence.
9. **Workers Paid plan confirmed** - Durable Objects + WebSockets architecture is a go.
10. **Verification reviews in v1:** handled by "me" = the NTHSKY team, all manual.
    Domain-based auto-approve considered later.

---

## 1. System shape

```
  Operators / their software ─┐
    (drone, GCS, controller)  │  POST telemetry (API key)
                              ▼
                 ┌────────────────────────────┐
                 │  ovrflight-api (Worker)     │  Auth, ingest, query, flight logging,
                 │  @ api.ovrflight.org        │  sharing rules, mission CRUD
                 └───┬─────────────┬───────────┘
                     │             │
        live state   │             │  durable records
   ┌─────────────────▼───┐   ┌─────▼──────────────┐
   │ Durable Objects     │   │  D1: ovrflight      │  users, orgs, teams, designations,
   │ (one per geo-cell)  │   │  (accounts, logs,   │  api_keys, aircraft, flights,
   │ live aircraft +     │   │   missions, shares) │  missions, shares, verification
   │ WebSocket fan-out   │   └─────────────────────┘
   └─────────┬───────────┘             │
             │ push (<5s)              │  raw tracks (optional)
   ┌─────────▼───────────┐       ┌─────▼──────┐
   │ Viewers + customers │       │ R2 bucket   │  archived flight tracks, exports
   │ (map, live feeds)   │       │ (cold)      │
   └─────────────────────┘       └────────────┘
```

**Why this shape.** The 5-second / 1-mile target is a *real-time fan-out* problem, not a
database problem. D1 (SQLite) is great for durable records (accounts, logs, missions) but
wrong for a stream of positions updating every second. Cloudflare **Durable Objects** are
built exactly for this: one small stateful object per geographic cell that holds the live
aircraft in that cell in memory and pushes updates to subscribed viewers over WebSockets.
Push, not poll, is what makes "under 5 seconds" easy. Positions live in the DO and expire;
only flight *summaries* (and optional raw tracks) get written durably.

**Separate stack from OVR3D.** New Worker (`ovrflight-api`), new D1 (`ovrflight`), new R2
bucket, Durable Objects. The frontend starts as a `flight/` folder in this repo deployed to
`flight.ovr3d.com`, then lifts to `ovrflight.org` unchanged. Backend is independent from day
one so the move is clean.

---

## 2. Access + visibility model

**Designations** (a user's role in the airspace, separate from org role):

| Designation | Track | Can post | Floor view (presence) | Full telemetry view | Notes |
|---|---|---|---|---|---|
| `hobbyist` | instant | yes | own + hobbyist only | no | cannot see commercial or public-safety ops |
| `commercial` | instant* | yes | yes | yes (per sharing) | Part 107 / delivery / security / commercial |
| `first_responder` | verified | yes | yes, situational "in my area" emphasis | yes + elevated | public safety |
| `police` / `fire` | verified | yes | yes | yes + elevated | distinct designations, protected ops |

\* **[DECISION]** Does `commercial` need any light verification (e.g. confirm a Part 107 /
business), or is it fully instant with trust built up over time? Recommendation: instant to
post, but a "verified commercial" badge available via light proof, so good actors stand out.

**The floor (what any valid user always sees within their radius):**
- Position, altitude, aircraft class (drone / helicopter / small aircraft), heading +
  trajectory, live/stale state.
- **Not** necessarily: operator name, tail/serial, mission purpose, org. Those are the
  "identity layer", revealed by designation + the broadcaster's sharing settings.

**Protected ops (police/fire):** appear on the floor as **presence** so others deconflict,
but identity and mission detail are masked to anyone below the right designation. **[DECISION]**
Can a police op choose to be fully invisible (covert), or is presence always shown for
safety? Recommendation: presence always shown (safety floor is non-negotiable), identity
maskable.

**Sharing rules (org admin controlled):** for each org, the admin sets the default and can
override per team:
- `all` - everything visible to all valid users
- `team` - visible only to listed teams
- `org_share` - shared with specific named organizations
These govern the *identity/telemetry* layer above the presence floor.

---

## 3. Data model (D1: `ovrflight`)

Reuses the OVR3D auth pattern (users/sessions) so we do not reinvent login.

```
users               id, email, password_hash | oauth, name, created_at,
                    designation (hobbyist|commercial|first_responder|police|fire),
                    designation_status (active|pending|rejected), platform_role
sessions            token, user_id, expires_at            (indexed on token, user_id)

organizations       id, name, kind (commercial|agency|dept), created_by, created_at,
                    default_visibility (all|team|org_share)
org_members         user_id, org_id, org_role (admin|member|viewer)
teams               id, org_id, name
team_members        user_id, team_id

verifications       id, user_id, requested_designation, evidence_ref, status,
                    reviewed_by, reviewed_at, notes       (the verified track queue)

api_keys            id, org_id, created_by, label, key_hash, scopes, last_used_at,
                    revoked_at                            (ingest + read auth)

aircraft            id, org_id, label, class (drone|heli|fixed_wing), remote_id,
                    serial, default_pilot_id              (registered assets)

flights             id, org_id, aircraft_id, pilot_id, started_at, ended_at,
                    duration_s, max_alt_agl_ft, max_alt_msl_ft, distance_m,
                    point_count, summary_json, track_ref (R2 key, nullable)

missions            id, org_id, created_by, name, geometry_json (polygon/circle),
                    floor_alt_ft, ceiling_alt_ft, window_start, window_end,
                    status (planned|active|done|cancelled), visibility

shares              id, from_org_id, to_org_id, scope (all|team), team_id (nullable),
                    layer (presence|identity|telemetry|logs), created_at

share_events        id, share_id, actor, action, at        (audit)
```

**Live state is NOT in D1.** It lives in Durable Objects (section 5) and expires. Only
flight summaries (and optional raw tracks in R2) persist.

**[DECISION]** Raw track storage: keep every position point (R2, for replay/analytics) or
only the summary + sampled track? Recommendation: summary in D1 always; full track to R2
optional per org (storage is cheap, but it is a privacy surface).

---

## 4. API surface

Base: `https://api.ovrflight.org/v1`. Auth: `Authorization: Bearer <api_key>` for
machine/ingest, session cookie for the web app. Every endpoint requires a valid user.

### 4.1 Ingest (the hero)

```
POST /v1/telemetry            one or a batch of position reports
```
Native JSON body, deliberately minimal so it is trivial to send:
```json
{
  "aircraft": "drone-01",         // your id or a registered aircraft id
  "class": "drone",
  "lat": 33.4484, "lon": -112.074,
  "alt_agl_ft": 220, "alt_msl_ft": 1305,
  "heading": 270, "speed_mps": 8.4,
  "ts": "2026-07-04T18:22:05Z",   // optional; server stamps if absent
  "flight": "auto"                // "auto" opens/continues a flight log
}
```
- Accepts a single object or an array (batch).
- **Adapters** (so operators send what they already have):
  - `POST /v1/telemetry` - native JSON, single or batch. ✅ built
  - `POST /v1/ingest/cot` - TAK Cursor-on-Target XML. Point a DroneSense TAK
    integration or any TAK feed at this URL with an API key. ✅ built
  - **ADS-B connector** - cron pull from the OpenSky Network for a configured bounding
    box, ingested under the system org "ADS-B Network", visible to all designations
    (public data). Anonymous polling every 5 min; every minute with OpenSky OAuth2
    client credentials (Worker secrets). ✅ built
  - Later: `geojson`, `remoteid` (OpenDroneID / ASTM F3411), `mavlink`, vendor-specific
    (e.g. DroneSense Open API direct, once credentials/docs are in hand).
- Idempotent per `(aircraft, ts)` so retries do not double-log.
- Response: `{ "ok": true, "flight_id": "...", "seen_by_cells": 1 }`.

### 4.2 Query + live

```
GET  /v1/nearby?lat=&lon=&radius_mi=   active aircraft near a point (default 1, max 2 mi)
WS   /v1/stream?lat=&lon=&radius_mi=   live push of enter/update/leave events (<5s)
GET  /v1/aircraft/{id}                 detail (identity layer subject to visibility)
```
Both `nearby` and `stream` apply the viewer's designation + sharing rules server-side, so a
hobbyist literally never receives commercial/police identity in the payload.

### 4.3 Flights + logs

```
GET  /v1/flights?org=&from=&to=        list (own org, or shared)
GET  /v1/flights/{id}                  detail + summary stats
GET  /v1/flights/{id}.csv              CSV export of one flight
GET  /v1/flights.csv?...               CSV export of many (the "download my flights" button)
```

### 4.4 Missions (soft area claim)

```
POST /v1/missions                      create a planned mission (area + time window)
GET  /v1/missions?bbox=&when=          who is planning/operating in an area
PATCH/DELETE /v1/missions/{id}
```
`GET /v1/missions` is the deconfliction view: before you fly, see who has already claimed
the area or time. Not an authorization, a coordination signal.

### 4.5 Live reporting out (fan-out to customers)

```
POST /v1/feeds                         create an outbound feed (webhook URL or WS token)
GET  /v1/feeds/{id}                    feed status
```
A feed streams a chosen org's activity to a customer's system in a chosen format. This is
the "API our info out to any customer that wants live reporting" requirement.

### 4.6 Output formats

Same data, multiple shapes, chosen by `Accept` header or `?format=`:
`json` (default), `geojson`, `csv`, and **`cot` (TAK Cursor-on-Target XML) in v1** - a
large police department is lined up to test the TAK feed. Roadmap: `kml`, vendor formats.

### 4.7 "API for dummies" surface

The web app has a **Connect your data** screen that, for a picked platform, generates a
ready-to-paste snippet (curl, Python, JS, and a generic HTTP block) pre-filled with the
org's API key and the native schema. Press button, copy, paste, positions appear on the map.
This screen is a v1 deliverable, not a doc afterthought.

---

## 5. Real-time architecture (hitting 5s / 1mi)

- **Geo-cells via geohash.** Space is diced into cells (geohash precision ~5, about 5 km).
  One **Durable Object per cell** holds that cell's live aircraft in memory.
- **Ingest path:** `POST /v1/telemetry` → Worker authenticates → computes the aircraft's
  cell → forwards the update to that cell's DO. The DO updates in-memory state and
  broadcasts to every WebSocket subscriber watching that cell. This is the sub-5-second path
  (usually sub-second); latency is network, not database.
- **Query path:** `GET /v1/nearby` / `WS /v1/stream` → Worker computes the handful of cells
  covering the radius → subscribes/reads from those DOs → filters by the viewer's visibility
  rules → returns.
- **Expiry:** positions in a DO expire after N seconds of silence (e.g. 30s) so stale
  aircraft drop off automatically. **[DECISION]** stale timeout value.
- **Flight logging:** the DO (or the Worker) detects flight start/stop (`flight:"auto"` +
  inactivity) and writes a summary row to D1 on end; optional raw track to R2.
- **Fan-out feeds:** outbound customer feeds subscribe to the same DO broadcast, reformatted.
- **Known v1 limitation:** an aircraft crossing a grid-cell boundary (~2.7 mi) starts a new
  flight segment in the new cell; the live map dedupes by aircraft id so it never shows
  twice, but long cross-cell flights log as multiple segments. Segment stitching (by org +
  aircraft + adjacent time windows) is a post-v1 cleanup, at query time or via a scheduled
  job.

This keeps D1 out of the hot path entirely. D1 is touched on login, flight-end, mission
edits, and settings changes, not on every position tick.

**[DECISION]** Cloudflare Durable Objects + WebSockets is a paid Workers feature (Workers
Paid plan). Confirm we are on Workers Paid for the ovrflight account, or we start with a
polling fallback (`GET /nearby` every few seconds) which is simpler but not as instant.

---

## 6. v1 screens (frontend, `flight/`)

1. **Sign up / log in** - instant track; designation picker; verified-track request if
   elevated.
2. **Onboarding / org setup** - create org, pick kind, invite teammates, choose default
   visibility.
3. **Live map (hero)** - full UX defined in §6.1. On-brand network aesthetic.
### 6.1 Live Map UX (defined with Rhys, 2026-07-04)

- **Entry:** a "Live Map" button pulls up the full map view. Zoom in/out freely; the
  visible tiles and the aircraft shown update to the viewable area.
- **Aircraft rendering:** each live aircraft is a small **soft-edged neon teal orb** (no
  hard boundary, a glow that fades out). **Helicopters render as larger orbs** than drones.
- **Left list panel:** scrollable list of the aircraft in view, roughly 10 visible at a
  time. Each row shows: aircraft type/model, time flying, current altitude. Clicking a row
  highlights that aircraft on the map (pulse + pan to it).
- **Sort rule:** the list is always sorted so the aircraft **closest to the map's center**
  are on top. If an area of intent is placed, sorting pivots to **closest to the intent
  orb** instead, with conflicts pinned to the very top.
- **Area of intent:** clicking anywhere on the map drops a small **soft-edged orange orb**
  marking where the user wants to fly. This produces a readout of who is nearby and
  **highlights every aircraft within a quarter mile horizontally and within 100 ft of the
  intended altitude** (intent altitude is adjustable, default 200 ft AGL). Clicking
  elsewhere moves the orb; it can be cleared.
- **Alerts:** proximity/conflict alerting is planned but not in the first cut of this
  screen; the sort-to-top + highlight behavior is the v1 stand-in.
- **Prototype:** `flight/index.html` implements this screen with ~45 simulated static
  aircraft (DJI drones + helicopters) placed within Asheville, NC city limits, so the UX
  can be felt before the backend exists.

4. **Connect your data** - pick platform, copy snippet, watch data land. The "no excuse"
   screen.
5. **API keys** - create/revoke keys, scopes, last-used.
6. **Flights / logs** - list, per-flight stats, CSV download.
7. **Missions** - draw an area + time window, see who else is planning/operating there.
8. **Org admin settings** - teams, members, sharing rules (all/team/org_share), org-to-org
   shares.
9. **Verification queue** (platform admin) - approve/reject first-responder/police/fire
   requests. This is the "validation we need to come up with" made concrete.

---

## 7. Verification (the verified track)

v1 mechanism, deliberately simple and human-in-the-loop, hardened later:
- Elevated sign-up submits: agency/department name, official contact email (domain
  checked), optional evidence upload (badge/credential/letter) to R2, a note.
- Lands in the **Verification queue**; a platform admin approves/rejects.
- On approve, `designation_status → active` and the designation unlocks elevated view.
- **[DECISION]** Who reviews in v1 (just Rhys, or a small trusted set)? And is a verified
  government email domain enough for auto-approve, or always manual at first? Recommendation:
  manual for all elevated in v1; add domain auto-approve once patterns are clear.

---

## 8. Anti-abuse / anti-fake-data (framework in v1, teeth later)

- Every position is attributable to an `api_key` → `org` → `user`. No anonymous injection.
- Rate limits per key. Sanity checks (impossible speed/altitude jumps flagged).
- **Trust tiers:** unverified sources render on the floor but visibly marked "unverified";
  verified sources carry a badge. Consumers can filter to verified-only.
- Full audit via `share_events` and key `last_used_at`.
- Hardening later: encryption at rest for sensitive layers, compliant handling for
  first-responder data, trust scoring, anomaly detection.

---

## 9. Security + privacy posture (v1 vs later)

- **v1:** open-data mode. The permissions/visibility framework (designations, sharing rules,
  layers) is fully built and enforced in the API, even while defaults are open. Nothing
  anonymous: every write is attributable.
- **Near term:** encrypt sensitive layers at rest; compliant first-responder data path;
  covert-identity option for protected ops (presence still shown); stronger verification and
  anti-abuse.
- **Always:** no secret values in the repo (same rule as OVR3D). API keys hashed at rest.

---

## 10. Build milestones (proposed order)

- **M0 Skeleton (no Cloudflare yet):** `flight/` app shell (brand, map, screens as static),
  `ovrflight-api` Worker with `/health` + `/v1/telemetry` + `/v1/nearby` against an
  in-memory stub, `schema.sql`. Deploy jobs added to `deploy.yml` but commented
  out. Everything reviewable as a PR, nothing live.
- **M1 The loop:** real D1 + auth, real ingest → Durable Object → `/nearby` → map dot. Prove
  one drone posting shows up near a viewer in under 5s.
- **M2 Orgs + sharing:** org/team/settings, visibility enforcement, verification queue.
- **M3 Logs + missions:** flight logging + CSV, mission create + deconfliction view.
- **M4 Fan-out + formats:** outbound feeds, geojson/csv out, "Connect your data" snippet gen.
- **M5 Move:** provision `ovrflight.org`, lift the frontend, cut over.

Each milestone is a PR you review and merge. Nothing auto-goes-live; you pick each moment.

---

## 11. Open decisions

All seven original open decisions were resolved 2026-07-04 and are recorded in §0
(items 4 through 10). Newly opened items:

1. **Retention/terms language** for "platform always keeps the full track" (§0.6) - needs
   legal-plain wording in the public terms before launch.
2. **Alert rules** for the Live Map (proximity/conflict notifications) - UX defined later;
   sort-to-top + conflict highlight is the v1 stand-in. (§6.1)
3. **SOC 2 / AES-256 hardening path** for protected-ops data (§0.5) - scope after v1.
```
