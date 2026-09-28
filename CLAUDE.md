# CLAUDE.md - OVRFLIGHT project guide for Claude Code

You are working in the **OVRFLIGHT** codebase (ovrflight.org). OVRFLIGHT is the
airspace-tracking site of the NTHSKY drone-services network: free, shared low-altitude
tracking of drones, helicopters and small aircraft (roughly 1,500 ft AGL and below).
Pilots and orgs report positions (JSON, TAK-CoT, browser GPS), everyone sees the shared
live map, and an ADS-B connector (OpenSky) fills in transponder traffic. It is a spoke of
the NTHSKY network: the hub (nthsky.ai) reads and manages this site's build board over
🕸 federation, and 🔑 Sign in with NTHSKY is the front door.

This repo was lifted out of `ovrgrid/ovr3d` (where it grew up in `flight-worker/` and
`flight/`) on 2026-08-23, the same way **TeamTrain** was lifted before it. It runs **the
RHYS way**, defined in **`OPERATING_METHOD.md`** in the repo root. The network rules at the
bottom of this file are the same in every ovrgrid repo.

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
- `ovr1/` - the home of **OVR 1**, NTHSKY's small drone and dock R&D program: method
  (`ovr1/TESTING.md`) and pointers only (`ovr1/CLAUDE.md`). Its confidential material lives
  on the hub's working side and in private repos, never here (site rule 4)

## Site rules (on top of the network rules below)
1. **This is a safety-adjacent product.** The map informs pilots about shared airspace.
   Never present unverified or stale positions as live truth. Read
   `flight/docs/TRUST-AND-SAFETY.md` before touching ingest, display, or verification.
2. **Anything touching ingest, auth, SSO or the live map is a big change**, whatever its
   diff size, because the failure mode is a pilot trusting a wrong picture of the sky.
3. **Version lane letter is `f`** (see `OPERATING_METHOD.md` "Version lanes" and R8 below).
4. **This repository is PUBLIC.** Anyone can read every file and every commit, forever.
   Nothing confidential goes in it: no customer or pilot data, no prices or partner names,
   and nothing from a program under NDA (OVR 1: see `ovr1/CLAUDE.md`). Secrets were always
   out (R1); this rule covers everything else that is not ours to publish.

## Deploy notes (current)
Pushing to `main` auto-deploys to live. Schema changes are applied manually
(`npx wrangler d1 execute ovrflight --remote --file schema.sql` - idempotent), never by a
deploy. "Done" means the Actions run is green **and** the live map has been probed.

## 🛠 The build bridge - connect before you start
If you are a Claude Code session working this network's boards, you have a channel back to
the owner that does not need a new screen. The spec lives in the hub:
**`ovrgrid/nthsky.ai`** → `docs/BUILD-SESSION.md`. In short: `GET /api/build-session/board`
on nthsky.ai carries your inbox (messages from Rhys and the assistant) plus the live build
board, and `POST /messages` is how you answer. Heartbeat when you start: a session unseen
for 24h is reported to the owner as NOT live, however recent its status line reads, and an
uncollected message reads as queued, never delivered. Both are computed, so connecting is
the only way to appear as working.

---

<!-- AIRULES:START v1.3 -->
## Network rules (synced from `ovrgrid/airules` - do not edit here)

These come from `RULES.md` in `ovrgrid/airules` and are identical in every ovrgrid repo.
If a rule below is wrong, fix it there, not in this file: the sync overwrites this block.

### R1. Secrets - the one unbreakable rule
Never put a secret value in any file in any repo. Credential *names* and *locations* only.
Real values live in Cloudflare Worker secrets, GitHub Actions secrets, and the owner's
password manager. This applies to code, docs, `INFRASTRUCTURE.md`, commits, and anything
you paste into chat. If you find a live secret committed anywhere, stop and say so rather
than quietly rotating around it.

### R2. Writing style - applies to CHAT REPLIES as much as to files
Everything you write is covered: what you say to Rhys in conversation, site copy, UI
strings, docs, `BUILDLOG.md` and `INFRASTRUCTURE.md` entries, code comments, commit
messages, PR bodies, and anything an in-app assistant generates.

**No em dashes, anywhere** (owner call, 2026-08-22). Use " - ", a comma, a colon, or a
period. The whole network was swept clean of them; do not reintroduce any. This includes
your replies in chat, which is where they slip back in most often: the first version of
this rule listed only files, so sessions read it as an artifact rule and let conversation
slide. Watch for the escaped form too, a backslash-u-2014 sequence inside a JS string: a
literal grep will not catch it, and it renders as a real em dash to the reader. Every AI
surface carries it as a system-prompt style rule (`NO_EM_DASH` in each worker). Standing
exception: `docs/infra-versions/` snapshots are frozen and never edited.

