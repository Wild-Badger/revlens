import { NextResponse } from "next/server";

import { getRevenueSummary } from "@/lib/revenue";

export async function GET() {
  const summary = await getRevenueSummary();

  return NextResponse.json(summary);
}
