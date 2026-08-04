# Current status

This file is the single current-state summary. Historical runbooks and the
capability registry keep their original evidence history; they must not be
used to promote a current project without matching project, commit and
artifact evidence.

## Completed foundation

- Public central forge, one repository per userscript, and local-only private
  evidence are separated.
- Project generation, work orders, readable builds, candidate locking,
  evidence validation and fail-closed release checks are available.
- Mac Chrome + Tampermonkey, GitHub publication and Greasy Fork publication
  have passed infrastructure canaries.
- Generic Android emulator, OnePlus Appium, iOS Simulator and iPhone Appium
  backends have structured evidence. Generic backend evidence never proves a
  userscript-manager gate.
- The current Android sample source is commit
  `b87a61073b29f9718bda4cbdcf1ceaac3583cc6b`; its readable artifact SHA-256 is
  `85089cca703bccc660f0e6e7e6efcee649a316b5901219b84f3614aa0c842595`.
- The sample implementation has PASS static/build tests. Historical local
  direct-browser and Mac Chrome + Tampermonkey evidence belongs to the prior
  source commit and must be rerun after a new clean candidate lock.
- The exact instrumented Fenix APK has schema-v2 PASS build evidence: 23
  HomeActivity tests, stage/package overlay, official Gecko payload equality,
  compiled manifest marker, arm64-only ABI and APK signature all pass. Its
  SHA-256 is
  `29fe8162a3ae3eb81eb76c461b635c703ce281c059174d35613e922880c99187`.

## Current blocking gates

- Stock Firefox/GeckoDriver Android existing-session attach is unsupported.
  Native Appium evidence is diagnostic-only and cannot prove DOM injection.
- A clean candidate for source commit `b87a61073b29f9718bda4cbdcf1ceaac3583cc6b`
  has not yet been locked. Mac Chrome + Tampermonkey and the instrumented Fenix
  live Tampermonkey/project injection run must both be rerun against that same
  candidate before they can produce current project evidence.
- OnePlus 15 must use stock Firefox for the final acceptance gate. A PASS must
  include an explicit final-user-acceptance record bound to the candidate;
  generic Appium or a manual statement without that binding is insufficient.
- The current sample has public source on GitHub but no matching GitHub
  Release evidence and no Greasy Fork project evidence. Publication remains
  closed until all pre-publication gates pass.

## Deliberately deferred

- iPhone Safari + Stay is a separate future platform gate. It is not required
  by the current Android sample and does not block its release.
- Post-release巡检 is not part of the current scope; verification is performed
  before publication.
