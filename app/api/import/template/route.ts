import { TEMPLATE_CSV } from "@/lib/import/csv-validator";

export async function GET() {
  return new Response(TEMPLATE_CSV, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": "attachment; filename=revlens-synthetic-template-2026-09-30.csv",
    "Cache-Control": "no-store",
  } });
}
