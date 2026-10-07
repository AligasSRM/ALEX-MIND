# Ali & Alex — Master Build Board

## Purpose

This document is the permanent reference for how Ali & Alex build software projects from zero to production.

The rule is simple:

**Idea → Structure → Real Build → Download/Install → Real User Test → GREEN → LOCK → Next Stage**

The project is built from 1 to 1000 in small, working, verified stages.

## 1. Start with the idea

Before coding:

- Define the product and its main purpose.
- Identify the first essential capability.
- Avoid building secondary features before the foundation works.

## 2. Build the real foundation first

Create the minimum real application structure:

- App/Site shell
- Required frontend
- Required backend/server
- Required storage/API connections
- Navigation and core pages
- Real runtime path

Do not treat mock screens or placeholder-only logic as a completed foundation.

## 3. Produce a real usable build

The stage must result in a build that the user can actually run.

Examples:

- Android → APK/AAB as appropriate
- Desktop → real installable/runnable application
- Web → deployed/testable application

## 4. Test the real program

Ali downloads/installs the build and tests it on the real device/environment.

The acceptance question is:

**Does the actual program work when used, not just when the code is inspected?**

The user reports the real result.

## 5. Automated verification still applies

Real-user testing does not replace engineering tests.

Each stage should also use, where applicable:

- Unit tests
- Integration tests
- Type checks
- Build checks
- CI
- Security checks
- Regression tests

## 6. GREEN

A stage becomes **GREEN** only when:

- The implementation exists.
- The build succeeds.
- Automated checks pass as applicable.
- The real build has been tested.
- The user confirms the stage works.

## 7. LOCK

After GREEN:

- Preserve a known-good version.
- Commit/version the working state.
- Record what was tested.
- Do not modify the locked foundation casually.
- Reopen a locked stage only when a real technical reason requires it.

## 8. Build the next module

Only after the current stage is GREEN + LOCK do we move forward.

Example:

1. App Shell → Build → Download → Test → GREEN → LOCK
2. Login → Build → Download → Test → GREEN → LOCK
3. Main Feature → Build → Download → Test → GREEN → LOCK
4. Settings → Build → Download → Test → GREEN → LOCK
5. Security/Permissions → Build → Download → Test → GREEN → LOCK
6. Remaining product modules → same cycle

## 9. Never build everything before testing

Do NOT:

**Build 20 pages → build the whole backend → add everything → test at the end.**

Instead:

**Build one meaningful stage → test it → lock it → build on top of it.**

This keeps failures isolated and keeps the project usable throughout development.

## 10. Updates after the foundation is complete

Once the application is working:

- Use the real program.
- Notice missing functionality or improvements.
- Define each improvement as a separate update/stage.
- Implement it without unnecessarily disturbing locked functionality.
- Build a new real version.
- Run automated/regression checks.
- Download/install and test it.
- If it works → GREEN → LOCK the update.

The program therefore evolves:

**Working Version → Small Update → Real Test → GREEN → LOCK → Stronger Working Version**

## 11. Regression rule

Every new stage must protect previous GREEN/LOCKED functionality.

A new feature is not successful if it breaks an older verified feature.

## 12. Definition of Done

A stage is not "done" because:

- code was written,
- a page looks correct,
- a local function returned success,
- or an AI/tool said it should work.

A stage is done when the required implementation is present, verification passes, a real usable build works, and the acceptance test is confirmed.

## Master sequence

```
IDEA
  ↓
ARCHITECTURE / APP SHELL
  ↓
REAL BUILD
  ↓
DOWNLOAD / INSTALL
  ↓
REAL USER TEST
  ↓
AUTOMATED + INTEGRATION + REGRESSION CHECKS
  ↓
GREEN
  ↓
LOCK
  ↓
NEXT MODULE
  ↓
REAL BUILD
  ↓
REAL USER TEST
  ↓
GREEN
  ↓
LOCK
  ↓
...
  ↓
COMPLETE PRODUCT
```

## Permanent Ali & Alex rule

**We build from 1 to 1000. One working stage at a time. Every stage becomes real, testable, GREEN, and LOCKED before the next stage becomes the foundation.**

This board is the default construction method for new projects and for major product updates.
