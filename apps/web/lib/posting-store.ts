import { randomUUID } from "node:crypto";
import type { Posting } from "./contracts";
const postings = new Map<string, Posting>();
export function createPosting(input: Omit<Posting, "id" | "createdAt" | "state">) { const posting: Posting = { ...input, id: randomUUID(), state: "QUEUED", createdAt: new Date().toISOString() }; postings.set(posting.id, posting); return posting; }
export function updatePosting(id: string, patch: Partial<Posting>) { const current = postings.get(id); if (!current) return; const next = { ...current, ...patch }; postings.set(id, next); return next; }
export function getPosting(id: string) { return postings.get(id); }
export function listPostings() { return [...postings.values()]; }
