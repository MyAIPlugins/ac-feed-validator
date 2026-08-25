import { describe, test, expect } from "bun:test";
import { openAIAdsValidator } from "./schema";
import { detectRawIssues } from "../validate-client";

function validAdsRecord(overrides: Record<string, unknown> = {}) {
  return {
    is_eligible_search: true,
    is_eligible_checkout: false,
    is_ads_eligible: true,
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

describe("openAIAdsValidator", () => {
  test("accepts a valid Ads-eligible record", () => {
    const result = openAIAdsValidator.validateRecord(validAdsRecord(), 1);
    expect(result.isValid).toBe(true);
  });

  test("rejects a record missing is_ads_eligible entirely", () => {
    const record = validAdsRecord();
    delete (record as Record<string, unknown>).is_ads_eligible;

    const result = openAIAdsValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.field === "is_ads_eligible")).toBe(true);
  });

  test("still enforces the shared base rules (checkout requires seller fields)", () => {
    const result = openAIAdsValidator.validateRecord(
      validAdsRecord({ is_eligible_checkout: true }),
      1
    );
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("seller_privacy_policy"))).toBe(true);
  });

  test("accepts is_ads_eligible: false (explicitly excluded from ads, still a valid row)", () => {
    const result = openAIAdsValidator.validateRecord(
      validAdsRecord({ is_ads_eligible: false }),
      1
    );
    expect(result.isValid).toBe(true);
  });

  test("maps the legacy alias is_eligible_ads -> is_ads_eligible", () => {
    const record = validAdsRecord();
    delete (record as Record<string, unknown>).is_ads_eligible;
    (record as Record<string, unknown>).is_eligible_ads = true;

    const result = openAIAdsValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(true);
    expect(result.normalized?.is_ads_eligible).toBe(true);
  });

  test("warns when the feed uses the wrong column name is_ads_enabled", () => {
    const record = validAdsRecord({ is_ads_enabled: true });

    const issues = detectRawIssues(
      record,
      openAIAdsValidator.fieldAliases,
      openAIAdsValidator.fieldNormalizers,
      openAIAdsValidator.trapAliases,
      openAIAdsValidator.booleanFields
    );

    const trapWarning = issues.find((i) => i.field === "is_ads_enabled");
    expect(trapWarning).toBeDefined();
    expect(trapWarning?.severity).toBe("warning");
    expect(trapWarning?.problem).toContain("is_ads_eligible");
  });

  test("also warns about is_ads_enabled for the plain (non-Ads) validator", async () => {
    // is_ads_eligible (and its trap alias) now live on the shared base
    // schema, so this warning applies to both validators, not just Ads -
    // see openai/schema.test.ts for the matching case.
    const { openAIValidator } = await import("../openai/schema");
    const record = { is_ads_enabled: true };

    const issues = detectRawIssues(
      record,
      openAIValidator.fieldAliases,
      openAIValidator.fieldNormalizers,
      openAIValidator.trapAliases,
      openAIValidator.booleanFields
    );

    expect(issues.some((i) => i.field === "is_ads_enabled")).toBe(true);
  });

  test("exposes is_ads_eligible as a required target field", () => {
    const field = openAIAdsValidator.targetFields.find((f) => f.name === "is_ads_eligible");
    expect(field).toBeDefined();
    expect(field?.required).toBe(true);
  });
});
