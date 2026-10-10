# ALEX-MIND Ideas Backlog

Use this file to capture ideas without interrupting the current development sequence. An idea is not a commitment until it is evaluated and approved.

## Rules
- Record the problem before proposing a solution.
- Separate observed evidence from assumptions.
- Prefer ideas that can be tested cheaply and safely.
- Do not add an idea to the active roadmap until impact, cost, risks, and acceptance criteria are clear.
- Never include secrets or private user/customer data.

## Idea template

### IDEA-YYYYMMDD-01 — Short title
- **Problem:** What real difficulty does this solve?
- **Who benefits:** Who experiences the problem?
- **Evidence:** What did we observe or measure?
- **Proposed solution:** The smallest useful version.
- **Alternatives:** What already exists?
- **Dependencies:** APIs, accounts, permissions, infrastructure, or other work needed.
- **Cost:** Free-tier fit, limits, and any possible charges.
- **Privacy/security risks:** What data or permissions are involved?
- **Smallest test:** A reversible test that can disprove the idea quickly.
- **Success criteria:** Measurable evidence required.
- **Decision:** INBOX / INVESTIGATE / APPROVED / DEFERRED / REJECTED.
- **Owner / date:**
- **Related phase or issue:**

## Inbox

### IDEA-20261010-01 — Recoverable Trash and Storage Capacity Manager
- **Problem:** Vault storage can fill up; deleting an item should not instantly destroy it, and storage pressure needs a safe, visible cleanup process.
- **Who benefits:** ALEX-MIND user across phone, work, and archive vaults.
- **Evidence:** User explicitly requested a Trash area for ALEX-MIND's storage/vault and a way to free space when storage fills.
- **Proposed solution:** Add soft-delete Trash with restore, retention, confirmed permanent purge, capacity monitoring, warnings, and narrowly scoped automatic cleanup for expired Trash and regenerable cache/temp data only.
- **Alternatives:** Manual provider-console deletion (unsafe and not integrated with the ALEX-MIND index).
- **Dependencies:** Object lifecycle/index, provider adapter (including B2), auth/ownership checks, audit events, UI/API, quota/usage data.
- **Cost:** Design for current storage provider and existing free-tier constraints; verify provider quota and request limits before implementation.
- **Privacy/security risks:** Accidental permanent loss, unauthorized restore/delete, stale metadata, provider/database mismatch.
- **Smallest test:** Implement and test against disposable data and a test bucket/database; never run cleanup on production during initial validation.
- **Success criteria:** Restore works during retention; purge is explicit/expired and auditable; storage alerts are accurate or clearly estimated; no protected or unexpired user data is auto-deleted.
- **Decision:** INVESTIGATE — specification recorded; runtime feature not implemented.
- **Owner / date:** Alex / 2026-10-10
- **Related phase or issue:** [Storage Trash and Capacity Management](../../storage/8.6-trash-and-capacity-management.md)
