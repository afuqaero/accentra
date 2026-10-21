import type { ExtractedDocument } from "./contracts";
import { field } from "./contracts";

const money = (text: string | null | undefined) => text ? Number(text.replace(/[^\d.-]/g, "")) : null;
const match = (text: string, pattern: RegExp) => text.match(pattern)?.[1]?.trim() ?? null;

function emptyField<T>() { return field<T>(null, null, 0, true); }

export function extractText(text: string, filename: string): ExtractedDocument {
  const family = /receipt/i.test(text) || /receipt/i.test(filename) ? "RECEIPT" : /payment voucher|\bPV[-\s]/i.test(text) ? "PAYMENT_VOUCHER" : /bank statement/i.test(text) || /statement/i.test(filename) ? "BANK_STATEMENT" : /invoice|inv[-\s]/i.test(text + filename) ? "PURCHASE_INVOICE" : "UNKNOWN";
  const supplierName = match(text, /(?:supplier|vendor|from|seller)\s*[:#-]?\s*([^\n]+)/i);
  const documentNumber = match(text, /(?:invoice|receipt|document|doc)\s*(?:no|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-/]+)/i);
  const date = match(text, /(?:date|issued)\s*[:#-]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
  const currency = match(text, /\b(MYR|RM|USD|SGD|EUR)\b/i)?.toUpperCase().replace("RM", "MYR") ?? null;
  const totalRaw = match(text, /(?:grand\s+total|total\s+due|total)\s*[:=]?\s*(?:RM|MYR|USD)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  const taxRaw = match(text, /(?:sst|tax|gst)\s*[:=]?\s*(?:RM|MYR)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  const total = money(totalRaw); const tax = money(taxRaw);
  const subtotal = total !== null && tax !== null ? Number((total - tax).toFixed(2)) : null;
  const make = <T>(value: T | null, raw = value === null ? null : String(value), confidence = value === null ? 0 : 0.88) => field(value, raw, confidence, value === null);
  return {
    doc_family: family,
    supplier: { name: make(supplierName), tax_id: emptyField(), address: emptyField(), phone: emptyField(), email: emptyField() },
    customer: { name: emptyField(), tax_id: emptyField(), address: emptyField() },
    document: { number: make(documentNumber), date: make(date), due_date: emptyField(), currency: make(currency), po_number: emptyField(), terms: emptyField() },
    lines: [],
    totals: { subtotal: make<number>(subtotal), discount: make<number>(null), tax: make<number>(tax), total: make<number>(total), paid: make<number>(null) },
    quality: { pages: 1, is_scanned: !/[\w]+\s*[:=]/.test(text), rotation_fixed: false, overall_confidence: total !== null ? 0.84 : 0.42, unreadable_regions: total === null ? 1 : 0 },
  };
}

export function extractCsv(text: string): ExtractedDocument {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines[0]?.split(",").map((v) => v.trim().toLowerCase()) ?? [];
  const rows = lines.slice(1).map((line) => line.split(",").map((v) => v.trim()));
  const totalIndex = headers.findIndex((h) => /total|amount|value/.test(h));
  const total = rows.reduce((sum, row) => sum + (totalIndex >= 0 ? Number(row[totalIndex]?.replace(/[^\d.-]/g, "") || 0) : 0), 0);
  return extractText(`bank statement\nTotal: ${total.toFixed(2)}\n${text}`, "statement.csv");
}
