# PROJECT BUILD MASTER PLAN
## Permanent 10-Section Build, Verification & Lock Protocol

**Purpose:** This document is the permanent operating rule for building a new project from zero to production. It is a process contract, not application logic.

### Core rule

Build the project in **10 major sections**.

For every section, follow this exact cycle:

1. **Inspect current state first.**
2. Define what belongs to this section and what does not.
3. Research the **current, proven, professional best practices** and suitable modern implementations.
4. Design the clean target state before changing code.
5. Implement the section completely.
6. Test it with real evidence where possible.
7. Run regression checks against all previously GREEN sections.
8. Fix only proven failures. Do not change healthy locked areas.
9. Record the exact implementation, tests, evidence, and known limits.
10. When the section is genuinely complete, mark it **GREEN / CLOSED / LOCKED**.
11. Only then move to the next section.

### No-patching rule

If a file or implementation is proven broken, corrupted, obsolete, or structurally wrong:

- Do **not** accumulate patches on top of it.
- Prefer a clean replacement of the affected file/module.
- Preserve working behavior and contracts that are already proven.
- Do not delete working production data merely to make the code look clean.
- Never rewrite healthy locked sections without a demonstrated technical reason.

### Green lock rule

A section may be marked GREEN only when:

- implementation is complete;
- tests relevant to the section pass;
- integration with previous GREEN sections is verified;
- security and failure behavior are checked where relevant;
- documentation/status matches reality;
- no known blocker remains inside that section.

GREEN means **closed and protected from unnecessary changes**.

### Regression rule

At the start of every new section:

- verify the latest project state;
- verify the last GREEN section;
- verify the interfaces/contracts between the previous section and the new section.

Before locking the new section:

- rerun the relevant regression checks across earlier sections;
- if an earlier section fails, stop and repair the proven failure before progressing.

### Evidence rule

Never declare GREEN from assumption.

Evidence can include:

- automated tests;
- type checks/lint/build;
- integration tests;
- database/storage verification;
- deployment/version evidence;
- API responses;
- logs/observability;
- security checks;
- documented manual verification when automation is impossible.

If a live test cannot be executed because of a tooling/network limitation, state exactly what is verified and what remains unverified. Do not fabricate success.

### Production rule

The project is built toward production, not a demo.

Every section must consider, when applicable:

- security;
- privacy;
- reliability;
- failure/rollback behavior;
- data integrity;
- observability;
- performance;
- maintainability;
- deployment;
- cost;
- recovery.

Use modern platform capabilities and current official documentation where relevant. Separate development/staging from production when the architecture requires it.

---

# The 10 major sections

## Section 01 — Foundation & Product Contract
Define exactly what the project is, why it exists, who/what it serves, the core promise, boundaries, non-goals, success criteria, architecture principles, and the initial technical foundation.

**Lock output:** Product/architecture contract + clean repository foundation.

## Section 02 — Core Architecture
Design the central architecture, modules, interfaces, data flow, dependency boundaries, and failure boundaries.

**Lock output:** Architecture is coherent, modular, and implementable without a monolithic core.

## Section 03 — Data & Persistence
Define schemas, data ownership, migrations, storage strategy, integrity rules, retention, backup/recovery expectations, and data lifecycle.

**Lock output:** Data model and persistence contracts are verified.

## Section 04 — Core Engine / Business Logic
Implement the main project capability and its domain rules.

**Lock output:** The central capability works independently and has deterministic tests.

## Section 05 — Security, Identity & Permissions
Implement authentication/authorization where required, secret handling, least privilege, validation, abuse protection, privacy boundaries, and fail-closed behavior where appropriate.

**Lock output:** Security baseline is proven.

## Section 06 — Interfaces & User/API Layer
Build the user-facing interface and/or API contracts, including validation, errors, accessibility/usability, and stable integration boundaries.

**Lock output:** External interfaces are production-ready and contract-tested.

## Section 07 — Integrations & External Providers
Connect required external services/providers using official/current integrations, explicit adapters, retries/timeouts, failure handling, and provider-independent boundaries where practical.

**Lock output:** Integrations are real, tested, observable, and replaceable where required.

## Section 08 — Testing, Observability & Reliability
Build unit/integration/regression tests, health checks, logging, metrics/tracing where useful, alerting hooks, and recovery behavior.

