import { z } from "zod";
import { factDateError, invalidIntervals } from "@/lib/dataset-temporal";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_EVENTS = 10000;
export const IMPORT_COLUMNS = [
  ["customer_id", true, "Stable source customer ID; names may change"],
  ["name", true, "Customer/company name"],
  ["domain", false, "Website domain"],
  ["industry", true, "Industry; use Not supplied when unknown"],
  ["company_size", true, "Company size; use Not supplied when unknown"],
  ["country", true, "Country; use Not supplied when unknown"],
  ["acquisition_channel", true, "Acquisition channel; use Not supplied when unknown"],
  ["status", true, "active, churned, lead or reactivated at as_of"],
  ["as_of", true, "Dataset observation date: YYYY-MM-DD, same on every row"],
  ["currency", true, "USD only; no currency conversion is performed"],
  ["customer_created_at", true, "Actual customer creation date: YYYY-MM-DD"],
  ["subscription_id", false, "Stable interval ID; use a different ID for each price/plan interval or reactivation"],
  ["plan_id", false, "Stable catalog plan ID; recommended to track renames with SCD2"],
  ["plan_base_price", false, "Optional actual catalog base price in USD; blank stays unknown"],
  ["plan_seat_price", false, "Optional actual catalog seat price in USD; blank stays unknown"],
  ["plan_name", false, "Exact plan name; required for a subscription"],
  ["billing_interval", false, "monthly or annual; MRR must still be monthly"],
  ["seats", false, "Positive integer; required for a subscription"],
  ["mrr", false, "Monthly recurring revenue in USD; never ARR or cash"],
  ["subscription_started_at", false, "Actual start: YYYY-MM-DD; required for a subscription"],
  ["subscription_ended_at", false, "Actual end: YYYY-MM-DD; required when churned"],
  ["invoice_id", false, "Stable source invoice ID; required with an invoice"],
  ["invoice_amount", false, "Invoice face value, not MRR or confirmed cash"],
  ["invoice_status", false, "paid, open, failed or void"],
  ["invoice_date", false, "Actual invoice date: YYYY-MM-DD"],
  ["invoice_paid_at", false, "Actual paid date if known; blank stays unknown"],
  ["invoice_failed_at", false, "Actual failure date if known; blank stays unknown"],
  ["event_id", false, "Stable source event/group ID"],
  ["event_name", false, "Observed product event name"],
  ["event_count", false, "Observed events on event_date: 1–1000"],
  ["event_date", false, "Actual event date: YYYY-MM-DD"],
] as const;
export type ImportColumn = typeof IMPORT_COLUMNS[number][0];
export type ColumnMappings = Partial<Record<ImportColumn, string | null>>;
export interface ValidationError { row: number; field: string; message: string; value?: string }
const text = z.string().min(1).max(200);
const optionalText = text.optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return value >= "0001-01-01" && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");
const money = z.string().regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/, "Use a non-negative decimal with at most 2 decimals; no commas, currency signs, exponent or ARR").transform(Number);
const integer = z.string().regex(/^[1-9]\d*$/, "Use a positive whole number").transform(Number);
export const CustomerCsvRow = z.object({
  customer_id: text, name: text, domain: optionalText,
  industry: text, company_size: text, country: text, acquisition_channel: text,
  status: z.enum(["lead", "active", "churned", "reactivated"]),
  as_of: date, currency: z.literal("USD", { error: "Only USD is supported; do not relabel another currency" }),
  customer_created_at: date,
  subscription_id: optionalText, plan_id: optionalText, plan_base_price: money.optional(), plan_seat_price: money.optional(), plan_name: optionalText, billing_interval: z.enum(["monthly", "annual"]).optional(),
  seats: integer.pipe(z.number().max(100000)).optional(), mrr: money.optional(),
  subscription_started_at: date.optional(), subscription_ended_at: date.optional(),
  invoice_id: optionalText, invoice_amount: money.optional(),
  invoice_status: z.enum(["paid", "open", "failed", "void"]).optional(), invoice_date: date.optional(),
  invoice_paid_at: date.optional(), invoice_failed_at: date.optional(),
  event_id: optionalText, event_name: optionalText,
  event_count: integer.pipe(z.number().max(1000)).optional(), event_date: date.optional(),
}).superRefine((row, ctx) => {
  const error = (field: ImportColumn, message: string) => ctx.addIssue({ code: "custom", path: [field], message });
  if (row.as_of > new Date().toISOString().slice(0, 10)) error("as_of", "Observation date cannot be in the future");
  const subFields = ["plan_name", "billing_interval", "seats", "mrr", "subscription_started_at"] as const;
  const hasSub = [...subFields, "subscription_ended_at" as const, "subscription_id" as const, "plan_id" as const, "plan_base_price" as const, "plan_seat_price" as const].some(field => row[field] !== undefined);
  if (hasSub) {
    for (const field of subFields) if (row[field] === undefined) error(field, "Required for a subscription");
    if (row.status === "lead") error("status", "A lead cannot have a subscription in this format");
    if (row.status === "churned" && !row.subscription_ended_at) error("subscription_ended_at", "Required for a currently churned customer");
    if (row.subscription_started_at && row.subscription_ended_at && row.subscription_ended_at <= row.subscription_started_at) error("subscription_ended_at", "End must be later than start");
    if (row.subscription_started_at && row.subscription_started_at < row.customer_created_at) error("subscription_started_at", "Start cannot precede customer creation");
  } else if (row.status !== "lead") error("plan_name", "A non-lead needs an explicitly dated subscription");
  const invoiceFields = ["invoice_id", "invoice_amount", "invoice_status", "invoice_date"] as const;
  if ([...invoiceFields, "invoice_paid_at" as const, "invoice_failed_at" as const].some(field => row[field] !== undefined)) {
    for (const field of invoiceFields) if (row[field] === undefined) error(field, "Required for an invoice");
    if (row.invoice_paid_at && row.invoice_status !== "paid") error("invoice_paid_at", "Paid date requires paid invoice status");
    if (row.invoice_failed_at && row.invoice_status !== "failed" && row.invoice_status !== "paid") error("invoice_failed_at", "Failure date requires failed or later-paid invoice status");
    for (const field of ["invoice_paid_at", "invoice_failed_at"] as const) if (row[field] && row.invoice_date && row[field]! < row.invoice_date) error(field, "Cannot precede invoice date");
    if (row.invoice_paid_at && row.invoice_failed_at && row.invoice_paid_at < row.invoice_failed_at) error("invoice_paid_at", "Cannot be paid before a supplied failure");
  }
  const eventFields = ["event_id", "event_name", "event_count", "event_date"] as const;
  if (eventFields.some(field => row[field] !== undefined)) for (const field of eventFields) if (row[field] === undefined) error(field, "Required for an event");
  for (const field of ["customer_created_at", "subscription_started_at", "subscription_ended_at", "invoice_date", "invoice_paid_at", "invoice_failed_at", "event_date"] as const) {
    if (factDateError(row[field], row.as_of)) error(field, "Date cannot be after dataset as_of");
  }
  if (row.invoice_date && row.invoice_date < row.customer_created_at) error("invoice_date", "Invoice cannot precede customer creation");
  if (row.event_date && row.event_date < row.customer_created_at) error("event_date", "Event cannot precede customer creation");
});
export type CustomerCsvRow = z.infer<typeof CustomerCsvRow>;
export const planSourceKey = (row: Pick<CustomerCsvRow, "plan_id" | "plan_name" | "billing_interval">) => JSON.stringify(row.plan_id ? [row.plan_id] : [row.plan_name, row.billing_interval]);
// A blank ID preserves v1 single-interval identity; explicit IDs distinguish dated changes.
export const subscriptionSourceKey = (row: CustomerCsvRow) => JSON.stringify([row.customer_id, row.subscription_id ?? null]);
export interface ImportValidationResult {
  validRows: CustomerCsvRow[]; errors: ValidationError[];
  summary: {
    totalRows: number; validRows: number; errorRows: number; customers: number; subscriptions: number;
    invoices: number; events: number; mrr: number; invoiceTotal: number; asOf: string | null; currency: "USD";
  };
}

