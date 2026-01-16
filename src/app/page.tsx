"use client";

import { useState, useEffect, useCallback } from "react";
import { FileUpload } from "@/components/file-upload";
import { ValidatorSelect } from "@/components/validator-select";
import { ValidationResults } from "@/components/validation-results";
import { FieldMappingDialog } from "@/components/field-mapping-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { extractHeadersClient } from "@/lib/parsers";
import { validateClient, getAvailableValidators, type ClientValidationResult } from "@/lib/validators/validate-client";

// OpenAI target fields definition
const OPENAI_TARGET_FIELDS = [
  { name: "is_eligible_search", required: true, description: "Enable ChatGPT search" },
  { name: "is_eligible_checkout", required: true, description: "Enable in-app checkout" },
  { name: "item_id", required: true, description: "Unique product ID" },
  { name: "title", required: true, description: "Product name" },
  { name: "description", required: false, description: "Product description" },
  { name: "url", required: true, description: "Product page URL" },
  { name: "brand", required: true, description: "Brand name" },
  { name: "price", required: true, description: "Regular price" },
  { name: "currency", required: false, description: "Currency code (ISO 4217)" },
  { name: "sale_price", required: false, description: "Sale price" },
  { name: "availability", required: true, description: "Stock status" },
  { name: "image_url", required: true, description: "Main product image" },
  { name: "additional_image_urls", required: false, description: "Extra images" },
  { name: "group_id", required: false, description: "Variant group ID" },
  { name: "size", required: false, description: "Product size" },
  { name: "color", required: false, description: "Product color" },
  { name: "condition", required: false, description: "new/refurbished/used" },
  { name: "product_category", required: false, description: "Product category" },
  { name: "store_name", required: false, description: "Merchant name" },
  { name: "seller_url", required: false, description: "Merchant URL" },
  { name: "return_policy", required: true, description: "Return policy URL" },
  { name: "return_window", required: true, description: "Return window in days" },
  { name: "target_countries", required: true, description: "Target countries (ISO)" },
  { name: "store_country", required: true, description: "Store country (ISO)" },
  { name: "material", required: false, description: "Product material" },
  { name: "inventory_quantity", required: false, description: "Stock quantity" },
];

interface Validator {
  id: string;
  name: string;
  description: string;
  version: string;
  supportedFormats: string[];
  fieldAliases?: Record<string, string[]>;
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

  useEffect(() => {
    // Load validators client-side (no API call needed)
    const availableValidators = getAvailableValidators() as Validator[];
    setValidators(availableValidators);
    if (availableValidators.length > 0) {
      setSelectedValidator(availableValidators[0].id);
    }
  }, []);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setResult(null);
    setError(null);
    setCustomMappings(null);

    // Extract headers for mapping dialog
    try {
      const headers = await extractHeadersClient(selectedFile);
      setSourceHeaders(headers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file headers");
    }
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

    setIsValidating(true);
    setError(null);
    setResult(null);

    try {
      // 100% client-side validation - no data leaves the browser
      const validationResult = await validateClient({
        file,
        validatorId: selectedValidator,
        includeValidRecords: true,
        customMappings: mappings,
      });

      setResult(validationResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsValidating(false);
    }
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
  };

  const currentValidator = validators.find((v) => v.id === selectedValidator);

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-950">
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
                  <span className="text-sm text-blue-400">
                    Custom field mapping applied ({Object.keys(customMappings).length} fields mapped)
                  </span>
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

        {/* Privacy Notice */}
        <div className="text-center p-4 rounded-lg bg-green-500/5 border border-green-500/20">
          <div className="flex items-center justify-center gap-2 text-green-400 text-sm">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>100% Client-Side - Your data never leaves your browser. No cookies, no tracking.</span>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-sm text-muted-foreground pt-8 border-t border-white/10 space-y-3">
          <p className="text-sm flex items-center justify-center gap-1">
            Made with{" "}
            <svg className="h-4 w-4 text-red-500 fill-red-500" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            {" "}in Canary Islands
          </p>
          <p className="text-xs">
            © {new Date().getFullYear()}{" "}
            <a
              href="https://www.alancurtisagency.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              Alan Curtis / AC Agency
            </a>
            {" "}— MIT License
            {" "}
            <a
              href="https://github.com/MyAIPlugins/ac-feed-validator"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center hover:text-primary transition-colors ml-2"
              aria-label="GitHub Repository"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
          </p>
          <div className="flex items-center justify-center gap-4">
            <Badge variant="secondary">Next.js 16</Badge>
            <Badge variant="secondary">Zod 4</Badge>
            <Badge variant="secondary">100% Client-Side</Badge>
          </div>
        </footer>
      </div>

      {/* Field Mapping Dialog */}
      <FieldMappingDialog
        open={showMappingDialog}
        onOpenChange={setShowMappingDialog}
        sourceHeaders={sourceHeaders}
        targetFields={OPENAI_TARGET_FIELDS}
        fieldAliases={currentValidator?.fieldAliases ?? {}}
        onConfirm={handleMappingConfirm}
      />
    </main>
  );
}
