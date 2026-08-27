import { describe, test, expect } from "bun:test";
import { z } from "zod";
import {
  commerceBaseFields,
  commerceBaseBooleanFields,
  booleanSchema,
  commerceBaseTargetFields,
  commerceBaseFieldNames,
  commerceBaseFieldDescriptions,
} from "./commerce-base";

// commerceBaseBooleanFields is still a hand-maintained list (per Alan's
// review of PR #1). This test makes the "can't silently drift" comment on
// that list actually true: it derives the boolean-typed field names
// straight from commerceBaseFields (the source of truth) and asserts they
// match. If someone adds a new field built on booleanSchema and forgets to
// add it to commerceBaseBooleanFields (or vice versa), this test fails.

function isBooleanField(schema: z.ZodTypeAny): boolean {
  const unwrapped = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
  return unwrapped === booleanSchema;
}

describe("commerceBaseBooleanFields", () => {
  test("matches every field in commerceBaseFields built on booleanSchema", () => {
    const derived = Object.entries(commerceBaseFields)
      .filter(([, schema]) => isBooleanField(schema))
      .map(([name]) => name)
      .sort();

    expect(derived).toEqual([...commerceBaseBooleanFields].sort());
  });
});

// commerceBaseTargetFields used to be a hand-maintained array that drifted
// 45 fields behind the schema (30 entries vs 75 real fields - Alan's PR #3
// finding). Now derived from commerceBaseFields directly - this test makes
// that actually true, same drift-test pattern as booleanFields above.
describe("commerceBaseTargetFields", () => {
  test("has exactly one entry per commerceBaseFields key, in the same set", () => {
    const targetNames = commerceBaseTargetFields.map((f) => f.name).sort();
    const schemaNames = [...commerceBaseFieldNames].sort();
    expect(targetNames).toEqual(schemaNames);
  });

  test("required flag matches whether the field's Zod schema is wrapped in .optional()", () => {
    for (const field of commerceBaseTargetFields) {
      const schema = commerceBaseFields[field.name as keyof typeof commerceBaseFields];
      const isOptional = schema instanceof z.ZodOptional;
      expect(field.required).toBe(!isOptional);
    }
  });

  test("every field has a non-empty description", () => {
    for (const field of commerceBaseTargetFields) {
      expect(field.description.length).toBeGreaterThan(0);
    }
  });
});

// A field added to commerceBaseFields without a matching entry in
// commerceBaseFieldDescriptions silently falls back to its raw field name
// (see commerce-base.ts) instead of failing loudly - this test is the loud
// failure.
describe("commerceBaseFieldDescriptions", () => {
  test("has exactly one entry per commerceBaseFields key, in the same set", () => {
    const descriptionNames = Object.keys(commerceBaseFieldDescriptions).sort();
    const schemaNames = [...commerceBaseFieldNames].sort();
    expect(descriptionNames).toEqual(schemaNames);
  });
});
