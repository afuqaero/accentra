import { getDocument, saveDocumentFile, updateDocument, contentHash } from "../../../../../lib/document-store";
import { MAX_FILE_BYTES } from "../../../../../lib/contracts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const record = getDocument(id);
  if (!record) return Response.json({ error: "Document not found" }, { status: 404 });
  const form = await request.formData(); const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return Response.json({ error: "Files must be 50 MB or smaller." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  await saveDocumentFile(id, bytes);
  const next = updateDocument(id, { size: file.size, contentType: record.contentType, contentHash: contentHash(bytes) });
  return Response.json({ document: next });
}
