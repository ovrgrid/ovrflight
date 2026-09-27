# OVR 1 - the program's home in OVRFLIGHT

You are in `ovr1/` of the **OVRFLIGHT** repo. OVR 1 is NTHSKY's research and development
program for a small drone and the dock it lives in. The root `CLAUDE.md`, its site rules and
the network rules apply here too. This file adds the rule that matters most in this folder.

## ⚠️ This repository is PUBLIC

`ovrgrid/ovrflight` is a public GitHub repository: anyone on the internet can read every
file and every commit, forever. OVR 1 is confidential by default. Everyone on the team signs
a project NDA before they see anything, and the public page asks for an email before it
opens. So **nothing confidential about OVR 1 goes in this repo**, in a file, a commit
message or a branch name:

- no parts, part numbers, bills of materials, weights, dimensions, designs, drawings,
  models, firmware or parameters;
- no suppliers, partners, manufacturers, customers or prices;
- no people (the team includes minors), no test data, no test locations or dates;
- no plans, schedules, money or anything from the NTHSKY Drive.

If you are not sure, it does not go here. Publishing a design can also affect whether it can
be patented, and a public commit cannot be taken back. Only two kinds of thing belong in this
folder: **how the program is run** (method, checklists, templates) and **where things live**.

## Where OVR 1 lives

| What | Where | Who can see it |
|---|---|---|
| Public page | `nthsky.ai/ovr1` on the **NTHSKY** hub (Builder build `ovr-1-dock-page`) | anyone who gives an email |
| Working side: team, updates, files, the NDA | `nthsky.ai/ovr1build` | approved members who signed the NDA |
| Program journal: sources, plan, steps, decisions | `ovrgrid/nthsky.ai` (private) → `docs/builds/ovr-1-dock.md` | the organization |
| NDA text and the questions for counsel | `ovrgrid/nthsky.ai` → `docs/builds/ovr-1-dock-nda.md` | the organization |
| Source material (the build sheets, reasoning, models) | the NTHSKY Drive | Drive sharing |
| Code, firmware, parameters and test data | the private repo `ovrgrid/ovr1` (decided 2026-09-27) | the program team |
| Who signed, who came in and what they did | hub Admin → 🗄 Records | owner tier only |

## How it runs

- The RHYS way, as `OPERATING_METHOD.md` at the repo root defines it. Version lane `f`.
- Testing follows `TESTING.md` in this folder. Results are recorded on the working side,
  never here.
- The first prototype is **prototype zero**: the smallest thing that proves the idea.
  Connected, flying, and home again in its dock, three times in a row.

## OVR 1 and the OVRFLIGHT map

Planned, not built: OVR 1 aircraft could report their positions to OVRFLIGHT like any other
aircraft. Decide before it happens, flight by flight: the shared map is public, so a test
flight on it is visible to other pilots nearby (a safety gain) and to everyone else (a
confidentiality cost). `flight/docs/TRUST-AND-SAFETY.md` applies either way: a test aircraft
must never appear as verified live traffic it is not.
