// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), prisma: { $transaction: vi.fn() } }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
import { TEMPLATE_CSV, detectColumns, parseCSV } from "@/lib/import/csv-validator";
import { importPreviewToken, readImportRequest, requireLocalImport } from "@/lib/import/request";
import { POST as columns } from "@/app/api/import/columns/route";
import { POST as validate } from "@/app/api/import/validate/route";
import { POST as commit } from "@/app/api/import/commit/route";
import { POST as legacy } from "@/app/api/import/customers/route";

const request = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://127.0.0.1:3101/api/import/${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.stubEnv("LOCAL_WORKSPACE_MODE", "true"); vi.stubEnv("DEMO_MODE", "false"); vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("AUTH_URL", "");
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { role: "admin" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("import preview and write boundary", () => {
  it("uses the configured browser origin when Next exposes an internal localhost URL", async () => {
    vi.stubEnv("AUTH_URL", "http://127.0.0.1:3101");
    const local = (origin: string) => new Request("http://localhost:3101/api/import/columns", { method: "POST", headers: { origin, "content-type": "application/json", host: "127.0.0.1:3102", "x-forwarded-host": "127.0.0.1:3102", "x-forwarded-proto": "http" }, body: JSON.stringify({ csv: TEMPLATE_CSV }) });
    expect((await columns(local("http://127.0.0.1:3101"))).status).toBe(200);
    expect((await columns(local("http://127.0.0.1:3102"))).status).toBe(403);
    expect((await columns(local("http://localhost:3101"))).status).toBe(403);
    expect((await columns(local("https://example.test"))).status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("requires a dedicated local, correctly configured, authenticated owner and same origin", async () => {
    const req = request("validate", { csv: TEMPLATE_CSV });
    await expect(requireLocalImport(req)).resolves.toBeUndefined();
    mocks.auth.mockResolvedValue(null); await expect(requireLocalImport(req)).rejects.toMatchObject({ status: 401 });
    mocks.auth.mockResolvedValue({ user: { role: "viewer" } }); await expect(requireLocalImport(req)).rejects.toMatchObject({ status: 403 });
    mocks.auth.mockResolvedValue({ user: { role: "admin" } });
    await expect(requireLocalImport(request("commit", {}, { origin: "https://another.example" }))).rejects.toMatchObject({ status: 403 });
    await expect(requireLocalImport(new Request("https://public.example/api/import/commit"))).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("DEMO_MODE", "true"); expect((await validate(request("validate", { csv: TEMPLATE_CSV }))).status).toBe(403);
    vi.stubEnv("DEMO_MODE", "false"); vi.stubEnv("LOCAL_WORKSPACE_MODE", "false"); expect((await commit(request("commit", { csv: TEMPLATE_CSV }))).status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("detects missing required columns; validates actual edited mapping, totals and token", async () => {
    const detected = await (await columns(request("columns", { csv: "name\nOnly a name" }))).json();
    expect(detected.hasRequiredColumns).toBe(false); expect(detected.missingRequiredColumns).toContain("as_of");
    const source = TEMPLATE_CSV.replace(",mrr,", ",Monthly value,");
    const { headers } = parseCSV(source);
    const mappings = Object.fromEntries(detectColumns(headers).map(item => [item.column, item.sourceHeader]));
    mappings.mrr = "Monthly value";
    const response = await validate(request("validate", { csv: source, mappings }));
    const preview = await response.json();
    expect(response.status).toBe(200); expect(preview.success).toBe(true);
    expect(preview.summary.mrr).toBe(200); expect(preview.validRows[0].mrr).toBe(125.5);
    expect(preview.previewToken).toBe(importPreviewToken(source, mappings));
    expect(importPreviewToken(source, mappings)).not.toBe(importPreviewToken(source, { ...mappings, mrr: null }));
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("refuses an unreviewed or changed file, validation errors and the alternate legacy writer", async () => {
    const previewToken = importPreviewToken(TEMPLATE_CSV);
    expect((await commit(request("commit", { csv: TEMPLATE_CSV, previewToken }))).status).toBe(400);
    expect((await commit(request("commit", { csv: TEMPLATE_CSV, confirmReplace: true, previewToken: "old" }))).status).toBe(400);
    const malformed = TEMPLATE_CSV.replace("125.50", "bad");
    const result = await commit(request("commit", { csv: malformed, confirmReplace: true, previewToken: importPreviewToken(malformed) }));
    expect(result.status).toBe(400); expect((await result.json()).errors.length).toBeGreaterThan(0);
    const brokenCsv = 'name\n"unclosed';
    expect((await commit(request("commit", { csv: brokenCsv, confirmReplace: true, previewToken: importPreviewToken(brokenCsv) }))).status).toBe(400);
    expect((await legacy()).status).toBe(410); expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("previews dated price changes as two intervals for one customer without writing", async () => {
    const { headers, rows } = parseCSV(TEMPLATE_CSV);
    headers.push("subscription_id");
    const before = [...rows[0], "before"], after = [...rows[0], "after"];
    for (const row of [before, after]) for (const field of headers.filter(header => header.startsWith("invoice_") || header.startsWith("event_"))) row[headers.indexOf(field)] = "";
    before[headers.indexOf("subscription_ended_at")] = "2026-08-01";
    after[headers.indexOf("subscription_started_at")] = "2026-08-01";
    after[headers.indexOf("mrr")] = "200";
    const csv = [headers, before, after].map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const response = await validate(request("validate", { csv }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.summary).toMatchObject({ customers: 1, subscriptions: 2, mrr: 200 });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("reads a real multipart file and bounds body bytes before parsing", async () => {
    const body = new FormData(); body.append("file", new File([TEMPLATE_CSV], "records.csv", { type: "text/csv" }));
    body.append("mappings", JSON.stringify({ mrr: "mrr" })); body.append("confirmReplace", "true");
    const parsed = await readImportRequest(new Request("http://localhost/api/import/validate", { method: "POST", body }));
    expect(parsed.csv).toBe(TEMPLATE_CSV); expect(parsed.mappings).toEqual({ mrr: "mrr" }); expect(parsed.confirmed).toBe(true);
    const tooBig = request("validate", { csv: "x".repeat(3 * 1024 * 1024) });
    await expect(readImportRequest(tooBig)).rejects.toMatchObject({ status: 413 });
  });
});
