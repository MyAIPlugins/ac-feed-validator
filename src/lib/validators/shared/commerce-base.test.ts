import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { commerceBaseFields, commerceBaseBooleanFields, booleanSchema } from "./commerce-base";

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
