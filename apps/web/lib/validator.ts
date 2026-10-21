import type { ClassifiedTransaction, ExtractedDocument, Finding, ValidationReport } from "./contracts";
import { getAccount } from "./chart-of-accounts";

const finding = (rule_id: string, severity: Finding["severity"], message: string, field_paths: string[], blocking: boolean): Finding => ({ rule_id, severity, message, field_paths, evidence: [], suggested_fix: null, blocking });
export function validateDocument(doc: ExtractedDocument, tx: ClassifiedTransaction, context: { duplicate?: boolean } = {}): ValidationReport {
  const findings: Finding[] = []; const debit = tx.entries.reduce((sum, line) => sum + line.dr, 0); const credit = tx.entries.reduce((sum, line) => sum + line.cr, 0);
  if (Math.abs(debit - credit) > 0.005) findings.push(finding("R1", "error", "The proposed entries do not balance: money in and money out differ.", ["entries"], true));
  if (doc.totals.total.value !== null && doc.totals.subtotal.value !== null && doc.totals.tax.value !== null && Math.abs(doc.totals.subtotal.value + doc.totals.tax.value - doc.totals.total.value) > 0.01) findings.push(finding("R2", "error", "Subtotal plus tax does not equal the printed total.", ["totals"], true));
  if (doc.lines.length > 0 && doc.lines.some((line) => line.qty.value !== null && line.unit_price.value !== null && line.amount.value !== null && Math.abs(line.qty.value * line.unit_price.value - line.amount.value) > 0.01)) findings.push(finding("R3", "error", "One line amount does not equal quantity multiplied by unit price.", ["lines"], true));
  if (context.duplicate) findings.push(finding("R5", "error", "This document matches another upload by content or supplier reference.", ["document", "contentHash"], true));
  if (tx.transaction_type !== "UNSUPPORTED" && doc.document.number.value === null) findings.push(finding("R5", "warning", "No document number was extracted, so duplicate checking is incomplete.", ["document.number"], false));
  if (tx.entries.some((line) => !getAccount(line.acc_no)?.postable)) findings.push(finding("R6", "error", "One or more selected accounts are not valid postable accounts.", ["entries.acc_no"], true));
  if (tx.transaction_type === "SALES_INVOICE" && tx.entries.some((line) => getAccount(line.acc_no)?.type === "EXPENSE")) findings.push(finding("R7", "warning", "A sales document is mapped to an expense account; confirm the classification.", ["entries.acc_no"], false));
  if (tx.transaction_type === "UNSUPPORTED") findings.push(finding("R13", "error", "This looks like a statement or summary, not a single transaction.", ["doc_family"], true));
  if (doc.quality.overall_confidence < 0.8) findings.push(finding("CONFIDENCE", "warning", "Some fields need a closer look because the document could not be read confidently.", ["quality.overall_confidence"], false));
  if (doc.document.date.value === null) findings.push(finding("R4", "error", "A document date is required before this can be posted.", ["document.date"], true));
  if (doc.totals.total.value === null) findings.push(finding("R2", "error", "A printed total is required before this can be posted.", ["totals.total"], true));
  if (tx.party.type !== "NONE" && !tx.party.code) findings.push(finding("R8", "error", "A valid customer or supplier code is required.", ["party.code"], true));
  if (tx.entries.some((line) => line.tax_code !== null && !["SST-0", "SST-6", "SST-8"].includes(line.tax_code))) findings.push(finding("R9", "error", "The selected tax code is not in the synced tax-code table.", ["entries.tax_code"], true));
  if (doc.totals.total.value !== null && doc.totals.total.value > 10000) findings.push(finding("R12", "warning", "This amount is above the default approval threshold and needs a second reviewer.", ["totals.total"], false));
  if (tx.period.currency_rate <= 0) findings.push(finding("R10", "warning", "A valid currency rate is required for review.", ["period.currency_rate"], false));
  if (doc.document.number.value !== null && /statement|summary/i.test(doc.document.number.value)) findings.push(finding("R11", "warning", "The document number looks like a statement or summary reference; confirm it is a transaction.", ["document.number"], false));
  if (doc.supplier.email.value && !doc.supplier.name.value) findings.push(finding("R14", "warning", "Supplier details are incomplete; verify bank and vendor-master details before posting.", ["supplier"], false));
  if (doc.totals.total.value !== null && doc.totals.total.value > 50000) findings.push(finding("R15", "warning", "This is an unusually large amount for the local review baseline.", ["totals.total"], false));
  const blocking_count = findings.filter((item) => item.blocking).length; const warning_count = findings.filter((item) => item.severity === "warning").length;
  return { findings, blocking_count, warning_count, postable: blocking_count === 0, checked_at: new Date().toISOString(), ruleset_version: "rules-v1-phase2", confidence_floor: doc.quality.overall_confidence };
}
