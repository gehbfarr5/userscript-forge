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
- The current forum sample candidate is source commit
  `d765bc032ffde1b6c098560f083da82b0576283b`; its readable artifact SHA-256 is
  `b189308abf515b6d12cbbffbd24a3f5acfd51453c9b36ee6d021760d49a7c097`.
- The current candidate has PASS static/build tests and a clean candidate lock
  at `candidate-forum-desktop-layout-enhancer-2026-08-04T10-47-57-330Z`.
  Historical direct-browser and Mac Chrome manager evidence belongs to older
  commits and cannot be reused for this candidate.
- The current Android emulator Firefox + Tampermonkey manager gate is PASS for
  this candidate. It proves the real manager installation, DOM injection,
  GM-storage lifecycle, 960px layout, actual horizontal scrolling and rollback
  toggle on the exact instrumented Fenix build; it does not prove OnePlus OEM
  behavior.
- The current OnePlus 15 stock Firefox technical canary reached the real smoke
  page for this candidate and observed the `mobile-desktop` marker, userscript
  root class, injected style, rollback toggle and required layout text.
  Firefox native Add was `NOT_PRESENT`, which is allowed after the RDP manager
  click. The run used the explicit Android VIEW-intent navigation path for
  GeckoView and restored the temporary awake guard state. The formal device
  observation remains `BLOCKED` at `manager-injection` until the separate
  `user-final-acceptance` command binds the user's visible acceptance.
- The exact instrumented Fenix APK has schema-v2 PASS build evidence: 23
  HomeActivity tests, stage/package overlay, official Gecko payload equality,
  compiled manifest marker, arm64-only ABI and APK signature all pass. Its
  SHA-256 is
  `29fe8162a3ae3eb81eb76c461b635c703ce281c059174d35613e922880c99187`.

## Current blocking gates

- Stock Firefox/GeckoDriver Android existing-session attach is unsupported.
  Native Appium evidence is diagnostic-only and cannot prove DOM injection.
- Mac Chrome + Tampermonkey current-candidate manager evidence is now PASS on
  the real production-origin page at a 412x915 viewport. It covers injection,
  desktop-width layout, actual horizontal navigation and the rollback toggle.
- OnePlus 15 must use stock Firefox for the final acceptance gate. The current
  technical device canary is PASS, but release still requires an explicit
  `user-final-acceptance` record bound to the candidate; generic Appium or a
  manual statement without that binding is insufficient. The documented Wi-Fi
  ADB and phone-to-host handoff paths are verified. The earlier native
  Appium/page-source limitation remains recorded as a capability boundary;
  the RDP/WebConsole plus Android VIEW-intent adapter is the accepted OnePlus
  technical path, not a waiver of the final acceptance or release checks.
- The current sample has public source on GitHub but no matching GitHub
  Release evidence and no Greasy Fork project evidence. Publication remains
  closed until the explicit final-user-acceptance record and the
  pre-publication release gate pass.

## Deliberately deferred

- iPhone Safari + Stay is a separate future platform gate. It is not required
  by the current Android sample and does not block its release.
- Post-release巡检 is not part of the current scope; verification is performed
  before publication.
