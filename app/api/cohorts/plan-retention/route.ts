import { NextResponse } from "next/server";

import { getPlanRetention } from "@/lib/cohorts";

export async function GET() {
  const data = await getPlanRetention();
  return NextResponse.json(data);
}
