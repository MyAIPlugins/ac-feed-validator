"use client";

import { useState, useEffect } from "react";
import { FileUpload } from "@/components/file-upload";
import { ValidatorSelect } from "@/components/validator-select";
import { ValidationResults } from "@/components/validation-results";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FeedValidationSummary } from "@/lib/validators/types";

interface Validator {
  id: string;
  name: string;
  description: string;
  version: string;
  supportedFormats: string[];
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
}

export default function Home() {
  const [validators, setValidators] = useState<Validator[]>([]);
  const [selectedValidator, setSelectedValidator] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isValidating, setIsValidating] = useState(false);
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

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            AI Feed Validator
          </h1>
          <p className="text-muted-foreground">
            Validate your product feeds for AI platforms
          </p>
        </div>

        {/* Main Content */}
        <div className="grid gap-6">
          {/* Step 1: Select Validator */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant="outline">1</Badge>
                Select Feed Format
              </CardTitle>
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant="outline">2</Badge>
                Upload Feed File
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FileUpload
                onFileSelect={handleFileSelect}
                accept=".jsonl,.csv,.jsonl.gz,.csv.gz"
                disabled={isValidating}
              />
              {file && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
                  <div className="flex items-center gap-3">
                    <svg
                      className="h-5 w-5 text-muted-foreground"
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
                    <div>
                      <p className="text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(1)} KB
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
              className="flex-1"
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
                "Validate Feed"
              )}
            </Button>
            {result && (
              <Button variant="outline" size="lg" onClick={handleReset}>
                Start Over
              </Button>
            )}
          </div>

          {/* Error */}
          {error && (
            <Card className="border-red-500 bg-red-500/10">
              <CardContent className="py-4">
                <p className="text-red-500 text-sm">{error}</p>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {result && (
            <ValidationResults
              summary={result.summary}
              validatorName={result.validator.name}
              fileName={result.file.name}
              truncated={result.truncated}
            />
          )}
        </div>

        {/* Footer */}
        <footer className="text-center text-xs text-muted-foreground pt-8 border-t">
          <p>
            AI Feed Validator - Validate product feeds for OpenAI, Google, Meta, and more.
          </p>
        </footer>
      </div>
    </main>
  );
}
