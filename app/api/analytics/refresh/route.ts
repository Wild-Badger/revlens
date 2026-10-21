import { prisma } from "@/lib/db";
import { analyticsService } from "@/lib/analytics-service";
import { requireLocalImport, ImportRequestError } from "@/lib/import/request";
export async function POST(request: Request) {
  try {
    await requireLocalImport(request);
    const metadata = await prisma.datasetMetadata.findUnique({ where: { id: "local" } });
    return Response.json(await analyticsService("/v1/refresh", metadata?.revision ?? 0));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Analytics refresh failed" }, { status: error instanceof ImportRequestError ? error.status : 503 });
  }
}
