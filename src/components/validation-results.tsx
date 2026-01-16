"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import type { FeedValidationSummary } from "@/lib/validators/types";

interface ValidationResultsProps {
  summary: FeedValidationSummary;
  validatorName: string;
  fileName: string;
  truncated?: boolean;
}

export function ValidationResults({
  summary,
  validatorName,
  fileName,
  truncated,
}: ValidationResultsProps) {
  const successRate = summary.totalRows > 0
    ? Math.round((summary.validRows / summary.totalRows) * 100)
    : 0;

  const isSuccess = summary.invalidRows === 0;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Validation Results</span>
            <Badge variant={isSuccess ? "default" : "destructive"}>
              {isSuccess ? "Valid" : "Has Issues"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-lg bg-muted">
              <p className="text-2xl font-bold">{summary.totalRows}</p>
              <p className="text-xs text-muted-foreground">Total Rows</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-green-500/10">
              <p className="text-2xl font-bold text-green-500">{summary.validRows}</p>
              <p className="text-xs text-muted-foreground">Valid</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-red-500/10">
              <p className="text-2xl font-bold text-red-500">{summary.invalidRows}</p>
              <p className="text-xs text-muted-foreground">Invalid</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-yellow-500/10">
              <p className="text-2xl font-bold text-yellow-500">{summary.warningCount}</p>
              <p className="text-xs text-muted-foreground">Warnings</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Success Rate</span>
              <span>{successRate}%</span>
            </div>
            <Progress value={successRate} className="h-2" />
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>File: {fileName}</p>
            <p>Validator: {validatorName}</p>
          </div>
        </CardContent>
      </Card>

      {/* Issues List */}
      {summary.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Issues ({summary.errorCount} errors, {summary.warningCount} warnings)
              {truncated && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  (showing first 100)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {summary.issues.map((issue, idx) => (
                <Alert
                  key={idx}
                  variant={issue.severity === "error" ? "destructive" : "default"}
                  className="py-2"
                >
                  <AlertTitle className="text-sm flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">
                      Row {issue.row}
                    </Badge>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {issue.field}
                    </Badge>
                  </AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    {issue.message}
                    {issue.value !== undefined && (
                      <span className="block mt-1 font-mono text-muted-foreground">
                        Value: {JSON.stringify(issue.value)}
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success Message */}
      {isSuccess && (
        <Alert className="border-green-500 bg-green-500/10">
          <AlertTitle className="text-green-500">All records valid!</AlertTitle>
          <AlertDescription>
            Your feed file passed all validation checks and is ready for submission.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
