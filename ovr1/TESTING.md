# OVR 1 - how we test

The method only. Plans and results are confidential and live on the working side
(`nthsky.ai/ovr1build`), never in this public repo (see `CLAUDE.md` in this folder).

## Four rules

1. **A test not written down did not happen.** Every test has a plan before it starts and a
   record after it ends, pass or fail.
2. **Change one thing at a time.** Each record names the exact hardware build and software
   version it ran on, so a result can be traced to a change.
3. **Simulate before you fly.** Software changes run in software-in-the-loop simulation of
   the flight stack first; a change that has not flown in simulation does not fly outdoors.
4. **Nobody flies to prove a point.** A test stops the moment anything is not as planned, and
   the stop is a result, recorded like any other.

## The ladder

A step is passed when its test has passed on the current build. A hardware or flight software
change drops the build back to the lowest step that change could affect.

| Step | What | Passed when |
|---|---|---|
| 1. Bench, propellers off | power, sensors, calibration, motor order and direction, radio and link-loss behaviour, every failsafe triggered on purpose | every check on the list passes |
| 2. Restrained hover | first spin-up with propellers, tethered or caged | stable hover, clean shutdown, failsafes still fire |
| 3. Free hover, manual | outdoors, a clear area, low and close | holds and lands under manual control |
| 4. Assisted flight | position hold, altitude hold, return to launch | each mode does what it says, repeatably |
| 5. Commanded flight | the ground computer arms, takes off, flies a short route and lands, with a pilot ready to take over | the mission completes with no manual input |
| 6. Dock landing | the same, ending on the dock | lands on the dock and stays there |
| 7. **Prototype zero** | step 6, three times in a row, launched on command | three for three, recorded |

The dock is tested on its own ladder alongside: mechanism cycles, power and charging,
temperature, water and dust, and the link to the ground computer. Each has a written pass
line before the first test is run.

## Before any flight outdoors

A company's research flight is not a recreational flight, so it runs under the FAA's Part 107:

- the remote pilot in command holds a current Part 107 certificate;
- the aircraft is registered (under Part 107, registration applies whatever the weight) and
  meets Remote ID, which applies to every aircraft that must be registered;
- the airspace is checked, with authorization obtained where the airspace needs it;
- the flight stays within visual line of sight;
- **no flight over people** until the aircraft is confirmed eligible. Category 1 of the
  operations-over-people rule (14 CFR 107.110) needs BOTH 0.55 lb or less on takeoff with
  everything attached, AND no exposed rotating parts that would lacerate skin; sustained
  flight over open-air assemblies also needs Remote ID. Weight alone is not enough.

These are the program's minimums, not legal advice: the remote pilot in command checks the
current rules before every flight day.

## Safety on the bench

- Propellers off for every bench test. They go on last and come off first.
- Lithium batteries charge in a fire-safe container, never unattended, never damaged or
  swollen, and are stored partly charged.
- Eye protection whenever a motor can spin.
- One person calls the arm and disarm, out loud.

## The record (the same for every test)

| Field | What goes in it |
|---|---|
| Test ID and date | e.g. `B-012`, the date |
| Who | the pilot in command and the observer, by role on the working side |
| Build | the hardware build and the software version it ran |
| Step | which step of which ladder |
| Plan | what should happen, and the pass line, written before the test |
| Conditions | indoors or out, wind, temperature, light |
| What happened | in order, plainly, including anything unexpected |
| Result | pass, fail, or stopped (and why) |
| Data | logs, video and photos, attached on the working side |
| Next | what changes before the next test |

Post each record as an update on the working side, titled with its test ID. A dedicated test
log on the working side is planned; until then, the updates feed is the record.
