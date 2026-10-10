# ALEX-MIND Working Notes

This is the durable project-notes register. Keep entries short, dated, evidence-based, and actionable.

## Current checkpoint — 2026-10-10

- The user's goal is a central place to view project emails/notifications from a computer, rather than repeatedly opening a personal inbox.
- Do not confuse changing GitHub notification delivery with implementing an email inbox inside ALEX-MIND.
- The production D1 database currently has an 'inbox' table with 0 rows.
- Source records named Gmail A and Gmail B exist, but that alone does not prove Gmail authorization, message ingestion, or working synchronization.
- The current database query showed no last-sync timestamp/status for Gmail A or Gmail B.
- The production database does not currently contain the expected identity/auth tables checked during the audit ('users', 'user_credentials', 'user_sessions', 'external_connections', 'external_credentials', 'sync_cursors', 'security_events', 'user_resource_ownership'). Reconcile the schema against the latest code before deploying.
- Six objects are recorded in the object registry; five are marked stored and one archived, all associated with Backblaze B2. This metadata is not by itself proof that each underlying object can be retrieved.

## Decisions / constraints

- Inspect the actual repository, deployed runtime, database schema, and tests before changing code.
- No production activation based on mock credentials, simulated inbox messages, or unverified status.
- Never put secrets, private email contents, access tokens, recovery codes, or personal identifiers in this public repository.
- Keep one canonical current version of each document; update rather than create confusing duplicate versions.

## New note template

### YYYY-MM-DD — Short title
- Observation:
- Evidence:
- Decision:
- Follow-up:
- Status: GREEN / YELLOW / RED
