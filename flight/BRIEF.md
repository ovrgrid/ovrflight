# OVRFLIGHT - Project Brief

> Living document. This is the "what and why" before any code. We pour the vision in
> here, turn it into a spec, then build. Nothing here is final; it is the shared source
> of truth for the idea. Owner: Rhys Andersen (NTHSKY / OvrWatch).

**Working name:** OVRFLIGHT
**Target home:** `ovrflight.org` (prototype first at `flight.ovr3d.com`, then lift-and-shift)
**Status:** Brief / discovery. No infrastructure provisioned yet.
**Last updated:** 2026-07-04

---

## 1. Purpose - the "why"

One line: **a free, shared source of truth for who is flying in low-altitude airspace, so
the skies stay safe as they fill up.**

The full set of purposes, all treated as co-equal deciding factors (we do not prioritize
one user type over another; we accommodate all):

- **Incentivize everyone to share telemetry.** Make it so easy and so valuable that there
  is no excuse not to. Free for all.
- **Track the sky as it fills.** As airspace gets crowded, someone has to have the picture.
  This is that picture.
- **A safe space to share information.** Commercial ops and first responders sit in the
  same "stay safe around other aircraft" category.
- **Un-scatter the data.** Today every operator's info is stuck inside their own software.
  Pull it into one place.
- **Build awareness toward safer skies.** Raise awareness, make participation frictionless.
- **Easy to claim your right to be in an area, and deconflict when needed.** Not formal
  airspace authorization; a way to say "I am / will be operating here" and see if someone
  else already is.
- **Support good actors; make bad actors obvious.** Broad legitimate participation makes
  the anomalies stand out.

This value set is the tie-breaker for every product decision we make.

---

## 2. Who it is for

**Primary (valid users):**
- Part 107 pilots doing commercial operations
- First responders / public safety
- Police
- Fire
- Security operators
- Commercial ops of all kinds
- Delivery operators

**Personal / hobbyist:** not the target. Allowed to *post* their own use if they want, but
they get a restricted view: they cannot see commercial or police/first-responder ops.

**User designations matter.** Police and fire get distinct designations (not just generic
accounts). Access and visibility flow from designation.

---

## 3. What flies on the map

Priority is **anything that drops into 1,500 ft AGL or below.**

- Drones (Remote ID + direct telemetry)
- Helicopters
- Small aircraft
- Focus band: low-altitude airspace (≤ ~1,500 ft AGL)

---

## 4. Data IN - ingestion

The single most important build problem, per Rhys: **how we receive and process the data,
and how we make sending it dead simple.**

**What the data is:** telemetry / positioning only. Not heavy. Position + trajectory +
basic flight state. But it still has to be received, processed, and served fast.

**Speed requirement:** from the moment a drone moves to the moment its position and
trajectory are known to a nearby user should be **no more than 5 seconds.** As fast as
reasonably possible.

**What a live user sees:** all active aircraft near them, within ~1 mile of an active user
(v1 map may show up to ~2 miles around a picked location). Localized, not the whole world
firehose.

**Ways data can get in (make ALL of them easy):**
1. **Direct API push** - operator or their software POSTs telemetry to us. Open API.
2. **Copy-paste integration ("API for dummies")** - press button, copy code snippet, paste
   into their stack, data shows up. Pre-coded options for common platforms so they pick
   one and deploy fast. We build the add-on for them.
3. **Embeddable client** - something that can be embedded, takes their data, converts it to
   the right form, and streams it in.
