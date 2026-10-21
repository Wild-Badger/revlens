import { readFile } from "node:fs/promises";
import { auth } from "@/auth";
import { isLocalDatasetRequest } from "@/lib/dataset-backup";
import { checkpointFile } from "@/lib/dataset-checkpoints";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalDatasetRequest(request)) return Response.json({ error: "Local workspace only" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "Local owner access required" }, { status: 403 });
  const { id } = await params;
  try { const bytes = await readFile(await checkpointFile(id)); return new Response(bytes, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="revlens-checkpoint-${id}.json"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
  catch { return Response.json({ error: "Checkpoint unavailable" }, { status: 404 }); }
}
