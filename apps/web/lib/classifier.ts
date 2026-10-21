import type { Account, ClassifiedTransaction, ExtractedDocument } from "./contracts";

export type MappingMemory = { vendorKey: string; docFamily: string; accNo: string; hits: number; confidence: number };

export function classifyDocument(doc: ExtractedDocument, accounts: Account[], memories: MappingMemory[] = []): ClassifiedTransaction {
  const vendor = doc.supplier.name.value ?? "Unknown supplier";
  const learned = memories.find((item) => item.vendorKey.toLowerCase() === vendor.toLowerCase() && item.docFamily === doc.doc_family);
  const expense = accounts.find((account) => account.accNo === (learned?.accNo ?? "610-2000")) ?? accounts.find((account) => account.type === "EXPENSE" && account.postable);
  const creditor = accounts.find((account) => account.accNo === "300-D002") ?? accounts[0];
  const amount = doc.totals.total.value ?? 0;
  const isUnsupported = ["BANK_STATEMENT", "UNKNOWN"].includes(doc.doc_family);
  const transactionType = isUnsupported ? "UNSUPPORTED" : doc.doc_family === "RECEIPT" ? "CASH_SALE" : doc.doc_family === "PAYMENT_VOUCHER" ? "PAYMENT_OUT" : doc.doc_family === "SALES_INVOICE" ? "SALES_INVOICE" : "PURCHASE_INVOICE";
  const entry = { line_no: 1, acc_no: expense?.accNo ?? "610-2000", acc_name: expense?.accName ?? "Utilities", dr: amount, cr: 0, description: vendor, tax_code: null, department: null };
  const counter = { line_no: 2, acc_no: creditor.accNo, acc_name: creditor.accName, dr: 0, cr: amount, description: vendor, tax_code: null, department: null };
  return {
    transaction_type: transactionType,
    autocount_target: { method: transactionType === "PURCHASE_INVOICE" ? "purchaseInvoice" : transactionType === "SALES_INVOICE" ? "invoice" : transactionType === "PAYMENT_OUT" ? "cashBookEntry" : "journalEntry", document_type: transactionType === "PURCHASE_INVOICE" ? "PI" : transactionType === "SALES_INVOICE" ? "IV" : "JE" },
    entries: [entry, counter],
    party: { type: transactionType === "SALES_INVOICE" ? "DEBTOR" : transactionType === "UNSUPPORTED" ? "NONE" : "CREDITOR", code: transactionType === "UNSUPPORTED" ? null : "300-D002", name: vendor, is_new: false },
    period: { doc_date: doc.document.date.value, currency: doc.document.currency.value ?? "MYR", currency_rate: 1 },
    rationale: learned ? `Matched ${vendor} to a previously approved mapping (${learned.accNo}, ${learned.hits} approvals).` : `The document is treated as a ${transactionType.toLowerCase().replaceAll("_", " ")} and the amount is mapped to ${expense?.accNo ?? "610-2000"} pending review.`,
    evidence: [{ claim: "Total amount", field: "totals.total", page: doc.totals.total.page }],
    confidence: Math.min(doc.quality.overall_confidence, learned?.confidence ?? 0.78),
    alternatives: accounts.filter((account) => account.type === "EXPENSE" && account.postable && account.accNo !== expense?.accNo).slice(0, 2).map((account) => ({ label: `${account.accNo} · ${account.accName}`, acc_no: account.accNo, why_not: "Possible expense category; document evidence is weaker." })),
  };
}
