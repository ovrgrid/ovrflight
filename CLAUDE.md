# CLAUDE.md - OVRFLIGHT project guide for Claude Code

You are working in the **OVRFLIGHT** codebase (ovrflight.org). OVRFLIGHT is the
airspace-tracking site of the NTHSKY drone-services network: free, shared low-altitude
tracking of drones, helicopters and small aircraft (roughly 1,500 ft AGL and below).
Pilots and orgs report positions (JSON, TAK-CoT, browser GPS), everyone sees the shared
live map, and an ADS-B connector (OpenSky) fills in transponder traffic. It is a spoke
of the NTHSKY network: the hub (nthsky.ai) reads and manages this site's build board
over federation, and Sign in with NTHSKY is the front door.

This repo was lifted out of `ovrgrid/ovr3d` (where it grew up in `flight-worker/` +
`flight/`) on 2026-08-23, the same way TeamTrain was lifted before it. It runs **the
RHYS way** - the operating method proven on TeamTrain (`ovrgrid/teamtrain`) and shared
by every ovrgrid platform, defined in **`OPERATING_METHOD.md`** in the repo root. If
you've worked in one of these repos, you know all of them.

## Read this first
Before making any change, read **`INFRASTRUCTURE.md`** in the repo root - the single
source of truth for all infrastructure. If reality and that file disagree, flag the
conflict; don't silently assume. Sync before building: `git fetch origin main`.

## Repo layout
- `OPERATING_METHOD.md` - how this product is run (roles, repo contract, GitHub rules, ops)
- `INFRASTRUCTURE.md` - source-of-truth infra reference (read before changing anything)
- `flight-worker/worker.js` - the Cloudflare Worker `ovrflight-api`: auth + SSO, orgs,
  API keys, telemetry ingest, nearby queries, flights, missions, verification queue,
  ADS-B cron, NTHSKY federation. GeoCell Durable Objects hold live state; D1 stays off
  the hot path
- `flight-worker/wrangler.toml` - Worker config (D1/R2/DO bindings, vars, cron, assets)
- `flight/index.html` - the map frontend + accounts UI (served by the Worker as static
  assets; one origin for app + API, no CORS)
- `flight/BRIEF.md` - product vision · `flight/SPEC.md` - architecture ·
  `flight/DEPLOY-FLIGHT.md` - deploy runbook · `flight/docs/TRUST-AND-SAFETY.md`
- `schema.sql` - Cloudflare D1 schema for the `ovrflight` database (idempotent)
- `.github/workflows/deploy.yml` - push-to-main deploy via wrangler-action
- `BUILDLOG.md` - the running build story: decisions, incidents, lessons (append-only)

## Product method - KAMERA
Every proposed change is judged against: **K**eep it simple - **A**dapt to current tech -
**M**odernize & maintain - **E**fficient for the user - **R**ealistically viable -
**A**wesome experience. Build it if it satisfies these (or at least opposes none).

## Hard rules
1. **Never put secret values in any file in this repo.** Credential *names* and
   *locations* only. Real values live in Cloudflare Worker secrets and the owner's
   password manager. This applies to code, docs, and `INFRASTRUCTURE.md`.
2. **Keep `INFRASTRUCTURE.md` current.** When you change infrastructure (Worker, schema,
   bindings, vars, secrets, routes/domains, deploy), update the relevant section in the
   same change. Bump the version + date at the top (lane letter `f` - see
   OPERATING_METHOD "Version lanes") and add a Changelog row. Update status tags
   (✅ / 🟡 / ⬜).
3. **Don't rewrite working systems to "improve" them** unless asked. Prefer the smallest
   change that solves the task. Ask before large refactors.
4. **Append to `BUILDLOG.md` on every meaningful drop.** What shipped, why, any incident
   + root cause, the lesson. In the same commit as the work.
5. **"Done" = shipped AND verified.** Check the Actions run is green after every push to
   `main`, then probe the live site; a merged commit with a red deploy is not done.