4. **Controller app** - an app installable on any controller that reads the transmitted
   data from that controller and forwards it (instead of the operator's own app).
5. **Remote-flight / GCS software integration** - get the software vendor to send active
   drone position from their platform.
6. **MQTT / bus sniffing** - read the data flowing in/out of the controller and run it
   through a telemetry decipher. Requires internet connectivity.
7. **ADS-B / Remote ID passive** - works, but noted as not always accurate and has no way
   to know mission schedules ahead of time. Treated as a supplement, not the core.

Design goal for all of the above: **so simple there is no excuse.** The winning UX is
"select your platform from a pre-coded list, copy, paste, done."

---

## 5. Data OUT - serving + APIs

- **Out in as many expected formats as possible, and fast.** Match what the ecosystem
  already uses (see §10 - study the free/existing players to learn formats).
- **Live reporting API.** Push a user's info not only to the drone they are actively
  flying, but out to any customer who wants a live feed of that operator's activity.
- **Per-user flight logs.** Every flight is tracked and logged into one database. Users can
  download their own flights as CSV. Simple stats: flight time, altitudes, flight stats.
- **Open source code / API, but the user must be a valid (authenticated) user** to use it.

---

## 6. "Free for all" and "one source of truth" - what it means in practice

- Encourage everyone to send information. Super easy sign-up. No BS: sign up, connect the
  APIs, done.
- Provide simple instructions covering more than one way to connect and receive.
- Goal: **all police and fire report here**, with distinct designations.
- All data tracked, logged, and stored in one database of per-user flights (CSV download).
- We still want an integration that lets us API a user's info out to any customer wanting
  live reporting.

The floor everyone gets: **you can always see who is in your area.** Beyond that general
current-telemetry floor, operators customize who receives what.

---

## 7. Access tiers / visibility model

Different levels of viewing by user type. Rough shape (to be refined):

- **First responders / public safety:** more of an "in this area" situational view (who is
  around them now).
- **Others (commercial, etc.):** fuller telemetry view.
- **Personal / hobbyist:** can post their own, but cannot see commercial or police ops.

Core rule: everyone sees the general "who is in your area" current telemetry. Anything
beyond that (full telemetry, historical, cross-org detail) is governed by designation and
by the sharing settings the operator/org chooses.

---

## 8. Orgs, teams, and sharing - the heart of v1

This is called out as **the biggest thing.** The org / sharing / send / receive model:

- A user logs in and sets up their **organization**.
- **First responder / police sign-ups go through a review / validation step** (mechanism
  TBD - see open questions) before they get their elevated designation.
- An org can contain **teams**.
- An **admin settings panel** controls all access points:
  - all flights visible to all, or
  - visible to only certain teams, or
  - shared to another organization.
- The org-to-org sharing, sending, and receiving is the central feature.

End state: everyone gets to see who is in their area, but operators customize who gets sent
what information beyond the general current telemetry.

---

## 9. Pre-planned missions / soft area claiming

- A database where **pre-planned missions** can be added ahead of time.
- Acts like **"claiming an area without really claiming it."**
- Others (e.g. AirHub-style planners and peers) can see if someone is **already operating
  or planning to operate** in an area, and deconflict.
- Not a formal airspace authorization; a coordination and awareness layer.

---

## 10. Ecosystem, standards, and open-source strategy

- Pull in anything that is **free**. Use existing/free players to learn what gets
  delivered, what formats are used and monitored, and how to copy/match them.
- Reference points already identified (drone + crewed aviation):
  - **Remote ID** broadcast standard (ASTM F3411) and OpenDroneID tooling
  - **ADS-B** (crewed aircraft; OpenSky Network is the open, contribute-your-receiver model)
  - **Wing OpenSky** - free app with a public API others integrate
  - **DroneAware** - free community FAA Remote ID map + history
  - **MAVLink** telemetry (common GCS/autopilot format)
  - **MQTT** as a transport for controller/bus data
- Open question: how much is open source vs. partner/paid software integrations. Default
  stance: anything free, we try to pull in.

---

## 11. Security, privacy, trust (framework now, hardening soon)

- **v1:** open data, no permissions/sharing gating yet - but the **framework must exist**
  from the start so we can turn it on.
- **Near future:**
  - Protect this information.
  - Encrypt everything.
  - Handle first-responder-grade data in an encrypted, compliant way.
  - Anti-abuse: prevent bad actors who sign up just to inject fake data and bog down /
    pollute the system. (Validation, trust scoring, designation review - TBD.)

---

## 12. Look and feel - NTHSKY brand

From `NTHSKY_Brand_Guidelines.pdf`. Neutral-led, teal as the signal.

- **Primary:** NTHSKY Teal `#4A9DAB`
- **Emphasis:** Signal `#21B9BA` (links, live state) · Glow `#66E6E0` (LED highlights,
  sparingly) · Deep `#357C8A` (hovers, headers on light) · Darkest `#1E5560`
- **Core neutrals (default field) - Deck Ink, NETWORK SHARED, do not fork:** Ink `#0B0E12`
  · Slate `#14181E` · Graphite `#262C35` · Steel `#77828E` · Mist `#B6BFC9` · Cloud `#F2F5F7`
  (source of truth: `nthsky.ai/docs/BRAND-STANDARD.md` - the accent is per-site, the
  neutrals are not)
- **Warm option:** Champagne `#F3EFE7` · Linen `#ECE5D8` · Sand `#C8BCA6` · Wheat `#B9AD99`
- **Ratio:** neutral-led, ~10–20% teal. Teal draws the eye; deep teal for depth.
- **Type:** Poppins for display/headlines/numbers; **Inter** for dense UI + data (maps,
  tables, telemetry readouts).
- **Imagery:** real photography cooled toward monochrome, teal LED glow as the only color,
  aerial/elevated, moody, sense of scale. Futuristic but grounded. Never neon or cartoon.
- **Voice:** plain, confident, present tense, utility over hype. **No em dashes, ever.**
- **Logo:** white on dark, dark on light. Never recolor or distort.

The live map's "active aircraft glowing on a cooled network" aesthetic maps directly onto
the brand's node-and-grid imagery. This is on-brand by nature.

---

## 13. v1 scope (what we build first)

- Sign up / log in.
- Set up an org; first-responder/police accounts go through a validation step.
- Orgs contain teams.
- Admin settings panel for all access points (all-visible / team-scoped / org-shared).
- Org-to-org sharing / send / receive (the central feature).
- Site (web) and/or mobile app.
- **Live map** showing active aircraft up to ~2 miles around a picked location.
- That data is served back to the user and can be API'd out to a holding/reporting site.
- **Flight logging:** simple per-flight data - flight time, altitudes, flight stats.
- **Ingest API** with heavy focus on "API for dummies" (button → copy → paste → data shows
  up), plus the controller-read and GCS-integration paths.
- Permissions framework present but running in open-data mode.

## 14. Later / someday

- Encryption everywhere; compliant first-responder data handling.
- Anti-fake-data / anti-abuse trust system.
- Full partner-software integrations.
- Broader format coverage on the out-API.
- Native mobile / controller app distribution.

---

## 15. Open questions (decisions we still need)

1. **First-responder/police validation:** what proves someone is real public safety?
   (Verified email domain? Manual review? Credential upload? Vouching?)
2. **Anti-fake-data:** how do we stop someone injecting garbage telemetry to pollute the
   map? (Rate limits, trust scoring, verified-source-only display?)
3. **Identity vs. privacy:** how much operator identity is shown on the public floor view
   vs. hidden? (Especially police ops visibility.)
4. **Web app, native app, or both for v1?** (Controller-installable app is a bigger lift.)
5. **Which ingest path is the v1 hero?** (Direct API is fastest to ship; controller-read
   and MQTT-sniff are more involved.)
6. **Hosting/scale for real-time:** Cloudflare Workers + Durable Objects / WebSockets is the
   natural fit for "within a mile, under 5 seconds" - to be confirmed in the spec phase.
7. **Data retention:** how long do we keep flight logs, and who can download whose?
8. **Legal / liability posture:** this is not FAA authorization; how do we message that so
   nobody treats "soft claim" as a clearance?

---

## Next step

Turn this brief into a technical **spec**: data model (aircraft, positions, orgs, teams,
missions, shares), the ingest + serve API surface, the real-time architecture that hits the
5-second / 1-mile target, and the v1 screen list. No infrastructure gets provisioned until
the spec is agreed.
