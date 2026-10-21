import { analyticsService } from "@/lib/analytics-service";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DatasetConflictError } from "@/lib/dataset-backup";
import { importCustomersData, ImportStateError } from "@/lib/import/import-service";
import { validateImportCSV } from "@/lib/import/csv-validator";
import { ImportRequestError, importPreviewToken, readImportRequest, requireLocalImport } from "@/lib/import/request";

export async function POST(request: Request) {
  try {
    await requireLocalImport(request);
    let input;
    try { input = await readImportRequest(request); }
    catch (error) {
      if (error instanceof ImportRequestError || error instanceof ImportStateError) throw error;
      throw new ImportRequestError("Could not read a valid UTF-8 CSV request. Choose the file again and validate it.");
    }
    const { csv, mappings, confirmed, previewToken, options } = input;
    if (!confirmed) throw new ImportRequestError("Confirm replacement of the complete local dataset after reviewing the preview");
    if (options.expectedRevision === undefined) throw new ImportRequestError("Review a fresh preview with the current dataset revision");
    if (!previewToken || previewToken !== importPreviewToken(csv, mappings, options)) throw new ImportRequestError("File or mapping changed. Validate and review a fresh preview before replacing the dataset");
    let validation;
    try { validation = validateImportCSV(csv, mappings); }
    catch (error) { throw new ImportRequestError(error instanceof Error ? error.message : "Invalid CSV"); }
    if (validation.errors.length) return NextResponse.json({ error: "No changes saved. Fix every validation error before importing.", ...validation }, { status: 400 });
    const saved = await importCustomersData(prisma, validation, options);
    try { await analyticsService("/v1/refresh", saved.revision); return NextResponse.json({ ...saved, analyticsStatus: "ready" }); }
    catch { return NextResponse.json({ ...saved, analyticsStatus: "pending", message: "Data saved; analytics pending. Start the Python service and retry refresh from Data workspace." }); }
  } catch (error) {
    if (error instanceof DatasetConflictError) return NextResponse.json({ error: error.message, code: error.code, revision: error.revision }, { status: 409 });
    if (error instanceof ImportRequestError || error instanceof ImportStateError) return NextResponse.json({ error: error.message }, { status: error.status });
    // Do not return database errors or log supplied rows; they can include private dataset values.
    return NextResponse.json({ error: "No changes saved. Import failed and the transaction was rolled back. Retry, or correct the CSV and validate again." }, { status: 500 });
  }
}