6. **No em dashes, anywhere.** Not in site copy, docs, commits, or comments. Use " - ",
   a comma, a colon, or a period instead (network rule: hub BRAND-STANDARD v1.3 rule 6).
7. **This is a safety-adjacent product.** The map informs pilots about shared airspace.
   Never present unverified or stale positions as live truth; read
   `flight/docs/TRUST-AND-SAFETY.md` before touching ingest, display, or verification.

## Change workflow - review-first for big changes
Pushing to `main` auto-deploys to live. So gate changes by size:
- **Small / low-risk** (copy, styling, a bug fix, doc updates): commit straight to `main`.
- **Big / risky** (noticeable UI changes, Worker API changes, D1 schema changes, anything
  touching ingest/auth/SSO or the live map): **do NOT push to `main`.** Branch + PR; Rhys
  reviews and picks the go-live moment by merging.
- When unsure which bucket a change falls in, treat it as big and use a branch + PR.
Schema changes are applied manually
(`npx wrangler d1 execute ovrflight --remote --file schema.sql` - idempotent), never by
a deploy.

## 🛠 The build bridge - connect before you start
If you are a Claude Code session working this network's boards, you have a channel back
to the owner that does not need a new screen. The spec lives in the hub:
**`ovrgrid/nthsky.ai` → `docs/BUILD-SESSION.md`**. In short: `GET /api/build-session/board`
on nthsky.ai carries your inbox (messages from Rhys and the assistant) plus the live
build board, and `POST /messages` is how you answer. Heartbeat when you start - a session
unseen for 24h is reported to the owner as NOT live, however recent its status line
reads, and an uncollected message reads as queued, never delivered. Both are computed,
so connecting is the only way to appear as working.

## Writing style (owner rules - applies to CHAT REPLIES as much as to files)

These govern everything you write: what you say to Rhys in conversation, site copy,
BUILDLOG and INFRASTRUCTURE entries, docs, code comments, commit messages, and anything
an assistant generates. A rule that only covers files is a rule that leaks into chat, so
read these as covering your own sentences first.

**1. No em dashes, anywhere** (2026-08-22). Use " - ", a comma, a colon, or a period
instead. The whole network was swept clean of them; do not reintroduce any. This includes
your replies in chat, which is where they slip back in most often. Watch for the escaped
form too (`—` inside a JS string) - a literal grep will not catch it.

**2. Four signals, so the reader can tell categories apart at a glance** (2026-08-31).
Rhys asked for this: when everything is formatted the same way, a table name and a company
look identical and the sentence stops being readable. Terminal markdown has no colour, so
use contrast:

| Signal | Means | Example |
|---|---|---|
| `backticks` | a literal string, greppable: table, column, role value, file, endpoint, command | `build_messages`, `admin_dev`, `src/worker.js`, `/api/nthsky/tasks` |
| **bold** | a site or product | **ovrops**, **NTHSKY**, **OVR3D**, **OVRFLIGHT**, **TeamTrain** |
| emoji + name | a system or process | 🛠 the build bridge, 🛰 the network check, 🔑 SSO, 🕸 federation |
| plain text | people, concepts, everything else | Mark, the dev host, access, the roadmap |

The test for backticks is one question: could the reader copy this and find it? If not, it
is not code. Bold is reserved for sites, so it stays meaningful - do not use it for general
emphasis. Keep the emoji set small and fixed; inventing one per sentence turns a signal
back into decoration. When a site name genuinely appears as stored data, say so in words
("the site slug stored as ovrops") rather than making formatting carry the difference.

## Commit style
Short, imperative commit messages. When you (an AI) make the commit, add the trailer:
```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
(swap the model name to match whatever model actually did the work).

## Context about the operator
The owner (Rhys) is technical-adjacent - comfortable with APIs, datasets, and AI-assisted
development, but not a hand-coder. Explain what a change does and why in plain terms,
give the exact steps to deploy or test it, and don't assume deep framework knowledge.
