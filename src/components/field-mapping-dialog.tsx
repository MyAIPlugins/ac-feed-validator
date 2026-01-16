"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";

interface FieldMapping {
  sourceField: string;
  targetField: string | null;
  autoMapped: boolean;
}

interface FieldMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceHeaders: string[];
  targetFields: { name: string; required: boolean; description?: string }[];
  fieldAliases: Record<string, string[]>;
  onConfirm: (mappings: Record<string, string>) => void;
}

export function FieldMappingDialog({
  open,
  onOpenChange,
  sourceHeaders,
  targetFields,
  fieldAliases,
  onConfirm,
}: FieldMappingDialogProps) {
  const [mappings, setMappings] = useState<FieldMapping[]>([]);

  // Initialize mappings when dialog opens
  useEffect(() => {
    if (open && sourceHeaders.length > 0) {
      const initialMappings: FieldMapping[] = sourceHeaders.map((header) => {
        // Check if header matches a target field directly
        const directMatch = targetFields.find(
          (f) => f.name.toLowerCase() === header.toLowerCase()
        );
        if (directMatch) {
          return { sourceField: header, targetField: directMatch.name, autoMapped: true };
        }

        // Check aliases
        for (const [targetField, aliases] of Object.entries(fieldAliases)) {
          if (aliases.some((alias) => alias.toLowerCase() === header.toLowerCase())) {
            return { sourceField: header, targetField, autoMapped: true };
          }
        }

        return { sourceField: header, targetField: null, autoMapped: false };
      });

      setMappings(initialMappings);
    }
  }, [open, sourceHeaders, targetFields, fieldAliases]);

  const handleMappingChange = (sourceField: string, targetField: string | null) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.sourceField === sourceField
          ? { ...m, targetField: targetField === "unmapped" ? null : targetField, autoMapped: false }
          : m
      )
    );
  };

  const handleConfirm = () => {
    const mappingResult: Record<string, string> = {};
    for (const mapping of mappings) {
      if (mapping.targetField) {
        mappingResult[mapping.sourceField] = mapping.targetField;
      }
    }
    onConfirm(mappingResult);
  };

  const getMappedTargetFields = () => {
    return new Set(mappings.filter((m) => m.targetField).map((m) => m.targetField));
  };

  const mappedFields = getMappedTargetFields();
  const requiredFields = targetFields.filter((f) => f.required);
  const missingRequired = requiredFields.filter((f) => !mappedFields.has(f.name));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <svg className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Field Mapping
          </DialogTitle>
          <DialogDescription>
            Review and adjust how your CSV columns map to OpenAI feed fields.
            Auto-detected mappings are shown with a badge.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {mappings.map((mapping) => (
              <div
                key={mapping.sourceField}
                className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 border"
              >
                {/* Source field */}
                <div className="flex-1 min-w-0">
                  <Label className="text-xs text-muted-foreground">Your Column</Label>
                  <p className="font-mono text-sm truncate">{mapping.sourceField}</p>
                </div>

                {/* Arrow */}
                <svg className="h-5 w-5 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>

                {/* Target field selector */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Label className="text-xs text-muted-foreground">OpenAI Field</Label>
                    {mapping.autoMapped && mapping.targetField && (
                      <Badge variant="secondary" className="text-xs h-5">
                        Auto
                      </Badge>
                    )}
                  </div>
                  <Select
                    value={mapping.targetField ?? "unmapped"}
                    onValueChange={(value) => handleMappingChange(mapping.sourceField, value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select field..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unmapped">
                        <span className="text-muted-foreground">-- Unmapped --</span>
                      </SelectItem>
                      {targetFields.map((field) => {
                        const isMapped = mappedFields.has(field.name) && mapping.targetField !== field.name;
                        return (
                          <SelectItem
                            key={field.name}
                            value={field.name}
                            disabled={isMapped}
                          >
                            <span className="flex items-center gap-2">
                              {field.name}
                              {field.required && (
                                <span className="text-xs text-red-500">*</span>
                              )}
                              {isMapped && (
                                <span className="text-xs text-muted-foreground">(used)</span>
                              )}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Status */}
        <div className="border-t pt-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Mapped: {mappings.filter((m) => m.targetField).length} / {sourceHeaders.length} columns
            </span>
            {missingRequired.length > 0 && (
              <span className="text-red-500">
                Missing required: {missingRequired.map((f) => f.name).join(", ")}
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Confirm & Validate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
