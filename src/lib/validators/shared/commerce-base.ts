import { z } from "zod";
import type { FieldAliases, FieldNormalizers, RecordValidationResult, TrapAliases, ValidationIssue } from "../types";
import { normalizeRecord } from "../types";

// Shared building blocks for OpenAI Commerce product feed validators.
//
// Both the plain "OpenAI Product Feed" validator (src/lib/validators/openai)
// and the "OpenAI Ads Product Feed" validator (src/lib/validators/openai-ads)
// are built on the SAME base commerce fields, per OpenAI's stable product
// feed specification (developers.openai.com/commerce/specs/file-upload/products).
// The Ads feed adds exactly one thing on top: `is_ads_eligible`.
//
// This module holds everything that is shared, so the two validators don't
// duplicate ~370 lines of field definitions. Extracted from the original
// openai/schema.ts with NO behavior changes.

// ISO 4217 currency codes (common ones)
export const currencyCodes = [
  "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "HKD", "NZD",
  "SEK", "KRW", "SGD", "NOK", "MXN", "INR", "RUB", "ZAR", "BRL", "TWD",
] as const;

// ISO 3166-1 alpha-2 country codes (common ones)
export const countryCodes = [
  "US", "GB", "CA", "AU", "DE", "FR", "IT", "ES", "JP", "CN",
  "KR", "IN", "BR", "MX", "NL", "SE", "NO", "DK", "FI", "PL",
  "AT", "BE", "CH", "IE", "PT", "NZ", "SG", "HK", "TW", "ZA",
] as const;

export const availabilityValues = ["in_stock", "out_of_stock", "pre_order", "backorder", "unknown"] as const;

export const urlSchema = z.string().url().max(2048);

// Price format. Per developers.openai.com/commerce/specs/file-upload/products
// (fetched 2026-08-25): "Number + currency, ISO 4217, e.g. '79.99 USD'. Must
// include currency code." A bare number can never carry that, so (unlike the
// original version of this schema) a plain number is no longer accepted -
// this is an intentional breaking change; see the PR description for the
// old-vs-new differential.
function isValidPriceWithCurrency(value: string): boolean {
  const match = value.match(/^\d+(\.\d{1,2})?\s([A-Z]{3})$/);
  return !!match && (currencyCodes as readonly string[]).includes(match[2]);
}

export const priceSchema = z.string().min(1).refine(isValidPriceWithCurrency, {
  message: 'Price must be a number followed by a currency code, e.g. "79.99 USD"',
});

// shipping: "country:region:service_class:price:min_handling_days:max_handling_days:min_transit_days:max_transit_days",
// e.g. "US:CA:Overnight:16.00 USD:1:2:1:3". Per the same spec page: "Omitting
// fields is allowed ('US::Overnight:16.00 USD'); use colon separators" -
// every part except the leading country code may be left empty.
export const shippingSchema = z.string().min(1).refine((value) => {
  const parts = value.split(":");
  if (parts.length === 0 || parts.length > 8) return false;
  const [country, , , price, minHandling, maxHandling, minTransit, maxTransit] = parts;
  if (!country || !/^[A-Z]{2}$/.test(country)) return false;
  if (price && !isValidPriceWithCurrency(price)) return false;
  for (const days of [minHandling, maxHandling, minTransit, maxTransit]) {
    if (days && !/^\d+$/.test(days)) return false;
  }
  return true;
}, {
  message: 'shipping must be "country:region:service_class:price:min_handling_days:max_handling_days:min_transit_days:max_transit_days" (parts may be empty except country), e.g. "US:CA:Overnight:16.00 USD:1:2:1:3"',
});

// ISO 8601 date format
export const dateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/,
  "Date must be in ISO 8601 format"
);

// Boolean that accepts various string formats
export const booleanSchema = z.union([
  z.boolean(),
  z.enum(["true", "false", "TRUE", "FALSE", "True", "False", "1", "0"]),
]).transform((v) => {
  if (typeof v === "boolean") return v;
  return ["true", "TRUE", "True", "1"].includes(v);
});

