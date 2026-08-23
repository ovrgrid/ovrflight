# Deploying OVRFLIGHT - runbook

What exists, what deploys automatically, and the short list of things done by hand.
Read `flight/SPEC.md` for the architecture. Same rules as the rest of the repo:
no secret values in any file, D1 schema applied manually, deploys via push to `main`.

## Already provisioned (done 2026-07-04, via Cloudflare API)

| Resource | Name / ID | Status |
|---|---|---|
| D1 database | `ovrflight` · `ff091b85-28a4-442a-904b-4fb73215d2ca` (ENAM) | ✅ created, schema applied |
| R2 bucket | `ovrflight-tracks` (ENAM) | ✅ created |
| D1 schema | `schema.sql` (19 statements) | ✅ applied to live DB |

The Worker (`flight-worker/`) is written and tested locally but NOT yet deployed -
it ships automatically the first time this branch merges to `main`.

## What happens on merge to `main`

The `flight-worker` job in `.github/workflows/deploy.yml` runs
`wrangler deploy` from `flight-worker/`. This:

- creates the Worker `ovrflight-api` with the GeoCell Durable Object,
- binds it to the D1 database and R2 bucket above,
- serves it at `https://ovrflight.org` once the custom domain is attached
  (`https://ovrflight-api.randersen.workers.dev` keeps working as a fallback).

No new GitHub secrets needed - it uses the same `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` as the other jobs.

**If the job fails with an authentication/permission error:** the API token was
created from the "Edit Cloudflare Workers" template and may lack D1/R2 scopes.
Edit the token (dash.cloudflare.com → My Profile → API Tokens) and add:
**Account → D1 → Edit** and **Account → Workers R2 Storage → Edit**, then re-run
the job from the Actions tab.

**Find the workers.dev URL** after the first deploy: Workers & Pages →
`ovrflight-api` → the `workers.dev` route shown on the overview (or in the
deploy job log).

## Trying it live (after first deploy)

1. Create your account (first signup becomes the platform super admin):
   ```bash
   curl -X POST https://ovrflight.org/v1/auth/signup \
     -H "Content-Type: application/json" \
     -d '{"email":"you@nthsky.net","password":"<pick one>","name":"Rhys Andersen"}'
   ```
   Save the `token` from the response.
2. Create an org, then an API key (see `flight/SPEC.md` §4 for all endpoints):
   ```bash
   curl -X POST .../v1/orgs -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" -d '{"name":"NTHSKY Ops"}'
   curl -X POST .../v1/keys -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" -d '{"org_id":"<org id>","label":"test"}'
   ```
   The `secret` (starts `ovf_`) is shown once - store it.
3. Post a position with the key, from anything that can send HTTP:
   ```bash
   curl -X POST .../v1/telemetry -H "Authorization: Bearer ovf_..." \
     -H "Content-Type: application/json" \
     -d '{"aircraft":"drone-01","class":"drone","lat":35.5951,"lon":-82.5515,"alt_agl_ft":200}'
   ```
4. Open the map in live mode (query params store themselves; sim data disappears):
   ```
   flight/index.html?api=https://ovrflight.org&token=<token>
   ```
   Your posted aircraft appears within ~3 seconds. `?api=off` returns to sim mode.

## Feeding it real data without your own drone

**ADS-B (helicopters + small aircraft), automatic.** The Worker polls the OpenSky
Network every 5 minutes for the Asheville region (`ADSB_BBOX` in
`flight-worker/wrangler.toml`) and puts live crewed traffic on the map under the org
"ADS-B Network". Nothing to configure. To poll every minute instead: create a free
OpenSky account, create an API client on your account page, then
`wrangler secret put OPENSKY_CLIENT_ID` and `wrangler secret put OPENSKY_CLIENT_SECRET`
(run from `flight-worker/`).

**DroneSense (Asheville PD), via TAK/CoT.** DroneSense's TAK integration streams
telemetry as Cursor-on-Target. Our endpoint accepts it directly:

```
POST https://ovrflight.org/v1/ingest/cot
Authorization: Bearer ovf_<their API key>
Content-Type: application/xml
<body: CoT event XML, single or multiple events>
```

Setup for the PD: sign them up, create their org (kind `agency`), issue an API key,
and point their TAK/CoT forwarder at the URL above. If their DroneSense plan exposes
the Open API instead, we build that adapter once they share the docs/credentials -
the ingest core is shared, so it is a small add.

## Still manual, when you choose to (not needed for a functional loop)

> **Launch approach (updated 2026-08-21):** no Pages project. The Worker already
> serves the app and API on one origin, so going live on the real domain is a
> Workers **Custom Domain**, which also auto-creates DNS and the certificate.

| Step | When |
|---|---|
| Buy `ovrflight.org` (Cloudflare Registrar is simplest) or add the zone + move nameservers if bought elsewhere | before launch |
| Workers & Pages -> `ovrflight-api` -> Settings -> Domains & Routes -> **Add Custom Domain** `ovrflight.org` (and `www.ovrflight.org`) | the actual go-live step; DNS + cert are automatic |
| Confirm `NTHSKY_FEDERATION_KEY` secret on the worker; arm `NTHSKY_SSO_KEY` at the SSO drop | launch / SSO |
| Update hub `NETCHECK_SITES` + docs from workers.dev to ovrflight.org URLs | after the domain resolves |
| Workers Paid plan ($5/mo) | optional now - SQLite-backed Durable Objects run on the free plan; paid raises limits when traffic grows |
| Terms of service incl. the "platform always retains full tracks" retention language | before public launch |

## Costs today

Everything provisioned so far is on free tiers: D1 (5 GB), R2 (10 GB), Workers
(100k requests/day), Durable Objects (SQLite-backed, free plan). $0/month until
real traffic arrives.
