import { describe, test, expect } from "bun:test";
import { openAIValidator } from "./schema";
import { detectRawIssues } from "../validate-client";

// Regression tests for the plain "OpenAI Product Feed" validator, written
// against the post-refactor version (fields extracted into
// shared/commerce-base.ts). These prove the extraction didn't change any
// observable behavior for the validator that already ships today.
//
// Updated for the spec-drift audit PR (verified against
// developers.openai.com/commerce/specs/file-upload/products, fetched
// 2026-08-25): price now requires an embedded currency code, store_name was
// renamed to seller_name (old name kept as an alias), return_window was
// renamed to return_deadline_in_days (same), store_country/return_policy/
// return_deadline_in_days are now Optional per spec, and the silent
// target_countries/store_country "IT" defaults were removed.

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    is_eligible_search: true,
    is_eligible_checkout: false,
    item_id: "SKU123",
    title: "Test Product",
    description: "A great product",
    url: "https://example.com/product/123",
    brand: "Acme",
    price: "19.99 USD",
    availability: "in_stock",
    image_url: "https://example.com/image.jpg",
    return_policy: "https://example.com/returns",
    return_deadline_in_days: 30,
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
        seller_name: "Acme Store",
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

  test("rejects backorder availability without availability_date", () => {
    // Per spec notes (not the field table row alone): "Include
    // availability_date when availability is preorder or backorder".
    const result = openAIValidator.validateRecord(
      validRecord({ availability: "backorder" }),
      1
    );
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("availability_date"))).toBe(true);
  });

  test("accepts backorder availability with availability_date", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ availability: "backorder", availability_date: "2026-09-01" }),
      1
    );
    expect(result.isValid).toBe(true);
  });

  test("normalizes comma-decimal price before validating", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ price: "63,00 EUR" }),
      1
    );
    expect(result.isValid).toBe(true);
    expect(result.normalized?.price).toBe("63.00 EUR");
  });

  test("rejects a price with no currency code (breaking change per spec)", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ price: "19.99" }),
      1
    );
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.field === "price")).toBe(true);
  });

  test("rejects a bare numeric price (breaking change per spec)", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ price: 19.99 }),
      1
    );
    expect(result.isValid).toBe(false);
  });

  test("rejects a price with an unrecognized currency code", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ price: "19.99 XXX" }),
      1
    );
    expect(result.isValid).toBe(false);
  });

  test("maps a known alias column (link -> url)", () => {
    const record = validRecord();
    delete (record as Record<string, unknown>).url;
    (record as Record<string, unknown>).link = "https://example.com/aliased";

    const result = openAIValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(true);
    expect(result.normalized?.url).toBe("https://example.com/aliased");
  });

  test("maps the legacy alias store_name -> seller_name", () => {
    const record = validRecord({
      is_eligible_checkout: true,
      seller_privacy_policy: "https://example.com/privacy",
      seller_tos: "https://example.com/tos",
      store_name: "Acme Store",
    });

    const result = openAIValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(true);
    expect(result.normalized?.seller_name).toBe("Acme Store");
  });

  test("maps the legacy alias return_window -> return_deadline_in_days", () => {
    const record = validRecord();
    delete (record as Record<string, unknown>).return_deadline_in_days;
    (record as Record<string, unknown>).return_window = 30;

    const result = openAIValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(true);
    expect(result.normalized?.return_deadline_in_days).toBe(30);
  });

  test("maps the legacy aliases for sale_price_start_date/end_date", () => {
    const record = validRecord({
      sale_price: "15.00 USD",
      sale_price_effective_date_begin: "2026-09-01",
      sale_price_effective_date_end: "2026-09-30",
    });

    const result = openAIValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(true);
    expect(result.normalized?.sale_price_start_date).toBe("2026-09-01");
    expect(result.normalized?.sale_price_end_date).toBe("2026-09-30");
  });

  test("store_country is optional", () => {
    const record = validRecord();
    delete (record as Record<string, unknown>).store_country;

    const result = openAIValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(true);
  });

  test("return_policy and return_deadline_in_days are optional", () => {
    const record = validRecord();
    delete (record as Record<string, unknown>).return_policy;
    delete (record as Record<string, unknown>).return_deadline_in_days;

    const result = openAIValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(true);
  });

  test("target_countries is required and has no silent default", () => {
    // commerceBaseDefaults used to silently fill target_countries/store_country
    // with "IT" - removed since target_countries is Required per spec.
    const record = validRecord();
    delete (record as Record<string, unknown>).target_countries;

    const result = openAIValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.field === "target_countries")).toBe(true);
  });

  test("accepts a valid gtin and mpn", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ gtin: "012345678905", mpn: "ABC-123" }),
      1
    );
    expect(result.isValid).toBe(true);
  });

  test("rejects a malformed gtin", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ gtin: "not-a-gtin" }),
      1
    );
    expect(result.isValid).toBe(false);
  });

  test("accepts a valid shipping value, all parts present", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ shipping: "US:CA:Overnight:16.00 USD:1:2:1:3" }),
      1
    );
    expect(result.isValid).toBe(true);
  });

  test("accepts shipping with omitted middle parts", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ shipping: "US::Overnight:16.00 USD" }),
      1
    );
    expect(result.isValid).toBe(true);
  });

  test("rejects shipping missing the country part", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ shipping: ":CA:Overnight:16.00 USD" }),
      1
    );
    expect(result.isValid).toBe(false);
  });

  test("rejects shipping with a malformed price part", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ shipping: "US:CA:Overnight:16.00" }),
      1
    );
    expect(result.isValid).toBe(false);
  });

  test("accepts is_ads_eligible as an optional field (shared with the Ads validator)", () => {
    // is_ads_eligible now lives on the shared base schema as optional -
    // OpenAI's own spec lists it as "Required (Ads); Optional (non-Ads)".
    // It must survive validation rather than being stripped as an unknown key.
    const result = openAIValidator.validateRecord(
      validRecord({ is_ads_eligible: true }),
      1
    );
    expect(result.isValid).toBe(true);
    expect(result.data?.is_ads_eligible).toBe(true);
  });

  test("still validates fine when is_ads_eligible is absent", () => {
    const result = openAIValidator.validateRecord(validRecord(), 1);
    expect(result.isValid).toBe(true);
  });

  test("warns on the is_ads_enabled trap column (inherited from the shared base)", () => {
    const record = validRecord({ is_ads_enabled: true });

    const issues = detectRawIssues(
      record,
      openAIValidator.fieldAliases,
      openAIValidator.fieldNormalizers,
      openAIValidator.trapAliases,
      openAIValidator.booleanFields,
      openAIValidator.fieldNames
    );

    const trapWarning = issues.find((i) => i.field === "is_ads_enabled");
    expect(trapWarning).toBeDefined();
    expect(trapWarning?.severity).toBe("warning");
    expect(trapWarning?.problem).toContain("is_ads_eligible");
  });

  test.each(["currency", "shipping_price", "delivery_estimate", "inventory_quantity"])(
    "warns that %s is not a spec field and is silently ignored",
    (field) => {
      const record = validRecord({ [field]: "something" });

      const issues = detectRawIssues(
        record,
        openAIValidator.fieldAliases,
        openAIValidator.fieldNormalizers,
        openAIValidator.trapAliases,
        openAIValidator.booleanFields,
        openAIValidator.fieldNames
      );

      const warning = issues.find((i) => i.field === field);
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe("warning");
    }
  );

  test("surfaces a genuinely unrecognized column as an ignored-column info", () => {
    const record = validRecord({ totally_made_up_column: "x" });

    const issues = detectRawIssues(
      record,
      openAIValidator.fieldAliases,
      openAIValidator.fieldNormalizers,
      openAIValidator.trapAliases,
      openAIValidator.booleanFields,
      openAIValidator.fieldNames
    );

    const info = issues.find((i) => i.field === "totally_made_up_column");
    expect(info).toBeDefined();
    expect(info?.severity).toBe("info");
    expect(info?.problem).toContain("not part of the OpenAI product feed spec");
  });

  test("does not flag known canonical fields or their aliases as ignored columns", () => {
    const record = validRecord({ store_name: "Acme" }); // legacy alias for seller_name

    const issues = detectRawIssues(
      record,
      openAIValidator.fieldAliases,
      openAIValidator.fieldNormalizers,
      openAIValidator.trapAliases,
      openAIValidator.booleanFields,
      openAIValidator.fieldNames
    );

    expect(issues.some((i) => i.field === "store_name" && i.severity === "info" && i.problem.includes("not part of"))).toBe(false);
  });

  test("exposes targetFields for the field-mapping dialog", () => {
    expect(openAIValidator.targetFields.length).toBeGreaterThan(0);
    expect(openAIValidator.targetFields.some((f) => f.name === "item_id" && f.required)).toBe(true);
    expect(
      openAIValidator.targetFields.some((f) => f.name === "is_ads_eligible" && !f.required)
    ).toBe(true);
    expect(
      openAIValidator.targetFields.some((f) => f.name === "seller_name")
    ).toBe(true);
    expect(
      openAIValidator.targetFields.some((f) => f.name === "store_country" && !f.required)
    ).toBe(true);
  });
});
