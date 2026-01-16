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
}

export interface FeedValidationSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
}

export interface ValidatorModule<T extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  name: string;
  description: string;
  version: string;
  supportedFormats: ("jsonl" | "csv")[];
  schema: T;
  validateRecord: (record: Record<string, unknown>, row: number) => RecordValidationResult;
}

export type FileFormat = "jsonl" | "csv" | "jsonl.gz" | "csv.gz";

export interface ParsedFile {
  format: FileFormat;
  records: AsyncGenerator<Record<string, unknown>, void, unknown>;
  totalLines?: number;
}