**Lock output:** The system can prove whether it is healthy.

## Section 09 — Deployment, Operations & Production Readiness
Finalize environments, CI/CD, secrets, migrations, deployment strategy, rollback, monitoring, operational documentation, and cost controls.

**Lock output:** Production deployment is reproducible and controlled.

## Section 10 — Final Audit, Release & Permanent Lock
Perform a complete end-to-end audit against Sections 01–09, verify documentation and actual runtime state, run final regression/security checks, and record the release state.

**Lock output:** RELEASE GREEN / CLOSED / LOCKED.

---

# Permanent project state format

Maintain a single authoritative state record:

| Section | State | Evidence | Last verified | Lock |
|---|---|---|---|---|
| 01 | 🔴 / 🟡 / 🟢 | exact evidence | timestamp/commit | OPEN/CLOSED |
| 02 | 🔴 / 🟡 / 🟢 | exact evidence | timestamp/commit | OPEN/CLOSED |
| 03 | 🔴 / 🟡 / 🟢 | exact evidence | timestamp/commit | OPEN/CLOSED |
| 04 | 🔴 / 🟡 / 🟢 | exact evidence | timestamp/commit | OPEN/CLOSED |
| 05 | 🔴 / 🟡 / 🟢 | exact evidence | timestamp/commit | OPEN/CLOSED |
| 06 | 🔴 / 🟡 / 🟢 | exact evidence | timestamp/commit | OPEN/CLOSED |
| 07 | 🔴 / 🟡 / 🟢 | exact evidence | timestamp/commit | OPEN/CLOSED |
| 08 | 🔴 / 🟡 / 🟢 | exact evidence | timestamp/commit | OPEN/CLOSED |
| 09 | 🔴 / 🟡 / 🟢 | exact evidence | timestamp/commit | OPEN/CLOSED |
| 10 | 🔴 / 🟡 / 🟢 | exact evidence | timestamp/commit | OPEN/CLOSED |

**Color meaning:**
- 🔴 NOT STARTED / BLOCKED
- 🟡 ACTIVE / UNDER VERIFICATION
- 🟢 GREEN / CLOSED / LOCKED

---

# Continuation protocol

When work resumes after a pause:

1. Read this master plan.
2. Read the project's current state record.
3. Inspect the repository/deployment/runtime state.
4. Identify the **highest verified GREEN section**.
5. Verify that section and its immediate interfaces.
6. Do not restart from Section 01 unless evidence shows a regression.
7. Continue from the first section that is not GREEN.
8. Keep earlier GREEN sections locked unless a real technical failure is proven.
9. End the session with an updated state record and an exact next step.

**Never infer the current stage from memory alone when repository/runtime evidence is available.**

---

# Change-control rule

Any change to a GREEN/LOCKED section requires a reason recorded as:

- proven failure or security issue;
- exact affected component;
- evidence;
- intended correction;
- regression tests;
- new commit/version;
- re-lock decision.

No cosmetic refactor, speculative improvement, or unrelated cleanup is allowed to reopen a locked section.

---

# Master execution prompt

Use the following prompt at the start of a project or when resuming one:

> **ALEX PROJECT BUILD MODE**
>
> Build this project using the PROJECT BUILD MASTER PLAN.
>
> First inspect the real current state. Do not assume.
>
> Divide the project into exactly 10 major sections unless a documented technical reason requires a different structure.
>
> Work on one section at a time.
>
> For the active section:
> - define its exact scope;
> - research current professional best practices and official documentation;
> - design the clean target state;
> - implement it completely;
> - test it;
> - verify integration with previous GREEN sections;
> - fix only proven failures;
> - prefer clean replacement over patch accumulation when a file/module is genuinely broken;
> - document evidence and remaining limitations;
> - mark GREEN / CLOSED / LOCKED only when the evidence supports it.
>
> Then move to the next section.
>
> At every resume, inspect the real repository/runtime state and continue from the first non-GREEN section. Never restart from the beginning without evidence of regression.
>
> Never claim a test passed unless it actually passed.
> Never claim production readiness from configuration alone when runtime verification is required.
> Never modify a locked section without a proven technical reason.
>
> Final objective:
> **10 sections → verified → integrated → production-ready → final audit → permanent release lock.**
