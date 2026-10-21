import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentRecord } from "./contracts";

const records = new Map<string, DocumentRecord>();
const dataDir = path.join(process.cwd(), ".data", "documents");

export function createDocument(input: Omit<DocumentRecord, "state" | "createdAt">) {
  const record: DocumentRecord = { ...input, state: "UPLOADED", createdAt: new Date().toISOString() };
  records.set(record.id, record);
  return record;
}

export function getDocument(id: string) { return records.get(id); }
export function updateDocument(id: string, patch: Partial<DocumentRecord>) {
  const current = records.get(id);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  records.set(id, next);
  return next;
}

export async function saveDocumentFile(id: string, bytes: Uint8Array) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, id), bytes);
}

export async function readDocumentFile(id: string) { return readFile(path.join(dataDir, id)); }
export function contentHash(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

export function listDocuments() { return [...records.values()]; }
