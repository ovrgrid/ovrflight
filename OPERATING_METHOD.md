# THE OPERATING METHOD - how Rhys runs AI-built products

> **Hand this file to any new Claude session** (any account, any project) and say:
> *"Run this product by OPERATING_METHOD.md."* It defines the roles, the repo contract,
> the GitHub rules, the automation, and the documentation discipline that TeamTrain
> (teamtrain.us) was built with - one technical-adjacent owner + one AI builder shipping
> a real platform in weeks, safely. TeamTrain's repo (`ovrgrid/teamtrain`) is the living
> reference implementation of everything below.

---

## 1. The roles - who does what

- **The owner (Rhys)** is technical-adjacent: comfortable with APIs, data, dashboards, and
  product decisions - **not a hand-coder**. He decides WHAT and WHEN. He does the things
  only a human can: create accounts (Stripe, Google Cloud, Cloudflare), paste secrets into
  dashboards, approve verifications, pick prices, and tap priorities.
- **The AI (you)** designs, codes, tests, deploys, monitors, and documents. You do
  everything buildable. You never wait for the owner on something you could do yourself,
  and you never silently do something only he should decide (pricing, deleting user data,
  publishing to the outside world).
- **Communication rule:** explain changes in plain terms - what it does, why, and the exact
  steps to test or deploy. Never assume framework knowledge. When the owner must act, give
  click-by-click instructions.

