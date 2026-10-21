import { prisma } from "@/lib/db";
export async function GET() {
  const metadata = await prisma.datasetMetadata.findUnique({ where: { id: "local" } });
  return Response.json({ revision: metadata?.revision ?? 0, analyticsRevision: metadata?.analyticsRevision ?? -1,
    status: metadata?.pipelineStatus ?? "empty", source: metadata?.sourceName ?? null }, { headers: { "Cache-Control": "no-store" } });
}
