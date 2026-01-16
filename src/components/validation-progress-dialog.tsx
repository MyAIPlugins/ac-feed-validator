"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ValidationProgress } from "@/lib/validators/validate-client";

interface ValidationProgressDialogProps {
  open: boolean;
  progress: ValidationProgress | null;
  onCancel: () => void;
}

export function ValidationProgressDialog({
  open,
  progress,
  onCancel,
}: ValidationProgressDialogProps) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (open && !progress?.isComplete) {
      startTimeRef.current = Date.now();
      const interval = setInterval(() => {
        if (startTimeRef.current) {
          setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 1000);
      return () => clearInterval(interval);
    } else {
      startTimeRef.current = null;
      setElapsedTime(0);
    }
  }, [open, progress?.isComplete]);

  const percentage = progress?.totalRows
    ? Math.round((progress.processedRows / progress.totalRows) * 100)
    : 0;

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  // Estimate remaining time based on current speed
  const estimatedRemaining = progress?.processedRows && progress.processedRows > 0
    ? Math.round(((progress.totalRows - progress.processedRows) / progress.processedRows) * elapsedTime)
    : null;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg className="animate-spin h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Validating Feed
          </DialogTitle>
          <DialogDescription>
            Processing all records with normalization and validation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{percentage}%</span>
            </div>
            <Progress value={percentage} className="h-2" />
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-2 rounded-lg bg-slate-500/10 border border-slate-500/20">
              <p className="text-lg font-bold text-slate-200">
                {progress?.processedRows.toLocaleString() ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">
                of {progress?.totalRows.toLocaleString() ?? "?"} processed
              </p>
            </div>
            <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20">
              <p className="text-lg font-bold text-green-400">
                {progress?.validRows.toLocaleString() ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Valid</p>
            </div>
            <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-lg font-bold text-red-400">
                {progress?.invalidRows.toLocaleString() ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Invalid</p>
            </div>
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-lg font-bold text-amber-400">
                {((progress?.errorCount ?? 0) + (progress?.warningCount ?? 0)).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">
                {progress?.errorCount ?? 0} errors, {progress?.warningCount ?? 0} warnings
              </p>
            </div>
          </div>

          {/* Time info */}
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Elapsed: {formatTime(elapsedTime)}</span>
            {estimatedRemaining !== null && estimatedRemaining > 0 && (
              <span>~{formatTime(estimatedRemaining)} remaining</span>
            )}
          </div>

          {/* Cancel button */}
          <Button
            variant="outline"
            className="w-full"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
