import { randomUUID } from "node:crypto";
import type { ClassifiedTransaction } from "./contracts";

type Posted = { docNo: string; endpoint: string; payload: unknown; location: string; idempotencyKey: string };
const posted = new Map<string, Posted>();

export async function postToAutoCount(endpoint: string, payload: ClassifiedTransaction, idempotencyKey: string) {
  const existing = [...posted.values()].find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) return existing;
  const docNo = `ACC-${new Date().getFullYear()}-${String(posted.size + 1).padStart(5, "0")}`;
  const result = { docNo, endpoint, payload, idempotencyKey, location: `mock://autocount/1/${endpoint}?docNo=${docNo}` };
  posted.set(docNo, result); return result;
}

export async function getFromAutoCount(docNo: string) { return posted.get(docNo) ?? null; }
export function adapterStatus() { return { adapter: "mock-autocount-cloud", accountBookId: "demo-book", credentialsConfigured: Boolean(process.env.AUTCOUNT_API_KEY), postedCount: posted.size }; }
export function makeIdempotencyKey(documentId: string, contentHash: string) { return `ACC:${documentId}:${contentHash.slice(0, 16) || randomUUID()}`; }
