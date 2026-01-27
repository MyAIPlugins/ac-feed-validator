import { parseFileClient, detectFormat } from "@/lib/parsers";
import { getValidator, getValidatorIds } from "./registry";
import type { FeedValidationSummary, ValidationIssue } from "./types";

const MAX_ISSUES_RETURNED = 100;
const MAX_VALID_RECORDS_STORED = 10000;
const MAX_RAW_ISSUES_PREVIEW = 20;

// Summary of issues found in raw feed (before normalization)
export interface RawFeedIssue {
  field: string;
  originalValue: unknown;
  problem: string;
  fixedValue?: unknown;
  count: number;
  severity: "warning" | "info";
}

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
  rawIssues?: RawFeedIssue[];
  truncated: boolean;
  validRecordsTruncated?: boolean;
}

// Progress callback for validation
export interface ValidationProgress {
  totalRows: number;
  processedRows: number;
  validRows: number;
  invalidRows: number;
  errorCount: number;
  warningCount: number;
  isComplete: boolean;
  isCancelled: boolean;
}

export interface ValidateClientOptions {
  file: File;
  validatorId: string;
  includeValidRecords?: boolean;
  customMappings?: Record<string, string> | null;
  onProgress?: (progress: ValidationProgress) => void;
  signal?: AbortSignal;
  chunkSize?: number;
}

// Boolean fields that should be true booleans, not strings
const BOOLEAN_FIELDS = [
  "is_eligible_search",
  "is_eligible_checkout",
  "listing_has_variations",
  "accepts_returns",
  "accepts_exchanges",
  "is_digital",
];

// URL fields that should not contain localhost
const URL_FIELDS = ["url", "image_url", "seller_url", "return_policy", "seller_privacy_policy", "seller_tos", "warning_url"];

// Detect raw issues by comparing original values with what normalization produces
function detectRawIssues(
  record: Record<string, unknown>,
  fieldAliases: Record<string, string[]>,
  fieldNormalizers: Record<string, (value: unknown) => unknown>
): Array<{ field: string; original: unknown; fixed: unknown; problem: string; severity: "warning" | "info" }> {
  const issues: Array<{ field: string; original: unknown; fixed: unknown; problem: string; severity: "warning" | "info" }> = [];

  // Helper to get field value (checking aliases too)
  const getFieldValue = (fieldName: string): { value: unknown; actualField: string } | null => {
    if (record[fieldName] !== undefined) {
      return { value: record[fieldName], actualField: fieldName };
    }
    const aliases = fieldAliases[fieldName] ?? [];
    for (const alias of aliases) {
      if (record[alias] !== undefined) {
        return { value: record[alias], actualField: alias };
      }
    }
    return null;
  };

  // Check for booleans passed as strings
  for (const field of BOOLEAN_FIELDS) {
    const found = getFieldValue(field);
    if (found && typeof found.value === "string") {
      const strVal = found.value.toLowerCase();
      if (["true", "false", "1", "0"].includes(strVal)) {
        issues.push({
          field: found.actualField,
          original: found.value,
          fixed: ["true", "1"].includes(strVal),
          problem: `Boolean as string → will convert to ${["true", "1"].includes(strVal)}`,
          severity: "warning",
        });
      }
    }
  }

  // Check for localhost URLs
  for (const field of URL_FIELDS) {
    const found = getFieldValue(field);
    if (found && typeof found.value === "string") {
      const url = found.value.toLowerCase();
      if (url.includes("localhost") || url.includes("127.0.0.1")) {
        issues.push({
          field: found.actualField,
          original: found.value,
          fixed: undefined,
          problem: "URL contains localhost - may not pass OpenAI validation",
          severity: "warning",
        });
      }
    }
  }

  // Check for short return_window
  const returnWindow = getFieldValue("return_window");
  if (returnWindow) {
    const numVal = typeof returnWindow.value === "number"
      ? returnWindow.value
      : parseInt(String(returnWindow.value), 10);
    if (!isNaN(numVal) && numVal < 7) {
      issues.push({
        field: returnWindow.actualField,
        original: returnWindow.value,
        fixed: undefined,
        problem: `Return window is only ${numVal} day(s) - unusually short`,
        severity: "warning",
      });
    }
  }

  // Check field aliases - detect misnamed fields
  for (const [canonical, aliases] of Object.entries(fieldAliases)) {
    for (const alias of aliases) {
      if (record[alias] !== undefined && record[canonical] === undefined) {
        issues.push({
          field: alias,
          original: alias,
          fixed: canonical,
          problem: `Field "${alias}" renamed to "${canonical}"`,
          severity: "info",
        });
      }
    }
  }

  // Check normalizers - detect value transformations
  for (const [field, normalizer] of Object.entries(fieldNormalizers)) {
    // Find the actual field name (could be aliased)
    let actualField = field;
    let originalValue = record[field];

    if (originalValue === undefined) {
      const aliases = fieldAliases[field] ?? [];
      for (const alias of aliases) {
        if (record[alias] !== undefined) {
          actualField = alias;
          originalValue = record[alias];
          break;
        }
      }
    }

    if (originalValue !== undefined && originalValue !== null && originalValue !== "") {
      const normalized = normalizer(originalValue);
      if (normalized !== originalValue) {
        let problem = `Value normalized`;

        // Detect specific normalization types
        if (field === "price" || field === "sale_price" || field === "shipping_price") {
          problem = "Price format corrected (comma → dot)";
        } else if (field === "availability") {
          problem = "Availability format standardized";
        } else if (field === "return_window") {
          problem = "Return window extracted (days → number)";
        } else if (field === "condition") {
          problem = "Condition value translated";
        }

        issues.push({
          field: actualField,
          original: originalValue,
          fixed: normalized,
          problem,
          severity: "info",
        });
      }
    }
  }

  return issues;
}

