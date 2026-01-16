import { NextResponse } from "next/server";
import { parseFile, detectFormat } from "@/lib/parsers";
import { getValidator, getValidatorIds } from "@/lib/validators/registry";
import type { FeedValidationSummary, ValidationIssue } from "@/lib/validators/types";

const MAX_ISSUES_RETURNED = 100;

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const validatorId = formData.get("validator") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    if (!validatorId) {
      return NextResponse.json(
        { error: "No validator specified", availableValidators: getValidatorIds() },
        { status: 400 }
      );
    }

    const validator = getValidator(validatorId);
    if (!validator) {
      return NextResponse.json(
        { error: `Unknown validator: ${validatorId}`, availableValidators: getValidatorIds() },
        { status: 400 }
      );
    }

    // Detect and validate file format
    let format: ReturnType<typeof detectFormat>;
    try {
      format = detectFormat(file.name);
    } catch {
      return NextResponse.json(
        { error: "Unsupported file format. Use .jsonl, .csv, .jsonl.gz, or .csv.gz" },
        { status: 400 }
      );
    }

    const baseFormat = format.replace(".gz", "") as "jsonl" | "csv";
    if (!validator.supportedFormats.includes(baseFormat)) {
      return NextResponse.json(
        { error: `Validator ${validatorId} does not support ${baseFormat} format` },
        { status: 400 }
      );
    }

    // Parse and validate
    const parsed = await parseFile(file);
    const issues: ValidationIssue[] = [];
    let totalRows = 0;
    let validRows = 0;
    let invalidRows = 0;
    let errorCount = 0;
    let warningCount = 0;

    let row = 1;
    for await (const record of parsed.records) {
      totalRows++;
      const result = validator.validateRecord(record, row);

      if (result.isValid) {
        validRows++;
      } else {
        invalidRows++;
      }

      for (const issue of result.issues) {
        if (issue.severity === "error") errorCount++;
        if (issue.severity === "warning") warningCount++;

        // Limit stored issues to prevent memory issues with large files
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
    };

    return NextResponse.json({
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Validation failed: ${message}` },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<Response> {
  const validators = getValidatorIds().map((id) => {
    const v = getValidator(id);
    return v ? {
      id: v.id,
      name: v.name,
      description: v.description,
      version: v.version,
      supportedFormats: v.supportedFormats,
    } : null;
  }).filter(Boolean);

  return NextResponse.json({ validators });
}
