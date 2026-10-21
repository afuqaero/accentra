import { getDocument, updateDocument } from "../../../../../lib/document-store";
import { validateDocument } from "../../../../../lib/validator";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) { const record = getDocument((await params).id); if (!record?.extracted || !record.classified) return Response.json({ error: "Classify the document first" }, { status: 400 }); const validation = validateDocument(record.extracted, record.classified); updateDocument(record.id, { validation }); return Response.json({ validation }); }
