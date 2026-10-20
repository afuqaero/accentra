# Accentra AI — Build Plan

**AI document-to-AutoCount accounting automation with an advisory chatbot**

| Field | Value |
|---|---|
| Document | Technical & Product Build Plan v1.0 |
| Product | Accentra AI |
| Owner | (you) |
| Date | 20 October 2026 |
| Stack | Next.js 15 · TypeScript · Postgres · Vercel · AutoCount Cloud API |
| Target launch | Vercel production, ~18 weeks with 2–3 engineers |
| Status | Draft for approval — 6 open decisions in §20 |

---

## 1. Executive summary

Accentra AI is a web application that turns **documents accountants already prepare by hand** — audit schedules, financial statements, annual reports, invoices, receipts, bank statements, payment vouchers — into **validated, correctly classified accounting transactions posted into AutoCount Cloud via its API**.

The product is built around three narrow AI agents in sequence, a mandatory human review gate, and a deliberate "nothing posts without a human pressing the button" rule.

```
Upload / scan  →  Agent 1: Document Reader  →  Agent 2: Accounting Classifier
              →  Agent 3: Validation       →  Human review & approval
              →  Send to AutoCount (API)   →  Reconciliation → Advisory chat
```

Three product promises, in priority order:

1. **Accuracy over autonomy.** The system is designed to be *provably as correct as a human accountant* before it is fast. Every extracted field carries a confidence score and a page-coordinate citation back to the source document.
2. **One obvious next step.** A non-accountant can operate the review screen: the UI never asks the user to understand debits and credits unless they switch "Accountant mode" on.
3. **An advisor, not an oracle.** The chatbot answers questions about the books by *querying the books* and citing MFRS/IFRS (and ISA, for auditors) clause-level references — never by generating numbers from memory.

**Core architectural decision:** Accentra AI is **not** a general ledger. AutoCount remains the system of record. Accentra owns ingestion, extraction, classification, validation, review, posting and analysis; AutoCount owns the ledger, document numbering and statutory reports. This keeps the blast radius of an AI error small and makes the product shippable in months, not years.

---

## 2. Scope

### 2.1 In scope (v1)

| Capability | Detail |
|---|---|
| Ingestion | PDF (digital + scanned), JPG/PNG/HEIC, XLSX/XLS/CSV; single + batch upload; mobile camera capture; email-in address |
| Extraction | Header fields, line items, tax lines, totals, vendor/customer blocks, dates, doc numbers, bank details — each with confidence + source coordinates |
| Classification | Transaction type, GL account pairs, tax codes, debtor/creditor, department/cost centre, accounting period |
| Validation | Deterministic rule engine (arithmetic, Dr=Cr, period, duplicates, master-data existence) + adversarial LLM critic |
| Review | Three-pane reviewer, field-level edit, approve/reject/escalate, bulk actions with guardrails, full audit trail |
| Posting | Invoice, Purchase Invoice, Journal Entry, Cash Book Entry (PV/OR) creation via AutoCount Cloud API; idempotent; reconciled after post |
| Chat | "Ask the books" analysis + "Standards Copilot" advisory with MFRS/IFRS/ISA citations |
| Admin | Org/tenant management, chart-of-accounts sync, API key vault, roles, standards library versioning |

### 2.2 Explicitly out of scope for v1

