import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { DatasetBackupError, exportDatasetBackup, isLocalDatasetRequest } from "@/lib/dataset-backup";

export async function GET(request: Request) {
  if (!isLocalDatasetRequest(request)) return Response.json({ error: "Backup is available only in the local workspace" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "Local owner access required" }, { status: 403 });
  try {
    const backup = await exportDatasetBackup(prisma);
    return Response.json(backup, { headers: {
      "Content-Disposition": `attachment; filename="revlens-backup-${backup.exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof DatasetBackupError ? error.message : "Backup failed; local data was not changed" }, { status: error instanceof DatasetBackupError ? 400 : 500 });
  }
}