// Base commerce fields shared by every OpenAI product feed variant.
//
// Field set verified against developers.openai.com/commerce/specs/file-upload/products
// (fetched 2026-08-25, 107 fields on the live page). Three renames below
// (seller_name, return_deadline_in_days, sale_price_start_date/end_date)
// replace names this schema used before that didn't match the spec - the old
// names are kept working as aliases (see commerceBaseAliases) so existing
// feed files don't silently break. currency, shipping_price,
// delivery_estimate and inventory_quantity are NOT spec fields and have been
// removed - they're registered in commerceBaseTrapAliases instead, so a feed
// still using them gets a warning instead of the column being silently
// dropped with no explanation.
export const commerceBaseFields = {
  // OpenAI Control Flags (Required)
  is_eligible_search: booleanSchema,
  is_eligible_checkout: booleanSchema,

  // Basic Product Data (Required)
  item_id: z.string().min(1).max(100),
  gtin: z.string().regex(/^\d{8,14}$/, "GTIN must be 8-14 digits").optional(),
  mpn: z.string().max(70).optional(),
  title: z.string().min(1).max(150).refine(
    (title) => title !== title.toUpperCase() || title.length <= 10,
    { message: "Avoid using all-caps for titles" }
  ),
  description: z.string().max(5000),
  url: urlSchema,
  brand: z.string().min(1).max(70),

  // Pricing (Required)
  price: priceSchema,
  sale_price: priceSchema.optional(),
  sale_price_start_date: dateSchema.optional(),
  sale_price_end_date: dateSchema.optional(),

  // Availability (Required)
  availability: z.enum(availabilityValues),
  // Required when availability is pre_order OR backorder - enforced in
  // withCommerceRefinements below. Per spec: the field table row only says
  // "Required if availability=pre_order", but the page's own notes add
  // "Include availability_date when availability is preorder or backorder".
  availability_date: dateSchema.optional(),
  expiration_date: dateSchema.optional(),

  // Media (Required)
  image_url: urlSchema,
  additional_image_urls: z.string().optional(),
  video_url: urlSchema.optional(),
  model_3d_url: urlSchema.optional(),

  // Variants
  group_id: z.string().max(70).optional(),
  item_group_title: z.string().max(150).refine(
    (title) => title !== title.toUpperCase() || title.length <= 10,
    { message: "Avoid using all-caps for group titles" }
  ).optional(),
  listing_has_variations: booleanSchema.optional(),
  variant_dict: z.string().optional(),
  size: z.string().max(100).optional(),
  color: z.string().max(40).optional(),
  size_system: z.string().optional(),
  gender: z.enum(["male", "female", "unisex"]).optional(),
  offer_id: z.string().optional(),

  // Merchant Information (Required for checkout)
  seller_name: z.string().max(70).optional(),
  marketplace_seller: z.string().optional(),
  seller_url: urlSchema.optional(),
  seller_privacy_policy: urlSchema.optional(),
  seller_tos: urlSchema.optional(),

  // Returns Policy - all four Optional per spec (a merchant that doesn't
  // accept returns needs neither a policy URL nor a return window). Found
  // during this audit's implementation, same class of fix as store_country
  // below - flagged separately since it wasn't in the original review list.
  return_policy: urlSchema.optional(),
  return_deadline_in_days: z.union([
    z.number().int().positive(),
    z.string().regex(/^\d+$/),
  ]).transform((v) => Number(v)).optional(),
  accepts_returns: booleanSchema.optional(),
  accepts_exchanges: booleanSchema.optional(),

  // Fulfillment
  shipping: shippingSchema.optional(),
  pickup_method: z.enum(["in_store", "reserve", "not_supported"]).optional(),
  pickup_sla: z.string().optional(),
  unit_pricing_measure: z.string().optional(),
  base_measure: z.string().optional(),
  is_digital: booleanSchema.optional(),

  // Geo Targeting (Required)
  // Spec: List, Required, "first entry used" - a comma/array of countries is
  // accepted for compatibility, but OpenAI itself only reads the first entry.
  target_countries: z.union([
    z.string().min(2),
    z.array(z.string().min(2)).min(1),
  ]),
  store_country: z.enum(countryCodes).optional(),
  geo_price: z.string().optional(),
  geo_availability: z.string().optional(),

  // Item Information (Optional)
  condition: z.enum(["new", "refurbished", "used"]).optional(),
  product_category: z.string().optional(),
  material: z.string().optional(),
  dimensions: z.string().optional(),
  length: z.string().optional(),
  width: z.string().optional(),
  height: z.string().optional(),
  dimensions_unit: z.string().optional(),
  weight: z.string().optional(),
  item_weight_unit: z.string().optional(),
  age_group: z.enum(["newborn", "infant", "toddler", "kids", "adult"]).optional(),
  pricing_trend: z.string().max(80).optional(),

  // Performance (Optional)
  popularity_score: z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).optional(),
  return_rate: z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).optional(),

  // Compliance (Optional)
  warning: z.string().optional(),
  warning_url: urlSchema.optional(),
  age_restriction: z.union([z.number().int(), z.string().regex(/^\d+$/)]).optional(),

  // Reviews (Optional)
  review_count: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).optional(),
  star_rating: z.union([
    z.number().min(0).max(5),
    z.string().regex(/^[0-5](\.\d+)?$/),
  ]).optional(),
  store_review_count: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).optional(),
  store_star_rating: z.union([
    z.number().min(0).max(5),
    z.string().regex(/^[0-5](\.\d+)?$/),
  ]).optional(),
  q_and_a: z.string().optional(),
  reviews: z.string().optional(),

  // Related Products (Optional)
  related_product_id: z.string().optional(),
  relationship_type: z.string().optional(),

  // Ads (Optional here; the openai-ads validator overrides this as required).
  // Per developers.openai.com/ads/product-feeds: "Required (Ads); Optional
  // (non-Ads)". Kept on the base schema (not Ads-only) so a merchant running
  // ONE feed file through the plain OpenAI validator doesn't have this column
  // silently stripped from the export by Zod's default unknown-key handling.
  is_ads_eligible: booleanSchema.optional(),
  ads_metadata: z.string().optional(),
};