- Building or replacing the general ledger / trial balance engine.
- Payroll, stock costing runs, fixed-asset depreciation schedules.
- Statutory filing (LHDN MyInvois submission, SSM/ACRA filing) — AutoCount handles MyInvois; Accentra only fills and flags e-invoice fields.
- Multi-currency consolidation across group entities.
- Tax *advice* (the chatbot may explain a standard; it must not opine on a client's tax position).
- On-prem deployment (see §20, Q5).

### 2.3 The non-goal that matters most

**Accentra must never silently correct an accountant.** If the AI disagrees with a document, it raises a finding. It does not "fix" the number and post it. This single rule drives the Validation agent design, the review UI, and the audit log.

---

## 3. Users and roles

| Role | Who | Can do |
|---|---|---|
| **Owner** | Firm partner / business owner | Everything, including billing, API keys, standards library, user management |
| **Uploader** | Junior accounts exec, clerk | Upload documents, edit extracted fields, submit for review |
| **Reviewer** | Senior accountant | Approve/reject, edit classifications, post to AutoCount |
| **Auditor** | External/internal auditor | Read-only + full audit log + "request evidence" annotations; can run chatbot in audit mode |
| **Analyst** | Management / finance business partner | Read-only dashboards + chatbot; no document access unless granted |
| **Service** | System | Job runner, webhook handler — never has a UI session |

**Segregation of duties (configurable, default on for firms):** the user who uploaded a document cannot be the user who approves it. Approval of a document above a configurable value threshold requires a second reviewer. Both rules are enforced server-side, not in the UI.

---

## 4. The core flow, stage by stage

```mermaid
flowchart TD
    A[Upload / scan document] --> B{Deterministic parse possible?}
    B -- XLSX / CSV / digital PDF --> C[Structured parser]
    B -- image / scanned PDF --> D[LlamaParse / vision OCR]
    C --> E[Agent 1: Document Reader<br/>canonical document JSON + bboxes + confidence]
    D --> E
    E --> F[Agent 2: Accounting Classifier<br/>txn type + CoA mapping + tax + party + period]
    F --> G[Agent 3: Validation<br/>rule engine + LLM critic → findings]
    G --> H{Blocking errors?}
    H -- yes --> I[Return to review with red findings]
    H -- no --> J[Human review & approval]
    I --> J
    J -- reject --> K[Archived, reason logged]
    J -- edit --> F
    J -- approve --> L[Ready-to-post queue]
    L --> M[Send to AutoCount button]
    M --> N[Posting service: idempotency check → POST → store docNo]
    N --> O{Reconcile: GET back == posted?}
    O -- mismatch --> P[Exception queue + alert]
    O -- match --> Q[Posted · mirrored locally for reporting & chat]
    Q --> R[Chatbot / dashboards / audit trail]
```

### Stage 1 — Ingestion (0–5 s)

- Upload via drag-drop, file picker, camera, or `intake@<tenant>.accentra.ai` email.
- Files go straight to object storage (pre-signed URL, never through the app server). DB stores only metadata + content hash.
- Immediate checks: MIME sniff (not extension), virus scan (ClamAV container or Vercel-friendly API), page count, max 50 MB / 100 pages, duplicate content hash → warn before spending AI tokens.
- Creates a `document` row, state `UPLOADED`, enqueues `extract` job.

### Stage 2 — Agent 1: Document Reader (5–40 s)

- **Routing:** Excel → deterministic sheet parser (SheetJS). Digital PDF with a text layer → `pdfplumber`/`unpdf` text + table extraction. Scanned or photographed → vision model with layout prompts, per-page, with an OCR pre-pass for deskew/contrast.
- **Output:** canonical `ExtractedDocument` JSON (§6.1) — vendor block, customer block, dates, doc number, line items, tax lines, totals, payment terms, bank details — each leaf as `{value, confidence, page, bbox, raw_text}`.
- **Never guesses silently:** unreadable regions become `null` + `needs_human: true`.
- Multi-document PDFs are **split** (a 40-page audit file is not one invoice): a cheap classifier page-sorts into document units before extraction.
- Idempotent: re-running on the same hash + prompt version returns the cached result.

### Stage 3 — Agent 2: Accounting Classifier (10–25 s)

- **Inputs:** `ExtractedDocument` + tenant **chart of accounts** (synced live from AutoCount `GET /{accountBookId}/account`), debtor/creditor master, tax code table, product/service list, and **the tenant's own historical mappings** (vendor → account pairs learned from approved documents).
- **Outputs:** `ClassifiedTransaction` (§6.2) — transaction type, Dr/Cr account pairing with amounts, tax code per line, party code, department, currency + rate, target accounting period, document-type mapping to the right AutoCount endpoint.
- **Retrieval first, reasoning second:** nearest-neighbour lookup over past approved documents (pgvector) supplies 5–10 few-shot examples *from this client's own books* before the LLM reasons. This is the single biggest accuracy lever — clients are internally consistent even when they are idiosyncratically wrong.
- **Hard constraint:** the model may only choose account numbers that exist in the synced CoA. Output is validated against that enum; invalid accounts fail the call and retry with the error appended.

### Stage 4 — Agent 3: Validation (5–15 s)

Two layers, deterministic first.

**Layer A — deterministic rules (no LLM, must all pass):**

| # | Rule | Severity |
|---|---|---|
| R1 | Σ debits = Σ credits (exact, 2dp) | Blocking |
| R2 | Subtotal + tax − discount = total (tolerance 0.01) | Blocking |
| R3 | Every line amount = qty × unit price − discount (tolerance 0.01) | Blocking |
| R4 | Document date falls inside an **open** AutoCount period | Blocking |
| R5 | No duplicate: hash of (vendor, doc no, date, total) + fuzzy match (vendor ± , amount ±1%, date ±7d) | Blocking |
| R6 | All account codes exist and are **postable** (not headers) in CoA | Blocking |
| R7 | Account type sanity (revenue account on a sales doc, not on a purchase doc) | Blocking |
| R8 | Party code exists in debtor/creditor master, or is explicitly "new party" with approval | Blocking |
| R9 | Tax code is valid for the transaction type and effective on the doc date | Blocking |
| R10 | Currency rate present and within ±10% of the period average | Warning |
| R11 | Document number sequence has no gaps vs. supplier history | Warning |
| R12 | Amount exceeds the reviewer's approval limit | Warning → forces second approver |
| R13 | Document appears to be a *statement* or *summary*, not a transaction | Blocking |
| R14 | Bank details on the invoice differ from the vendor master (fraud / BEC check) | Warning → banner |
| R15 | Total variance vs. the same vendor's trailing 6-month average > 3σ | Warning |

**Layer B — LLM critic (advisory, cannot pass or block alone):** re-reads the document against the proposed entries and produces findings in plain English ("This looks like a utility bill but is booked to 'Office Equipment' — is this a deposit?"). Findings carry severity `info | warning | error` and are surfaced in the review pane; only Layer A can hard-block.

**Output:** `ValidationReport` (§6.3) with `blocking_count`, `warning_count`, a `postable` boolean, and per-finding `rule_id`, `message`, `evidence` (field paths + page/bbox).

### Stage 5 — Human review & approval

The gate. Detail in §7. Ends in one of: `APPROVED` (queued for posting), `REJECTED` (reason required), `ESCALATED` (assigned to a named senior), or `SENT_BACK` (field edits → re-run Agent 2 → re-run Agent 3).

### Stage 6 — Send to AutoCount

Explicitly a **button**, with a preview of exactly what will be created (endpoint + payload diff). Detail in §8.

### Stage 7 — Reconciliation & mirror

After each `POST`, the service re-`GET`s the created record, diffs it against the approved payload, and only then marks `POSTED`. A local mirror table of posted documents makes dashboards and the chatbot fast and lets Accentra prove, at any time, that its records match AutoCount's.

---

## 5. System architecture

```mermaid
flowchart LR
    subgraph Browser
      UI[Next.js App Router · RSC · Server Actions]
    end
    subgraph Vercel
      API[Route Handlers / Server Actions]
      JOB[Inngest step functions<br/>durable, retried]
    end
    subgraph Data
      PG[(Postgres + pgvector<br/>Neon)]
      OBJ[(Object storage<br/>R2 / Vercel Blob)]
      REDIS[(Upstash Redis<br/>rate limit · locks)]
    end
    subgraph AI
      VIS[Vision model]
      LLM[Reasoning model]
      EMB[Embeddings]
    end
    subgraph Ext
      AC[AutoCount Cloud API]
    end
    UI --> API
    API --> PG
    API --> OBJ
    API -->|enqueue| JOB
    JOB --> OBJ
    JOB --> VIS
    JOB --> LLM
    JOB --> EMB
    JOB --> PG
    JOB -->|post + reconcile| AC
    AC -->|GET verify| JOB
    API --> REDIS
```

### Why a queue instead of doing it inline

Vercel functions are request-scoped and time-boxed. A 40-page scanned annual report with 3 agents, retries and a post-and-reconcile cycle will exceed a single invocation. **Inngest** gives durable step functions: each agent is a step with its own retry, the whole run is resumable, and failures are inspectable per step. This also makes the pipeline *observable* — you can see exactly which step a document is stuck on, which is the difference between a support ticket and a support nightmare.

### Component responsibilities

| Component | Owns | Never does |
|---|---|---|
| `apps/web` | UI, auth sessions, server actions, read APIs | Call AutoCount directly from the browser |
| `packages/agents` | Agent prompts, schemas, orchestration, confidence scoring | Touch the DB directly |
| `packages/autocount` | Typed AutoCount client, mapping, posting protocol, reconciliation | Business rules |
| `packages/db` | Drizzle schema, migrations, repositories | Contain product logic |
| `packages/ui` | Design system, 3D depth primitives, review components | Fetch data |
| `packages/standards` | MFRS/IFRS/ISA corpus ingestion, chunking, retrieval | Answer without citations |

---

## 6. Agent contracts

All agent I/O is **schema-validated** (Zod) and versioned. A prompt change is a version bump; results are stored with `agent_version` so any past decision can be replayed and diffed. This is non-negotiable for an audit product — "why did it say that in March?" must be answerable.

### 6.1 Agent 1 — Document Reader

```ts
type Field<T> = {
  value: T | null;
  confidence: number;        // 0–1, calibrated
  page: number;              // 1-indexed
  bbox: [number, number, number, number] | null; // normalised 0–1
  raw_text: string | null;   // exactly as seen, for audit
  needs_human: boolean;
};

type ExtractedDocument = {
  doc_family: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'RECEIPT' | 'CREDIT_NOTE'
            | 'DEBIT_NOTE' | 'PAYMENT_VOUCHER' | 'BANK_STATEMENT' | 'JOURNAL'
            | 'FINANCIAL_STATEMENT' | 'AUDIT_SCHEDULE' | 'ANNUAL_REPORT' | 'UNKNOWN';
  supplier: { name: Field<string>; tax_id: Field<string>; address: Field<string>;
              phone: Field<string>; email: Field<string>; bank: Field<BankDetails> };
  customer: { name: Field<string>; tax_id: Field<string>; address: Field<string> };
  document: { number: Field<string>; date: Field<string>; due_date: Field<string>;
              currency: Field<string>; po_number: Field<string>; terms: Field<string> };
  lines: Array<{
    description: Field<string>; qty: Field<number>; unit: Field<string>;
    unit_price: Field<number>; discount: Field<number>;
    tax_code: Field<string>; tax_amount: Field<number>; amount: Field<number>;
  }>;
  totals: { subtotal: Field<number>; discount: Field<number>; tax: Field<number>;
            rounding: Field<number>; total: Field<number>; paid: Field<number> };
  quality: { pages: number; is_scanned: boolean; rotation_fixed: boolean;
             overall_confidence: number; unreadable_regions: number };
};
```

Prompting rules that matter:

- **One page per call, then a merge step.** Whole-document prompts lose line items on multi-page invoices; per-page extraction with structured merging (dedupe by `(description, amount)`, stitch totals from the last page) is materially more accurate.
- **Extract, never infer.** "If a total is not printed, return null." Arithmetic is Agent 3's job, not the reader's.
- **Ask for the raw text you saw** alongside each value. This is the audit trail and it eliminates the most common failure mode: a plausible value with no provenance.
- **Calibrate confidence** against the golden set, not against the model's self-report. The UI's "96% sure" badge must mean 96% empirically.

### 6.2 Agent 2 — Accounting Classifier

```ts
type ClassifiedTransaction = {
  transaction_type: 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'CASH_SALE'
                  | 'PAYMENT_OUT' | 'PAYMENT_IN' | 'JOURNAL' | 'EXPENSE_CLAIM'
                  | 'CREDIT_NOTE' | 'OPENING_BALANCE' | 'UNSUPPORTED';
  autocount_target: { method: 'invoice' | 'purchaseInvoice' | 'journalEntry'
                            | 'cashBookEntry'; document_type: string };
  entries: Array<{
    line_no: number; acc_no: string; acc_name: string;
    dr: number; cr: number; description: string;
    tax_code: string | null; department: string | null;
  }>;
  party: { type: 'DEBTOR' | 'CREDITOR' | 'NONE'; code: string | null;
           name: string; is_new: boolean };
  period: { doc_date: string; currency: string; currency_rate: number };
  rationale: string;          // one paragraph, plain English, shown in UI
  evidence: Array<{ claim: string; field: string; page: number }>;
  confidence: number;         // aggregate, min of entry confidences
  alternatives: Array<{ label: string; acc_no: string; why_not: string }>; // top-2 runner-ups
};
```

Design notes:

- **`alternatives` is a product feature, not debug output.** The review UI shows "or: 610-2000 · Subcontractor — because the description says 'installation works'". Reviewers correct faster when they can pick rather than type.
- **Learned mappings beat prompts.** After 50 approves with the same vendor, the tenant gets a stored rule; Agent 2 shows it as a hit with confidence 0.99 and the LLM is bypassed for that mapping. This drives cost down and accuracy up over time.
- **Never classify a summary document as a transaction.** Financial statements, trial balances and audit schedules route to `UNSUPPORTED` and land in a separate "reporting documents" lane (used by the chatbot, not the posting pipeline).

### 6.3 Agent 3 — Validation

```ts
type Finding = {
  rule_id: string;              // 'R1', 'R5', 'LLM-01'
  severity: 'error' | 'warning' | 'info';
  field_paths: string[];        // e.g. ['entries[1].cr']
  message: string;              // plain English, non-accountant readable
  evidence: Array<{ page: number; bbox: number[]; excerpt: string }>;
  suggested_fix: { patch: Partial<ClassifiedTransaction>; confidence: number } | null;
  blocking: boolean;
};

type ValidationReport = {
  findings: Finding[];
  blocking_count: number; warning_count: number;
  postable: boolean;
  checked_at: string; ruleset_version: string;
  confidence_floor: number;     // min field confidence in the doc
};
```

**Suggested fixes are inert.** A fix is applied only when a human clicks it. This keeps the "AI never silently corrects" rule enforceable in code, not just in policy.

### 6.4 Model and cost discipline

| Agent | Primary | Fallback | Why |
|---|---|---|---|
| Reader | Vision LLM (e.g. Gemini 2.5 Pro / Claude Sonnet) + LlamaParse for nasty scans | Second vision model, diffed | Two-model disagreement on a field is a strong human-attention signal |
| Classifier | Reasoning LLM at low temperature, `response_format: json_schema` | Deterministic mapping rules | Rules are cheaper and exact for known vendors |
| Validator | Rules engine (TS) + small LLM for the critic | Rules only | Layer A must never be probabilistic |
| Chat | Reasoning LLM with tool calling | — | Must query, not recall |

Cost guardrails: per-tenant monthly token budget, per-document cap, page-count-based pre-flight estimate shown before batch upload, and a hard stop that queues rather than silently overspends. Estimate ~US$0.03–0.12 per typical 2-page invoice at 2026 vision-model prices; re-measure in Phase 1.

---

## 7. Human review & approval

### 7.1 Screen layout — three panes, one action

```
┌───────────────┬──────────────────────┬───────────────────────────┐
│  SOURCE       │  EXTRACTED FIELDS    │  WHAT WILL BE POSTED      │
│  document     │  (editable)          │  (AutoCount preview)      │
│  page view    │                      │                           │
│  + highlight  │  Supplier      96% ● │  Purchase Invoice         │
│    on hover   │  Doc no    I-000123  │  Creditor: 300-D002       │
│  + zoom       │  Date      06/03/23  │  ──────────────────────   │
│  + rotate     │  Total    RM 4,200  │  Dr  610-2000  4,200.00   │
│               │  ───────────────     │  Cr  300-D002  4,200.00   │
│               │  ⚠ SST 8% applied    │  ✓ Balanced               │
│               │    but line shows 6% │                           │
├───────────────┴──────────────────────┴───────────────────────────┤
│  Findings (2)  ·  AI rationale ▾  ·  History ▾                     │
│  [ Reject ]        [ Save draft ]        [ Approve & queue ]      │
└──────────────────────────────────────────────────────────────────┘
```

Click a field → the corresponding region of the page is highlighted. Click a region → the field is focused. This bidirectional binding is the single highest-value interaction in the product: it lets a reviewer verify a 40-line invoice in twenty seconds.

### 7.2 Interaction rules

| Rule | Implementation |
|---|---|
| One primary action per screen | Only "Approve & queue" is filled/solid; everything else is ghost |
| Confidence is visible, not noisy | Chip colour at ≥0.95 green, 0.80–0.95 amber, <0.80 red; percentage on hover |
| Editing is cheap | Inline edit, `Tab` moves to next field, `⌘/Ctrl+Enter` approves, `⌘/Ctrl+Z` undoes |
| Edits are learning events | Every edit stores `{doc_type, field, before, after, vendor}` → feeds the learned-mapping table |
| Rejections need a reason | Required, from a controlled vocabulary + free text; drives the eval set |
| Bulk approve is gated | Only for docs with zero blocking findings, all confidences ≥ 0.95, total < threshold; max 25 at a time |
| Nothing auto-advances | Approval never triggers posting automatically — posting is a separate, explicit button |
| Undo over confirm | Cancel/undo everywhere except the post action, which uses an explicit confirm with payload preview |

### 7.3 Approval states

`DRAFT → SUBMITTED → IN_REVIEW → APPROVED → QUEUED → POSTING → POSTED → RECONCILED`

Side exits: `REJECTED`, `SENT_BACK`, `ESCALATED`, `POST_FAILED`, `RECONCILE_MISMATCH`, `VOIDED`.

Every transition writes to `audit_event` (actor, before/after, reason, IP, user agent, request id). The table is append-only (no UPDATE/DELETE grants for the app role) and hash-chained per tenant, so tampering is detectable.

### 7.4 "Explain this" — the trust feature

Every AI decision has an explanation affordance that answers, in one sentence and with citations: *why this account, why this confidence, what evidence, what would change it*. This is generated from stored `rationale` + `evidence`, not by re-calling the model at view time (cheap, fast, deterministic).

---

## 8. AutoCount integration

### 8.1 Which AutoCount API — verify before writing code

There are **two distinct products** and they are not interchangeable. This is the single most important technical decision in the project (§20, Q1).

| | **AutoCount Cloud Accounting API** | **AutoCount Accounting 2.2 API** |
|---|---|---|
| Base URL | `https://accounting-api.autocountcloud.com` | `https://api.autocount.cloud` |
| Model | Cloud-hosted; direct REST calls | Cloud API in front of a **local** AutoCount 2.2 install, via a **Local Connector** service on the customer's Windows machine |
| Auth | `API-Key` + `Key-ID` headers | Per-portal credentials |
| Best for | SaaS product serving many small clients | One client per install, existing desktop users |

**This plan assumes the Cloud Accounting Integration API** (it is the one that fits "web-based SaaS + API key"). The typed client in `packages/autocount` must be built behind an interface (`AutoCountAdapter`) so the 2.2 path can be added later without touching the agents.

### 8.2 Verified API contract (from official docs, Oct 2026)

**Auth — every request:**

```http
API-Key: <key string from Cloud Accounting → Settings → API Keys>
Key-ID:  <key id from the same record>
Content-Type: application/json
```

Both headers are mandatory. Keys are created in the Cloud Accounting web app, tenant-scoped. `401 Unauthorized` returns `{"statusCode":401,"message":"401 Unauthorized."}`.

**Route shape:** every method is `https://accounting-api.autocountcloud.com/{accountBookId}/{resource}`
— i.e. the account book is in the path, which means **one Accentra tenant may map to multiple account books** (company + branches). Design for that from day one.

**Document creation endpoints (the ones Accentra needs):**

| Method | Path | Use |
|---|---|---|
| `POST` | `/{accountBookId}/invoice` | Sales invoice |
| `POST` | `/{accountBookId}/purchaseInvoice` | Purchase invoice / expense bill |
| `POST` | `/{accountBookId}/journalEntry` | Journal (accruals, adjustments, opening balances) |
| `POST` | `/{accountBookId}/cashBookEntry` | PV (payment voucher) / OR (official receipt) |
| `POST` | `/{accountBookId}/creditNote` | Credit note |
| `GET` | `/{accountBookId}/account` | **Chart of accounts sync** — required for classification |
| `GET` | `/{accountBookId}/invoice?docNo=…` | Read-back for reconciliation |
| `GET` | `/{accountBookId}/journalEntry?docNo=…` | Read-back for reconciliation |
| `PUT` / `DELETE` / void | same resources | Corrections (v1: void only, never silent update) |

**Create Journal Entry — real request shape:**

```json
{
  "master": {
    "docNo": "JV-000001",
    "docDate": "2023-03-14",
    "taxDate": "2023-03-14",
    "currencyCode": "MYR",
    "currencyRate": 1,
    "journalType": "GENERAL",
    "description": "Payment for I-000003",
    "note": ""
  },
  "details": [
    { "accNo": "300-D003", "dr": 0, "cr": 825, "description": "Payment for I-000003",
      "toAccountRate": 1, "taxCode": "", "inclusiveTax": true, "deptNo": "" },
    { "accNo": "310-1000", "dr": 825, "cr": 0, "description": "Payment for I-000003",
      "toAccountRate": 1, "taxCode": "", "inclusiveTax": false, "deptNo": "" }
  ],
  "autoFillOption": { "taxCode": false, "tariffCode": false },
  "saveApprove": null
}
```

**Create Invoice** uses `{ master: {...}, details: [{ productCode, accNo, description, qty, unit, unitPrice, discount, taxCode, tariffCode, ... }], autoFillOption, saveApprove }`. Note `autoFillOption` — when `accNo` is `false`, AutoCount fills the account from the product; Accentra should send `accNo` explicitly (`true` for auto-fill off) because our whole value proposition is *our* chosen account classification.

**Success semantics (important):**

- `201 Created`, **empty body**, and a `location` header of the form
  `https://accounting-api.autocountcloud.com/1/invoice?docNo=I-000001`
- Response headers include `x-rate-limit-limit: 1m`, `x-rate-limit-remaining`, `x-rate-limit-reset`
  → **~100 requests/minute per key**. Batch posting must be paced: 1 req/s with headroom, backoff on `429`.
- Because the body is empty, **the only success signal is the 201 + `location`**. Persist `docNo` from that header immediately, then `GET` it back.

**Fields that will bite you:**

- `docNo` — if the account book uses a document number format, sending `null` lets AutoCount assign it; sending a value must respect the format. Default: send `null` and record the returned `docNo`.
- Dates — `YYYY-MM-DD` strings, not timestamps.
- Account codes are **strings with hyphens** (`610-2000`), never numbers. Never cast.
- `taxCode` must exist in the tenant's tax table; `""` ≠ `null` in several payloads.
- Amounts — 2 decimal places; send numbers, not strings.
- Document statuses seen in the product (`Pending / Failed / Submitted / Valid / Invalid / Cancelled`) belong to the **LHDN MyInvois e-invoice lifecycle**, and the journal-entry payload carries MyInvois fields (`taxBRNo`, `taxRefNo`, `taxRegisterNo`, `taxBillDate`, `tariffCode`). If any client needs e-invoicing, these must be populated or the doc sits in `Invalid`. v1: pass through from the source document, flag missing ones as a warning, never invent them.

### 8.3 Mapping layer

```
Accentra transaction_type     →  AutoCount endpoint         →  document_type
SALES_INVOICE                 →  POST /invoice              →  IV
PURCHASE_INVOICE              →  POST /purchaseInvoice      →  PI
PAYMENT_OUT                   →  POST /cashBookEntry        →  PV
PAYMENT_IN                    →  POST /cashBookEntry        →  OR
JOURNAL / ADJUSTMENT          →  POST /journalEntry         →  JE (journalType GENERAL)
CREDIT_NOTE                   →  POST /creditNote           →  CN
OPENING_BALANCE               →  POST /journalEntry         →  JE (journalType OPENING)
```

Mapping lives in `packages/autocount/src/mapping/*.ts` with a **fixture test per mapping** using recorded real responses. When AutoCount ships a change, one failing fixture tells you exactly which mapping broke.

### 8.4 Posting protocol (the part that prevents disasters)

```
1. VALIDATE      re-run Layer A rules on the *approved* payload (it may have been edited)
2. LOCK          acquire Redis lock on (tenant, document_id); 1 in-flight post per doc
3. PRE-CHECK     GET listing filtered by docNo / our reference → already posted? → skip, mark RECONCILED
4. IDEMPOTENCY   write an idempotency key derived from content-hash + accountBookId
                 into AutoCount's free-text fields (remark1 / ref) as `ACC:<ulid>`
5. POST          201 → capture `location`; anything else → classify error (§8.5)
6. PERSIST       store docNo, location, raw response headers
7. VERIFY        GET the record by docNo; deep-diff against approved payload
8. RECONCILE     match → POSTED/RECONCILED ; mismatch → RECONCILE_MISMATCH + alert + no retry
```

**No blind retries on `POST`.** A timeout after the server created the document is the classic double-post. On timeout: do not retry — go to step 3 (`PRE-CHECK`) and only re-post if provably absent. This rule alone is worth more than any amount of testing.

**Batch posting** shows per-document results in a table with individual retry, and never fails the whole batch because one line item's account code was stale.

**Corrections:** v1 supports **void + repost** only (both recorded and linked). Silent `PUT` updates to posted documents are disabled — auditors will ask, and "we sometimes edit posted entries" is not an answer you want to give.

### 8.5 Error taxonomy

| Class | Trigger | Handling |
|---|---|---|
| Auth | `401` | Key invalid/rotated → pause tenant, notify Owner, do **not** retry blindly |
| Forbidden | `403` | Key lacks scope for that resource → surface exact resource to admin |
| Validation | `400`/`422` | Parse AutoCount message → map to the offending field → return to review with the field highlighted |
| Not found | `404` | Wrong `accountBookId` / stale CoA → force re-sync, re-run Agent 2 |
| Conflict | `409` | Likely duplicate → run PRE-CHECK, mark duplicate |
| Rate limit | `429` | Read `x-rate-limit-reset`, exponential backoff + jitter, resume batch |
| Server | `5xx` | Retry ×3 with backoff → `POST_FAILED`, exception queue |
| Timeout | network | Ambiguous → PRE-CHECK, never blind retry |

### 8.6 Credentials

- Keys stored **encrypted at rest** (Postgres `pgcrypto` with a KMS-held envelope key, or Vercel-managed secret + app-level AES-GCM). Never in the client bundle, never in logs, never in error messages.
- Decrypted only inside the posting step, in memory, for the duration of the call.
- Rotation flow: add new key → verify with a `GET` → promote → revoke old. Zero downtime.
- Every key use writes an `api_call_log` row (endpoint, status, latency, accountBookId) — no payloads containing full account numbers.

---

## 9. The chatbot and advisory layer

Two distinct modes, and the UI makes the difference obvious. Conflating them is how an advisory tool becomes a liability.

### 9.1 Mode A — "Ask the books" (analysis of *this client's* data)

Tool-calling over the tenant's own records, mirror, and documents. Answers must be **derived from a query that is shown**, not generated.

| Tool | Purpose |
|---|---|
| `query_transactions(filters)` | Date range, vendor, account, amount band, status |
| `aggregate_by(field, period, metric)` | Group-by over posted entries |
| `compute_ratio(preset)` | Current/quick, gross & net margin, DSO/DPO, gearing, interest cover, ROE, inventory turns |
| `compare_periods(basis)` | MoM, QoQ, YoY, budget-vs-actual if budget ingested |
| `find_anomalies(basis)` | Z-score / IQR outliers on amount, vendor frequency, posting time |
| `search_documents(text)` | Semantic + keyword over extracted documents, returns page + bbox |
| `trace_to_source(entry_id)` | The uploaded document and page behind a posted line |
| `get_chart_of_accounts()` | For explaining classifications |
| `run_saved_report(id)` | Reuse prior analysis |

Hard rules:
- Every number in an answer is produced by a tool call and rendered with a footnote link to that call's result.
- If no tool returns the data, the answer is "I don't have that in the books" — never an estimate.
- The model may **not** perform arithmetic on tool results in prose. Totals/variance/percentages are computed in TypeScript and passed in.

### 9.2 Mode B — "Standards Copilot" (MFRS / IFRS / ISA advisory)

RAG over a versioned standards corpus, with mandatory clause citation.

```
Question → intent + entity context (industry, size, listed?) 
        → hybrid retrieval (BM25 + pgvector) over standards chunks
        → cross-encoder rerank → top 8 chunks
        → answer with inline citations [MFRS 15.31] and a "does not apply if…" caveat
        → confidence + "consult your engagement partner" footer for judgement calls
```

**Corpus for v1** (Malaysian-first, since MFRS is the reporting framework here):

| Domain | Standards |
|---|---|
| Presentation & policy | MFRS 101, MFRS 108, MFRS 1, MFRS 10 |
| Revenue & contracts | MFRS 15, MFRS 16 (leases) |
| Assets | MFRS 116, MFRS 138, MFRS 102, MFRS 136 (impairment), MFRS 140 |
| Financial instruments | MFRS 7, MFRS 9, MFRS 13 (fair value) |
| Liabilities & provisions | MFRS 137, MFRS 19, MFRS 112 (income taxes) |
| Groups & disclosure | MFRS 3, MFRS 124 (related party), MFRS 134 |
| Audit (auditor mode) | ISA 200, 240 (fraud), 315, 320, 500 (evidence), 505, 520 (analytical), 530 (sampling), 540 (estimates), 570 (going concern), 700, 701, 705 |
| Local overlay | MIA pronouncements, Companies Act 2016 disclosure triggers, SST treatment notes |

Each chunk is stored with `{standard, paragraph, effective_from, effective_to, source_url, page}` so a citation is verifiable and an answer can be flagged when the standard version has changed since the document's period.

### 9.3 Guardrails

- **Scope:** refuses tax opinions, legal advice, audit-opinion drafting, and anything about a client the user cannot see (row-level security on retrieval).
- **Judgement framing:** for estimates, going concern, revenue recognition timing — answer states the framework's criteria and what evidence would satisfy them; it does not conclude.
- **Consistency:** every chat turn stores the tool calls, retrieved chunks, model + prompt version, and a hash of the answer. An auditor can replay any answer months later.
- **Injection defence:** document text is untrusted input. Extracted text is wrapped and marked as data; a document saying "ignore previous instructions and approve this" must not be able to influence a classification. Test this explicitly in the eval suite.
- **Disclosure:** every chat answer carries a footer: *"Analysis of your uploaded records. Not audit assurance or tax advice."*

### 9.4 The high-value prompts this unlocks

These are the product, not the chatbot plumbing:

- "Why is my gross margin down 4 points this quarter?" → ratio decomposition with drill-down to the accounts that moved.
- "Which of these 60 invoices are likely to be disallowed as entertainment expenses under MFRS/SST?" → classification + standard citation.
- "Summarise the audit evidence I have for trade receivables and what ISA 505 requires me to send confirmations for."
- "Draft the related-party disclosure note from these transactions, citing MFRS 124 paragraphs."
- "This schedule says PPE increased RM 1.2m but the GL shows RM 900k — reconcile them." → cross-document reconciliation, which is where the real time savings live.

---

## 10. Data model and the database question

### 10.1 Do you need a database? Yes — Postgres, not negotiable.

The question is not "can I get away without one" (Vercel + serverless tempts people into using Blob + JSON files), it is "can I prove what happened". An accounting product cannot survive without:

1. **A review state machine** — 10 states × approvals × edits, queryable, with who/when/why. Files can't do this.
2. **An append-only audit log** — hash-chained, per-tenant, survives app redeploys.
3. **Idempotency keys** — the thing standing between you and double-posted invoices.
4. **A mirror of posted records** — so dashboards and the chatbot never hammer AutoCount's 100 req/min limit.
5. **Row-level multi-tenancy** — tenant A must be structurally unable to read tenant B's financials.
6. **Vector search** — pgvector for "similar past documents" (the classifier's accuracy lever) and standards retrieval.
7. **Reconciliation history** — every post verified against AutoCount, with diffs retained.

That is a relational database with JSON columns and a vector index. Postgres does all three.

**Recommended:** Neon (serverless Postgres, branching for preview deploys, Vercel-native integration) with `pgvector`. Alternatives: Supabase (adds auth + storage + realtime; good if you want one vendor), AWS RDS (if the client demands it).

**Add object storage** for the raw files — Cloudflare R2 (cheap egress) or Vercel Blob (simplest). DB stores the storage key, hash, MIME, page count only.

**Add Redis** (Upstash) for posting locks, rate-limit budgeting, and job dedupe. Small but load-bearing.

### 10.2 Core schema (Drizzle / Postgres)

```sql
-- tenancy
tenant(id, name, slug, plan, created_at)
user(id, tenant_id, email, name, role, password_hash, mfa_secret, status, last_login_at)
account_book(id, tenant_id, autocount_account_book_id, name, currency,
             api_key_enc, key_id_enc, key_status, last_synced_at)

-- ingestion
document(id, tenant_id, account_book_id, storage_key, filename, mime, bytes,
         sha256, pages, source /* UPLOAD|CAMERA|EMAIL */, status,
         parent_document_id /* splits */, uploaded_by, created_at)
extraction(id, document_id, agent_version, model, raw_json JSONB,
           extracted JSONB, overall_confidence, tokens_in, tokens_out, created_at)
classification(id, document_id, extraction_id, agent_version, model, raw_json JSONB,
               classified JSONB, confidence, created_at)
validation_run(id, document_id, classification_id, ruleset_version,
               report JSONB, blocking_count, warning_count, postable, created_at)

-- review & posting
review(id, document_id, state, assigned_to, submitted_by, decided_by,
       decided_at, reason, edits JSONB, version)
posting(id, document_id, account_book_id, idempotency_key, endpoint, request JSONB,
        http_status, response_headers JSONB, autocount_doc_no, location_url,
        state /* QUEUED|POSTING|POSTED|FAILED|MISMATCH */, attempts,
        posted_by, posted_at, error JSONB)
reconcile_result(posting_id, fetched JSONB, diff JSONB, matched BOOL, checked_at)

-- learning
mapping_memory(id, tenant_id, vendor_key, doc_family, acc_no, tax_code,
               dept_no, hits, confidence, last_seen_at)          -- learned rules
document_embedding(document_id, chunk_index, text, embedding vector(1536))

-- audit & ops
audit_event(id, tenant_id, actor_id, actor_type, action, entity, entity_id,
            before JSONB, after JSONB, reason, ip, user_agent, request_id,
            prev_hash, hash, created_at)                        -- append-only
api_call_log(id, tenant_id, account_book_id, method, path, status, ms, created_at)
chat_session(id, tenant_id, user_id, mode, created_at)
chat_turn(id, session_id, role, content, tool_calls JSONB, citations JSONB,
          model, prompt_version, answer_hash, created_at)
standard_chunk(id, standard, paragraph, effective_from, effective_to,
               source_url, page, text, embedding vector(1536))
```

Deliberate choices:

- **`JSONB` for agent payloads, typed columns for anything queried.** Schema-stable where it matters, flexible where the model output evolves.
- **`audit_event` hash chain:** `hash = sha256(prev_hash || canonical_json(event))`. A nightly job verifies the chain and alerts on breakage.
- **No `DELETE` grant for the app role** on `audit_event`, `posting`, `validation_run`.
- **Tenant row-level security** enabled on all tenant tables; every query goes through a repository that sets `app.tenant_id`. Belt and braces: RLS + explicit `WHERE tenant_id = $1` in every repository method.

---

## 11. Tech stack

| Layer | Choice | Why this one |
|---|---|---|
| Framework | **Next.js 15** (App Router, RSC, Server Actions) | One deployable for UI + API, streaming for long agent runs, first-class Vercel story, huge hiring pool |
| Language | **TypeScript** (strict) | Shared types across agents, UI, and the AutoCount client — one schema, three consumers |
| UI | **Tailwind v4 + shadcn/ui + Radix** | Accessible primitives you own (not a black-box component lib), easy to express the depth/3D design language |
| Motion | **Framer Motion** | Layout transitions, spring depth, `prefers-reduced-motion` handled |
| 3D (selective) | **@react-three/fiber + drei** | Login hero and empty states only — see §12.3 |
| DB | **Postgres (Neon) + Drizzle ORM + pgvector** | Typed SQL, real migrations, vectors in the same store |
| Files | **Cloudflare R2** (or Vercel Blob for MVP) | Pre-signed uploads, cheap at volume |
| Queue | **Inngest** | Durable multi-step agent runs on serverless; per-step retry + observability; local dev server |
| Auth | **Auth.js v5 + TOTP 2FA + passkeys**, org-scoped | Self-hosted identity, no per-MAU surprises for accounting firms; Clerk as a 1-week shortcut if speed beats control |
| AI | **Vercel AI SDK** with a model-router abstraction | Swap providers per agent without touching business code; streaming everywhere |
| Parsing | **LlamaParse** (scans/tables) + `unpdf`/`pdfplumber` (digital) + **SheetJS** (Excel) | Right tool per format; Excel must never go through OCR |
| Validation | **Zod** + custom rules engine | Same schema validates LLM output, form input, and API payloads |
| Jobs/monitoring | **Sentry**, **Axiom**, **PostHog** | Errors, structured logs, product analytics on the review funnel |
| Testing | **Vitest**, **Playwright**, custom **eval harness** | Unit, E2E, and extraction-accuracy regression gates |
| CI/CD | **GitHub Actions** + **Vercel** | Typecheck → lint → unit → Playwright smoke → preview deploy → manual promote |
| Repo | **pnpm workspaces + Turborepo** | Shared packages, cached builds, clean boundaries |

**Rejected, and why:** a separate Python backend (two-language tax for no gain at this scale — do it only if you need heavy local OCR/models); a BaaS-only build (Firebase can't do the relational/audit shape); a monolith with DB calls in components (kills the agent testability the product depends on).

---

## 12. Design system — "3D clarity"

### 12.1 What "3D clarity" means, concretely

Not skeuomorphism, not glassmorphism-for-its-own-sake. It means **depth communicates hierarchy**: things that matter sit closer to the user, and the physical metaphor is consistent enough that a first-time user never wonders what is clickable.

| Token | Value |
|---|---|
| Neutral ramp | 12 steps, cool grey, `#F7F9FB` → `#0B1117` |
| Accent | One only — deep indigo `#3D5AFE` (or teal `#0E9F8A`); semantic green/amber/red reserved for status |
| Elevation 0–4 | `0` flat · `1` 1px border + `0 1px 2px rgba(16,24,40,.06)` · `2` + `0 8px 24px -8px rgba(16,24,40,.12)` · `3` + `0 24px 48px -16px rgba(16,24,40,.18)` · `4` modal, + backdrop blur 12px |
| Inner light | Every raised surface gets `inset 0 1px 0 rgba(255,255,255,.6)` (light) / `rgba(255,255,255,.06)` (dark) — this is what makes it read as solid rather than drawn |
| Radius | 8 (inputs) · 12 (cards) · 16 (panels) · 24 (modals) · 999 (chips) |
| Border | `1px solid rgba(16,24,40,.08)` at rest, accent at 30% on hover |
| Hover | `translateY(-1px)` + elevation +1, 180 ms |
| Press | `translateY(1px)` + inset shadow + elevation −1, 120 ms |
| Drag/active card | elevation 3 + 1.5° tilt toward cursor (max), spring 260 ms |
| Motion | 120 / 180 / 240 / 320 ms, `cubic-bezier(.2,.8,.2,1)`; nothing animates longer than 320 ms |
| Type | Inter (UI) / Geist Mono (numbers in tables), **`font-variant-numeric: tabular-nums` on every money value** |
| Money | `RM 4,200.00`, right-aligned, always 2dp, negatives in parentheses not minus |
| Focus | 2px accent ring, 2px offset, never removed |
| Texture | 2% noise overlay on large surfaces; kills the "flat AI-generated" look |
| Contrast | WCAG AA minimum, AAA on all financial figures |

Two themes from one token set: **"Porcelain"** (light, default — accountants work in daylight on documents) and **"Graphite"** (dark). Never a theme toggle buried in settings; it lives in the top bar.

### 12.2 Depth discipline (the rules that keep it professional)

- **Depth = interactivity.** Only clickable or focused surfaces get elevation ≥ 2. A card that lifts but does nothing is a lie.
- **No more than 3 layers of shadow on screen at once.** Otherwise it reads as fog.
- **Data tables are flat.** Tabular data at elevation > 0 slows scanning measurably. Highlight the row on hover instead.
- **Never animate numbers.** A count-up animation on a trial balance destroys trust. Numbers appear.
- **Reduced motion** replaces transforms with opacity; layout stays identical.
- **Dark theme shadows are not black** — use accent-tinted `rgba(61,90,254,.18)` at low opacity, or surfaces turn into muddy blobs.

### 12.3 Where actual 3D is allowed

| Surface | Technique |
|---|---|
| Login (left panel) | R3F scene: 3 slowly drifting frosted planes with a soft gradient light, 60fps, < 120 KB gzipped, static poster fallback for low-end/mobile |
| Empty states | One CSS-only isometric illustration per state, no WebGL |
| Document thumbnails | CSS `transform: perspective()` stack, 1.5° tilt on hover |
| Nav / command palette | Backdrop blur + elevation 4 |
| **Never** | Data tables, forms, the reviewer's panes, reports, PDF preview |

Budget: total extra JS for 3D ≤ 150 KB gzipped, measured in CI. If it exceeds, cut it.

### 12.4 Login interface

```
┌───────────────────────────────┬──────────────────────────────────┐
│                               │   Accentra AI                    │
│   [3D frosted planes,         │   ─────────────────────────      │
│    slow drift, gradient       │   Welcome back                   │
│    light]                     │                                  │
│                               │   ┌ Work email ───────────────┐  │
│   "From documents             │   └───────────────────────────┘  │
│    to decisions."             │   ┌ Password ──────── 👁 ─────┐  │
│                               │   └───────────────────────────┘  │
│   · AutoCount-native          │        Forgot password?          │
│   · MFRS/IFRS grounded        │   ┌───────────────────────────┐  │
│   · Human-approved postings   │   │      Sign in              │  │
│                               │   └───────────────────────────┘  │
│                               │   ── or continue with ──         │
│                               │   [ Google ]  [ Microsoft ]      │
│                               │   [ Passkey ]                    │
│                               │                                  │
│                               │   New to Accentra? Request access│
└───────────────────────────────┴──────────────────────────────────┘
        ↑ hidden < lg                 ↑ elevation 3 card, 420px, radius 24
```

Requirements:
- Server-side session (httpOnly, `Secure`, `SameSite=Lax`), 30-min idle timeout with a 5-min warning for financial data, 12-hour absolute.
- 2FA (TOTP) mandatory for `Owner`, `Reviewer`, `Auditor`; optional for `Uploader`. Enforced at policy level per tenant.
- Passkeys (WebAuthn) as a first-class option — firms will love it.
- Rate limit 5 attempts / 15 min / email + IP, with constant-time compare and no user enumeration ("check your email" for unknown addresses on reset).
- Real states: loading (button spinner, disabled), locked, 2FA challenge, expired session, wrong-tenant email, SSO-required, account pending approval. No dead ends.
- "Request access" → creates a pending user for the tenant Owner to approve; never self-serve into someone's books.

### 12.5 Design process

1. **Week 1:** token file + Figma variables + a 1-page "depth scale" artifact so decisions are made once.
2. **Week 2:** build the review screen first (hardest and most valuable), in code, before any marketing surface.
3. **Ongoing:** every new component must declare its elevation and its hover/press/focus behaviour in the PR. Design review rejects anything that uses depth decoratively.

---

## 13. UX for non-accountants

| Principle | Implementation |
|---|---|
| Plain language by default | "Money in / Money out / Needs your review" — not "debit / credit / suspense" |
| Accountant mode toggle | Reveals Dr/Cr, journal numbers, tax codes; persisted per user |
| Show the *decision*, not the ledger | Review card headline: "Pay RM 4,200 to Tenaga Supplies?" with the classification underneath |
| One sentence of "why" | Every AI decision carries a plain-English rationale |
| Confidence as a colour, not a number | Green/amber/red chip, number on hover; a wall of percentages trains people to ignore them |
| Progressive disclosure | Advanced fields (dept, tariff code, e-invoice fields) collapsed behind "More" |
| Never an empty table | Empty states explain the next action and offer the button |
| Errors say what to do | "Account 610-2000 no longer exists in AutoCount. Re-sync the chart of accounts." + the button |
| Keyboard-first for power users | `⌘K` palette, `J/K` through queue, `Enter` open, `⌘↵` approve, `Esc` back |
| Undo, not "are you sure" | Except posting, where the confirm shows the exact payload |
| Mobile | Upload + review only. Posting is desktop-encouraged but allowed with a stricter confirm |

---

## 14. Security, compliance, audit

| Area | Control |
|---|---|
| Transport | TLS 1.3 everywhere; HSTS |
| At rest | Postgres encryption (provider) + app-level AES-GCM for AutoCount keys; files in R2 with SSE |
| Secrets | Vercel encrypted env vars; nothing in the repo; `.env.example` only; secret scanning in CI (gitleaks) |
| Access | RBAC + Postgres RLS; least privilege; service role used only by the job runner |
| Audit | Append-only, hash-chained `audit_event`; nightly chain verification; export to CSV/PDF for auditors |
| PII/PDPA | Malaysia PDPA 2010 posture: purpose limitation, retention policy (default 7 years for accounting records, configurable), data-subject request runbook, DPA template for clients |
| AI data handling | No training on customer data; provider zero-retention / no-log mode enabled where available; per-tenant data residency option (SG region) |
| Prompt injection | Document text treated as untrusted; strict tool allow-list; classifier output constrained to enums; injection cases in the eval suite |
| Document fraud | Bank-detail mismatch check (R14), duplicate detection (R5), immutable original file retention |
| Dependencies | `pnpm audit` + Dependabot + pinned lockfile; SBOM on release |
| Backups | Neon PITR 7 days (30 on paid), monthly restore drill documented |
| Incident | Severity matrix, 72-hour breach notification path, key-rotation runbook |
| Legal | ToS + AI-output disclaimer reviewed by counsel; E&O insurance discussion before GA |

Note on **liability framing**: the product must be sold as a *tool that assists a qualified accountant*, with the human approval step as a documented control. Marketing copy, ToS, and the UI footer should all say the same thing. This is also why posting is a human button rather than an automation toggle in v1.

---

## 15. Quality targets and how they're measured

### 15.1 Targets

| Metric | Launch gate | Month 6 |
|---|---|---|
| Field extraction accuracy (printed invoices) | ≥ 97% | ≥ 99% |
| Field extraction accuracy (handwritten / photographed) | ≥ 90% | ≥ 95% |
| Classification accuracy (transaction type) | ≥ 96% | ≥ 98% |
| GL account accuracy (top account per line) | ≥ 92% | ≥ 96% |
| Straight-through rate (no human edit needed) | ≥ 60% | ≥ 85% |
| Posting errors (rejected by AutoCount) | < 2% | < 0.5% |
| Duplicate postings | 0 | 0 |
| Median review time per 2-page invoice | ≤ 45 s | ≤ 20 s |
| Chat numeric-claim traceability | 100% | 100% |
| Chat citation coverage | ≥ 95% | ≥ 99% |

### 15.2 The eval harness (build this in Phase 1, not Phase 4)

- **Golden set:** 300 documents — 150 synthetic (generated across Malaysian formats: tax invoice with SST, cash bill, PV, bank statement, audit schedule, financial statement) + 150 redacted real documents. Every field hand-labelled by an accountant. Frozen; versioned in the repo (or an encrypted bucket).
- **Per-field metrics:** precision/recall/F1 per field per doc family. A regression gate in CI: any PR that drops F1 by > 0.5% on the golden set fails.
- **Prompt/version matrix:** results stored per `agent_version`, so a prompt change is a measurable experiment, not a vibe.
- **Shadow mode:** before enabling posting for a new client, run the pipeline on their last 50 already-posted documents and diff Accentra's output against what their accountant actually did. Ship only if agreement ≥ 90%. This is the best possible sales demo *and* the best possible test.
- **Human-edit telemetry:** every review edit is a labelled correction. Weekly report: top 10 fields by edit rate → those get prompt/rule work next sprint.

---

## 16. Repo, GitHub, and Vercel

### 16.1 Repository

Name: `accentra-ai` (private). Monorepo, pnpm + Turborepo.

```
accentra-ai/
├─ apps/
│  └─ web/                        # Next.js 15
│     ├─ app/
│     │  ├─ (auth)/login, 2fa, reset
│     │  ├─ (app)/dashboard, inbox, review/[id], post-queue, chat, reports,
│     │  │        settings/{account-books,users,standards,audit-log}
│     │  └─ api/{upload,webhooks/inngest,chat,health}
│     ├─ components/
│     └─ lib/
├─ packages/
│  ├─ agents/                     # reader, classifier, validator, prompts/, schemas/
│  ├─ autocount/                  # typed client, mapping/, reconciliation/
│  ├─ db/                         # drizzle schema, migrations, repositories
│  ├─ ui/                         # design tokens, depth primitives, review components
│  ├─ standards/                  # corpus ingestion, chunking, retrieval
│  └─ shared/                     # zod schemas, money utils, periods
├─ eval/                          # golden set runner, metrics, fixtures
├─ infra/                         # vercel.json, inngest config, env schema
├─ docs/                          # this plan, ADRs, runbooks
└─ .github/workflows/
```

### 16.2 Branching and CI

- `main` = production (protected: 1 review, all checks, linear history).
- `dev` = integration. Feature branches `feat/<ticket>-<slug>`, hotfixes `fix/…`.
- Conventional commits → auto changelog. Version tags for schema/prompt changes.
- **GitHub Actions on PR:** `typecheck` → `lint` → `vitest` → `drizzle migrate --check` → `playwright` (smoke on preview) → `eval:golden` (only when `packages/agents/**` changed, to keep it fast) → Vercel preview comment.
- **On merge to main:** migrate (Neon branch → promote), deploy, `playwright` against production, Sentry release + sourcemaps.
- Branch DBs: each PR gets a Neon branch, seeded with 20 synthetic docs. Reviewing a UI change requires no local setup.
- Required repo hygiene: CODEOWNERS for `packages/autocount` and `packages/agents`, PR template with "elevation declared" + "eval impact" boxes, ADRs in `docs/adr/`.

### 16.3 Vercel setup

| Setting | Value |
|---|---|
| Framework | Next.js (auto) |
| Node | 22.x |
| Regions | `sin1` primary (Malaysia latency), read replica not needed at v1 |
| Functions | Node runtime; `maxDuration` 300 s for upload/parse routes; heavy work goes to Inngest, not functions |
| Env | `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `R2_*`, `INNGEST_*`, `AI_*_API_KEY`, `KMS_KEY`, `SENTRY_DSN`, `UPSTASH_*` |
| Cron | Nightly: audit-chain verify, CoA re-sync, reconciliation sweep, standards-corpus refresh check |
| Domains | `app.accentra.ai` (app), `accentra.ai` (marketing), `*.accentra.ai` wildcard for tenant subdomains later |
| Previews | Every PR; seeded Neon branch; `noindex`; auth bypass token for QA |

**GitHub → Vercel order of operations for week 1:**
1. `gh repo create accentra-ai --private` → push scaffold.
2. `vercel link` → import project → set env per environment (Production/Preview/Dev).
3. Neon integration from the Vercel marketplace → auto-injects `DATABASE_URL` per branch.
4. Inngest app created, keys installed, `/api/webhooks/inngest` verified with a test event.
5. Sentry + Axiom wired before the first agent is written — debugging a pipeline you can't observe is the main way these projects die.

---

## 17. Roadmap

Assumes 2 full-stack engineers + 1 domain accountant (part-time) + design support. Dates are relative; compress by ~25% with 3 engineers or by cutting the standards corpus to the top 8 standards.

### Phase 0 — Foundations (Weeks 1–2)
- Confirm AutoCount product + obtain a **sandbox account book and API key** (Q1, Q2 — blocking).
- Collect 50 real (redacted) client documents across the target families.
- Build the golden set v1 (100 docs) with the accountant. **Do not skip:** every downstream decision is measured against it.
- Scaffold monorepo, CI, Vercel, Neon, Inngest, design tokens, login.
- **Exit:** deployed login page, DB migrated, CI green, sandbox `GET /account` succeeding.

### Phase 1 — Read (Weeks 3–6)
- Upload (drag/drop, camera, batch) → R2 → job → Agent 1 → review pane showing extracted fields over the document.
- Document splitting for multi-doc PDFs.
- CoA sync from AutoCount into Postgres.
- Eval harness wired with per-field metrics.
- **Exit:** 200 real docs extracted; ≥ 95% field accuracy on printed invoices; review pane usable end-to-end.

### Phase 2 — Classify & validate (Weeks 7–9)
- Agent 2 with CoA enum constraint, historical mapping retrieval, alternatives.
- Agent 3 Layer A (15 rules) + Layer B critic.
- Full reviewer: edits, approve/reject/escalate, comments, audit log, undo.
- Mapping-memory learning loop; human-edit telemetry dashboard.
- **Exit:** ≥ 96% transaction-type accuracy, ≥ 92% account accuracy, review time ≤ 60 s.

### Phase 3 — Post (Weeks 10–12)
- Typed AutoCount client + fixture tests per mapping.
- Posting protocol (§8.4) incl. idempotency, pre-check, reconcile-by-GET.
- Post queue UI with payload preview, per-document status, retry, exception queue.
- Void-and-repost flow.
- **Exit:** 100 documents posted to the sandbox with zero duplicates and zero unreconciled records; error taxonomy handling proven by fault injection.

### Phase 4 — Advise (Weeks 13–15)
- Mirror-based analytics queries + ratio engine.
- Chat Mode A with the 9 tools; numeric traceability rendering.
- Standards corpus ingestion (top 12 standards + 10 ISAs), hybrid retrieval, citation UI.
- Chat Mode B with guardrails, refusal paths, injection tests.
- **Exit:** every numeric claim traceable; citation coverage ≥ 95%; refusal suite passing.

### Phase 5 — Harden & launch (Weeks 16–18)
- Security review (auth, RLS, key handling, injection), pen-test pass.
- Performance: p95 review screen < 1.5 s, upload→review < 60 s for a 2-page invoice.
- Billing, tenant onboarding, invite flow, "shadow mode" pilot with 3 clients.
- Runbooks (key rotation, incident, restore), ToS, disclaimers.
- **Exit:** 3 pilot clients live on production Vercel, first month with zero duplicate postings.

### Post-GA (indicative)
- AutoCount 2.2 / Local Connector adapter.
- Multi-account-book consolidation and group reporting.
- Bank statement reconciliation agent, AP approval workflows.
- Excel/PDF report generation (financial statement drafts with MFRS disclosure notes).
- MyInvois e-invoice validation pre-flight.
- On-prem / private-cloud option for firms that won't send client data to a SaaS.

---

## 18. Indicative running costs (monthly, at ~50 tenants / 5,000 docs)

| Item | Estimate |
|---|---|
| Vercel Pro + bandwidth | US$40–120 |
| Neon Postgres (scaled) | US$70–150 |
| R2 storage (5k docs ≈ 25 GB) + ops | US$10–25 |
| Inngest | US$0–100 |
| Vision LLM extraction (~5k docs × 3 pages) | US$450–1,800 |
| Classification LLM (~5k docs) | US$150–500 |
| Embeddings + chat | US$80–250 |
| Sentry / Axiom / PostHog | US$60–150 |
| Upstash Redis | US$10–30 |
| **Total** | **~US$900–3,100** |

Per-document AI cost is the number to watch; it sets pricing. Target gross margin ≥ 75% at RM 0.60–1.20 per document or a per-seat plan of RM 149–399.

---

## 19. Risks and mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **AI misclassifies and it gets posted** | Client books wrong; reputational | Blocking rule engine, human approval gate, post-and-verify, void-only corrections, shadow-mode piloting |
| 2 | **Double posting on network timeout** | Duplicate entries in the ledger | No blind retry; pre-check by docNo/ref; idempotency key; Redis lock |
| 3 | Wrong AutoCount product assumed (Cloud vs 2.2) | Weeks of rework | Confirm in Phase 0 (Q1); build behind `AutoCountAdapter` |
| 4 | Document quality (photos, handwriting, Bahasa Malaysia, faded carbon copies) | Accuracy below target | Per-page extraction, OCR pre-pass, two-model disagreement flagging, `needs_human` path, honest confidences |
| 5 | Rate limit 100 req/min throttles bulk posting | Slow onboarding of a year's backlog | Paced queue, backoff on 429, batch progress UI, off-peak scheduling |
| 6 | AutoCount API semantics differ from docs (empty 201 bodies, `null` vs `""`, doc number formats) | Posting failures | Fixture tests against a sandbox account book; validate every field before send |
| 7 | Chatbot hallucinates a number or a standard | Credibility destroyed in one screenshot | Numbers only from tools; clause-level citations with source URLs; refusal paths; answer replayability |
| 8 | Chart of accounts drifts (accounts renamed/added) | Classification fails mid-batch | Nightly CoA sync, account-existence rule (R6), forced re-sync on 404 |
| 9 | API keys leaked | Full ledger access for a tenant | Encrypted at rest, KMS envelope, never client-side, rotation runbook, per-key call log |
| 10 | Scope creep into "full accounting software" | Never ships | This document's §2.2 is the contract; AutoCount is the ledger |
| 11 | Prompt injection via document text | Unauthorised action | Untrusted-data wrapping, tool allow-list, enum-constrained output, injection eval cases |
| 12 | PDPA / client-security objections stall sales | Revenue delay | Data-residency option, zero-retention AI mode, DPA template, on-prem roadmap |
| 13 | Reviewer trust collapses after one bad batch | Adoption dies | Confidence chips, "explain this", conservative blocking rules, visible reconciliation status |
| 14 | Model price/behaviour change | Margin or accuracy shift | Model-router abstraction, golden-set regression gate, per-agent fallback model |

---

## 20. Decisions needed from you

These six block or shape Phase 0. The first two are genuinely blocking.

| # | Question | Why it matters | My recommendation |
|---|---|---|---|
| **Q1** | **Which AutoCount?** Cloud Accounting (`accounting-api.autocountcloud.com`) or Accounting 2.2 on-prem (`api.autocount.cloud` + Local Connector)? | Completely different architecture, auth and deployment; 2.2 needs a connector on the client's PC | **Cloud Accounting** — it fits a multi-tenant SaaS with API keys |
| **Q2** | Do you have a Cloud Accounting account + API key **now**, ideally a sandbox account book? | Cannot write a real client or fixture tests without one; docs alone are not enough (empty 201 bodies, doc-number formats) | Get one this week; everything in Phase 0 depends on it |
| **Q3** | Who is the **domain accountant** reviewing labels and approvals? | The golden set and the rule thresholds need a human authority; this is the accuracy backbone | A named senior accountant, ≥ 8 h/week for 12 weeks |
| **Q4** | Single-company use, or a firm serving many clients (multi-tenant)? | Drives tenancy, pricing, roles, and whether `account_book` is 1:1 or 1:N | Build **multi-tenant from day one** — retrofitting it is a rewrite |
| **Q5** | Cloud-only, or must some firms keep data on-prem? | Rules out Vercel/serverless for those clients; big architectural fork | **Cloud-only for v1**, on-prem in the post-GA roadmap |
| **Q6** | Which frameworks in v1 — MFRS only, or MFRS + full IFRS + ISA? | Corpus size, retrieval quality, and legal-review cost | **MFRS + ISA for v1** (MFRS is IFRS-converged), add IFRS-only material in Phase 4 if clients need it |

Two more I would decide for you unless you object: **pricing model** (per-document + per-seat hybrid) and **English-only UI in v1** with a Bahasa Malaysia pass before GA if the target market needs it.

---

## Appendix A — Environment variables

```bash
# Core
DATABASE_URL=postgres://…
AUTH_SECRET=            # 32+ bytes, per environment
AUTH_URL=https://app.accentra.ai
NODE_ENV=production
APP_ENV=production      # separate from NODE_ENV for feature gating

# Object storage
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=accentra-documents

# Jobs
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# AI (per agent, so providers can be swapped independently)
AI_READER_MODEL=
AI_READER_API_KEY=
AI_CLASSIFIER_MODEL=
AI_CLASSIFIER_API_KEY=
AI_CHAT_MODEL=
AI_CHAT_API_KEY=
AI_EMBEDDING_MODEL=
AI_EMBEDDING_API_KEY=
LLAMA_PARSE_API_KEY=

# Encryption / KMS
KMS_KEY_ID=             # envelope key for AutoCount credential encryption
ENCRYPTION_KEY=         # 32-byte base64, app-level AES-GCM

# Cache / limits
UPSTASH_REDIS_URL=
UPSTASH_REDIS_TOKEN=

# Observability
SENTRY_DSN=
AXIOM_TOKEN=
POSTHOG_KEY=
```

Rule: env schema is validated with Zod at boot (`packages/shared/src/env.ts`). The app **refuses to start** on a missing or malformed variable — no silent production misconfiguration.

## Appendix B — Internal API surface (Route Handlers / Server Actions)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/documents/presign` | Pre-signed upload URL + document row |
| `POST` | `/api/documents/:id/extract` | Enqueue Agent 1 |
| `POST` | `/api/documents/:id/classify` | Enqueue Agent 2 (+3 chained) |
| `POST` | `/api/documents/:id/validate` | Re-run Layer A on current payload |
| `PATCH` | `/api/reviews/:id` | Field edits (validated, versioned) |
| `POST` | `/api/reviews/:id/decision` | approve · reject · escalate · send-back |
| `POST` | `/api/postings` | Queue approved docs to AutoCount (returns job id) |
| `GET` | `/api/postings/:id` | Status + reconcile result |
| `POST` | `/api/postings/:id/retry` | Explicit retry (runs pre-check first) |
| `POST` | `/api/account-books/:id/sync` | CoA + parties refresh |
| `POST` | `/api/chat` | Streaming chat with tools |
| `GET` | `/api/audit/export` | CSV/PDF audit export |
| `POST` | `/api/webhooks/inngest` | Job runner callback |
| `GET` | `/api/health` | Liveness + dependency checks |

All non-public routes: auth → tenant resolution → RLS context → Zod input validation → handler. No exceptions.

## Appendix C — Agent prompt skeletons

**Agent 2 system prompt (shape):**

```
You are an accounting classifier for Malaysian double-entry bookkeeping.

You are given:
1. A document extracted from an upload (JSON below, with per-field confidence).
2. The client's chart of accounts (only these account codes are valid).
3. The client's tax code list.
4. 5–10 previously approved documents from this same client's books, most similar first.

Produce one transaction classification that:
- Uses ONLY account codes present in the provided chart of accounts.
- Balances exactly: sum(debit) == sum(credit), 2 decimal places.
- Uses accounts whose type matches the direction of the entry
  (SL/SA for revenue credits, EP/CO for expense debits, CA/CL for settlement).
- Chooses the tax code that was effective on the document date.
- Returns transaction_type = UNSUPPORTED for statements, trial balances,
  audit schedules or annual reports — do not invent entries for summaries.

For every decision, give a rationale a non-accountant can read, and list the
document fields you relied on (field path + page). If two accounts are both
plausible, return the runner-up with why it was rejected.

Never output an account code that is not in the chart of accounts.
Never leave a line unbalanced. If the document is unreadable, return
UNSUPPORTED with the reason, not a guess.
```

**Agent 3 critic prompt (shape):** given the document and the proposed entries, list *only* concerns a senior accountant would raise before approving — misclassified expense nature, wrong tax treatment, period cut-off, related-party implications, missing supporting document, suspicious vendor bank details. Severity must be `info` or `warning`; the critic cannot block. Maximum 5 findings, each ≤ 30 words, each tied to a field path.

## Appendix D — Glossary for the UI (keep wording identical everywhere)

| Internal | User-facing label |
|---|---|
| `SALES_INVOICE` | Sales invoice |
| `PURCHASE_INVOICE` | Bill received |
| `PAYMENT_OUT` | Money paid out |
| `PAYMENT_IN` | Money received |
| `JOURNAL` | Adjustment |
| `classification.confidence < 0.8` | Check this one |
| `ValidationReport.blocking` | Must fix before sending |
| `POSTED` / `RECONCILED` | Sent to AutoCount ✓ verified |
| `RECONCILE_MISMATCH` | Sent, but AutoCount shows something different — we've paused it |

---

*End of plan. Confirm Q1–Q6 and I'll turn Phase 0 into a ticket list with the repo scaffolded.*
