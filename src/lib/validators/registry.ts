import type { ValidatorModule } from "./types";
import { openAIValidator } from "./openai/schema";

const validators: Map<string, ValidatorModule> = new Map();

function registerValidator(validator: ValidatorModule): void {
  validators.set(validator.id, validator);
}

export function getValidator(id: string): ValidatorModule | undefined {
  return validators.get(id);
}

export function getAllValidators(): ValidatorModule[] {
  return Array.from(validators.values());
}

export function getValidatorIds(): string[] {
  return Array.from(validators.keys());
}

// Register all validators
registerValidator(openAIValidator);
