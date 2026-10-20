import { IMPORT_COLUMNS, type ColumnMappings } from "./csv-validator";

export const MAPPING_STORAGE_KEY = "revlens:csv-column-mappings:v1";

// Store column names only. Files, values and customer records never enter browser storage.
export function reuseColumnMappings(headers: string[], detected: ColumnMappings, saved: string | null): ColumnMappings {
  if (!saved) return detected;
  try {
    const previous: unknown = JSON.parse(saved);
    if (!previous || typeof previous !== "object" || Array.isArray(previous)) return detected;
    const candidate = { ...detected };
    for (const [column] of IMPORT_COLUMNS) {
      const value = (previous as Record<string, unknown>)[column];
      if (typeof value === "string" && headers.includes(value)) candidate[column] = value;
    }
    // Different exports may reuse a header for another field. Never introduce ambiguous mapping.
    const values = Object.values(candidate).filter(Boolean);
    return new Set(values).size === values.length ? candidate : detected;
  } catch { return detected; }
}
