# OVRFLIGHT - Infrastructure Source of Truth

> **This is the canonical reference for the OVRFLIGHT platform.** Point every new chat
> here first, and write every change back here. If reality and this file disagree, fix
> this file.

**Last updated:** 2026-09-30
**Version:** 1.1f
**Maintained by:** Rhys Andersen (OvrWatch / ovrgrid)

**Status key:** ✅ live & confirmed · 🟡 in progress / unconfirmed · ⬜ planned

---

## 1. What OVRFLIGHT is

Free, shared low-altitude airspace tracking (drones + helicopters + small aircraft,
roughly 1,500 ft AGL and below). Pilots and orgs report positions; everyone sees the
shared live map; an ADS-B connector fills in transponder traffic. Vision:
`flight/BRIEF.md`. Architecture: `flight/SPEC.md`. Deploy runbook:
`flight/DEPLOY-FLIGHT.md`. Trust rules: `flight/docs/TRUST-AND-SAFETY.md`.

History: built inside `ovrgrid/ovr3d` (`flight-worker/` + `flight/` +
`db/ovrflight-schema.sql`, first provisioned 2026-07-04, ovr3d INFRA section 9b),
lifted into this repo 2026-08-23. Pre-lift history lives in ovr3d's git log, BUILDLOG
and infra changelog (v1.3 through v4.17a).

## 2. Architecture in one breath

One Worker, one URL. `flight/` is served as static assets by the Worker itself (docs
excluded via `flight/.assetsignore`); every other path (`/v1/*`, `/auth/*`,
`/api/nthsky/*`) hits the Worker script. Live positions live in **GeoCell Durable
Objects** (one per geographic cell, SQLite-backed, free tier) with a CellRegistry DO
indexing them - D1 stays off the ingest hot path. D1 `ovrflight` holds accounts, orgs,
API keys, flights, missions, the verification queue and the build board. R2
`ovrflight-tracks` archives flight tracks (the platform copy is never deleted). Auth is
self-built (hashed API keys in D1) plus NTHSKY SSO. No framework, no build step -
deploy is `wrangler deploy`.

**The one external runtime dependency is the basemap.** Leaflet itself is vendored into
the repo, but map tiles come from Esri **World Dark Gray Canvas**
(`server.arcgisonline.com`, no API key): `World_Dark_Gray_Base` plus a separate
`World_Dark_Gray_Reference` label layer. Esri holds no data past z16 and answers z17+
with a light "Map data not yet available" placeholder, so both layers pin
`maxNativeZoom: 16` and let Leaflet upscale to z19. Tiles are darkened in CSS
(`.basemap-dark`, `.basemap-labels`) to sit near Ink/Slate. This replaced CARTO
`dark_all`, which began requiring an API key in 2026-09 and stamped every tile
"API KEY REQUIRED". A third-party basemap is a live dependency whose terms can change
without notice: if the map ever renders wrong, suspect the tile provider first.

## 3. Cloudflare resources

| Piece | Name / ID | Status |
|---|---|---|
| Worker | `ovrflight-api` (`flight-worker/`) | ✅ live |
| Domain | `https://ovrflight.org` (Workers custom domain, attached 2026-08-22) | ✅ |
| Fallback | `https://ovrflight-api.randersen.workers.dev` (kept as the fallback door; browser GETs for HTML 302 to the canonical domain) | ✅ |
| D1 database | `ovrflight` · `ff091b85-28a4-442a-904b-4fb73215d2ca` (ENAM), schema `schema.sql` | ✅ applied |
| R2 bucket | `ovrflight-tracks` (ENAM; flight track archive) | ✅ |
| Durable Objects | `GeoCell` (binding `CELLS`, live per-cell state) · `CellRegistry` (binding `REGISTRY`) - SQLite-backed, migrations v1/v2 in `wrangler.toml` | ✅ |
| Cron | `* * * * *` - ADS-B poll every minute; the 07:37 UTC tick doubles as the nightly D1 backup | ✅ |

## 4. Vars and secrets

Plain vars (in `wrangler.toml`, safe to commit): `ADSB_ENABLED`, `ADSB_BBOX`
(lamin,lomin,lamax,lomax; default Asheville region), optional `FLIGHT_CLOSE_S`.

