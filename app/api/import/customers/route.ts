import { NextResponse } from "next/server";

// ponytail: the legacy endpoint is closed so there is only one validation/write contract.
export async function POST() {
  return NextResponse.json({ error: "This import endpoint is retired. Use the reviewed import wizard at /import; no changes were saved." }, { status: 410 });
}
export async function GET() {
  return NextResponse.json({ error: "Use /api/import/template for the current dated CSV contract." }, { status: 410 });
}
