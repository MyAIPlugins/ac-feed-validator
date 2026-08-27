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

  test("accepts backorder availability without availability_date (schema table only requires it for pre_order)", () => {
    // Flipped per Alan's PR #3 round-1 review, re-verified directly against
    // the live page: the main Feed Reference table's row is "Required if
    // availability=pre_order" only. "Include availability_date when
    // availability is preorder or backorder" is in the separate
    // "Google-compatible product data feeds" section - a different
    // input-format parser this tool doesn't implement, not this schema.
    const result = openAIValidator.validateRecord(
      validRecord({ availability: "backorder" }),
      1
    );
    expect(result.isValid).toBe(true);
  });

  test("warns (not errors) when backorder has no availability_date", () => {
    const record = validRecord({ availability: "backorder" });
    const issues = detectRawIssues(record, openAIValidator);
    const warning = issues.find((i) => i.field === "availability" && i.problem.includes("backorder"));
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
  });

  test("accepts backorder availability with availability_date, no warning raised", () => {
    const record = validRecord({ availability: "backorder", availability_date: "2026-09-01" });
    const result = openAIValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(true);
    const issues = detectRawIssues(record, openAIValidator);
    expect(issues.some((i) => i.field === "availability" && i.problem.includes("backorder"))).toBe(false);
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

  test.each(["USD", "DKK", "PLN", "CZK", "AED"])(
    "accepts price with any valid-format 3-letter currency code (%s) - not gated on a curated subset",
    (currency) => {
      // Regression for the PR #3 blocker: price used to be validated against
      // a 20-entry curated subset that didn't include DKK/PLN/CZK/AED,
      // wrongly rejecting valid feeds from merchants who use them.
      const result = openAIValidator.validateRecord(
        validRecord({ price: `19.99 ${currency}` }),
        1
      );
      expect(result.isValid).toBe(true);
    }
  );

  test("rejects a price with a lowercase currency code", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ price: "19.99 usd" }),
      1
    );
    expect(result.isValid).toBe(false);
  });

  test("rejects a price with a 2-letter currency code", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ price: "19.99 US" }),
      1
    );
    expect(result.isValid).toBe(false);
  });

  test.each(["US", "GR", "CZ", "HU", "RO"])(
    "accepts store_country with any valid-format 2-letter code (%s) - not gated on a curated subset",
    (country) => {
      // Regression for the same PR #3 blocker: store_country used to be
      // validated against a 30-entry curated subset that didn't include
      // GR/CZ/HU/RO.
      const result = openAIValidator.validateRecord(
        validRecord({ store_country: country }),
        1
      );
      expect(result.isValid).toBe(true);
    }
  );

  test("rejects a store_country that isn't 2 letters", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ store_country: "USA" }),
      1
    );
    expect(result.isValid).toBe(false);
  });

  test("rejects a target_countries value that isn't a 2-letter code", () => {
    const result = openAIValidator.validateRecord(
      validRecord({ target_countries: "United States" }),
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

    const issues = detectRawIssues(record, openAIValidator);

    const trapWarning = issues.find((i) => i.field === "is_ads_enabled");
    expect(trapWarning).toBeDefined();
    expect(trapWarning?.severity).toBe("warning");
    expect(trapWarning?.problem).toContain("is_ads_eligible");
  });

  test.each(["currency", "shipping_price", "delivery_estimate", "inventory_quantity"])(
    "warns that %s is not a spec field and is silently ignored",
    (field) => {
      const record = validRecord({ [field]: "something" });

      const issues = detectRawIssues(record, openAIValidator);

      const warning = issues.find((i) => i.field === field);
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe("warning");
    }
  );

  test("surfaces a genuinely unrecognized column as an ignored-column info", () => {
    const record = validRecord({ totally_made_up_column: "x" });

    const issues = detectRawIssues(record, openAIValidator);

    const info = issues.find((i) => i.field === "totally_made_up_column");
    expect(info).toBeDefined();
    expect(info?.severity).toBe("info");
    expect(info?.kind).toBe("ignored");
    expect(info?.problem).toContain("not part of the OpenAI product feed spec");
  });

  test("does not flag known canonical fields or their aliases as ignored columns", () => {
    const record = validRecord({ store_name: "Acme" }); // legacy alias for seller_name

    const issues = detectRawIssues(record, openAIValidator);

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

  test("targetFields now covers every schema field (was 30 of 75, Alan's PR #3 finding)", () => {
    expect(openAIValidator.targetFields.length).toBe(openAIValidator.fieldNames.length);
    for (const name of ["sale_price_start_date", "availability_date", "video_url", "marketplace_seller", "pickup_method"]) {
      expect(openAIValidator.targetFields.some((f) => f.name === name)).toBe(true);
    }
  });

  test("description no longer silently defaults to empty string when missing", () => {
    // commerceBaseDefaults used to include description: "" - dropped since
    // description is Required per spec and the default masked a missing one.
    const record = validRecord();
    delete (record as Record<string, unknown>).description;

    const result = openAIValidator.validateRecord(record, 1);
    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.field === "description")).toBe(true);
  });

  describe("cross-field rules (Alan's PR #3 addendum)", () => {
    test("rejects is_eligible_checkout=true when is_eligible_search=false", () => {
      const result = openAIValidator.validateRecord(
        validRecord({
          is_eligible_search: false,
          is_eligible_checkout: true,
          seller_privacy_policy: "https://example.com/privacy",
          seller_tos: "https://example.com/tos",
          seller_name: "Acme Store",
        }),
        1
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.message.includes("is_eligible_search"))).toBe(true);
    });

    test("rejects sale_price greater than price", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ price: "10.00 USD", sale_price: "15.00 USD" }),
        1
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.message.includes("sale_price"))).toBe(true);
    });

    test("accepts sale_price equal to price", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ price: "10.00 USD", sale_price: "10.00 USD" }),
        1
      );
      expect(result.isValid).toBe(true);
    });

    test("rejects length without dimensions_unit", () => {
      const result = openAIValidator.validateRecord(validRecord({ length: "10" }), 1);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.message.includes("dimensions_unit"))).toBe(true);
    });

    test("accepts length with dimensions_unit", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ length: "10", dimensions_unit: "in" }),
        1
      );
      expect(result.isValid).toBe(true);
    });

    test("rejects weight without item_weight_unit", () => {
      const result = openAIValidator.validateRecord(validRecord({ weight: "1.5" }), 1);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.message.includes("item_weight_unit"))).toBe(true);
    });

    test("rejects unit_pricing_measure without base_measure", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ unit_pricing_measure: "16 oz" }),
        1
      );
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.message.includes("unit_pricing_measure"))).toBe(true);
    });

    test("accepts unit_pricing_measure with base_measure", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ unit_pricing_measure: "16 oz", base_measure: "1 oz" }),
        1
      );
      expect(result.isValid).toBe(true);
    });

    test("rejects pickup_sla without pickup_method", () => {
      const result = openAIValidator.validateRecord(validRecord({ pickup_sla: "1 day" }), 1);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.message.includes("pickup_method"))).toBe(true);
    });

    test("accepts pickup_sla with pickup_method", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ pickup_sla: "1 day", pickup_method: "in_store" }),
        1
      );
      expect(result.isValid).toBe(true);
    });
  });

  describe("tightened limits and formats (Alan's PR #3 addendum)", () => {
    test("rejects size longer than 20 characters", () => {
      const result = openAIValidator.validateRecord(validRecord({ size: "a".repeat(21) }), 1);
      expect(result.isValid).toBe(false);
    });

    test("accepts size up to 20 characters", () => {
      const result = openAIValidator.validateRecord(validRecord({ size: "a".repeat(20) }), 1);
      expect(result.isValid).toBe(true);
    });

    test("rejects material longer than 100 characters", () => {
      const result = openAIValidator.validateRecord(validRecord({ material: "a".repeat(101) }), 1);
      expect(result.isValid).toBe(false);
    });

    test("rejects a size_system that isn't a 2-letter code", () => {
      const result = openAIValidator.validateRecord(validRecord({ size_system: "USA" }), 1);
      expect(result.isValid).toBe(false);
    });

    test("accepts a valid size_system", () => {
      const result = openAIValidator.validateRecord(validRecord({ size_system: "US" }), 1);
      expect(result.isValid).toBe(true);
    });

    test("accepts a relationship_type from the spec enum", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ relationship_type: "often_bought_with" }),
        1
      );
      expect(result.isValid).toBe(true);
    });

    test("rejects a relationship_type outside the spec enum", () => {
      const result = openAIValidator.validateRecord(validRecord({ relationship_type: "related" }), 1);
      expect(result.isValid).toBe(false);
    });

    test("accepts return_rate as a percent string, the spec's own example", () => {
      const result = openAIValidator.validateRecord(validRecord({ return_rate: "2%" }), 1);
      expect(result.isValid).toBe(true);
    });

    test("accepts return_rate as a bare number too", () => {
      const result = openAIValidator.validateRecord(validRecord({ return_rate: 2 }), 1);
      expect(result.isValid).toBe(true);
    });
  });

  describe("structured fields accept string or already-parsed JSON", () => {
    test("accepts q_and_a as a pre-serialized string", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ q_and_a: '[{"q":"Waterproof?","a":"Yes"}]' }),
        1
      );
      expect(result.isValid).toBe(true);
    });

    test("accepts q_and_a as already-parsed JSON (array)", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ q_and_a: [{ q: "Waterproof?", a: "Yes" }] }),
        1
      );
      expect(result.isValid).toBe(true);
    });

    test("accepts reviews as already-parsed JSON (array)", () => {
      const result = openAIValidator.validateRecord(
        validRecord({
          reviews: [{ title: "Great", content: "Loved it", minRating: 1, maxRating: 5, rating: 5 }],
        }),
        1
      );
      expect(result.isValid).toBe(true);
    });

    test("accepts variant_dict as already-parsed JSON (object)", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ variant_dict: { color: "Blue", size: "10" } }),
        1
      );
      expect(result.isValid).toBe(true);
    });

    test("accepts ads_metadata as already-parsed JSON (object)", () => {
      const result = openAIValidator.validateRecord(
        validRecord({ ads_metadata: { bidding_tier: "high" } }),
        1
      );
      expect(result.isValid).toBe(true);
    });
  });

  describe("new spec aliases (Alan's PR #3 addendum)", () => {
    test("maps additional_image_link -> additional_image_urls", () => {
      const record = validRecord({ additional_image_link: "https://example.com/2.jpg" });
      const result = openAIValidator.validateRecord(record, 1);
      expect(result.isValid).toBe(true);
      expect(result.normalized?.additional_image_urls).toBe("https://example.com/2.jpg");
    });

    test("maps product_type -> product_category", () => {
      const record = validRecord({ product_type: "Apparel > Shoes" });
      const result = openAIValidator.validateRecord(record, 1);
      expect(result.isValid).toBe(true);
      expect(result.normalized?.product_category).toBe("Apparel > Shoes");
    });

    test("maps google_product_category -> product_category when product_type is absent", () => {
      const record = validRecord({ google_product_category: "Shoes" });
      const result = openAIValidator.validateRecord(record, 1);
      expect(result.isValid).toBe(true);
      expect(result.normalized?.product_category).toBe("Shoes");
    });

    test("maps video_link -> video_url", () => {
      const record = validRecord({ video_link: "https://youtu.be/xyz" });
      const result = openAIValidator.validateRecord(record, 1);
      expect(result.isValid).toBe(true);
      expect(result.normalized?.video_url).toBe("https://youtu.be/xyz");
    });

    test("maps virtual_model_link -> model_3d_url", () => {
      const record = validRecord({ virtual_model_link: "https://example.com/model.glb" });
      const result = openAIValidator.validateRecord(record, 1);
      expect(result.isValid).toBe(true);
      expect(result.normalized?.model_3d_url).toBe("https://example.com/model.glb");
    });
  });
});
