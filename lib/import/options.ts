import { z } from "zod";
export const importOptionsSchema = z.object({
  mode: z.enum(["update", "new"]).default("update"),
  sourceName: z.string().trim().min(1).max(100).default("Local dataset"),
  historyStart: z.string().regex(/^\d{4}-\d{2}-01$/, "Choose the first complete coverage month").refine(value => {
    const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
  }).nullable().default(null),
  historyComplete: z.boolean().default(false),
}).refine(value => !value.historyComplete || !!value.historyStart, "Complete history needs a coverage start month");
export type ImportOptions = z.infer<typeof importOptionsSchema>;
