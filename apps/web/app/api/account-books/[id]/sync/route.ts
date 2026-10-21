import { demoAccounts } from "../../../../../lib/chart-of-accounts";
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) { return Response.json({ accountBookId: (await params).id, source: "local-demo-adapter", syncedAt: new Date().toISOString(), accounts: demoAccounts }); }
