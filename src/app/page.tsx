"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FileUpload } from "@/components/file-upload";
import { ValidatorSelect } from "@/components/validator-select";
import { ValidationResults } from "@/components/validation-results";
import { FieldMappingDialog } from "@/components/field-mapping-dialog";
import { PreValidationDialog, type PreValidationProgress } from "@/components/pre-validation-dialog";
import { ValidationProgressDialog } from "@/components/validation-progress-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { extractHeadersClient } from "@/lib/parsers";
import { validateClient, preValidateClient, getAvailableValidators, type ClientValidationResult, type PreValidationResult, type ValidationProgress } from "@/lib/validators/validate-client";
import type { TargetField } from "@/lib/validators/types";

interface Validator {
  id: string;
  name: string;
  description: string;
  version: string;
  supportedFormats: string[];
  fieldAliases?: Record<string, string[]>;
  // Each validator supplies its own mapping-dialog target fields, so the
  // dialog stays correct when a second (or third) validator is added instead
  // of silently reusing whichever one was hardcoded first. getAvailableValidators()
  // always includes this now, so it's not optional here.
  targetFields: TargetField[];
}

export default function Home() {
  const [validators, setValidators] = useState<Validator[]>([]);
  const [selectedValidator, setSelectedValidator] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<ClientValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Field mapping dialog state
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [sourceHeaders, setSourceHeaders] = useState<string[]>([]);
  const [customMappings, setCustomMappings] = useState<Record<string, string> | null>(null);

  // Pre-validation state
  const [preValidation, setPreValidation] = useState<PreValidationResult | null>(null);
  const [isPreValidating, setIsPreValidating] = useState(false);
  const [preValidationProgress, setPreValidationProgress] = useState<PreValidationProgress | null>(null);
  const [showPreValidationDialog, setShowPreValidationDialog] = useState(false);
  const preValidationAbortRef = useRef<AbortController | null>(null);

  // Final validation progress state
  const [validationProgress, setValidationProgress] = useState<ValidationProgress | null>(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const validationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Load validators client-side (no API call needed)
    const availableValidators = getAvailableValidators() as Validator[];
    setValidators(availableValidators);
    if (availableValidators.length > 0) {
      setSelectedValidator(availableValidators[0].id);
    }
  }, []);

  // Runs pre-validation for a given file against a given validator id. Pulled
  // out of handleFileSelect so handleValidatorChange can also trigger it when
  // the user switches validators after a file is already selected - without
  // this, switching validators left stale pre-validation results (computed
  // against the OLD validator) on screen.
  const runPreValidation = async (selectedFile: File, validatorId: string) => {
    preValidationAbortRef.current?.abort();
    preValidationAbortRef.current = new AbortController();

    setIsPreValidating(true);
    setShowPreValidationDialog(true);
    setPreValidationProgress(null);

    try {
      const preResult = await preValidateClient({
        file: selectedFile,
        validatorId,
        signal: preValidationAbortRef.current.signal,
        onProgress: (progress) => {
          setPreValidationProgress(progress);
        },
      });
      setPreValidation(preResult);
    } catch (preErr) {
      if (preErr instanceof Error && preErr.name !== "AbortError") {
        console.error("Pre-validation failed:", preErr);
      }
    } finally {
      setIsPreValidating(false);
      setShowPreValidationDialog(false);
    }
  };

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setResult(null);
    setError(null);
    setCustomMappings(null);
    setPreValidation(null);

    // Extract headers for mapping dialog
    try {
      const headers = await extractHeadersClient(selectedFile);
      setSourceHeaders(headers);

      if (selectedValidator) {
        await runPreValidation(selectedFile, selectedValidator);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file headers");
    }
  };

  // Switching validators changes the schema (and boolean/trap-alias rules)
  // records are checked against, so any result computed under the previous
  // validator is stale and must be cleared - then re-run pre-validation
  // against the new validator if a file is already selected.
  const handleValidatorChange = (id: string) => {
    setSelectedValidator(id);
    if (file) {
      setResult(null);
      setError(null);
      setCustomMappings(null);
      setPreValidation(null);
      void runPreValidation(file, id);
    }
  };

  const handleCancelPreValidation = () => {
    preValidationAbortRef.current?.abort();
    setShowPreValidationDialog(false);
    setIsPreValidating(false);
  };

  const handleShowMapping = () => {
    if (sourceHeaders.length > 0) {
      setShowMappingDialog(true);
    }
  };

  const handleMappingConfirm = (mappings: Record<string, string>) => {
    setCustomMappings(mappings);
    setShowMappingDialog(false);
    // Auto-validate after confirming mappings
    handleValidateWithMappings(mappings);
  };

  const handleValidateWithMappings = async (mappings: Record<string, string> | null) => {
    if (!file || !selectedValidator) return;

    // Cancel any existing validation
    validationAbortRef.current?.abort();
    validationAbortRef.current = new AbortController();

    setIsValidating(true);
    setError(null);
    setResult(null);
    setShowValidationDialog(true);
    setValidationProgress(null);

    try {
      // 100% client-side validation - no data leaves the browser
      const validationResult = await validateClient({
        file,
        validatorId: selectedValidator,
        includeValidRecords: true,
        customMappings: mappings,
        signal: validationAbortRef.current.signal,
        onProgress: (progress) => {
          setValidationProgress(progress);
        },
      });

      setResult(validationResult);
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      setIsValidating(false);
      setShowValidationDialog(false);
    }
  };

  const handleCancelValidation = () => {
    validationAbortRef.current?.abort();
    setShowValidationDialog(false);
    setIsValidating(false);
  };

  const handleValidate = () => {
    handleValidateWithMappings(customMappings);
  };

  const handleExport = useCallback(async () => {
    if (!result?.summary.validRecords?.length) return;

    setIsExporting(true);
    try {
      const jsonlContent = result.summary.validRecords
        .map((record) => JSON.stringify(record))
        .join("\n");

      const blob = new Blob([jsonlContent], { type: "application/json" });
      const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
      const compressedBlob = await new Response(stream).blob();

      const url = URL.createObjectURL(compressedBlob);
      const a = document.createElement("a");
      a.href = url;
      const baseName = result.file.name.replace(/\.(jsonl|csv)(\.gz)?$/i, "");
      a.download = `${baseName}-validated.jsonl.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }, [result]);

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setSourceHeaders([]);
    setCustomMappings(null);
    setPreValidation(null);
  };

  const currentValidator = validators.find((v) => v.id === selectedValidator);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-white dark:from-slate-900 dark:via-blue-950 dark:to-slate-950">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
        {/* Header */}
        <div className="space-y-4">
          <div className="flex justify-end">
            <ThemeToggle />
          </div>
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Open Source
            </div>
            <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
              AI Feed Validator
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Validate, normalize, and export product feeds for AI commerce platforms.
              Supports OpenAI, with more coming soon.
            </p>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid gap-6">
          {/* Step 1: Select Validator */}
          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                  1
                </div>
                <div>
                  <CardTitle>Select Feed Format</CardTitle>
                  <CardDescription>Choose the target platform for validation</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ValidatorSelect
                validators={validators}
                selected={selectedValidator}
                onSelect={handleValidatorChange}
                disabled={isValidating}
              />
            </CardContent>
          </Card>

          {/* Step 2: Upload File */}
          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                  2
                </div>
                <div>
                  <CardTitle>Upload Feed File</CardTitle>
                  <CardDescription>Your file will be validated and normalized automatically</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <FileUpload
                onFileSelect={handleFileSelect}
                accept=".jsonl,.csv,.jsonl.gz,.csv.gz"
                disabled={isValidating}
              />
              {file && (
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <svg
                        className="h-5 w-5 text-primary"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {file.size > 1024 * 1024
                          ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
                          : `${(file.size / 1024).toFixed(1)} KB`}
                        {sourceHeaders.length > 0 && ` · ${sourceHeaders.length} columns detected`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {sourceHeaders.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleShowMapping}
                        disabled={isValidating}
                      >
                        <svg className="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        Map Fields
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleReset}
                      disabled={isValidating}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              )}
              {customMappings && (
                <div className="flex items-center gap-2 p-2 rounded bg-blue-500/10 border border-blue-500/30">
                  <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-sm text-blue-700 dark:text-blue-400">
                    Custom field mapping applied ({Object.keys(customMappings).length} fields mapped)
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pre-validation Results */}
          {(isPreValidating || preValidation) && (
            <Card className="border-slate-500/50 bg-slate-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <svg className="h-5 w-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  <CardTitle className="text-base">Pre-validation Results</CardTitle>
                </div>
                <CardDescription>
                  {preValidation?.analyzedRows === preValidation?.totalRows
                    ? `All ${preValidation?.totalRows.toLocaleString()} records analyzed`
                    : preValidation
                      ? `${preValidation.analyzedRows.toLocaleString()} of ${preValidation.totalRows.toLocaleString()} records (cancelled)`
                      : "Analyzing..."}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {preValidation && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center p-3 rounded-lg bg-slate-500/10 border border-slate-500/20">
                        <p className="text-2xl font-bold text-foreground">{preValidation.totalRows.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Total Records</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                        <p className="text-2xl font-bold text-green-800 dark:text-green-400">{preValidation.validRows.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Valid</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                        <p className="text-2xl font-bold text-red-700 dark:text-red-400">{preValidation.invalidRows.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Invalid</p>
                      </div>
                    </div>
                    {preValidation.rawIssues.length > 0 && (() => {
                      const warnings = preValidation.rawIssues.filter(i => i.severity === "warning");
                      const infos = preValidation.rawIssues.filter(i => i.severity === "info" && i.kind !== "ignored");
                      const ignored = preValidation.rawIssues.filter(i => i.kind === "ignored");
                      return (
                        <div className="pt-3 border-t border-slate-500/20 space-y-4">
                          {/* Warnings - need attention */}
                          {warnings.length > 0 && (
                            <div>
                              <p className="text-xs text-red-700 dark:text-red-400 font-medium mb-2">
                                ⚠️ {warnings.length} warning{warnings.length > 1 ? "s" : ""} - needs attention
                              </p>
                              <div className="space-y-1">
                                {warnings.map((issue, idx) => (
                                  <div key={idx} className="flex items-center gap-2 text-xs p-2 rounded bg-red-500/10 border border-red-500/20">
                                    <span className="font-mono text-red-700 dark:text-red-300 shrink-0">{issue.field}</span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="text-red-700 dark:text-red-200">{issue.problem}</span>
                                    {issue.count > 1 && (
                                      <span className="text-red-700 dark:text-red-400 ml-auto">×{issue.count}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Info - will be auto-fixed */}
                          {infos.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">
                                ✓ {infos.length} normalization{infos.length > 1 ? "s" : ""} will be applied
                              </p>
                              <div className="space-y-1">
                                {infos.map((issue, idx) => (
                                  <div key={idx} className="flex items-center gap-2 text-xs p-2 rounded bg-amber-500/10 border border-amber-500/20">
                                    <span className="font-mono text-amber-800 dark:text-amber-300 shrink-0">{issue.field}</span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="text-amber-800 dark:text-amber-200">{issue.problem}</span>
                                    {issue.count > 1 && (
                                      <span className="text-amber-800 dark:text-amber-400 ml-auto">×{issue.count}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Ignored columns - not a fix, dropped from the export entirely */}
                          {ignored.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">
                                ⊘ {ignored.length} column{ignored.length > 1 ? "s" : ""} not part of the spec, won&apos;t be exported
                              </p>
                              <div className="space-y-1">
                                {ignored.map((issue, idx) => (
                                  <div key={idx} className="flex items-center gap-2 text-xs p-2 rounded bg-slate-500/10 border border-slate-500/20">
                                    <span className="font-mono text-foreground shrink-0">{issue.field}</span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="text-foreground">{issue.problem}</span>
                                    {issue.count > 1 && (
                                      <span className="text-foreground/80 ml-auto">×{issue.count}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {preValidation.invalidRows === 0 && preValidation.validRows > 0 && (() => {
                      const hasWarnings = preValidation.rawIssues.some(i => i.severity === "warning");
                      if (hasWarnings) {
                        return (
                          <div className="flex items-center gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/30">
                            <svg className="h-4 w-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <span className="text-sm text-amber-800 dark:text-amber-400">
                              Records pass schema validation, but have warnings. Review before submitting to OpenAI.
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div className="flex items-center gap-2 p-2 rounded bg-green-500/10 border border-green-500/30">
                          <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-sm text-green-800 dark:text-green-400">
                            {preValidation.analyzedRows === preValidation.totalRows
                              ? "All records are valid! You can proceed with full validation and export."
                              : "Feed looks valid so far. Run full validation to confirm."}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Validate Button */}
          <div className="flex gap-3">
            <Button
              size="lg"
              className="flex-1 h-12 text-base"
              onClick={handleValidate}
              disabled={!file || !selectedValidator || isValidating}
            >
              {isValidating ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Validating...
                </>
              ) : (
                <>
                  <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Validate Feed
                </>
              )}
            </Button>
            {result && (
              <Button variant="outline" size="lg" className="h-12" onClick={handleReset}>
                Start Over
              </Button>
            )}
          </div>

          {/* Error */}
          {error && (
            <Card className="border-destructive bg-destructive/10">
              <CardContent className="py-4 flex items-center gap-3">
                <svg className="h-5 w-5 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-destructive text-sm">{error}</p>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {result && (
            <>
              {/* Warnings & Auto-fixes Applied */}
              {result.rawIssues && result.rawIssues.length > 0 && (() => {
                const warnings = result.rawIssues.filter(i => i.severity === "warning");
                const infos = result.rawIssues.filter(i => i.severity === "info" && i.kind !== "ignored");
                const ignored = result.rawIssues.filter(i => i.kind === "ignored");
                return (
                  <div className="space-y-4">
                    {/* Warnings Card */}
                    {warnings.length > 0 && (
                      <Card className="border-red-500/50 bg-red-500/5">
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-2">
                            <svg className="h-5 w-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <CardTitle className="text-base">Warnings</CardTitle>
                          </div>
                          <CardDescription>
                            These issues may cause problems - review before submitting to OpenAI
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-2">
                            {warnings.map((issue, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20"
                              >
                                <svg className="h-4 w-4 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-red-700 dark:text-red-200">
                                    {issue.problem}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    <span className="font-mono bg-muted px-1 rounded">{issue.field}</span>
                                    {": "}
                                    <span className="text-red-700 dark:text-red-400/70">{String(issue.originalValue)}</span>
                                    {issue.fixedValue !== undefined && (
                                      <>
                                        {" → "}
                                        <span className="text-amber-800 dark:text-amber-400">{String(issue.fixedValue)}</span>
                                      </>
                                    )}
                                    {issue.count > 1 && (
                                      <span className="ml-2 text-red-700 dark:text-red-400">({issue.count}+ occurrences)</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    {/* Auto-fixes Card */}
                    {infos.length > 0 && (
                      <Card className="border-amber-500/50 bg-amber-500/5">
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-2">
                            <svg className="h-5 w-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <CardTitle className="text-base">Auto-fixes Applied</CardTitle>
                          </div>
                          <CardDescription>
                            These issues in your original feed were automatically corrected
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-2">
                            {infos.map((issue, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
                              >
                                <svg className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                                    {issue.problem}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    <span className="font-mono bg-muted px-1 rounded">{issue.field}</span>
                                    {": "}
                                    <span className="line-through text-red-700 dark:text-red-400/70">{String(issue.originalValue)}</span>
                                    {issue.fixedValue !== undefined && (
                                      <>
                                        {" → "}
                                        <span className="text-green-800 dark:text-green-400">{String(issue.fixedValue)}</span>
                                      </>
                                    )}
                                    {issue.count > 1 && (
                                      <span className="ml-2 text-amber-800 dark:text-amber-400">({issue.count}+ occurrences)</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    {/* Ignored Columns Card - dropping a column isn't a correction,
                        so it gets its own bucket instead of "Auto-fixes Applied" */}
                    {ignored.length > 0 && (
                      <Card className="border-slate-500/50 bg-slate-500/5">
                        <CardHeader className="pb-3">
                          <div className="flex items-center gap-2">
                            <svg className="h-5 w-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                            <CardTitle className="text-base">Columns Not Exported</CardTitle>
                          </div>
                          <CardDescription>
                            These columns aren&apos;t part of the OpenAI product feed spec and will not be included in the export
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-2">
                            {ignored.map((issue, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-3 p-3 rounded-lg bg-slate-500/10 border border-slate-500/20"
                              >
                                <svg className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                </svg>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground">
                                    {issue.problem}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    <span className="font-mono bg-muted text-foreground px-1 rounded">{issue.field}</span>
                                    {": "}
                                    <span className="text-foreground/80">{String(issue.originalValue)}</span>
                                    {issue.count > 1 && (
                                      <span className="ml-2 text-foreground/80">({issue.count}+ occurrences)</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                );
              })()}

              <ValidationResults
                summary={result.summary}
                validatorName={result.validator.name}
                fileName={result.file.name}
                truncated={result.truncated}
              />

              {/* Export Button */}
              {result.summary.validRecords && result.summary.validRecords.length > 0 && (
                <Card className="border-green-500/50 bg-green-500/5">
                  <CardContent className="py-6">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-full bg-green-500/20">
                          <svg className="h-6 w-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </div>
                        <div>
                          <p className="font-medium">Export Valid Records</p>
                          <p className="text-sm text-muted-foreground">
                            Download {result.summary.validRecords.length} valid records as JSONL.gz
                            {result.validRecordsTruncated && " (truncated to 10,000)"}
                          </p>
                        </div>
                      </div>
                      <Button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {isExporting ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Exporting...
                          </>
                        ) : (
                          <>
                            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download JSONL.gz
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        {/* Privacy Notice */}
        <div className="text-center p-4 rounded-lg bg-green-500/5 border border-green-500/20">
          <div className="flex items-center justify-center gap-2 text-green-800 dark:text-green-400 text-sm">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>100% Client-Side - Your data never leaves your browser. No cookies, no tracking.</span>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-sm text-muted-foreground pt-8 border-t border-border space-y-3">
          <p className="text-sm flex items-center justify-center gap-1">
            Made with{" "}
            <svg className="h-4 w-4 text-red-500 fill-red-500" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            {" "}in Canary Islands
          </p>
          <p className="text-xs flex items-center justify-center gap-1">
            <span>© {new Date().getFullYear()}</span>
            <a
              href="https://www.alancurtisagency.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              Alan Curtis / AC Agency
            </a>
            <span>— MIT License</span>
            <a
              href="https://github.com/MyAIPlugins/ac-feed-validator"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
              aria-label="GitHub Repository"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
          </p>
          <div className="flex items-center justify-center gap-4">
            <Badge variant="secondary">Zero Tracking</Badge>
            <Badge variant="secondary">No Cookies</Badge>
            <Badge variant="secondary">100% Privacy</Badge>
            <Badge variant="secondary">Open Source</Badge>
          </div>
        </footer>
      </div>

      {/* Field Mapping Dialog */}
      <FieldMappingDialog
        open={showMappingDialog}
        onOpenChange={setShowMappingDialog}
        sourceHeaders={sourceHeaders}
        targetFields={currentValidator?.targetFields ?? []}
        fieldAliases={currentValidator?.fieldAliases ?? {}}
        onConfirm={handleMappingConfirm}
      />

      {/* Pre-validation Progress Dialog */}
      <PreValidationDialog
        open={showPreValidationDialog}
        progress={preValidationProgress}
        onCancel={handleCancelPreValidation}
      />

      {/* Final Validation Progress Dialog */}
      <ValidationProgressDialog
        open={showValidationDialog}
        progress={validationProgress}
        onCancel={handleCancelValidation}
      />
    </main>
  );
}