// variant_dict, reviews, geo_price, geo_availability and ads_metadata are
// structured (JSON object / list / region-keyed) in the spec. Raw feed rows
// (CSV/JSONL) give us these as plain strings, and the spec doesn't fully
// pin down their sub-shape - kept as free-form strings deliberately rather
// than guessing a stricter shape that might reject valid data.

export const commerceBaseSchema = z.object(commerceBaseFields);

// Every canonical field name this schema recognizes - see ValidatorModule.fieldNames.
export const commerceBaseFieldNames: string[] = Object.keys(commerceBaseFields);

// Minimal shape withCommerceRefinements' checks rely on. Any schema built on
// commerceBaseFields (with or without extra fields like is_ads_eligible)
// satisfies this.
type CommerceRefinementFields = {
  is_eligible_checkout: boolean;
  seller_privacy_policy?: string;
  seller_tos?: string;
  seller_name?: string;
  availability: string;
  availability_date?: string;
};

// The two cross-field rules from OpenAI's spec that apply to every commerce
// feed regardless of platform (checkout eligibility, pre-order availability).
// Kept as a standalone function (not baked into commerceBaseSchema) so it can
// be applied as the LAST step, after a platform extends the base with its own
// fields (e.g. openai-ads adding is_ads_eligible) — refinements should see the
// final, fully-composed shape. (Verified against zod 4.3.5: .refine() on a
// ZodObject does NOT block a later .extend() in this version, unlike Zod 3's
// ZodEffects wrapper — this split isn't required by that constraint, it's
// just the correct order regardless of Zod's internal API.)
export function withCommerceRefinements<T extends z.ZodType<CommerceRefinementFields>>(schema: T) {
  return schema
    .refine(
      (data: z.infer<T>) => {
        if (data.is_eligible_checkout) {
          return !!data.seller_privacy_policy && !!data.seller_tos && !!data.seller_name;
        }
        return true;
      },
      { message: "Checkout-enabled products require seller_privacy_policy, seller_tos, and seller_name" }
    )
    .refine(
      (data: z.infer<T>) => {
        // Per developers.openai.com/commerce/specs/file-upload/products
        // (fetched 2026-08-25): "Include availability_date when availability
        // is preorder or backorder" - the field table row alone only
        // mentions pre_order, but the page's own note covers both.
        if (data.availability === "pre_order" || data.availability === "backorder") {
          return !!data.availability_date;
        }
        return true;
      },
      { message: "Pre-order and backorder products require availability_date" }
    );
}

