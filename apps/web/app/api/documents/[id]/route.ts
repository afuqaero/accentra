import { getDocument } from "../../../../lib/document-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const record = getDocument((await params).id);
  return record ? Response.json({ document: record }) : Response.json({ error: "Document not found" }, { status: 404 });
}
