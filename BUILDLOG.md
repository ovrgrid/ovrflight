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

## 2026-09-27 - OVR 1 gets a home, and "public" becomes a rule

**What.** OVR 1, NTHSKY's research and development program for a small drone and its dock,
now has a folder here: `ovr1/CLAUDE.md` (what may and may not live in this repo, and where
everything else lives) and `ovr1/TESTING.md` (the test method: four rules, a step ladder
ending at "prototype zero", the Part 107 minimums before any outdoor flight, bench safety,
and one record format for every test). The site itself, the team's working side and the
project NDA are on the **NTHSKY** hub (`nthsky.ai/ovr1`, `nthsky.ai/ovr1build`), built the
same day on the hub's own branch.

**Why so little.** The owner asked for the program to have its own branch here and to mimic
the MD files. Checking the repo first showed that `ovrgrid/ovrflight` is **public**, while the
program is confidential by default: its team signs an NDA before seeing anything. So the
program's substance (parts, suppliers, prices, designs, people, test data) stays on the
working side, in the private hub repo and on the Drive, and a private repo for the code and
test data is proposed (`ovrgrid/ovr1`) for the owner to create. What lives here is the
method and the pointers, which are safe to publish and useful to anyone on the team.

**Also.** The FAA rules the testing doc states were checked against the regulation and the
FAA's registration page on the day, not written from memory: Category 1 over people needs
0.55 lb or less AND no exposed rotating parts that would lacerate skin (14 CFR 107.110), and
under Part 107 an aircraft is registered whatever its weight, so it needs Remote ID. A
sub-250 g design alone does not make a flight over people legal.

**LESSON.** Check a repository's visibility before writing anything into it. The instruction
"put it in the flight repo" was about where the work belongs; whether a word of it can be
public is a separate question, and a public commit cannot be taken back. It is now site
rule 4 in `CLAUDE.md`, so the next session meets it before it writes anything.

---

## 2026-09-30 - The map went blank: a free basemap stopped being free (v1.1f)

The owner opened the live map and found it papered over with "API KEY REQUIRED /
carto.com/basemaps?apikey" watermarks across every tile. Nothing in this repo had
changed. CARTO began requiring an API key for `basemaps.cartocdn.com/dark_all`, and the
map we had been serving since July quietly turned into a wall of advertising for their
signup page. The aircraft layer, the list, the conflict logic: all still correct,
sitting on top of an unusable backdrop.

Replaced with Esri **World Dark Gray Canvas** (`server.arcgisonline.com`), which needs
no key. Esri splits base and labels into two services, which turned out to be a feature:
the base is darkened hard in CSS to sit near Ink/Slate so the teal orbs carry the eye,
while the label layer is only lightly dimmed so place names stay readable. Filters are
scoped per layer by `className` rather than applied to the whole tile pane, because
darkening the pane would have crushed the labels along with the base. The dashboard mini
map takes the base only: at country zoom, labels are clutter.

**The trap, caught before shipping and not by luck.** Esri answers z17 and beyond with
HTTP 200 and a tile - but the tile is a LIGHT grey square reading "Map data not yet
available". Identical byte length at z17, z18 and z19 is what gave it away; downloading
one and looking at it confirmed it. Shipping that would have reproduced the exact bug we
were fixing, one zoom level in, and it would have looked like our own CSS was broken
rather than a provider limit. Both layers now pin `maxNativeZoom: 16` so Leaflet upscales
the last real tile instead of requesting the placeholder - slightly soft when zoomed
tight, which is the right trade for a quarter-mile conflict radius that still has a dark
map under it. A 200 is not the same as a usable response, and byte-identical responses
across inputs that should differ are worth one more look.

**The lesson, which is bigger than one provider.** Leaflet is vendored into this repo, so
we treated the map as self-contained. It never was: the tiles were always a live call to
a third party operating under terms they can change unilaterally, and they did, with no
notice and no deploy on our side. A dependency that can break the product without anyone
touching the code deserves to be named in `INFRASTRUCTURE.md` rather than living
implicitly inside a URL string, so section 2 now calls the basemap out as the one
external runtime dependency and says to suspect the provider first when the map looks
wrong. Worth a follow-up: nothing watches for this. A basemap that silently degrades is
invisible to every health check we have, because the tiles are fetched by the browser and
never touch our Worker.

Verified in a real browser against the actual page, not just by reading the diff: 40
tiles loaded across both layers, zero requests to CARTO, zero failed tile responses, no
JS errors, 45 simulated aircraft still rendering, and place labels (Asheville, Woodfin)
legible against the darkened base.