// Field aliases shared by every OpenAI product feed variant: map common CSV
// column names to canonical OpenAI field names.
export const commerceBaseAliases: FieldAliases = {
  // Control flags
  is_eligible_search: ["enable_search", "eligible_search", "search_enabled", "searchable"],
  is_eligible_checkout: ["enable_checkout", "eligible_checkout", "checkout_enabled", "buyable"],

  // Basic product data
  item_id: ["id", "product_id", "sku", "item_code", "article_id"],
  title: ["name", "product_name", "product_title", "item_name"],
  description: ["desc", "product_description", "long_description", "body"],
  url: ["link", "product_url", "product_link", "page_url", "canonical_url"],
  brand: ["manufacturer", "brand_name", "vendor"],

  // Pricing
  price: ["regular_price", "base_price", "list_price"],
  sale_price: ["special_price", "discount_price", "promo_price"],

  // Availability
  availability: ["stock_status", "stock"],

  // Media
  image_url: ["image_link", "image", "main_image", "primary_image", "picture"],
  additional_image_urls: ["additional_images", "extra_images", "gallery"],

  // Variants
  group_id: ["item_group_id", "parent_id", "variant_group", "product_group"],
  item_group_title: ["group_title", "variant_group_title", "parent_title"],
  listing_has_variations: ["has_variants", "has_variations", "is_variant"],

  // Merchant info
  seller_name: ["store_name", "merchant_name", "shop_name"],

  // Returns - renamed to match the spec's return_deadline_in_days; the old
  // return_window name is kept working as an alias.
  return_deadline_in_days: ["return_window"],

  // Pricing - renamed to match the spec's sale_price_start_date/end_date.
  sale_price_start_date: ["sale_price_effective_date_begin"],
  sale_price_end_date: ["sale_price_effective_date_end"],

  // Media
  video_url: ["video", "product_video"],

  // Basic product data
  gtin: ["upc", "ean"],

  // Geo
  target_countries: ["countries", "ship_to_countries", "available_countries"],
  store_country: ["country", "merchant_country", "seller_country"],

  // Ads
  is_ads_eligible: ["is_eligible_ads"],
};

// Boolean-typed fields shared by every OpenAI product feed variant - drives
// the "boolean sent as string" raw-issue warning. Owned here (next to where
// each field is actually declared as booleanSchema) instead of a separate
// hardcoded list in validate-client.ts, so adding a boolean field can't
// silently forget to also register it for that warning.
export const commerceBaseBooleanFields: string[] = [
  "is_eligible_search",
  "is_eligible_checkout",
  "is_ads_eligible",
  "listing_has_variations",
  "accepts_returns",
  "accepts_exchanges",
  "is_digital",
];

