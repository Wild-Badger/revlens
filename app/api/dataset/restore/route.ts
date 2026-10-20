import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasLocalMutationOrigin } from "@/lib/dataset";
import { DatasetBackupError, isLocalDatasetRequest, MAX_BACKUP_BYTES, RESTORE_CONFIRMATION, restoreDatasetBackup } from "@/lib/dataset-backup";

export async function POST(request: Request) {
  if (!isLocalDatasetRequest(request)) return Response.json({ error: "Restore is available only in the local workspace" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "Local owner access required" }, { status: 403 });
  if (!hasLocalMutationOrigin(request, true)) return Response.json({ error: "Same-origin request required" }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return Response.json({ error: "Use a JSON backup" }, { status: 415 });
  if (Number(request.headers.get("content-length")) > MAX_BACKUP_BYTES) return Response.json({ error: "Backup exceeds 25 MiB" }, { status: 413 });
  try {
    // Read a bounded stream rather than trusting a missing/incorrect Content-Length header.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "Backup is required" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BACKUP_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Backup exceeds 25 MiB" }, { status: 413 });
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body?.confirmation !== RESTORE_CONFIRMATION || !body?.backup || Object.keys(body).some((key) => !["confirmation", "backup"].includes(key))) return Response.json({ error: "Select a backup and confirm replacing the local dataset" }, { status: 400 });
    const backup = await restoreDatasetBackup(prisma, body.backup);
    return Response.json({ restored: true, customers: backup.customers.length, asOf: backup.metadata?.asOf ?? null, currency: backup.metadata?.currency ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const invalid = error instanceof DatasetBackupError || error instanceof SyntaxError;
    return Response.json({ error: error instanceof DatasetBackupError ? error.message : invalid ? "Invalid JSON backup" : "Restore failed; the previous local dataset was preserved" }, { status: invalid ? 400 : 500 });
  }
}