Encrypted Worker secrets (names only - values live in the Cloudflare dashboard and the
owner's password manager):

| Secret | Purpose | Status |
|---|---|---|
| `NTHSKY_FEDERATION_KEY` | Hub reads/manages the build board (`/api/nthsky/tasks`) | ✅ armed (verified 2026-08-08; 401 not 503) |
| `NTHSKY_SSO_KEY` | Verifies hub SSO tickets on `POST /auth/sso` | ✅ armed (verified 2026-08-22; 401 not 503) |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | Authenticated OpenSky polling (every minute instead of every 5th) | ⬜ optional, anonymous polling works |

A deploy overwrites plain vars from `wrangler.toml` but preserves secrets - never move
a sensitive value to a plain var.

## 5. NTHSKY network (spoke duties)

- **Federation** ✅: `GET/POST/PATCH /api/nthsky/tasks` (bearer `NTHSKY_FEDERATION_KEY`)
  lets the hub read + manage this site's build board (D1 `platform_tasks`, seeded
  ovrflight-01..17: launch → SSO → module ports → repo extraction).
- **SSO** ✅: `POST /auth/sso` verifies the hub's 60s HMAC ticket offline per
  ACCESS-STANDARD section 9 (site-slug check, role cap below super_admin,
  elevate-never-downgrade merge by email). Local login stays the fallback door.
  Conformance suite: `flight-worker/sso_test.mjs`.
- **Standards**: this spoke points at the hub's normative docs - ACCESS-STANDARD (who a
  person is), BRAND-STANDARD (Deck Ink neutrals; OVRFLIGHT's teal plus the intent
  `#FF8A3D` / heli `#FF5C5C` DATA colours, which are map semantics, not brand accents),
  ASSISTANT-STANDARD (OVRFLIGHT is an "AI button only" site - no full assistant here).
  Never duplicate the standards; link them.
- **Hub monitoring**: nthsky's netcheck probes `https://ovrflight.org` health,
  federation (expects 401) and SSO (expects 401).

## 6. Deploy

Push to `main` runs `.github/workflows/deploy.yml`: `wrangler deploy` from
`flight-worker/` via wrangler-action. One-time setup: repo Actions secrets
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (same values as the other ovrgrid
repos). The deploy NEVER runs the D1 schema - apply manually:
`npx wrangler d1 execute ovrflight --remote --file schema.sql`.

Until the cutover PR removes `flight-worker/` from `ovrgrid/ovr3d`, BOTH repos can
deploy the same Worker - coordinate so only one is authoritative (see Changelog 1.0f).

## 7. Roadmap

The live roadmap is the build board in D1 `platform_tasks` (hub-managed over
federation): ovrflight-01..17 plus whatever the board holds now. Highlights still open
at lift time: module ports from the network registry, org access model, OpenSky
authenticated polling.

## 8. Changelog

| Date | Version | Change |
|---|---|---|
| 2026-09-30 | 1.1f | 🗺 **Basemap moved to Esri Dark Gray Canvas.** CARTO `dark_all` began requiring an API key and served every tile stamped "API KEY REQUIRED", so the live map was unreadable. Swapped both call sites (live map + dashboard mini map) to Esri `World_Dark_Gray_Base`, no key, with `World_Dark_Gray_Reference` for labels on the main map only. Esri has no data past z16 and serves a LIGHT placeholder tile above it, so both layers pin `maxNativeZoom: 16` and Leaflet upscales to z19. Darkened in CSS per layer (`.basemap-dark`, `.basemap-labels`) so it reads as Ink/Slate and the teal orbs still carry the eye. Verified in a real browser: 40 tiles loaded, zero CARTO requests, zero failures, labels legible. |
| 2026-08-23 | 1.0f | 🛫 **Repo extraction: OVRFLIGHT stands alone.** Lifted from `ovrgrid/ovr3d` (`flight-worker/` + `flight/` + `db/ovrflight-schema.sql` → root `schema.sql`; references updated) into `ovrgrid/ovrflight`, the same move that gave TeamTrain its own repo. Copied verbatim: the Worker, wrangler.toml (bindings unchanged), the frontend, the four flight docs, the SSO test. New here: this file (v1.0f - first version in the `f` lane), CLAUDE.md, BUILDLOG.md, OPERATING_METHOD.md (from teamtrain, the portable reference), single-job deploy workflow. No code change, no schema change, no live deploy from this repo until the Actions secrets are added and the ovr3d cutover PR removes the old deploy job - until then ovr3d remains the authoritative deployer. Pre-lift history: ovr3d INFRA v1.3-v4.17a + BUILDLOG. |
