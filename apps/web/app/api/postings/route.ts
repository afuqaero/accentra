import { getDocument } from "../../../lib/document-store";
import { getReview } from "../../../lib/review-store";
import { makeIdempotencyKey, postToAutoCount, getFromAutoCount } from "../../../lib/autocount";
import { createPosting, listPostings, updatePosting } from "../../../lib/posting-store";
import type { ClassifiedTransaction } from "../../../lib/contracts";

export async function GET() { return Response.json({ postings: listPostings() }); }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { documentId?: string } | null; const document = body?.documentId ? getDocument(body.documentId) : undefined;
  if (!document?.classified || !document.validation) return Response.json({ error: "A classified and validated document is required." }, { status: 400 });
  if (!document.validation.postable) return Response.json({ error: "Blocking validation findings must be resolved before posting." }, { status: 409 });
  if (getReview(document.id).state !== "APPROVED") return Response.json({ error: "A reviewer must approve this document before posting." }, { status: 409 });
  const idempotencyKey = makeIdempotencyKey(document.id, document.contentHash); const endpoint = document.classified.autocount_target.method;
  const existing = listPostings().find((item) => item.idempotencyKey === idempotencyKey); if (existing) return Response.json({ posting: existing, idempotent: true });
  const posting = createPosting({ documentId: document.id, idempotencyKey, endpoint, request: document.classified }); updatePosting(posting.id, { state: "POSTING" });
  try { const created = await postToAutoCount(endpoint, document.classified as ClassifiedTransaction, idempotencyKey); const fetched = await getFromAutoCount(created.docNo); const matched = Boolean(fetched && JSON.stringify(fetched.payload) === JSON.stringify(document.classified)); return Response.json({ posting: updatePosting(posting.id, { state: matched ? "RECONCILED" : "MISMATCH", autocountDocNo: created.docNo, locationUrl: created.location, response: fetched }) }); }
  catch (error) { return Response.json({ posting: updatePosting(posting.id, { state: "FAILED", error: error instanceof Error ? error.message : "Posting failed" }) }, { status: 502 }); }
}
