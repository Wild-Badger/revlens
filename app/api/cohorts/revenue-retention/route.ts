import { NextResponse } from "next/server";
import { z } from "zod";

import { getRevenueRetentionCohorts } from "@/lib/cohorts";

const querySchema = z.object({
  segment: z.string().trim().min(1).max(100).optional(),
  plan: z.string().trim().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  const rawParams = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(rawParams);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_query",
          message: "Invalid cohort query parameters.",
          issues: z.flattenError(parsed.error).fieldErrors,
        },
      },
      { status: 400 }
    );
  }

  const data = await getRevenueRetentionCohorts({
    segment: parsed.data.segment,
    plan: parsed.data.plan,
  });

  return NextResponse.json(data);
}
