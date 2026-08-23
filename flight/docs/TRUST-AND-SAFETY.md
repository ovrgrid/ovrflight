# OVRFLIGHT: How the Shared Airspace Picture Works

*Written for command staff and decision makers. No technical background needed.*

---

## What OVRFLIGHT is

OVRFLIGHT is one shared, live map of who is flying in low altitude airspace: drones,
helicopters, and small aircraft below roughly 1,500 feet. Any legitimate operator can put
their aircraft on the map in seconds, from a phone, a drone dock, or their existing flight
software. Everyone on the map sees who else is operating near them. It is free, and it
exists because right now that information is scattered across dozens of private apps that
do not talk to each other.

## The core question: how do we know a dot on the map is real?

Every aircraft on the map carries one of three trust levels, assigned automatically the
moment its data arrives. The map shows all three differently, so you always know how much
weight to give a dot.

**1. OBSERVED (highest trust).** An independent receiver physically detected this
aircraft's radio broadcast. Today that means aircraft transponders (ADS-B, how helicopters
and planes are tracked worldwide). Soon it includes Remote ID, the FAA-required broadcast
that nearly all drones transmit. Nobody can fake a broadcast their aircraft is not making,
and nobody can hide one it is making. This is ground truth.

**2. VERIFIED.** The operator reported their own position, and we have checked who they
are. For commercial pilots that means their FAA Part 107 remote pilot certificate was
validated against the FAA registry. For police and fire it means the agency account passed
a review before it was activated. Verified aircraft display at full brightness.

**3. UNVERIFIED.** Someone reported a position but their account has not been checked yet.
These aircraft still appear, because more information is safer than less, but they render
dimmed and clearly tagged UNVERIFIED, on the map and in every list.

## The "Verified only" switch

Every user has a one-click filter that removes unverified dots from their view. Two things
matter about it:

- **It is always the viewer's choice.** Nothing is hidden from you by default. A police
  account starts with the complete picture and narrows it only if you choose to.
- **It never removes OBSERVED aircraft.** A drone that a receiver physically detected stays
  on your screen no matter what filters are set. This matters in the field: many careless
  or bad-faith operators do not realize their drone broadcasts Remote ID. Their aircraft
  shows up bright and labeled "Observed" even when every unproven claim is filtered out.

At a crash scene, that means your screen can show three kinds of dots at once: your own
aircraft, cooperating operators who checked in voluntarily, and any unknown drone that is
physically broadcasting nearby, whether its pilot wants to be seen or not.

## Why flooding the map with fake traffic does not work

A reasonable worry: could someone create an account and paint fifty fake drones over their
neighborhood to scare people off? The system is built so that fails:

- **Nothing is anonymous.** Every position report traces to a registered account. For
  commercial accounts that includes an FAA certificate number. Faking airspace data means
  committing documented fraud under an identity that gets banned.
- **Concurrent aircraft caps.** One unchecked account can show at most a handful of
  aircraft in one area at a time. A hobbyist account: two. Fake swarms are blocked at the
  door with a message telling the user that verifying their identity raises the limit.
- **Rate limits.** No account can flood the system with traffic.
- **The dimming does the rest.** Whatever noise gets through renders dim, tagged, and
  removable with one click, while observed and verified traffic is unaffected.
- **And the sky itself is the final check.** Fake dots cannot fly. Receiver detection shows
  what is really airborne, so painted traffic that no receiver corroborates stands out as
  exactly what it is.

## What public safety accounts get

- **A reviewed designation.** Police and fire sign ups are held for human review before the
  elevated designation activates, so the tier means something.
- **The full picture.** Elevated accounts always see all traffic and all trust levels, with
  the filter under their control.
- **Presence without exposure.** Your flights appear to other operators as presence, so
  aircraft deconflict around you, but your identity and mission details are only visible to
  peers at your tier and to qualifying operators. Your agency can also pause its outward
  feed entirely. You are never invisible to your own team.
- **Standard formats.** The system speaks TAK (Cursor on Target), so feeds can flow into
  and out of tools your teams may already use, including DroneSense TAK integrations.

## Every flight becomes a record

Every flight on the platform is logged automatically: when it started and ended, duration,
altitudes, distance, and the complete flight track. Records are downloadable as
spreadsheets. The platform keeps the full track permanently, which means the history is
there when an incident review needs it.

## Getting a department connected

1. An officer creates an account at the OVRFLIGHT site, selects Police, and enters the
   agency name. The request is reviewed and approved by the platform team.
2. The department creates its organization and adds team members.
3. Aircraft get on the map any of three ways: pilots tap Start Flight on a phone at the
   controls, the department's flight software (for example DroneSense via its TAK
   integration) forwards telemetry automatically, or a connection key links dock and fleet
   systems directly.
4. From then on, every flight is live on the shared picture and logged, and the department
   sees everyone else operating in its area in real time.

Questions or setup help: contact the OVRFLIGHT team at NTHSKY.
