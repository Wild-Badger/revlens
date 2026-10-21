import { z } from "zod";
import { coverageError } from "@/lib/dataset-temporal";
export const importOptionsSchema = z.object({
  mode: z.enum(["update", "new"]).default("update"),
  sourceName: z.string().trim().min(1).max(100).default("Local dataset"),
  historyStart: z.string().regex(/^\d{4}-\d{2}-01$/, "Choose the first complete coverage month").refine(value => {
    const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
  }).nullable().default(null),
  historyComplete: z.boolean().default(false),
  expectedRevision: z.number().int().min(0).max(2147483647).optional(),
}).refine(value => !coverageError("9999-12-31", value.historyStart, value.historyComplete), "Complete history needs a valid coverage start month");
export type ImportOptions = z.infer<typeof importOptionsSchema>;
