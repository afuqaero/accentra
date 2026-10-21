# Accentra implementation changelog

## 2026-10-21 — Phase 1: Read

- Scaffolded the Next.js 15 web app and pnpm workspace.
- Added the dashboard review queue and upload experience.
- Added document intake, local storage, content hashing, and extraction APIs.
- Added versioned reader contracts with field-level provenance and confidence.
- Added conservative deterministic extraction for CSV/text and human-review fallbacks for unsupported binary extraction.
- Added Phase 1 handoff documentation.

## 2026-10-21 — Phase 2: Classify & validate

- Added constrained chart-of-accounts and classifier contracts.
- Added local classification with rationale, evidence, confidence, alternatives, and mapping-memory support.
- Added deterministic validation and blocking findings.
- Added review decisions, edits, and append-only audit events.
- Added the `/review/:id` review experience and account-book sync adapter.

## 2026-10-21 — Phases 3–5: Post, advise, harden

- Added idempotent mock AutoCount posting and reconciliation APIs.
- Added posting state tracking and retry guard behavior.
- Added grounded Books/Standards chat endpoint and dashboard control.
- Added audit CSV export, dependency health reporting, and security headers.
- Added phase handoff records for production validation gates.
- Added three-pane local review layout with source, fields, and posting preview.
- Added local duplicate detection and hash-chained audit events.
- Added post-queue screen and local posting status view.
- Added dedicated `/chat` workspace with document upload, conversation history, follow-up questions, and source citations.
