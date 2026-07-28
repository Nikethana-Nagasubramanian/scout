import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "@/lib/database";

export const runtime = "nodejs";

export async function GET() {
  const path = resolve(process.cwd(), "data/backups/job-copilot-download.sqlite");
  try { await unlink(path); } catch { }
  await db.backup(path);
  const file = await readFile(path);
  await unlink(path);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(file), { headers: { "Content-Type": "application/vnd.sqlite3", "Content-Disposition": `attachment; filename="job-copilot-${date}.sqlite"` } });
}
