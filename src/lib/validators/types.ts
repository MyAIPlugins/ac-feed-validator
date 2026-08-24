import type { z } from "zod";

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  row: number;
  field: string;
  message: string;
  severity: ValidationSeverity;
  value?: unknown;
}

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
}

export interface RecordValidationResult {
  row: number;
  isValid: boolean;
  issues: ValidationIssue[];
  data?: Record<string, unknown>;
  normalized?: Record<string, unknown>;
}

export interface FeedValidationSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
  validRecords?: Record<string, unknown>[];
}

// Field mapping: target field -> list of possible source field names
export type FieldAliases = Record<string, string[]>;

// Normalizer function: transforms a value before validation
export type FieldNormalizer = (value: unknown) => unknown;

// Field normalizers: target field -> normalizer function
export type FieldNormalizers = Record<string, FieldNormalizer>;

// Target field metadata for the field-mapping dialog: name, whether it's
// required, and a short human-readable description.
export type TargetField = { name: string; required: boolean; description?: string };

// Known-wrong-but-plausible source column names that silently do nothing
// once mapped (e.g. "is_ads_enabled" instead of "is_ads_eligible" - OpenAI
// ignores it, Zod strips it, and the user gets no signal it was a no-op).
// Maps the trap column name -> a human-readable warning to surface it.
export type TrapAliases = Record<string, string>;

export interface ValidatorModule<T extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  name: string;
  description: string;
  version: string;
  supportedFormats: ("jsonl" | "csv")[];
  schema: T;
  fieldAliases: FieldAliases;
  fieldNormalizers: FieldNormalizers;
  defaultValues?: Record<string, unknown>;
  // Fields the field-mapping dialog should offer as mapping targets for
  // THIS validator. Each validator supplies its own list so the dialog
  // never falls out of sync with a schema it doesn't own.
  targetFields: TargetField[];
  trapAliases?: TrapAliases;
  // Field names whose schema is boolean-typed - drives the "boolean sent as
  // string" raw-issue warning. Owned per-validator (next to the schema that
  // declares them) instead of a hardcoded list in validate-client.ts, so a
  // new boolean field can't be added to a schema without also being wired
  // up for that warning.
  booleanFields: string[];
  validateRecord: (record: Record<string, unknown>, row: number) => RecordValidationResult;
  // Validate without applying normalizations (for raw feed analysis)
  validateRecordRaw?: (record: Record<string, unknown>, row: number) => RecordValidationResult;
}

export type FileFormat = "jsonl" | "csv" | "jsonl.gz" | "csv.gz";

export interface ParsedFile {
  format: FileFormat;
  records: AsyncGenerator<Record<string, unknown>, void, unknown>;
  totalLines?: number;
}

// Utility to apply field mappings and normalizations
export function normalizeRecord(
  record: Record<string, unknown>,
  aliases: FieldAliases,
  normalizers: FieldNormalizers,
  defaults?: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  // First, map aliased fields to canonical names
  for (const [canonicalName, aliasList] of Object.entries(aliases)) {
    // Check canonical name first
    if (record[canonicalName] !== undefined && record[canonicalName] !== "") {
      normalized[canonicalName] = record[canonicalName];
    } else {
      // Check aliases
      for (const alias of aliasList) {
        if (record[alias] !== undefined && record[alias] !== "") {
          normalized[canonicalName] = record[alias];
          break;
        }
      }
    }
  }

  // Copy any fields that weren't in the alias map
  for (const [key, value] of Object.entries(record)) {
    if (!(key in normalized)) {
      // Check if this key is an alias for something
      let isAlias = false;
      for (const aliasList of Object.values(aliases)) {
        if (aliasList.includes(key)) {
          isAlias = true;
          break;
        }
      }
      if (!isAlias) {
        normalized[key] = value;
      }
    }
  }

  // Apply default values for missing fields
  if (defaults) {
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (normalized[key] === undefined || normalized[key] === "") {
        normalized[key] = defaultValue;
      }
    }
  }

  // Apply normalizers to transform values
  for (const [field, normalizer] of Object.entries(normalizers)) {
    if (normalized[field] !== undefined) {
      normalized[field] = normalizer(normalized[field]);
    }
  }

  return normalized;
}
