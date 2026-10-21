import { getDocument, updateDocument, listDocuments } from "../../../../../lib/document-store";
import { demoAccounts } from "../../../../../lib/chart-of-accounts";
import { classifyDocument } from "../../../../../lib/classifier";
import { validateDocument } from "../../../../../lib/validator";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const record = getDocument((await params).id); if (!record?.extracted) return Response.json({ error: "Extract the document first" }, { status: 400 });
  const classified = classifyDocument(record.extracted, demoAccounts); const duplicate = listDocuments().some((candidate) => candidate.id !== record.id && candidate.contentHash === record.contentHash && record.contentHash !== "pending"); const validation = validateDocument(record.extracted, classified, { duplicate }); const next = updateDocument(record.id, { classified, validation, state: "NEEDS_REVIEW" });
  return Response.json({ document: next, classifier: "classifier-v1-local", validator: validation.ruleset_version });
}