**Four signals, so the reader can tell categories apart at a glance** (owner call,
2026-08-31). When a table name and a company are formatted identically, the reader cannot
tell what is doing what to what. Terminal markdown has no colour, so use contrast:

| Signal | Means | Example |
|---|---|---|
| `backticks` | a literal string, greppable: table, column, role value, file, endpoint, command | `build_messages`, `admin_dev`, `src/worker.js`, `/api/nthsky/tasks` |
| **bold** | a site or product | **ovrops**, **NTHSKY**, **OVR3D**, **OVRFLIGHT**, **TeamTrain** |
| emoji + name | a system or process | 🛠 the build bridge, 🛰 the network check, 🔑 SSO, 🕸 federation |
| plain text | people, concepts, everything else | Mark, the dev host, access, the roadmap |

The test for backticks is one question: could the reader copy this and find it? If not, it
is not code. Bold is reserved for sites so it stays meaningful; do not spend it on general
emphasis. Keep the emoji set small and fixed, because inventing one per sentence turns a
signal back into decoration. When a site name genuinely appears as stored data, say so in
words ("the site slug stored as ovrops") rather than making formatting carry the difference.

### R3. Keep `INFRASTRUCTURE.md` current
When you change infrastructure (Worker, schema, bindings, vars, secrets, routes, domains,
deploy), update the relevant section in the same change. Bump the version and date at the
top, add a Changelog row, update the status tags (✅ live / 🟡 in progress / ⬜ planned).
If reality and that file disagree, flag the conflict; do not silently assume.

### R4. Append to `BUILDLOG.md` on every meaningful drop
What shipped, why, any incident plus root cause, the lesson. In the same commit as the
work. `INFRASTRUCTURE.md` says what the system IS; `BUILDLOG.md` says what HAPPENED and
what we learned. It is the network's long-term memory: a lesson that is not written down
gets re-learned by the next session at full price.

### R5. Do not rewrite working systems to "improve" them
Prefer the smallest change that solves the task. Ask before large refactors.

### R6. Change workflow - review-first for anything that matters
Pushing to `main` auto-deploys to live on every site. So gate by size:
- **Small / low-risk** (copy, styling, a bug fix, doc updates): commit straight to `main`.
- **Big / risky** (noticeable UI changes, API changes, D1 schema changes, auth, anything
  that could disrupt someone mid-session): branch plus PR. Rhys reviews and picks the
  go-live moment by merging.
- When unsure which bucket a change falls in, treat it as big and use a branch plus PR.

Schema changes are applied manually and never by a deploy, so a push cannot wipe live data.

### R7. "Done" = shipped AND verified
Check the Actions run is green after every push to `main`, then probe the live surface. A
merged commit with a red deploy is not done. **Verify on the screen the user actually
touches**, not only the API and the database: on 2026-08-31 a role shipped correct in the
worker and in D1 while the admin dropdown had never learned it, and the owner found it in a
screenshot. Passing probes proved the half I had looked at.

### R8. Version lanes - so parallel sessions never collide
Version numbers carry a lane letter: `a` multi-site, `n` **NTHSKY**, `o` **ovrops**,
`d` **OVR3D**, `f` **OVRFLIGHT**, `t` **TeamTrain**. The same number in two lanes is two
versions, not a conflict. Resolve changelog collisions by union: keep both rows.

### R9. Commit style
Short, imperative commit messages. When an AI makes the commit, add the trailer with the
model that actually did the work:

```
Co-Authored-By: Claude <model> <noreply@anthropic.com>
```

Never put a model identifier anywhere else in a pushed artifact: not in PR titles or
bodies, not in code comments, not in site copy.

### R10. Reuse before rebuild
Platform machinery already exists somewhere in the network (auth, invites, vault, push,
E2E harness, nightly ops, federation). Port it, do not reinvent it. A bug fixed once is a
bug class everywhere: when you fix one, check whether the sibling sites share it.

### R11. KAMERA - the test every proposed change is judged against
**K**eep it simple, **A**dapt to current tech, **M**odernize and maintain, **E**fficient
for the user, **R**ealistically viable, **A**wesome experience. Build it if it satisfies
these, or at least opposes none. User suggestions flow through the in-app KAMERA queue
where a site has one: AI-assessed, admin-decided.

