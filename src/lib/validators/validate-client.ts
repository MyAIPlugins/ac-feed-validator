import { parseFileClient, detectFormat } from "@/lib/parsers";
import { getValidator, getValidatorIds } from "./registry";
import type { FeedValidationSummary, ValidationIssue } from "./types";

const MAX_ISSUES_RETURNED = 100;
const MAX_VALID_RECORDS_STORED = 10000;

export interface ClientValidationResult {
  success: boolean;
  validator: {
    id: string;
    name: string;
    version: string;
  };
  file: {
    name: string;
    format: string;
    size: number;
  };
  summary: FeedValidationSummary;
  truncated: boolean;
  validRecordsTruncated?: boolean;
}

export interface ValidateClientOptions {
  file: File;
  validatorId: string;
  includeValidRecords?: boolean;
  customMappings?: Record<string, string> | null;
}

export async function validateClient(options: ValidateClientOptions): Promise<ClientValidationResult> {
  const { file, validatorId, includeValidRecords = true, customMappings } = options;

  // Get validator
  const validator = getValidator(validatorId);
  if (!validator) {
    throw new Error(`Unknown validator: ${validatorId}. Available: ${getValidatorIds().join(", ")}`);
  }

  // Detect and validate file format
  let format: ReturnType<typeof detectFormat>;
  try {
    format = detectFormat(file.name);
  } catch {
    throw new Error("Unsupported file format. Use .jsonl, .csv, .jsonl.gz, or .csv.gz");
  }

  const baseFormat = format.replace(".gz", "") as "jsonl" | "csv";
  if (!validator.supportedFormats.includes(baseFormat)) {
    throw new Error(`Validator ${validatorId} does not support ${baseFormat} format`);
  }

  // Parse and validate
  const parsed = await parseFileClient(file);
  const issues: ValidationIssue[] = [];
  const validRecords: Record<string, unknown>[] = [];
  let totalRows = 0;
  let validRows = 0;
  let invalidRows = 0;
  let errorCount = 0;
  let warningCount = 0;

  let row = 1;
  for await (const record of parsed.records) {
    totalRows++;

    // Apply custom mappings if provided
    let mappedRecord = record;
    if (customMappings) {
      mappedRecord = {};
      for (const [sourceField, value] of Object.entries(record)) {
        const targetField = customMappings[sourceField];
        if (targetField) {
          mappedRecord[targetField] = value;
        } else {
          // Keep unmapped fields with original name
          mappedRecord[sourceField] = value;
        }
      }
    }

    const result = validator.validateRecord(mappedRecord, row);

    if (result.isValid) {
      validRows++;
      // Store valid normalized records for export
      if (includeValidRecords && validRecords.length < MAX_VALID_RECORDS_STORED && result.data) {
        validRecords.push(result.data);
      }
    } else {
      invalidRows++;
    }

    for (const issue of result.issues) {
      if (issue.severity === "error") errorCount++;
      if (issue.severity === "warning") warningCount++;

      if (issues.length < MAX_ISSUES_RETURNED) {
        issues.push(issue);
      }
    }

    row++;
  }

  const summary: FeedValidationSummary = {
    totalRows,
    validRows,
    invalidRows,
    errorCount,
    warningCount,
    issues,
    validRecords: includeValidRecords ? validRecords : undefined,
  };

  return {
    success: true,
    validator: {
      id: validator.id,
      name: validator.name,
      version: validator.version,
    },
    file: {
      name: file.name,
      format,
      size: file.size,
    },
    summary,
    truncated: errorCount + warningCount > MAX_ISSUES_RETURNED,
    validRecordsTruncated: includeValidRecords && validRows > MAX_VALID_RECORDS_STORED,
  };
}

// Get available validators (for client-side use)
export function getAvailableValidators() {
  return getValidatorIds().map((id) => {
    const v = getValidator(id);
    return v ? {
      id: v.id,
      name: v.name,
      description: v.description,
      version: v.version,
      supportedFormats: v.supportedFormats,
      fieldAliases: v.fieldAliases,
    } : null;
  }).filter(Boolean);
}
