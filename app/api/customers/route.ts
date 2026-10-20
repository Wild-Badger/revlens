import { NextResponse } from "next/server";

import { getCustomersList } from "@/lib/customers";
import { getAsOf } from "@/lib/dataset";
import { prisma } from "@/lib/db";
import { z } from "zod";

const query = z.object({
  search: z.string().max(200).optional(), status: z.enum(["lead", "active", "churned", "reactivated"]).optional(),
  plan: z.string().max(200).optional(), paymentStatus: z.enum(["current", "at_risk", "failed", "not_supplied"]).optional(),
  churnRisk: z.enum(["low", "medium", "high", "not_applicable"]).optional(),
  sortBy: z.enum(["name", "currentMrr", "plan", "status", "paymentStatus", "churnRisk"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const parsed = query.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid customer filters. Clear filters and retry." }, { status: 400 });

  const customers = await getCustomersList(parsed.data);
  const plans = await prisma.plan.findMany({ select: { name: true }, distinct: ["name"], orderBy: { name: "asc" } });

  return NextResponse.json({ customers, as_of: (await getAsOf()).toISOString(), plans: plans.map((plan) => plan.name) });
}
