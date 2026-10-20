import { NextResponse } from "next/server";
import { detectColumns, IMPORT_COLUMNS, parseCSV } from "@/lib/import/csv-validator";
import { ImportRequestError, readImportRequest, requireLocalImport } from "@/lib/import/request";

export async function POST(request: Request) {
  try {
    await requireLocalImport(request);
    const { csv } = await readImportRequest(request);
    const { headers, rows } = parseCSV(csv);
    const mapping = detectColumns(headers);
    const missing = IMPORT_COLUMNS.filter(([column, required]) => required && !mapping.find(item => item.column === column)?.sourceHeader).map(([column]) => column);
    return NextResponse.json({ headers, mapping, hasRequiredColumns: missing.length === 0, missingRequiredColumns: missing, totalRows: rows.length, previewRows: rows.slice(0, 5) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Column detection failed" }, { status: error instanceof ImportRequestError ? error.status : 400 });
  }
}
