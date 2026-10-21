# Accentra AI

> Upload a financial document. AI reads it, classifies the entries, validates them, a human approves, and it posts to AutoCount Cloud. Then ask the books anything — grounded in MFRS and IFRS.

**Status:** Phase 0 foundation scaffold · plan v1.0 (20 Oct 2026)

---

## What it does

```
Upload / scan  →  Agent 1: Document Reader  →  Agent 2: Accounting Classifier
              →  Agent 3: Validation       →  Human review & approval
              →  Send to AutoCount (API)   →  Reconciliation → Advisory chat
```

- **Ingests** audit documents, financial statements, annual reports, invoices, receipts, payment vouchers and transaction proofs — as image, PDF or Excel.
- **Extracts** every financial field with a confidence score and a citation back to the exact page and coordinates.
- **Classifies** each entry against the client's live AutoCount chart of accounts, tax codes and party master.
- **Validates** against 15 deterministic blocking rules (Dr = Cr, SST arithmetic, duplicates, open period, account existence) plus an advisory LLM critic.
- **Never posts without a human.** Review and approval is a hard gate; the "Send to AutoCount" button is explicit.
- **Advises** the accountant and auditor through a chatbot that answers only from queries against the books, with clause-level MFRS / IFRS / ISA citations.

## The one architectural rule

Accentra is **not** a general ledger. AutoCount remains the system of record. Accentra owns ingestion, extraction, classification, validation, review, posting and analysis. This keeps the blast radius of an AI error small.

## Read the plan

**[→ ACCENTRA-AI-PLAN.md](./ACCENTRA-AI-PLAN.md)** — full build plan (24 sections + 4 appendices).

| Section | What's in it |
|---|---|
| [§2](./ACCENTRA-AI-PLAN.md#2-scope) | Scope and explicit non-goals |
| [§4](./ACCENTRA-AI-PLAN.md#4-the-core-flow-stage-by-stage) | The seven-stage flow, stage by stage |
| [§6](./ACCENTRA-AI-PLAN.md#6-agent-contracts) | The three agents — typed I/O contracts, prompting rules, cost |
| [§7](./ACCENTRA-AI-PLAN.md#7-human-review--approval) | Review screen, approval states, audit trail |
| [§8](./ACCENTRA-AI-PLAN.md#8-autocount-integration) | **AutoCount Cloud API** — verified auth, endpoints, posting protocol, error taxonomy |
| [§9](./ACCENTRA-AI-PLAN.md#9-the-chatbot-and-advisory-layer) | Chatbot tools, standards corpus, guardrails |
| [§10](./ACCENTRA-AI-PLAN.md#10-data-model-and-the-database-question) | **Database decision** + schema |
| [§11](./ACCENTRA-AI-PLAN.md#11-tech-stack) | Stack and why |
| [§12](./ACCENTRA-AI-PLAN.md#12-design-system--3d-clarity) | "3D clarity" design system + login interface |
| [§13](./ACCENTRA-AI-PLAN.md#13-ux-for-non-accountants) | UX for non-accountants |
| [§17](./ACCENTRA-AI-PLAN.md#17-roadmap) | 18-week roadmap in six phases |
| [§20](./ACCENTRA-AI-PLAN.md#20-decisions-needed-from-you) | **6 open decisions — Q1/Q2 are blocking** |

## Stack

`Next.js 15` · `TypeScript` · `Tailwind v4 + shadcn/ui` · `Postgres (Neon) + Drizzle + pgvector` · `Inngest` · `Cloudflare R2` · `Auth.js v5` · `Vercel AI SDK` · `Vercel`

## Blocking before Phase 0

1. Which AutoCount — Cloud Accounting API (`accounting-api.autocountcloud.com`) or Accounting 2.2 on-prem (`api.autocount.cloud` + Local Connector)?
2. A sandbox account book + API key, created in Cloud Accounting → Settings → API Keys.

## Run locally

```bash
pnpm install
pnpm dev
```

The first runnable slice lives in `apps/web`: an Accentra dashboard with the review queue, upload entry point, book-health summary, and `/api/health` liveness route. It uses representative data until the database, authentication, storage, job runner, and AutoCount sandbox credentials are connected.

---

*Plan authored 20 Oct 2026. Supersede by editing `ACCENTRA-AI-PLAN.md` and bumping the version in its header.*
