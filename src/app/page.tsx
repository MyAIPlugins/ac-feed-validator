"use client";

import { useState, useEffect, useCallback } from "react";
import { FileUpload } from "@/components/file-upload";
import { ValidatorSelect } from "@/components/validator-select";
import { ValidationResults } from "@/components/validation-results";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FeedValidationSummary } from "@/lib/validators/types";

interface Validator {
  id: string;
  name: string;
  description: string;
  version: string;
  supportedFormats: string[];
  fieldAliases?: Record<string, string[]>;
}

interface ValidationResponse {
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

export default function Home() {
  const [validators, setValidators] = useState<Validator[]>([]);
  const [selectedValidator, setSelectedValidator] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [result, setResult] = useState<ValidationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/validate")
      .then((res) => res.json())
      .then((data: { validators: Validator[] }) => {
        setValidators(data.validators);
        if (data.validators.length > 0) {
          setSelectedValidator(data.validators[0].id);
        }
      })
      .catch(() => setError("Failed to load validators"));
  }, []);

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setResult(null);
    setError(null);
  };

  const handleValidate = async () => {
    if (!file || !selectedValidator) return;

    setIsValidating(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("validator", selectedValidator);
      formData.append("includeValidRecords", "true");

      const response = await fetch("/api/validate", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Validation failed");
      }

      setResult(data as ValidationResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsValidating(false);
    }
  };

  const handleExport = useCallback(async () => {
    if (!result?.summary.validRecords?.length) return;

    setIsExporting(true);
    try {
      // Convert to JSONL
      const jsonlContent = result.summary.validRecords
        .map((record) => JSON.stringify(record))
        .join("\n");

      // Compress with gzip using CompressionStream
      const blob = new Blob([jsonlContent], { type: "application/json" });
      const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
      const compressedBlob = await new Response(stream).blob();

      // Download
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
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
        {/* Header */}
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
                onSelect={setSelectedValidator}
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
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    disabled={isValidating}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

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

        {/* Footer */}
        <footer className="text-center text-sm text-muted-foreground pt-8 border-t space-y-2">
          <p className="font-medium">AI Feed Validator</p>
          <p>
            Validate product feeds for OpenAI, Google Shopping, Meta, and more.
          </p>
          <div className="flex items-center justify-center gap-4 pt-2">
            <Badge variant="secondary">Next.js 16</Badge>
            <Badge variant="secondary">Zod 4</Badge>
            <Badge variant="secondary">Bun</Badge>
          </div>
        </footer>
      </div>
    </main>
  );
}
