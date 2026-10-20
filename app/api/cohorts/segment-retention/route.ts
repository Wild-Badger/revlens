import { NextResponse } from "next/server";

import { getSegmentRetention } from "@/lib/cohorts";

export async function GET() {
  const data = await getSegmentRetention();
  return NextResponse.json(data);
}
