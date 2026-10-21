import { auth } from "@/auth";
import { isLocalDatasetRequest } from "@/lib/dataset-backup";
import { listCheckpoints } from "@/lib/dataset-checkpoints";

export async function GET(request: Request) {
  if (!isLocalDatasetRequest(request)) return Response.json({ error: "Local workspace only" }, { status: 403 });
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (session.user.role !== "admin") return Response.json({ error: "Local owner access required" }, { status: 403 });
  try { return Response.json({ checkpoints: await listCheckpoints() }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Private checkpoint storage is unavailable" }, { status: 503 }); }
}
