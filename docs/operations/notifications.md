# Notification Management

Purpose: keep project notifications visible without flooding the user's personal inbox.

## Current user-side change (2026-10-10)

- GitHub Actions notification channels were reviewed in account settings.
- The user unchecked the **Email** channel for Actions and kept **On GitHub** enabled.
- The **Only notify for failed workflows** filter was left enabled. This filter controls which workflow events qualify; it does not itself enable or disable email.
- The user also reviewed Watching/Subscriptions and Pull Request notification channels and intended to remove **Email** there as well.
- These are account-level settings, not repository code. Recheck that each settings dialog was saved and verify by observing future notifications; do not claim all GitHub email is disabled until every applicable category has been reviewed.

## Rules

1. Prefer **On GitHub** notifications for routine development activity.
2. Disable **Email** only for categories the user explicitly wants kept out of the inbox.
3. Preserve account recovery and critical security messages where the provider does not offer a safe opt-out.
4. Do not disable workflows, CI, or deployments just to reduce email.
5. Record provider, category, channel changes, save confirmation, and verification date here. Never store passwords, app passwords, OAuth tokens, API keys, or recovery codes in this file.

## Remaining checks

- [ ] Confirm Actions notification settings were saved.
- [ ] Confirm Watching/Subscriptions email channel was disabled and saved.
- [ ] Confirm Pull Request email channel was disabled and saved.
- [ ] Review other GitHub email categories only if unwanted messages continue.
- [ ] When a dedicated project email is created, connect it only after verifying access and recovery options.
- [ ] Later, evaluate whether ALEX-MIND can ingest project notifications using official, authorized integrations; do not promise automatic email collection before the integration is implemented and tested.
