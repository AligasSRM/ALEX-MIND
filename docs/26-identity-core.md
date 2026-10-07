# Phase 26 — Identity Core

Status: implementation branch only; not production-locked.

## Security boundary
- ALEX-MIND login email is separate from connected provider accounts.
- User IDs are opaque UUID-based identifiers.
- Passwords use PBKDF2-HMAC-SHA-256 with 600,000 iterations and a unique 128-bit salt.
- Sessions are server-side and use a Secure, HttpOnly, SameSite=Strict __Host- cookie with a random verifier.
- Authenticated state-changing requests require a separate CSRF token.
- Verification/reset tokens are stored only as SHA-256 hashes, are single-use and expire.
- Repeated failed logins trigger temporary locking.

## Tenant isolation
User-owned content tables now have user_id and provider-imported content can carry connection_id. Real provider accounts live in external_connections; credentials are separated in external_credentials. The old global sources table remains a system/control registry and is not treated as a user's connected account.

## Endpoints
GET /api/auth/csrf
POST /api/auth/signup
GET /api/auth/verify-email?token=...
POST /api/auth/login
POST /api/auth/logout
GET /api/auth/me
POST /api/auth/forgot-password
POST /api/auth/reset-password
POST /api/auth/resend-verification

## Email delivery gate
The verification/reset code is wired to an optional Cloudflare Email Service binding named EMAIL plus AUTH_EMAIL_FROM and AUTH_BASE_URL. Signup fails closed until real email delivery is configured. There is no production test bypass.

## Next phase
Configure a real sending domain/binding, then run end-to-end signup -> verification -> login -> logout -> reset tests before locking Phase 26.