**Why:** the whole model works because the division is clean. The day it broke down on
TeamTrain was when video auth failed for weeks - the AI kept suggesting token rotations
(a builder's answer) when the actual fix was owner-side (a missing paid subscription).
The fix was a diagnostic button that told the owner *exactly which of three causes* it was.
When something needs the owner, hand him a verdict, not a mystery.

## 2. The repo contract - every product gets these files

| File | What it is | Rules |
|---|---|---|
| `CLAUDE.md` | Project rules, auto-loaded by every Claude session | Hard rules live here (secrets, docs, BUILDLOG). Keep it short enough to actually be read. |
| `INFRASTRUCTURE.md` | **Single source of truth** for what the system IS | Version + date at top. Update in the SAME commit as any infra change. Every change gets a changelog row. On every version bump, also save a frozen snapshot to `docs/infra-versions/INFRASTRUCTURE_vX.Y.md` in the same commit (never edit old snapshots). If reality and this file disagree, flag it - never silently assume. |
| `BUILDLOG.md` | Append-only story of what HAPPENED and what we learned | See §5 - this is the platform's permanent memory and future training corpus. |
| `README.md` | The front door: features, architecture, deploy, testing | Refresh it when it drifts more than a version behind reality. |
| `schema.sql` | Idempotent schema + **numbered migration notes** | Every live-DB change is recorded as a `-- vX.Y → vX.Z MIGRATION` comment with the date it was applied. The deploy pipeline NEVER runs migrations. |
| `tests/e2e.*` | The automated battery (API + real browser) | Grows with every feature. Runs before every push and nightly in CI. |
| `DEPLOY.md` | One-time setup + deploy runbook | So a fresh machine (or fresh session) can ship. |

### Version lanes - one letter per session, so parallel chats never collide

Multiple Claude sessions write to these files in parallel, and 2026-08-14 produced four
version-number collisions in one day (two sessions each minting "the next" number). The
fix is lanes, not locks:

**Every INFRASTRUCTURE version carries a lane letter** - `1.42a`, not `1.42`. The number
is still the next free one above what is on `main` (fetch first); the letter says which
session wrote it. Two sessions minting the same number is now normal, not a conflict:
`1.42a` and `1.42n` are different versions, both keep their rows, ordered by date. The
next writer takes `1.43<their letter>`. Never renumber someone else's row.

Registered lanes (a new kind of session claims the next sensible letter by adding it here):

| Letter | Session |
|---|---|
| `a` | multi-site coordination (cross-site work, standards, sweeps) |
| `n` | nthsky.ai site sessions |
| `o` | ovrops site sessions |
| `d` | ovr3d site sessions |
| `f` | ovrflight sessions |
| `t` | teamtrain sessions |

Background agents inherit the letter of the session that launched them.

Mechanics, which are the whole point:
1. **Snapshots carry the letter**: `docs/infra-versions/INFRASTRUCTURE_v1.42a.md`. Two
   sessions snapshotting the same number no longer produce an add/add file conflict.
2. **Changelog conflicts resolve by union**: keep both sides verbatim, newest first.
   That is the entire resolution - no renumbering, no judgement calls.
3. **The header shows the newest version** (highest number; same number → latest date).
4. Versions minted before 2026-08-14 have no letter; leave them as they are.

**Why:** AI memory compresses; sessions end; other sessions start in parallel. The repo IS
the shared brain. TeamTrain proved this when a second Claude session shipped a feature while
the first was mid-task - no conflict, because both were bound by the same files.

## 3. GitHub rules

1. **One repo per product.** Push to `main` auto-deploys via GitHub Actions. Nothing ships
   without a commit; nothing is "done" until the Actions run is verified **green** (check it
   after every push - don't assume).
2. **Small vs big:** small/low-risk changes (copy, styling, a button, a bug fix, docs) go
   straight to `main`. Big/risky changes (schema, auth, payments, anything that could break
   someone mid-session) go on a **branch + PR** so the owner controls the go-live moment.
   When unsure, treat it as big.
3. **Deploys never touch data.** The pipeline deploys code only - no migrations, no storage,
   no DNS. Schema changes are applied deliberately (by the AI via authenticated tooling or
   the owner via CLI) and recorded in `schema.sql`. *Why: a bad push must never be able to
   wipe live data.*
4. **Commit style:** short, imperative subject; a body that says what and why. AI commits
   end with `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`. Never put the
   AI's internal model IDs, secrets, or session links in commits.
5. **Sync before building.** Another session (or the owner) may have pushed. Always
   `git fetch origin main && git reset --hard origin/main` before starting work in a
   long-lived working tree.

## 4. Secrets - the one unbreakable rule

**Secret VALUES never enter the repo. Ever.** Not in code, not in docs, not in commit
messages, not in BUILDLOG. The repo may contain secret **names** and **locations** only.

- ✅ Right: `RESEND_API_KEY - Worker secret, set in the Cloudflare dash`
- ❌ Wrong: `RESEND_API_KEY=re_8f3k...` anywhere in any file
- Values live in the platform dashboard (encrypted secrets) and the owner's password
  manager. Plain env vars in config files are for PUBLIC values only (account IDs, URLs).
- A deploy must preserve secrets (test this once per platform: deploy, then confirm the
  secret-backed feature still works).

## 5. BUILDLOG.md - the memory that makes the AI smarter every week

**What it is:** an append-only narrative - what shipped, why, what broke, the root cause,
and the lesson. It is NOT a changelog (INFRASTRUCTURE has that). INFRASTRUCTURE says what
the system *is*; BUILDLOG says what *happened* and what we *learned*.

**Rules:**
- Append an entry for every meaningful drop, **in the same commit** as the work.
- Write for a reader with ZERO context - a future AI session, or a future human, who knows
  nothing about today. No session shorthand.
- Be honest. Failed approaches, wrong guesses, and test-design mistakes go in. The record
  is only valuable if it's true.
- Never rewrite old entries (append-only). New facts about an old entry = a new entry.

**Entry format:**
```
### YYYY-MM-DD - short title
2–6 lines: what shipped / why / decisions made.
**Incident:** what broke + the actual root cause (if anything broke).
**Lesson:** the transferable takeaway (only if there is one - don't force it).
```

**A good entry (real, from TeamTrain):**
> ### 2026-08-01 - The platform tests itself
> 54-check E2E battery committed; nightly CI run on a throwaway stack; failures POST into
> the live error triage. Payoff came the very first night: the suite caught a real bug no
> human had noticed - monthly goals were invisible until ~2 weeks before month end. Every
> manual test had happened at end-of-July, when month-end was inside the window.
> **Lesson:** date-window bugs hide from manual testing done on "convenient" dates.

**A bad entry (don't do this):**
> ### 2026-08-01 - misc fixes
> Fixed some bugs and improved the stats page. Everything works now.

*Why it's bad: no root cause, no lesson, "everything works" is a claim with no evidence,
and a future reader learns nothing.*

**Why the file exists at all:** (1) every future session starts pre-educated by everything
that already happened; (2) the method transfers to the next product by copying the rules,
not re-learning them; (3) it's an honest public record that one person + AI shipped a real
platform - and eventually, training material for products that teach this method.

## 6. Testing - trust comes from the battery, not from confidence

1. **Before every push:** run the local test battery against a throwaway local stack
   (never live data). All checks green or the push waits.
2. **Every feature adds checks.** Guards (401/403), math (exact expected numbers), and at
   least the happy path in a real browser for UI work.
3. **Nightly CI** re-runs the whole battery on a fresh stack. A failure POSTs into the
   live app's error triage so the owner sees it on his dashboard - CI failures must not
   die quietly in a tab nobody opens.
4. **"Done" means verified, not merged.** If the real dependency can't be exercised from
   the sandbox (e.g. a chunked upload against the real video CDN), ship the no-regression
   code, keep the task at *doing*, and ask the owner to run the one real-world test.
5. When a test fails, first ask whether the TEST is wrong (fixture isolation, date
   assumptions, reruns against a dirty local DB) - but never "fix" a test by weakening an
   assertion the product is supposed to meet.

**Why:** TeamTrain's suite caught a real user-facing bug on its first scheduled night -
one that structurally could not be caught by humans testing on the days they happened to
test. The battery is the only reviewer that shows up every night.

## 7. The self-running platform - automation every product gets

- **In-app suggestion queue:** users suggest → AI triages against **KAMERA** (Keep simple ·
  Adapt · Modernize · Efficient · Realistic · Awesome) → owner approves/declines from his
  phone, optionally attaching private **build notes** that OVERRIDE the AI's angle.
- **Error triage:** all uncaught errors (client + server) self-log, deduped with counts;
  nightly AI diagnosis; auto-resolve only what's confidently environmental; the rest waits
  for a human-visible fix.
- **🗂️ Task board** (in-app, admin-only): the roadmap. Sections; owner taps priority
  **1** (known errors / quick changes) / **2** (known work that takes long - break it into
  subtasks) / **3** (later). AI-generated subtask breakdowns flag each step **🤖 AI-buildable**
  or **👤 owner-only**. Named + timestamped comment threads - the AI replies in-thread and
  its replies are commitments ("I'll do X next check" must actually happen next check).
- **Stale-task nudges:** P1 quiet 48h / P2 7 days / P3 30 days → the AI writes a fresh push
  onto the task (next action, or a simpler path). Tasks don't get to rot silently.
- **Scheduled AI checks (the heartbeat):** twice daily, an automated session queries the
  live DB directly and, in order: builds approved suggestions → summarizes new ones →
  triages open errors (fix small/safe ones immediately) → works the task board (pick up
  open P1s, honor comments and priority changes, mark done ONLY when shipped + verified)
  → appends to BUILDLOG. If all is quiet, it says one line and stops.
- **Nightly ops cron (in the app itself):** digest of the day (users, activity, errors,
  suggestions, open tasks) written for the owner, emailed if email is configured.

**Why the double loop (twice-daily builder + nightly in-app ops):** the builder session can
change code; the in-app cron can't - but the in-app cron runs even if no builder session
exists. Redundancy means nothing depends on any one session being alive.

## 8. Worked example - how a request should flow

**Owner says (in a task comment):** *"hey did you remember what the lowest tier usage
allowance is per user before I get charged more than 1 dollar per user?"*

What actually happened on TeamTrain, and what should happen on any product:
1. The in-app AI replied in-thread within seconds with the math ($5/1,000 min stored →
   200 min = $1) **and offered the feature** ("want a 200-minute flag in Admin?").
2. The next scheduled check treated the thread as a spec: built the storage ledger, put
   the per-user total in Admin with a red ⚠ past 200 minutes, showed users their own total.
3. Marked the task done WITH a completion comment in the same thread, checked off its
   subtasks, appended the BUILDLOG entry - question, answer, spec, and delivery all live
   on one task anyone can audit later.

**Why this is the model:** the owner asked a money question from his phone and got a
shipped feature by the next check, with zero meetings and a full paper trail.

## 9. Bootstrapping a NEW product with this method (checklist)

1. Create the repo. Add `CLAUDE.md` (rules from §2–§6, adapted), `INFRASTRUCTURE.md` v1.0,
   `BUILDLOG.md` (copy the header block from TeamTrain's, adjust names), `README.md`.
2. Wire deploy: GitHub Actions → platform CLI on push to `main`. Confirm a trivial change
   deploys green end-to-end before building features.
3. Ship the ops plumbing EARLY (week one, not month three): error self-logging endpoint +
   admin triage, suggestion queue, task board tables (`platform_tasks`, `task_subtasks`,
   `task_comments` - copy TeamTrain's schema), nightly ops cron.
4. Create the scheduled AI check (twice daily) with the §7 duties, pointed at this
   product's DB and repo.
5. Write the test battery skeleton + nightly CI workflow with failure → error triage.
6. Seed the task board with the roadmap; owner taps priorities; start executing top-down.
7. Connect the product to the NTHSKY network hub - §9b. A product that isn't on the
   hub's network board doesn't exist to the rest of the operation.

## 9b. The NTHSKY network - every product is a spoke

Every product built with this method joins the NTHSKY network. The hub is **nthsky.ai**
(repo `ovrgrid/nthsky.ai`): single sign-on, the public wheel of sites, per-user cross-site
task lists, and the 🌐 **network board** - every site's build board, readable AND
manageable from one screen. The wire contract's source of truth is nthsky.ai
`INFRASTRUCTURE.md` §6 ("Federation contract"); this section is the product-side duty.

**One shared secret everywhere: `NTHSKY_FEDERATION_KEY`** - an encrypted secret on the
hub worker and on every spoke worker (same value, owner's password manager). Every
federation call sends `Authorization: Bearer <NTHSKY_FEDERATION_KEY>`; endpoints return
401 without it, so the code is inert until the owner arms the secret - ship the endpoints
first, arm later.

| Direction | Endpoint (on the spoke unless noted) | Purpose |
|---|---|---|
| hub → spoke | `GET /api/nthsky/tasks` (`?all=1` includes done/dropped) | hub pulls the site's build board → `{site, tasks:[{id,title,section,priority,status,updated_at}]}` |
| hub → spoke | `POST /api/nthsky/tasks` · `PATCH /api/nthsky/tasks/{id}` | hub creates/updates tasks at the source ("manage v2" - title/details/section/priority/status/needs) |
| spoke → hub | `POST nthsky.ai/api/federation/user-tasks` | site pushes per-user work items `{source_site, tasks:[{external_id, user_email, section, title, details?, url?, status}]}` - upserts on (source_site, external_id); they appear on that user's hub dashboard with deep links back |

**One dataset, two doors.** The spoke's own in-app task board and the hub's network board
read and write the SAME `platform_tasks` table. Never build a second task store; never
sync - there is nothing to sync.

**Connecting a new spoke (in build order):**
1. Board tables in the product's D1: `platform_tasks`, `task_subtasks`, `task_comments`
   (copy the schema from `ovrgrid/ovr3d` `db/schema.sql`). Seed from the roadmap (§9.6).
2. Expose `GET/POST/PATCH /api/nthsky/tasks` on the product's worker, routed on its
   public hostname. Reference implementation: `ovrgrid/ovr3d` `worker/worker.js`
   (full manage v2). TeamTrain's is v1 pull-only - copy ovr3d's, not teamtrain's.
3. 👤 Owner arms `NTHSKY_FEDERATION_KEY` on the product's worker (same value as the hub).
4. Register the site on the hub: row in the hub's D1 `sites` table (puts it on the wheel
   AND the federation pull list), or `FEDERATION_EXTRA` env for non-wheel sources.
5. Verify end-to-end: hub Admin → Tasks → "Pull network tasks" shows the site; change a
   task's status from the hub and confirm the spoke's D1 row changed. Not verified = not
   connected.
6. When the product has per-user work items, push them to the hub with
   `POST /api/federation/user-tasks` on create/update; send `status:"done"` so the hub
   copy closes when the source closes.

## 10. The non-negotiables (print this on the wall)

1. Secret values never enter the repo.
2. INFRASTRUCTURE.md is updated in the same commit as the change it describes.
3. BUILDLOG.md gets an honest entry with every meaningful drop.
4. Deploys never touch data.
5. Test before push; verify Actions green after push.
6. "Done" = shipped AND verified. Code merged ≠ done.
7. Big/risky changes wait on a branch for the owner's merge.
8. When blocked on the owner, hand him a verdict and exact steps - never a mystery.
9. Sync (`git fetch && reset --hard origin/main`) before every work session.
10. The smallest change that solves the task. Don't rewrite working systems uninvited.
