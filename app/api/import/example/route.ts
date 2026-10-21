import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("invalid") === "true" ? "revlens-invalid.csv" : "revlens-48-months.csv";
  const csv = await readFile(path.join(process.cwd(), "docs", "examples", name), "utf8");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
