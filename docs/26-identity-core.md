# Phase 26 — Identity Core

Status: implementation branch only; not production-locked.

## Locked product decision
- ALEX-MIND is a private personal application.
- No paid custom domain is required for the application.
- The existing `workers.dev` URL remains the application origin.
- A custom domain is explicitly out of scope unless the project later needs branding or business-critical hosting.
- Email delivery is a separate dependency and must not be confused with the application domain.

## Global build order

1. **Phase 26 — Identity Core**
   - users and credentials
   - server-side sessions
   - email verification/reset token storage
   - authentication routes
   - security events
   - external-account connection model
   - resource ownership boundary
2. **Phase 27 — Authorization & Tenant Isolation**
   - enforce authenticated user context on every user API
   - ownership checks for vault/items/projects/memories
   - cross-user denial tests
   - migrate existing legacy data only through an explicit ownership operation
3. **Phase 28 — Transactional Email**
   - select an email sender that does not force a purchased custom domain
   - keep provider credentials in Worker secrets
   - verification/reset delivery
   - delivery/error/rate-limit handling
   - end-to-end email tests
4. **Phase 29 — Real User UI**
   - signup/login/verification
   - forgot/reset password
   - authenticated home
   - logout
   - vault/projects/memory/search navigation
5. **Phase 30 — Connected Accounts**
   - Gmail OAuth first
   - separate connection records per account
   - encrypted credential storage
   - connect/revoke/status
6. **Phase 31 — Ingestion & Sync**
   - incremental provider sync
   - normalization/deduplication
   - items and attachments
   - B2 vault storage
   - per-connection cursors and failures
7. **Phase 32 — GitHub + Cloudflare Connectors**
   - same ownership/security model as Gmail
8. **Phase 33 — Production Security & Recovery**
   - rate limits
   - abuse controls
   - session/re-auth rules
   - account deletion/disconnect
   - audit/recovery tests
9. **Phase 34 — Full mobile production acceptance**
   - install/open
   - signup -> email verification -> login
   - connect Gmail -> sync
   - view vault/email/item
   - logout -> login -> persistence
   - regression against locked Phase 25

## Security boundary
- ALEX-MIND login email is separate from connected provider accounts.
- User IDs are opaque UUID-based identifiers.
- Passwords use PBKDF2-HMAC-SHA-256 with 600,000 iterations and a unique 128-bit salt.
- Sessions are server-side and use a Secure, HttpOnly, SameSite=Strict __Host- cookie with a random verifier.
- Authenticated state-changing requests require CSRF protection.
- Verification/reset tokens are stored only as SHA-256 hashes, are single-use and expire.
- Repeated failed logins trigger temporary locking.

## Tenant isolation
The Phase 26 schema creates the identity boundary and a `user_resource_ownership` mapping. The existing global `sources` table remains a system/control registry and is not treated as a user's connected account. Actual Gmail/GitHub/Cloudflare accounts will live in `external_connections`, one record per user/provider account.

## Email delivery rule
Phase 26 does not add a fake email sender and does not require buying a domain. Signup remains fail-closed until Phase 28 provides a real transactional delivery path. The verification/reset URLs can use the current Worker origin; `AUTH_BASE_URL` is not a reason to purchase a domain.

## Production rule
Phase 25 Control Plane stays locked and is not refactored as part of the user-facing application.