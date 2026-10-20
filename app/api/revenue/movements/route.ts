import { NextResponse } from "next/server";
import { z } from "zod";

import { getRevenueMovements } from "@/lib/revenue";

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => { const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }, "Invalid date");

const querySchema = z
  .object({
    from: dateParam.optional(),
    to: dateParam.optional(),
    segment: z.string().trim().min(1).max(100).optional(),
    plan: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    (params) => !params.from || !params.to || params.from <= params.to,
    { message: "`from` must be before or equal to `to`", path: ["from"] }
  );

function parseDate(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

export async function GET(request: Request) {
  const rawParams = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(rawParams);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_query",
          message: "Invalid revenue movement query parameters.",
          issues: z.flattenError(parsed.error).fieldErrors,
        },
      },
      { status: 400 }
    );
  }

  const movements = await getRevenueMovements({
    from: parseDate(parsed.data.from),
    to: parsed.data.to ? new Date(`${parsed.data.to}T23:59:59.999Z`) : undefined,
    segment: parsed.data.segment,
    plan: parsed.data.plan,
  });

  return NextResponse.json({ movements });
}
