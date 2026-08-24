import { describe, test, expect } from "bun:test";
import { openAIValidator } from "./schema";

// Regression tests for the plain "OpenAI Product Feed" validator, written
// against the post-refactor version (fields extracted into
// shared/commerce-base.ts). These prove the extraction didn't change any
// observable behavior for the validator that already ships today.

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    is_eligible_search: true,
    is_eligible_checkout: false,
    item_id: "SKU123",
    title: "Test Product",
    description: "A great product",
    url: "https://example.com/product/123",
    brand: "Acme",
    price: 19.99,
    availability: "in_stock",
    image_url: "https://example.com/image.jpg",
    return_policy: "https://example.com/returns",
    return_window: 30,
    target_countries: "US",
    store_country: "US",
    ...overrides,
  };
}

describe("openAIValidator", () => {
  test("accepts a fully valid record", () => {
    const result = openAIValidator.validateRecord(validRecord(), 1);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test("rejects checkout-enabled record missing seller fields", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ is_eligible_checkout: true }),
      1
    );
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("seller_privacy_policy"))).toBe(true);
  });

  test("accepts checkout-enabled record with all seller fields", () => {
    const result = openAIValidator.validateRecord(
      validRecord({
        is_eligible_checkout: true,
        seller_privacy_policy: "https://example.com/privacy",
        seller_tos: "https://example.com/tos",
        store_name: "Acme Store",
      }),
      1
    );
    expect(result.isValid).toBe(true);
  });

  test("rejects pre_order availability without availability_date", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ availability: "pre_order" }),
      1
    );
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("availability_date"))).toBe(true);
  });

  test("normalizes comma-decimal price before validating", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ price: "63,00 EUR" }),
      1
    );
    expect(result.isValid).toBe(true);
    expect(result.normalized?.price).toBe("63.00 EUR");
  });

  test("maps a known alias column (link -> url)", () => {
    const record = validRecord();
    delete (record as Record<string, unknown>).url;
    (record as Record<string, unknown>).link = "https://example.com/aliased";

    const result = openAIValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(true);
    expect(result.normalized?.url).toBe("https://example.com/aliased");
  });

  test("does not accept is_ads_eligible (not part of this validator's schema)", () => {
    // Zod strips unknown keys by default - confirms the plain validator
    // stays unaffected by the Ads-only field.
    const result = openAIValidator.validateRecord(
      validRecord({ is_ads_eligible: true }),
      1
    );
    expect(result.isValid).toBe(true);
    expect(result.data && "is_ads_eligible" in result.data).toBe(false);
  });

  test("exposes targetFields for the field-mapping dialog", () => {
    expect(openAIValidator.targetFields.length).toBeGreaterThan(0);
    expect(openAIValidator.targetFields.some((f) => f.name === "item_id" && f.required)).toBe(true);
    expect(openAIValidator.targetFields.some((f) => f.name === "is_ads_eligible")).toBe(false);
  });
});
