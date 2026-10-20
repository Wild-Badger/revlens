import { NextResponse } from "next/server";
import { validateImportCSV } from "@/lib/import/csv-validator";
import { ImportRequestError, importPreviewToken, readImportRequest, requireLocalImport } from "@/lib/import/request";

export async function POST(request: Request) {
  try {
    await requireLocalImport(request);
    const { csv, mappings } = await readImportRequest(request);
    const result = validateImportCSV(csv, mappings);
    return NextResponse.json({ success: result.errors.length === 0, ...result,
      mode: "local", operation: "replace-dataset", previewToken: importPreviewToken(csv, mappings),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Validation failed" }, { status: error instanceof ImportRequestError ? error.status : 400 });
  }
}
