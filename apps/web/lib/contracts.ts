export type SupportedMime = "application/pdf" | "image/jpeg" | "image/png" | "image/heic" | "text/csv" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.ms-excel";

export type Field<T> = {
  value: T | null;
  confidence: number;
  page: number;
  bbox: [number, number, number, number] | null;
  raw_text: string | null;
  needs_human: boolean;
};

export type ExtractedDocument = {
  doc_family: "SALES_INVOICE" | "PURCHASE_INVOICE" | "RECEIPT" | "PAYMENT_VOUCHER" | "BANK_STATEMENT" | "UNKNOWN";
  supplier: { name: Field<string>; tax_id: Field<string>; address: Field<string>; phone: Field<string>; email: Field<string> };
  customer: { name: Field<string>; tax_id: Field<string>; address: Field<string> };
  document: { number: Field<string>; date: Field<string>; due_date: Field<string>; currency: Field<string>; po_number: Field<string>; terms: Field<string> };
  lines: Array<{ description: Field<string>; qty: Field<number>; unit_price: Field<number>; tax_amount: Field<number>; amount: Field<number> }>;
  totals: { subtotal: Field<number>; discount: Field<number>; tax: Field<number>; total: Field<number>; paid: Field<number> };
  quality: { pages: number; is_scanned: boolean; rotation_fixed: boolean; overall_confidence: number; unreadable_regions: number };
};

export type DocumentRecord = {
  id: string;
  filename: string;
  contentType: SupportedMime;
  size: number;
  contentHash: string;
  state: "UPLOADED" | "EXTRACTING" | "EXTRACTED" | "NEEDS_REVIEW" | "FAILED";
  createdAt: string;
  extracted?: ExtractedDocument;
  classified?: ClassifiedTransaction;
  validation?: ValidationReport;
  error?: string;
};

export type Account = { accNo: string; accName: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE"; postable: boolean };
export type ClassifiedTransaction = {
  transaction_type: "SALES_INVOICE" | "PURCHASE_INVOICE" | "CASH_SALE" | "PAYMENT_OUT" | "PAYMENT_IN" | "JOURNAL" | "EXPENSE_CLAIM" | "UNSUPPORTED";
  autocount_target: { method: "invoice" | "purchaseInvoice" | "journalEntry" | "cashBookEntry"; document_type: string };
  entries: Array<{ line_no: number; acc_no: string; acc_name: string; dr: number; cr: number; description: string; tax_code: string | null; department: string | null }>;
  party: { type: "DEBTOR" | "CREDITOR" | "NONE"; code: string | null; name: string; is_new: boolean };
  period: { doc_date: string | null; currency: string; currency_rate: number };
  rationale: string;
  evidence: Array<{ claim: string; field: string; page: number }>;
  confidence: number;
  alternatives: Array<{ label: string; acc_no: string; why_not: string }>;
};
export type Finding = { rule_id: string; severity: "error" | "warning" | "info"; field_paths: string[]; message: string; evidence: Array<{ page: number; bbox: number[]; excerpt: string }>; suggested_fix: null; blocking: boolean };
export type ValidationReport = { findings: Finding[]; blocking_count: number; warning_count: number; postable: boolean; checked_at: string; ruleset_version: string; confidence_floor: number };
export type Posting = { id: string; documentId: string; idempotencyKey: string; endpoint: string; state: "QUEUED" | "POSTING" | "POSTED" | "RECONCILED" | "FAILED" | "MISMATCH"; autocountDocNo?: string; locationUrl?: string; request: unknown; response?: unknown; error?: string; createdAt: string; };

export const SUPPORTED_MIMES: SupportedMime[] = ["application/pdf", "image/jpeg", "image/png", "image/heic", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"];
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function field<T>(value: T | null, raw: string | null, confidence = value === null ? 0 : 0.86, needsHuman = value === null): Field<T> {
  return { value, confidence, page: 1, bbox: null, raw_text: raw, needs_human: needsHuman };
}
