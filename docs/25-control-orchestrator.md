# Phase 25 — ALEX Control Orchestrator

Status: IMPLEMENTED ON BRANCH / PENDING CI AND PRODUCTION VERIFICATION

## Scope
Phase 25 turns the existing Control Layer into a durable, policy-first operation orchestrator.

Implemented capabilities:
- operation identity and idempotency key;
- request hashing to prevent idempotency-key reuse with different payloads;
- explicit lifecycle states;
- authorization and policy gates;
- deterministic source target resolution;
- durable D1 operation records;
- durable audit events;
- execution routing for the currently approved `sync_policy` action;
- verification before completion;
- explicit failure classification;
- fail-closed unsupported actions;
- operation inspection API;
- reconciliation endpoint that refuses unsafe blind replay;
- legacy `/sync-policy` routed through the same orchestrator.

## Lifecycle
`requested -> authorized -> running -> verifying -> completed`

Terminal safety states:
- `blocked`
- `failed`
- `cancelled`
- `reconciliation_required`

A completion is only written after the action result has been verified.

## Storage
Migration `0002_control_orchestrator.sql` adds:
- `control_operations`
- `control_operation_events`

No secrets are stored in either table.

## API
- `POST /control/operations`
- `GET /control/operations`
- `GET /control/operations?operation_id=<id>`
- `POST /control/operations/<id>/reconcile`

The current execution registry intentionally exposes only `sync_policy`. Unknown actions are blocked instead of being guessed or dynamically executed.

## Security
All mutating control operations require `CONTROL_ACTION_KEY`.
Secrets are not included in operation payloads, audit details, or responses.

## Verification gates
1. Runtime validation.
2. Phase 22 regression.
3. Phase 23 Control UI regression.
4. Phase 24 authorization regression.
5. Idempotency and conflict tests.
6. Fail-closed routing tests.
7. Audit/lifecycle tests.
8. D1 migration application.
9. Production deployment.
10. Production control/status and operation verification.

## Lock condition
Phase 25 becomes GREEN/LOCKED only after CI succeeds, the migration is applied successfully, production deploy succeeds, and production verification confirms the new control tables and operation lifecycle without regression.