export async function validateClient(options: ValidateClientOptions): Promise<ClientValidationResult> {
  const {
    file,
    validatorId,
    includeValidRecords = true,
    customMappings,
    onProgress,
    signal,
    chunkSize = 500,
  } = options;

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

  // Parse file - first pass to collect all records
  const parsed = await parseFileClient(file);
  const allRecords: Record<string, unknown>[] = [];
  for await (const record of parsed.records) {
    allRecords.push(record);
  }
  const totalRows = allRecords.length;

  const issues: ValidationIssue[] = [];
  const validRecords: Record<string, unknown>[] = [];

  // Track raw issues for preview (aggregated by type)
  const rawIssuesMap = new Map<string, RawFeedIssue>();

  let validRows = 0;
  let invalidRows = 0;
  let errorCount = 0;
  let warningCount = 0;
  let processedInChunk = 0;

  // Report initial progress
  onProgress?.({
    totalRows,
    processedRows: 0,
    validRows: 0,
    invalidRows: 0,
    errorCount: 0,
    warningCount: 0,
    isComplete: false,
    isCancelled: false,
  });

  // Process records in chunks
  for (let i = 0; i < allRecords.length; i++) {
    // Check for cancellation
    if (signal?.aborted) {
      onProgress?.({
        totalRows,
        processedRows: i,
        validRows,
        invalidRows,
        errorCount,
        warningCount,
        isComplete: false,
        isCancelled: true,
      });

      // Return partial results on cancellation
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
        success: false,
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
        rawIssues: Array.from(rawIssuesMap.values()),
        truncated: true,
        validRecordsTruncated: false,
      };
    }

    const record = allRecords[i];
    const row = i + 1;

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

    // Detect raw issues before normalization (only on first few rows for preview)
    if (row <= 10) {
      const rawDetected = detectRawIssues(
        mappedRecord,
        validator.fieldAliases,
        validator.fieldNormalizers
      );

      for (const issue of rawDetected) {
        const key = `${issue.field}:${issue.problem}`;
        const existing = rawIssuesMap.get(key);
        if (existing) {
          existing.count++;
        } else if (rawIssuesMap.size < MAX_RAW_ISSUES_PREVIEW) {
          rawIssuesMap.set(key, {
            field: issue.field,
            originalValue: issue.original,
            problem: issue.problem,
            fixedValue: issue.fixed,
            count: 1,
            severity: issue.severity,
          });
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

    processedInChunk++;

    // Yield to UI every chunk
    if (processedInChunk >= chunkSize) {
      processedInChunk = 0;

      // Report progress
      onProgress?.({
        totalRows,
        processedRows: i + 1,
        validRows,
        invalidRows,
        errorCount,
        warningCount,
        isComplete: false,
        isCancelled: false,
      });

      // Yield to browser
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // Final progress report
  onProgress?.({
    totalRows,
    processedRows: totalRows,
    validRows,
    invalidRows,
    errorCount,
    warningCount,
    isComplete: true,
    isCancelled: false,
  });

  const summary: FeedValidationSummary = {
    totalRows,
    validRows,
    invalidRows,
    errorCount,
    warningCount,
    issues,
    validRecords: includeValidRecords ? validRecords : undefined,
  };

  // Convert raw issues map to array
  const rawIssues = Array.from(rawIssuesMap.values());

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
    rawIssues: rawIssues.length > 0 ? rawIssues : undefined,
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

// Pre-validation result (quick check without full processing)
export interface PreValidationResult {
  totalRows: number;
  analyzedRows: number;
  validRows: number;
  invalidRows: number;
  rawIssues: RawFeedIssue[];
}

// Progress callback for chunked validation
export interface PreValidationProgress {
  totalRows: number;
  processedRows: number;
  validRows: number;
  invalidRows: number;
  isComplete: boolean;
  isCancelled: boolean;
}

export interface PreValidateOptions {
  file: File;
  validatorId: string;
  onProgress?: (progress: PreValidationProgress) => void;
  signal?: AbortSignal;
  chunkSize?: number;
}

// Chunked pre-validation with progress reporting
export async function preValidateClient(
  options: PreValidateOptions
): Promise<PreValidationResult> {
  const { file, validatorId, onProgress, signal, chunkSize = 500 } = options;

  const validator = getValidator(validatorId);
  if (!validator) {
    throw new Error(`Unknown validator: ${validatorId}`);
  }

  const parsed = await parseFileClient(file);
  const rawIssuesMap = new Map<string, RawFeedIssue>();

  let totalRows = 0;
  let validRows = 0;
  let invalidRows = 0;
  let processedInChunk = 0;

  // First pass: count total rows (quick scan)
  const allRecords: Record<string, unknown>[] = [];
  for await (const record of parsed.records) {
    allRecords.push(record);
  }
  totalRows = allRecords.length;

  // Report initial progress
  onProgress?.({
    totalRows,
    processedRows: 0,
    validRows: 0,
    invalidRows: 0,
    isComplete: false,
    isCancelled: false,
  });

  // Process in chunks with yielding to UI
  for (let i = 0; i < allRecords.length; i++) {
    // Check for cancellation
    if (signal?.aborted) {
      return {
        totalRows,
        analyzedRows: i,
        validRows,
        invalidRows,
        rawIssues: Array.from(rawIssuesMap.values()),
      };
    }

    const record = allRecords[i];
    const row = i + 1;

    // Detect raw issues (only first 20 rows for issue detection)
    if (row <= 20) {
      const rawDetected = detectRawIssues(
        record,
        validator.fieldAliases,
        validator.fieldNormalizers
      );

      for (const issue of rawDetected) {
        const key = `${issue.field}:${issue.problem}`;
        const existing = rawIssuesMap.get(key);
        if (existing) {
          existing.count++;
        } else if (rawIssuesMap.size < MAX_RAW_ISSUES_PREVIEW) {
          rawIssuesMap.set(key, {
            field: issue.field,
            originalValue: issue.original,
            problem: issue.problem,
            fixedValue: issue.fixed,
            count: 1,
            severity: issue.severity,
          });
        }
      }
    }

    // Validate record WITHOUT normalization to show raw feed state
    const validateFn = validator.validateRecordRaw ?? validator.validateRecord;
    const result = validateFn(record, row);
    if (result.isValid) {
      validRows++;
    } else {
      invalidRows++;
    }

    processedInChunk++;

    // Yield to UI every chunk
    if (processedInChunk >= chunkSize) {
      processedInChunk = 0;

      // Report progress
      onProgress?.({
        totalRows,
        processedRows: i + 1,
        validRows,
        invalidRows,
        isComplete: false,
        isCancelled: false,
      });

      // Yield to browser
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // Final progress report
  onProgress?.({
    totalRows,
    processedRows: totalRows,
    validRows,
    invalidRows,
    isComplete: true,
    isCancelled: false,
  });

  return {
    totalRows,
    analyzedRows: totalRows,
    validRows,
    invalidRows,
    rawIssues: Array.from(rawIssuesMap.values()),
  };
}