// Known-wrong-but-plausible or no-longer-supported column names shared by
// every OpenAI product feed variant - each of these silently does nothing
// (Zod strips them as unknown keys) unless the merchant is told otherwise.
export const commerceBaseTrapAliases: TrapAliases = {
  is_ads_enabled: 'OpenAI does not read "is_ads_enabled" - it is silently ignored. Rename this column to "is_ads_eligible".',
  // currency, shipping_price, delivery_estimate and inventory_quantity were
  // never real spec fields (verified against developers.openai.com/commerce/specs/file-upload/products,
  // fetched 2026-08-25) and have been removed from the schema. Registered
  // here, same mechanism as is_ads_enabled, so a feed still using them gets
  // a warning instead of the column silently vanishing from the export.
  currency: 'OpenAI does not read "currency" as a separate column - it is silently ignored. Include the currency code directly in "price" instead, e.g. "63.00 EUR".',
  shipping_price: 'OpenAI does not read "shipping_price" - it is silently ignored. Provide "shipping" instead, formatted as "country:region:service_class:price:min_handling_days:max_handling_days:min_transit_days:max_transit_days", e.g. "US:CA:Overnight:16.00 USD:1:2:1:3".',
  delivery_estimate: 'OpenAI does not read "delivery_estimate" - it is silently ignored. Provide "shipping" instead, formatted as "country:region:service_class:price:min_handling_days:max_handling_days:min_transit_days:max_transit_days".',
  inventory_quantity: 'OpenAI does not read "inventory_quantity" - it is not part of the product feed spec and is silently ignored.',
};

// Normalizers shared by every OpenAI product feed variant: transform values
// to canonical format before validation.
export const commerceBaseNormalizers: FieldNormalizers = {
  // Normalize price: "63,00 EUR" -> "63.00 EUR"
  price: (value) => {
    if (typeof value !== "string") return value;
    return value.replace(/(\d+),(\d{2})(\s|$|[A-Z])/, "$1.$2$3").trim();
  },

  sale_price: (value) => {
    if (typeof value !== "string") return value;
    return value.replace(/(\d+),(\d{2})(\s|$|[A-Z])/, "$1.$2$3").trim();
  },

  // Normalize availability: "in stock" -> "in_stock"
  availability: (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.toLowerCase().trim().replace(/\s+/g, "_");
    const mapping: Record<string, string> = {
      "in_stock": "in_stock",
      "instock": "in_stock",
      "available": "in_stock",
      "out_of_stock": "out_of_stock",
      "outofstock": "out_of_stock",
      "unavailable": "out_of_stock",
      "sold_out": "out_of_stock",
      "pre_order": "pre_order",
      "preorder": "pre_order",
      "pre-order": "pre_order",
      "backorder": "backorder",
      "back_order": "backorder",
      "back-order": "backorder",
    };
    return mapping[normalized] ?? normalized;
  },

  // Normalize return_deadline_in_days: "14 days" -> "14"
  return_deadline_in_days: (value) => {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const match = value.match(/^(\d+)/);
    return match ? match[1] : value;
  },

  // Normalize condition
  condition: (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.toLowerCase().trim();
    const mapping: Record<string, string> = {
      "new": "new",
      "nuovo": "new",
      "neuf": "new",
      "neu": "new",
      "refurbished": "refurbished",
      "ricondizionato": "refurbished",
      "used": "used",
      "usato": "used",
    };
    return mapping[normalized] ?? normalized;
  },

  // Normalize description: handle empty/null
  description: (value) => {
    if (value === "" || value === null || value === undefined) return "";
    return String(value);
  },
};

// Default values shared by every OpenAI product feed variant.
//
// target_countries and store_country used to default to "IT" here. Dropped:
// target_countries is Required per spec, so a feed missing it should get a
// clear validation error the merchant can fix via the mapping dialog, not a
// silently-guessed country; store_country is Optional, so it needs no
// default at all - "missing" is already a valid, meaningful state for it.
export const commerceBaseDefaults: Record<string, unknown> = {
  description: "",
};

