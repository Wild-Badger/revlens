import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateImportCSV } from "@/lib/import/csv-validator";
import { ImportRequestError, importPreviewToken, readImportRequest, requireLocalImport } from "@/lib/import/request";

export async function POST(request: Request) {
  try {
    await requireLocalImport(request);
    const { csv, mappings, options } = await readImportRequest(request);
    const result = validateImportCSV(csv, mappings);
    if (options.historyStart && result.summary.asOf && options.historyStart > result.summary.asOf) throw new ImportRequestError("Coverage start cannot follow the observation date");
    const revision = (await prisma.datasetMetadata.findUnique({ where: { id: "local" } }))?.revision ?? 0;
    options.expectedRevision = revision;
    return NextResponse.json({ success: result.errors.length === 0, ...result,
      mode: "local", operation: "replace-dataset", revision, previewToken: importPreviewToken(csv, mappings, options),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Validation failed" }, { status: error instanceof ImportRequestError ? error.status : 400 });
  }
}