// ponytail: bounded comma CSV only; reject malformed quoting instead of guessing a dialect.
export function parseCSV(content: string): { headers: string[]; rows: string[][]; rowNumbers: number[] } {
  if (new TextEncoder().encode(content).length > MAX_IMPORT_BYTES) throw new Error("CSV exceeds the 2 MiB limit");
  const records: string[][] = [], rowNumbers: number[] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false, line = 1, startLine = 1;
  const input = content.replace(/^\uFEFF/, "");
  const finishRecord = () => {
    row.push(cell.trim());
    if (row.some(value => value !== "")) { records.push(row); rowNumbers.push(startLine); }
    if (records.length > MAX_IMPORT_ROWS + 1) throw new Error(`CSV exceeds ${MAX_IMPORT_ROWS} data rows`);
    row = []; cell = ""; closed = false;
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === "\0") throw new Error(`Row ${line}: NUL characters are not supported`);
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; }
      } else { cell += char; if (char === "\n") line++; }
    } else if (char === '"') {
      if (cell.length || closed) throw new Error(`Row ${line}: unexpected quote`);
      quoted = true;
    } else if (char === ",") { row.push(cell.trim()); cell = ""; closed = false; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      finishRecord(); line++; startLine = line;
    } else {
      if (closed) throw new Error(`Row ${line}: unexpected text after closing quote`);
      cell += char;
    }
  }
  if (quoted) throw new Error(`Row ${startLine}: unclosed quoted field`);
  if (cell || row.length || closed) finishRecord();
  if (records.length < 2) throw new Error("CSV needs a header and at least one data row");
  const headers = records.shift()!;
  rowNumbers.shift();
  if (headers.some(header => !header) || new Set(headers.map(normalizeHeader)).size !== headers.length) throw new Error("CSV headers must be non-empty and unique");
  return { headers, rows: records, rowNumbers };
}
const normalizeHeader = (header: string) => header.trim().toLowerCase().replace(/[ -]/g, "_");
export function detectColumns(headers: string[]) {
  return IMPORT_COLUMNS.map(([column]) => ({ column,
    sourceHeader: headers.find(header => normalizeHeader(header) === column) ?? null,
    confidence: headers.some(header => normalizeHeader(header) === column) ? 100 : 0,
  }));
}
export function validateImportCSV(content: string, mappings?: ColumnMappings): ImportValidationResult {
  const { headers, rows, rowNumbers } = parseCSV(content);
  const errors: ValidationError[] = [], validRows: CustomerCsvRow[] = [];
  const mapping: ColumnMappings = mappings ?? Object.fromEntries(detectColumns(headers).map(({ column, sourceHeader }) => [column, sourceHeader]));
  const used = new Set<string>();
  for (const [column, required] of IMPORT_COLUMNS) {
    const source = mapping[column];
    if (!source) { if (required) errors.push({ row: 1, field: column, message: "Required column is not mapped" }); continue; }
    if (!headers.includes(source)) errors.push({ row: 1, field: column, message: `Source header does not exist: ${source}` });
    if (used.has(source)) errors.push({ row: 1, field: column, message: "A source column cannot supply two different facts" });
    used.add(source);
    if (["mrr", "invoice_amount"].includes(column) && /(^|_)(arr|cash|revenue|balance)($|_)/.test(normalizeHeader(source)) && !["mrr", "monthly_recurring_revenue", "invoice_amount"].includes(normalizeHeader(source))) errors.push({ row: 1, field: column, message: "Ambiguous financial column: convert to explicit monthly MRR or invoice face value in your source first" });
  }
  const allowed = new Set(IMPORT_COLUMNS.map(([column]) => column));
  for (const key of Object.keys(mapping)) if (!allowed.has(key as ImportColumn)) errors.push({ row: 1, field: key, message: "Unsupported destination field" });
  for (const header of headers) if (!used.has(header) && rows.some(row => row[headers.indexOf(header)] !== "")) errors.push({ row: 1, field: header, message: "Unsupported or unmapped fact. Remove this column or map it explicitly; no non-empty data is silently discarded" });
  const customers = new Map<string, string>(), subscriptions = new Map<string, CustomerCsvRow>();
  const customerRows = new Map<string, CustomerCsvRow>();
  const subscriptionLines = new Map<string, number>();
  const plans = new Map<string, CustomerCsvRow>();
  const invoices = new Map<string, CustomerCsvRow>(), events = new Map<string, CustomerCsvRow>();
  let asOf: string | null = null;
  const signature = (row: CustomerCsvRow, fields: readonly (keyof CustomerCsvRow)[]) => JSON.stringify(fields.map(field => row[field] ?? null));
  const customerFields = ["name", "domain", "industry", "company_size", "country", "acquisition_channel", "status", "customer_created_at"] as const;
  const subFields = ["plan_id", "plan_name", "billing_interval", "seats", "mrr", "subscription_started_at", "subscription_ended_at"] as const;
  const duplicate = (map: Map<string, CustomerCsvRow>, key: string, data: CustomerCsvRow, fields: readonly (keyof CustomerCsvRow)[], field: string, line: number) => {
    const previous = map.get(key);
    if (previous && signature(previous, fields) !== signature(data, fields)) errors.push({ row: line, field, message: "Conflicting records for the same source ID. Use a unique subscription_id for each dated price/plan interval; repeated IDs must have identical facts" });
    else map.set(key, data);
  };
  if (!errors.length) rows.forEach((values, index) => {
    const rowNumber = rowNumbers[index];
    if (values.length !== headers.length) { errors.push({ row: rowNumber, field: "row", message: `Expected ${headers.length} cells; found ${values.length}` }); return; }
    const raw: Record<string, string> = {};
    for (const [column] of IMPORT_COLUMNS) { const source = mapping[column]; if (source) { const value = values[headers.indexOf(source)]; if (value !== "") raw[column] = value; } }
    const parsed = CustomerCsvRow.safeParse(raw);
    if (!parsed.success) { for (const issue of parsed.error.issues) errors.push({ row: rowNumber, field: issue.path.join("."), message: issue.message }); return; }
    const data = parsed.data;
    if (asOf && asOf !== data.as_of) errors.push({ row: rowNumber, field: "as_of", message: "Use one observation date for the entire dataset" }); else asOf = data.as_of;
    const customerSignature = signature(data, customerFields);
    if (customers.has(data.customer_id) && customers.get(data.customer_id) !== customerSignature) errors.push({ row: rowNumber, field: "customer_id", message: "Customer facts must agree across repeated rows" });
    else customers.set(data.customer_id, customerSignature);
    customerRows.set(data.customer_id, data);
    if (data.plan_name) {
      duplicate(plans, planSourceKey(data), data, ["plan_name","billing_interval","plan_base_price","plan_seat_price"], "plan_id", rowNumber);
      const key = subscriptionSourceKey(data);
      duplicate(subscriptions, key, data, subFields, "subscription_started_at", rowNumber);
      subscriptionLines.set(key, rowNumber);
    }
    if (data.invoice_id) duplicate(invoices, data.invoice_id, data, ["customer_id", "subscription_id", "subscription_started_at", "invoice_amount", "invoice_status", "invoice_date", "invoice_paid_at", "invoice_failed_at"], "invoice_id", rowNumber);
    if (data.event_id) duplicate(events, data.event_id, data, ["customer_id", "event_name", "event_count", "event_date"], "event_id", rowNumber);
    if (!errors.some(error => error.row === rowNumber)) validRows.push(data);
  });
  const byCustomer = new Map<string, CustomerCsvRow[]>();
  for (const row of subscriptions.values()) {
    const intervals = byCustomer.get(row.customer_id) ?? [];
    intervals.push(row); byCustomer.set(row.customer_id, intervals);
  }
  for (const [customerId, intervals] of byCustomer) {
    intervals.sort((a, b) => a.subscription_started_at!.localeCompare(b.subscription_started_at!));
    for (const current of invalidIntervals(intervals.map(row => ({ customerId, startedAt: row.subscription_started_at!, endedAt: row.subscription_ended_at ?? null, row })))) errors.push({ row: subscriptionLines.get(subscriptionSourceKey(current.row))!, field: "subscription_started_at", message: "Subscription intervals for one customer cannot overlap. End the previous interval on or before the next start; simultaneous subscriptions are not supported by this CSV format" });
    const customer = customerRows.get(customerId)!;
    const ongoing = intervals.filter(row => !row.subscription_ended_at);
    if (["active", "reactivated"].includes(customer.status) && !ongoing.length) errors.push({ row: subscriptionLines.get(subscriptionSourceKey(intervals[intervals.length - 1]))!, field: "status", message: "An active or reactivated customer must have an ongoing subscription interval at as_of" });
  }
  const eventCount = [...events.values()].reduce((sum, row) => sum + (row.event_count ?? 0), 0);
  if (eventCount > MAX_IMPORT_EVENTS) errors.push({ row: 1, field: "event_count", message: `At most ${MAX_IMPORT_EVENTS} total events per dataset` });
  const cents = (value: number) => Math.round(value * 100);
  return { validRows, errors, summary: {
    totalRows: rows.length, validRows: validRows.length, errorRows: new Set(errors.map(error => error.row)).size,
    customers: customers.size, subscriptions: [...subscriptions.values()].filter(row => row.plan_name).length,
    invoices: invoices.size, events: eventCount,
    mrr: [...subscriptions.values()].filter(row => row.plan_name && !row.subscription_ended_at).reduce((sum, row) => sum + cents(row.mrr ?? 0), 0) / 100,
    invoiceTotal: [...invoices.values()].reduce((sum, row) => sum + cents(row.invoice_amount ?? 0), 0) / 100,
    asOf, currency: "USD",
  } };
}
export const TEMPLATE_CSV = `customer_id,name,domain,industry,company_size,country,acquisition_channel,status,as_of,currency,customer_created_at,plan_name,billing_interval,seats,mrr,subscription_started_at,subscription_ended_at,invoice_id,invoice_amount,invoice_status,invoice_date,invoice_paid_at,invoice_failed_at,event_id,event_name,event_count,event_date
sample-001,"Café North, Ltd",cafe.example,Software,1-10,CA,referral,active,2026-09-30,USD,2026-01-05,Studio,monthly,3,125.50,2026-01-10,,invoice-001,125.50,paid,2026-09-01,2026-09-02,,event-001,report_viewed,3,2026-09-28
sample-002,Harbor Labs,harbor.example,Education,11-50,GB,organic,churned,2026-09-30,USD,2026-02-01,Team,annual,5,240.00,2026-02-05,2026-09-15,invoice-002,240.00,failed,2026-09-01,,2026-09-03,event-002,report_viewed,1,2026-09-02
sample-003,Maple Studio,maple.example,Software,1-10,US,organic,active,2026-09-30,USD,2026-03-01,Studio,monthly,2,74.50,2026-03-05,,invoice-003,74.50,open,2026-09-15,,,,,,
`;
