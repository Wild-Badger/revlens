import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function getDatasetContext(db: Pick<Prisma.TransactionClient, "datasetMetadata"> = prisma) {
  if (process.env.DEMO_MODE === "true") {
    return { kind: "demo" as const, asOf: new Date(process.env.DEMO_AS_OF ?? "2026-09-30T23:59:59.999Z"), currency: "USD", importedAt: null, rowCount: 60 };
  }
  const metadata = process.env.LOCAL_WORKSPACE_MODE === "true"
    ? await db.datasetMetadata.findUnique({ where: { id: "local" } })
    : null;
  return {
    kind: metadata ? "local" as const : "empty" as const,
    asOf: metadata?.asOf ?? new Date(),
    currency: metadata?.currency ?? "USD",
    importedAt: metadata?.importedAt ?? null,
    rowCount: metadata?.rowCount ?? 0,
  };
}

export async function getAsOf() {
  return (await getDatasetContext()).asOf;
}

export function isActiveAt(subscription: { startedAt: Date; endedAt: Date | null }, at: Date) {
  return subscription.startedAt <= at && (!subscription.endedAt || subscription.endedAt > at);
}

export function hasLocalMutationOrigin(request: Request, requireOrigin = false) {
  try {
    // Next can expose its internal localhost URL; AUTH_URL is the configured browser origin.
    const expected = new URL(process.env.LOCAL_WORKSPACE_MODE === "true" && process.env.AUTH_URL ? process.env.AUTH_URL : request.url);
    if (!["http:", "https:"].includes(expected.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname)) return false;
    const origin = request.headers.get("origin");
    return origin ? origin === expected.origin : !requireOrigin;
  } catch { return false; }
}
