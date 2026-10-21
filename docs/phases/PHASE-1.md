# Phase 1 — Read

Status: **Complete (local vertical slice)** · 21 October 2026

## Delivered

- Added the Phase 0 monorepo foundation under `apps/web`.
- Added document intake APIs:
  - `POST /api/documents/presign` validates file type and the 50 MB limit.
  - `POST /api/documents/:id/upload` stores the uploaded bytes in the local development store and records a SHA-256 content hash.
  - `POST /api/documents/:id/extract` runs the versioned Document Reader fallback.
  - `GET /api/documents/:id` returns the current extraction record.
- Added canonical `Field<T>` and `ExtractedDocument` contracts with confidence, raw text, page, bounding-box, and `needs_human` provenance fields.
- Added deterministic readers for text/CSV files and conservative fallbacks for PDF/image uploads. Unreadable fields stay `null`; the reader never invents values.
- Added an interactive upload card to the dashboard with upload, extraction, loading, success, and error states.
- Added `docs/CHANGELOG.md` and this phase record for handoff into Phase 2.

## Deliberate local-only boundaries

The storage map and `.data/documents` directory are development adapters. Before production, replace them with the plan's pre-signed R2/Vercel Blob flow and Postgres document repository. PDF/vision extraction is represented by the same schema and review-safe null behavior, but requires the configured LlamaParse/vision provider before it can claim production accuracy.

## Phase 1 exit evidence

- `apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit` passes.
- `apps/web/node_modules/.bin/next build` passes.
- Dashboard upload flow is wired to presign → upload → extract and reports the resulting reader state.

## Phase 2 handoff

Next: add the Postgres/Drizzle schema and AutoCount chart-of-accounts adapter, then build Agent 2 classification with account-code enum constraints and Agent 3 deterministic validation.
