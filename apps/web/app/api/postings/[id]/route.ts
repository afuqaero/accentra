import { getPosting } from "../../../../lib/posting-store";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { const posting = getPosting((await params).id); return posting ? Response.json({ posting }) : Response.json({ error: "Posting not found" }, { status: 404 }); }