### R12. Who you are writing for
The owner (Rhys) is technical-adjacent: comfortable with APIs, datasets and AI-assisted
development, not a hand-coder. Explain what a change does and why in plain terms, give the
exact steps to deploy or test it, and do not assume framework knowledge. Say what you
actually did and what you did not do. If a check failed, show the output rather than
summarising it away.

### R13. Every switch ships with its control on an admin screen
Owner call, 2026-09-23: "Do not ever make code that is a toggle or trigger for something
without connecting it to a setting and/or toggle inside an admin page." Anything you build
that changes how a product behaves - a toggle, a trigger, a threshold, a cap, a price, a
recipient, a schedule, a feature flag, a page password - ships WITH a control on an admin
screen that shows it and changes it, in the same change. Not a SQL statement, not a
wrangler var, not a constant with a comment saying "change this number". The owner should
never have to ask for the settings screen: it is part of the feature, like its table is.
- **Where the value lives:** a settings table, or the feature's own table, that the screen
  writes. A var or a constant may hold the DEFAULT; the screen holds the live value.
- **What the control shows:** the current value, who changed it and when, and one sentence
  on what it does. A switch whose effect is not live yet says so on the screen.
- **A control that saves but does nothing is worse than none.** It tells the owner a thing
  is off when it is on. Wire the control to the behaviour, then prove the behaviour moves
  when the control does, on the screen (R7).
- **Genuine infrastructure is the only exception** (a binding, a secret, a hostname, a
  cron slot). Say so in the change and in `INFRASTRUCTURE.md`, so it is a decision rather
  than an oversight.
- **The test before calling it done:** if the owner wanted this different tomorrow, where
  would he click? If the answer is "ask a session", it is not done.

### R14. One task system - a task not managed is a task lost
Owner call, 2026-09-27: "A task not managed is a task lost on a random page." Every task in
the network - a build item, a person's to-do, a team assignment, a site's board item, a
follow-up an AI raises - is one kind of thing with one profile, managed at the hub
(**NTHSKY**) whichever page shows it. The profile is defined in the hub's
`docs/TASK-STANDARD.md`; do not invent another.
- **Sectioned, never different.** A site, a build, a working side, a team or a program can
  have its own section of tasks. It never has its own kind of task: the same fields, the
  same statuses, the same management everywhere.
- **Chain of custody.** Who raised it, who holds it now, and every hand-off, status change
  and edit, with who and when, kept in the task's own history. A task is closed (done or
  dropped, with a reason), never deleted.
- **Three views, one record.** Full function on the page it belongs to, the hub's admin
  Tasks area with sections and filters, and the holder's own profile. A change in one is
  the change in all three.
- **Never a new task table.** A feature that needs tasks uses the hub's tasks with a section
  of its own. A site that still keeps its own board mirrors it to the hub in the same
  profile over 🕸 federation until it moves.
- **Routing and reminders are switches** (R13): who may assign, where unassigned work lands,
  when overdue work escalates, each with its control on an admin screen.
- **The test:** if the holder never opens the page the task was made on, do they still see
  it, and can an admin still find it and see who had it last? If not, it is lost.

### R15. One library - the same rules as tasks, for files
Owner call, 2026-09-27: "The project library should be the library - but just as the same
with Tasks - the library should have chain of custody that shows up based on who has access
to what and what their role is." Every file the network keeps for people to work from - a
spec, a drawing, a photo, a signed form, a test record - lives in one library at the hub
(**NTHSKY**), in a section per project, team, program or site. The contract is the hub's
`docs/LIBRARY-STANDARD.md`; do not build another file store.
- **Membership opens the section; a role can narrow a file.** Adding someone to a project
  or team gives them its library. A team leader (or above) can mark a file "this role or
  above", and then nobody below it sees it in a list, finds it in search or fetches it by
  id.
- **Chain of custody.** Who put it there, every new version, move, access change, view and
  download, with who and when, kept with the file. Everyone who can see a file sees its
  history of versions and access; leaders and admins also see who viewed and downloaded it.
  Files are archived, never silently deleted, and a new version never erases the old one.
- **Three views, one file.** The section's Library tab on its page, the hub's admin Library
  across every section, and a person's profile (what they uploaded, what they can open).
- **Public media is not the library.** Images a public page serves are public by design and
  never hold anything confidential; everything else goes in the library.
- **The test:** could an admin say who has this file, who has seen it and who put it
  there, and would someone added to the team tomorrow find it without being sent a link?
<!-- AIRULES:END -->
