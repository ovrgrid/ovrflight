# OVRFLIGHT BUILDLOG

The running story of what happened and what we learned. Append-only, newest at the
bottom. One entry per meaningful drop: what shipped, why, any incident + root cause,
the lesson. `INFRASTRUCTURE.md` says what the system IS; this file says what HAPPENED.

## The story so far (pre-lift, lived in ovrgrid/ovr3d)

OVRFLIGHT grew up inside the OVR3D repo as `flight-worker/` + `flight/`:

- **2026-07-04** - backend provisioned: D1 `ovrflight`, R2 `ovrflight-tracks`, Worker
  `ovrflight-api` with GeoCell Durable Objects, telemetry ingest (JSON + TAK-CoT +
  browser GPS), nearby queries in four formats, and the deploy job in ovr3d's workflow.
- **2026-08-02** - joined the NTHSKY federation: `/api/nthsky/tasks` + `platform_tasks`
  board seeded from the roadmap.
- **2026-08-08** - `NTHSKY_FEDERATION_KEY` verified armed (the 503/401 probe split).
- **2026-08-14** - Deck Ink neutrals applied; intent/heli map colours deliberately kept
  as DATA colours, not brand accents.
- **2026-08-22** - launch day: Cloudflare zone, Workers custom domain, live at
  `https://ovrflight.org`; then the SSO spoke (ACCESS-STANDARD section 9, 41-check
  conformance suite), public signup closed behind a D1 switch, stale workers.dev
  bookmarks redirected to the canonical domain.

The full record of those drops (including the wrong-TLD ovrflight.com incident and its
lesson: curl the title before writing a domain to the live registry) lives in ovr3d's
BUILDLOG and infra changelog. It is not copied here; the record stays where it was made.

## Live entries (append below)

## 2026-08-23 - The lift: OVRFLIGHT gets its own repo (v1.0f)

The site went live on its own domain, SSO landed, and the build board's own launch path
ended with "repo extraction" - so this drop is that task. Everything OVRFLIGHT moved
verbatim from ovr3d into `ovrgrid/ovrflight`: the Worker, the frontend it serves, the
schema (now root `schema.sql`), the four flight docs, the SSO test. New: the RHYS-way
md set (CLAUDE.md, INFRASTRUCTURE.md v1.0f - first version in the `f` lane,
OPERATING_METHOD.md from teamtrain, this file) and a single-job deploy workflow.

Deliberately staged cutover: this repo's deploy stays inert until the owner adds the
two Cloudflare Actions secrets, and ovr3d keeps its `flight-worker` deploy job until a
follow-up PR removes it - two repos able to deploy one Worker is a race, so exactly one
is authoritative at every moment, and the switch is a reviewed PR, not a side effect.

**Lesson carried from the TeamTrain lift:** move the code verbatim and the history
pointer explicitly. A lift that "cleans up while moving" turns a file copy into a
debugging session, and a repo that pretends it has no past loses its lessons.

### 2026-08-31 - AIRULES: the network rules stop being five copies

**Shipped.** A new repo, `ovrgrid/airules`, now holds the rules every Claude session
follows on every ovrgrid site. `RULES.md` R1 to R12 is the canonical block; a GitHub Action
there pushes it into every consumer repo's `CLAUDE.md` as a docs-only PR, replacing
everything between the `AIRULES:START` and `AIRULES:END` markers and touching nothing
outside them. This repo's `CLAUDE.md` is now site facts plus that block. `LESSONS.md`
carries the cross-site lessons harvested from every BUILDLOG; `REVIEW.md` is the protocol
that keeps the rules honest rather than merely deployed.

**Why.** The em-dash ban had been in force since 2026-08-22 and kept failing. Root cause
was not effort, it was distribution: the rule existed in exactly one repo's `CLAUDE.md`
(the hub) and had never been written into the other four, so four sessions out of five had
never read it. Writing it into all five would have been the same mistake one size larger,
because five copies drift. The fix had to make "written down" and "in force everywhere" the
same act.

**Why not the hub.** The hub was the obvious home and it is the wrong one. TeamTrain is
deliberately outside federation and outside the build bridge, and it still needs the rules,
because rules are build-time behaviour while federation is runtime data. The hub is now a
consumer of AIRULES exactly like the spokes: the biggest feeder into it, not its owner.
`docs/BRAND-STANDARD.md` v1.4 accordingly hands Voice over and keeps imagery.

**Lesson.** A rule stored in one place is not a network rule, it is a local habit. And a
rule that enumerates surfaces is read as excluding the surfaces it forgot to name: the
em-dash rule listed files, so sessions correctly concluded chat was out of scope. R2 now
names chat replies first.

**Owner action to finish it.** AIRULES needs one fine-grained PAT, scoped to the five repos
with Contents and Pull requests read/write, stored as the secret `AIRULES_SYNC_TOKEN` in
that repo only. Until it exists the block is correct everywhere but the sync cannot re-push
it. Setup steps are in the repo's README.
