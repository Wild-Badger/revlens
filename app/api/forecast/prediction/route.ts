import { analyticsService } from "@/lib/analytics-service";
export async function GET() {
  try { return Response.json(await analyticsService("/v1/prediction"), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Prediction unavailable" }, { status: 503 }); }
}
