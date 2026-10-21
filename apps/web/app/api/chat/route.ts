import { listDocuments } from "../../../lib/document-store";
import { adapterStatus } from "../../../lib/autocount";
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { message?: string; mode?: "books" | "standards" } | null; const message = body?.message?.trim(); if (!message) return Response.json({ error: "message is required" }, { status: 400 });
  const docs = listDocuments(); const posted = docs.filter((doc) => doc.validation?.postable).length;
  if (body?.mode === "standards") return Response.json({ answer: "MFRS and IFRS guidance is advisory here. Connect the standards corpus before relying on clause-level conclusions for a client decision.", citations: [{ standard: "MFRS/IFRS corpus", reference: "Pending corpus connection", source_url: "https://www.mia.org.my" }], mode: "standards" });
  return Response.json({ answer: `The local book mirror contains ${docs.length} documents, with ${posted} currently passing deterministic validation. AutoCount adapter status: ${adapterStatus().adapter}. I can only answer from records available in the mirror.`, citations: [{ standard: "Accentra book mirror", reference: "document and validation records", source_url: "/api/documents" }], mode: "books", trace: { documentCount: docs.length, validatedCount: posted } });
}
