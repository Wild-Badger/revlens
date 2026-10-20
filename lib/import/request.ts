import { createHash } from "node:crypto";
import { auth } from "@/auth";
import { hasLocalMutationOrigin } from "@/lib/dataset";
import { MAX_IMPORT_BYTES, type ColumnMappings } from "./csv-validator";

export class ImportRequestError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function requireLocalImport(request: Request) {
  if (process.env.LOCAL_WORKSPACE_MODE !== "true" || process.env.DEMO_MODE !== "false" || process.env.NEXT_PUBLIC_DEMO_MODE !== "false") throw new ImportRequestError("Import is available only in the dedicated local workspace. The synthetic demo is read-only.", 403);
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new ImportRequestError("Local workspace requests must use loopback", 403);
  if (!hasLocalMutationOrigin(request)) throw new ImportRequestError("Cross-origin replacement is not allowed", 403);
  const session = await auth();
  if (!session?.user) throw new ImportRequestError("Sign in to the local workspace", 401);
  if (session.user.role !== "admin") throw new ImportRequestError("Only the local owner can replace this dataset", 403);
}
export async function readImportRequest(request: Request): Promise<{ csv: string; mappings?: ColumnMappings; confirmed: boolean; previewToken?: string }> {
  const maxBody = MAX_IMPORT_BYTES + 128 * 1024;
  if (Number(request.headers.get("content-length")) > maxBody) throw new ImportRequestError("Request exceeds the 2 MiB CSV limit", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ImportRequestError("CSV file is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > maxBody) { await reader.cancel(); throw new ImportRequestError("Request exceeds the 2 MiB CSV limit", 413); }
    chunks.push(next.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  let csv: unknown, mappings: unknown, confirmed: unknown, previewToken: unknown;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
    const file = form.get("file");
    if (!file || typeof file === "string" || !/\.csv$/i.test(file.name)) throw new ImportRequestError("Choose a .csv file");
    if (file.size > MAX_IMPORT_BYTES) throw new ImportRequestError("CSV exceeds the 2 MiB limit", 413);
    csv = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    mappings = form.has("mappings") ? JSON.parse(String(form.get("mappings"))) : undefined;
    confirmed = form.get("confirmReplace") === "true";
    previewToken = form.get("previewToken") ?? undefined;
  } else if (contentType.includes("application/json")) {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    csv = parsed.csv; mappings = parsed.mappings; confirmed = parsed.confirmReplace; previewToken = parsed.previewToken;
  } else throw new ImportRequestError("Use multipart/form-data or application/json");
  if (typeof csv !== "string" || !csv.trim()) throw new ImportRequestError("CSV content is required");
  if (mappings !== undefined && (!mappings || Array.isArray(mappings) || typeof mappings !== "object" || Object.values(mappings).some(value => value !== null && typeof value !== "string"))) throw new ImportRequestError("Mappings must be an object of destination field to source header");
  if (previewToken !== undefined && typeof previewToken !== "string") throw new ImportRequestError("Invalid preview token");
  return { csv, mappings: mappings as ColumnMappings | undefined, confirmed: confirmed === true, previewToken: previewToken as string | undefined };
}
export function importPreviewToken(csv: string, mappings?: ColumnMappings) {
  return createHash("sha256").update(csv).update(JSON.stringify(Object.entries(mappings ?? {}).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}
