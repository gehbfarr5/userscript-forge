# Process findings

This file accumulates concrete gaps discovered while actually running the
Forge pipeline end to end on a real project, as opposed to assumptions made
while designing the schemas and contracts. Entries are raw observations, not
yet-decided fixes; whether an entry becomes a schema change, a new capability
type, or just documentation is decided in a later dedicated review, not at the
time it is logged here.

## tt1069-mobile-reader (2026-08-05)

- `registry/capabilities.json` declares `iphone-safari-stay` with
  `status: "NOT_RUN"`. Only generic Appium connectivity
  (`ios-simulator-appium-backend`, `iphone-real-appium-backend`) has ever
  passed; the actual "Safari + a third-party userscript manager extension
  injects the script" behavior has never been exercised once. The generic
  backends explicitly note they do not prove this. Real-device automation is
  the only plausible path (App Store binaries such as Stay are very unlikely
  to run on Simulator — different target architecture, no App Store access
  on Simulator to install them in the first place), but this has not been
  attempted yet either.
- `schemas/project.schema.json` → `targets.mobileVerification.automationAssertions.layout`
  hardcodes `horizontallyScrollable` to `"const": true`. This bakes in one
  specific implementation strategy (keep the desktop-fixed-width container and
  let the user scroll it horizontally) as if it were the only valid mobile
  layout strategy. A project that instead fluidizes the container to remove
  horizontal scrolling entirely (a different, equally valid strategy) cannot
  express a matching `layout` assertion at all — the field's only accepted
  value contradicts that strategy's actual behavior. The `layout` block is
  optional, so the workaround is to omit it, but that means this class of
  project ships with one less structured automation assertion than the schema
  intends to offer. Candidate fix directions for a later review: make
  `horizontallyScrollable` a plain boolean instead of a `const`, or split
  `layout` into strategy-specific assertion shapes.