// Metadata used by the field-mapping dialog. Kept in sync with
// commerceBaseFields' required/optional split. This used to live as a
// hardcoded, hand-maintained array inside src/app/page.tsx (OPENAI_TARGET_FIELDS) —
// duplicated from the schema and only ever wired to ONE validator. Moving it
// here means every validator supplies its own accurate list, and a second
// validator (openai-ads) can extend it instead of the UI silently keeping
// the old field list forever.
export const commerceBaseTargetFields: { name: string; required: boolean; description: string }[] = [
  { name: "is_eligible_search", required: true, description: "Enable ChatGPT search" },
  { name: "is_eligible_checkout", required: true, description: "Enable in-app checkout" },
  { name: "item_id", required: true, description: "Unique product ID" },
  { name: "gtin", required: false, description: "Universal product code (8-14 digits)" },
  { name: "mpn", required: false, description: "Manufacturer part number" },
  { name: "title", required: true, description: "Product name" },
  { name: "description", required: false, description: "Product description" },
  { name: "url", required: true, description: "Product page URL" },
  { name: "brand", required: true, description: "Brand name" },
  { name: "price", required: true, description: "Regular price with currency, e.g. \"79.99 USD\"" },
  { name: "sale_price", required: false, description: "Sale price with currency" },
  { name: "availability", required: true, description: "Stock status" },
  { name: "image_url", required: true, description: "Main product image" },
  { name: "additional_image_urls", required: false, description: "Extra images" },
  { name: "shipping", required: false, description: "country:region:service:price:handling/transit days" },
  { name: "group_id", required: false, description: "Variant group ID" },
  { name: "item_group_title", required: false, description: "Group product title" },
  { name: "listing_has_variations", required: false, description: "Has variants" },
  { name: "size", required: false, description: "Product size" },
  { name: "color", required: false, description: "Product color" },
  { name: "condition", required: false, description: "new/refurbished/used" },
  { name: "product_category", required: false, description: "Product category" },
  { name: "seller_name", required: false, description: "Merchant name" },
  { name: "seller_url", required: false, description: "Merchant URL" },
  { name: "return_policy", required: false, description: "Return policy URL" },
  { name: "return_deadline_in_days", required: false, description: "Return window in days" },
  { name: "target_countries", required: true, description: "Target countries (ISO, first entry used)" },
  { name: "store_country", required: false, description: "Store country (ISO)" },
  { name: "material", required: false, description: "Product material" },
  // Optional here; the openai-ads validator's targetFields overrides this
  // entry as required (filters it out and re-adds it - see openai-ads/schema.ts).
  { name: "is_ads_eligible", required: false, description: "Eligible for ChatGPT Ads (optional here; required in the Ads validator)" },
];

// Builds validateRecord/validateRecordRaw for a given (already-refined) Zod
// schema + its aliases/normalizers/defaults. Identical safeParse-and-map-issues
// logic used to be duplicated per validator; extracted here since it has
// nothing platform-specific in it.
export function createRecordValidators<T extends z.ZodTypeAny>(
  schema: T,
  aliases: FieldAliases,
  normalizers: FieldNormalizers,
  defaults?: Record<string, unknown>
): {
  validateRecord: (record: Record<string, unknown>, row: number) => RecordValidationResult;
  validateRecordRaw: (record: Record<string, unknown>, row: number) => RecordValidationResult;
} {
  function mapIssues(
    result: { success: false; error: z.ZodError },
    row: number,
    source: Record<string, unknown>
  ): ValidationIssue[] {
    return result.error.issues.map((issue) => ({
      row,
      field: issue.path.join("."),
      message: issue.message,
      severity: "error" as const,
      value: issue.path.reduce((obj: unknown, key) => {
        if (obj && typeof obj === "object" && key in obj) {
          return (obj as Record<string, unknown>)[key as string];
        }
        return undefined;
      }, source),
    }));
  }

  function validateRecord(record: Record<string, unknown>, row: number): RecordValidationResult {
    const normalized = normalizeRecord(record, aliases, normalizers, defaults);
    const result = schema.safeParse(normalized);

    if (result.success) {
      return {
        row,
        isValid: true,
        issues: [],
        data: result.data as Record<string, unknown>,
        normalized,
      };
    }

    return {
      row,
      isValid: false,
      issues: mapIssues(result, row, normalized),
      normalized,
    };
  }

  // Validate WITHOUT applying normalizations - shows raw feed state
  function validateRecordRaw(record: Record<string, unknown>, row: number): RecordValidationResult {
    const result = schema.safeParse(record);

    if (result.success) {
      return {
        row,
        isValid: true,
        issues: [],
        data: result.data as Record<string, unknown>,
      };
    }

    return {
      row,
      isValid: false,
      issues: mapIssues(result, row, record),
    };
  }

  return { validateRecord, validateRecordRaw };
}
