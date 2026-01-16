"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Validator {
  id: string;
  name: string;
  description: string;
  version: string;
  supportedFormats: string[];
}

interface ValidatorSelectProps {
  validators: Validator[];
  selected: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export function ValidatorSelect({
  validators,
  selected,
  onSelect,
  disabled,
}: ValidatorSelectProps) {
  return (
    <div className="grid gap-3">
      {validators.map((validator) => (
        <Card
          key={validator.id}
          className={cn(
            "cursor-pointer transition-all hover:border-primary/50",
            selected === validator.id && "border-primary bg-primary/5",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          onClick={() => !disabled && onSelect(validator.id)}
        >
          <CardContent className="flex items-center justify-between py-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">{validator.name}</h3>
                <Badge variant="outline" className="text-xs">
                  v{validator.version}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {validator.description}
              </p>
              <div className="flex gap-1 mt-2">
                {validator.supportedFormats.map((format) => (
                  <Badge key={format} variant="secondary" className="text-xs">
                    {format}
                  </Badge>
                ))}
              </div>
            </div>
            <div
              className={cn(
                "w-4 h-4 rounded-full border-2",
                selected === validator.id
                  ? "border-primary bg-primary"
                  : "border-muted-foreground"
              )}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
