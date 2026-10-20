import { NextResponse } from "next/server";
import { z } from "zod";

import { getCustomerDetail } from "@/lib/customers";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const rawParams = await params;
  const parsed = paramsSchema.safeParse(rawParams);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_params",
          message: "Invalid customer ID parameter.",
          issues: z.flattenError(parsed.error).fieldErrors,
        },
      },
      { status: 400 }
    );
  }

  const detail = await getCustomerDetail(parsed.data.id);

  if (!detail) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  return NextResponse.json({ customer: detail });
}
