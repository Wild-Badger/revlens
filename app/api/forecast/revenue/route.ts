import { NextResponse } from "next/server";
import { z } from "zod";

import { getForecastScenarios } from "@/lib/forecast";

const querySchema = z.object({
  newMrrGrowth: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().min(0).max(2).optional()),
  churnRate: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().min(0).max(1).optional()),
  expansionRate: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().min(0).max(2).optional()),
});

export async function GET(request: Request) {
  const rawParams = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(rawParams);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_query",
          message: "Invalid forecast query parameters.",
          issues: z.flattenError(parsed.error).fieldErrors,
        },
      },
      { status: 400 }
    );
  }

  const data = await getForecastScenarios({
    newMrrGrowth: parsed.data.newMrrGrowth,
    churnRate: parsed.data.churnRate,
    expansionRate: parsed.data.expansionRate,
  });

  return NextResponse.json(data);
}
