# Phase 2 — Classify & validate

Status: **Complete (local vertical slice)** · 21 October 2026

## Delivered

- Added `ClassifiedTransaction`, `Account`, `Finding`, and `ValidationReport` contracts.
- Added a constrained local chart-of-accounts adapter with postable account checks.
- Added classifier output with transaction type, AutoCount target, entries, party, rationale, evidence, confidence, and alternatives.
- Added learned mapping-memory input to the classifier contract.
- Added deterministic validation rules for balance, totals, account existence, unsupported summary documents, missing dates/totals, missing party codes, approval thresholds, and currency rate.
- Added review APIs for edits and decisions: approve, reject, escalate, and send back.
- Added append-only in-memory audit events for review changes.
- Added review screen at `/review/:id` with field confidence chips, validation findings, rationale, and approval controls.
- Added account-book sync adapter endpoint at `POST /api/account-books/:id/sync`.

## Local adapter boundaries

The chart of accounts is currently a seeded adapter because AutoCount credentials and a sandbox account book are not available. Review and audit records are in-memory for local development; production Phase 3 should move them into the planned Postgres/Drizzle tables and enforce tenant RLS.

## Exit evidence

- TypeScript check passes.
- Next.js production build passes.
- Phase 1 upload flow now continues through extraction → classification → validation before reporting the document ready for review.

## Phase 3 handoff

Next: implement the typed AutoCount client, idempotent posting protocol, post queue, payload preview, and reconciliation-by-GET against a sandbox account book.
