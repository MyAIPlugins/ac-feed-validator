"use client";

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  disabled?: boolean;
}

export function FileUpload({ onFileSelect, accept, disabled }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        onFileSelect(files[0]);
      }
    },
    [onFileSelect, disabled]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onFileSelect(files[0]);
      }
    },
    [onFileSelect]
  );

  return (
    <Card
      className={cn(
        "border-2 border-dashed transition-colors cursor-pointer",
        isDragging && "border-primary bg-primary/5",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <CardContent className="flex flex-col items-center justify-center py-12">
        <input
          type="file"
          accept={accept}
          onChange={handleChange}
          disabled={disabled}
          className="hidden"
          id="file-upload"
        />
        <label
          htmlFor="file-upload"
          className={cn(
            "flex flex-col items-center gap-4 cursor-pointer",
            disabled && "cursor-not-allowed"
          )}
        >
          <div className="rounded-full bg-muted p-4">
            <svg
              className="h-8 w-8 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">
              Drop your feed file here or click to browse
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Supports .jsonl, .csv, .jsonl.gz, .csv.gz
            </p>
          </div>
        </label>
      </CardContent>
    </Card>
  );
}
