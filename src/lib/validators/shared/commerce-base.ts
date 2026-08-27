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

// Country/currency codes are validated by FORMAT, not against a curated
// subset. An earlier version of this file gated price/store_country against
// small hardcoded lists (20 currencies, 30 countries) - Alan caught this in
// PR #3 review: DKK/PLN/CZK/AED and GR/CZ/HU/RO all rejected as "invalid"
// despite being real ISO codes we have clients in. The spec's own Validation
// Rules confirm price/sale_price use the full ISO 4217 set and
// target_countries/store_country use the full ISO 3166-1 alpha-2 set - not a
// subset - and a hand-maintained list is exactly the "can drift out of sync"
// problem this codebase already fixed once for booleanFields/fieldNames.
// Format validation has no list to go stale.
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;

export const availabilityValues = ["in_stock", "out_of_stock", "pre_order", "backorder", "unknown"] as const;

export const urlSchema = z.string().url().max(2048);

// Price format. Per developers.openai.com/commerce/specs/file-upload/products
// (fetched 2026-08-25, re-verified 2026-08-25 with every field's expanded
// Validation Rules): "Number + currency" example "79.99 USD", Supported
// Values "ISO 4217", Validation Rules "Must include currency code". A bare
// number can never carry that, so (unlike the original version of this
// schema) a plain number is no longer accepted - this is an intentional
// breaking change; see the PR description for the old-vs-new differential.
function isValidPriceWithCurrency(value: string): boolean {
  const match = value.match(/^\d+(\.\d{1,2})?\s([A-Z]{3})$/);
  return !!match && CURRENCY_CODE_RE.test(match[2]);
}

// Extracts the numeric amount from a validated "NN.NN CUR" string, for
// cross-field comparisons (e.g. sale_price <= price). Returns null for
// anything that isn't already a valid price string - callers should only
// compare when both sides parse.
function priceAmount(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^(\d+(?:\.\d{1,2})?)\s[A-Z]{3}$/);
  return match ? Number(match[1]) : null;
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

// Fields the spec defines as a structured list/object (q_and_a, reviews,
// variant_dict, ads_metadata) but that a raw CSV/JSONL row may deliver
// either as a pre-serialized string or as already-parsed JSON. Per Alan's
// review: "loose inner shape is fine; rejecting valid JSONL is not" - these
// deliberately don't pin down the item/object shape any tighter than the
// spec itself does.
const stringOrArraySchema = z.union([z.string(), z.array(z.unknown())]).optional();
const stringOrObjectSchema = z.union([z.string(), z.record(z.string(), z.unknown())]).optional();

// Base commerce fields shared by every OpenAI product feed variant.
//
// Field set verified against developers.openai.com/commerce/specs/file-upload/products
// (fetched 2026-08-25, re-verified 2026-08-25 by expanding every field card's
// "Show more" detail in the live DOM - the page's own "All fields (79)"
// toggle is the field count; an earlier revision of this comment said 107,
// which was never a real count from this page). Three renames below
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
  // Required when availability is pre_order - enforced in
  // withCommerceRefinements below. Per spec, the main Feed Reference table's
  // row is explicit: "Required if availability=pre_order" - that's this
  // schema. The "preorder or backorder" wording lives in a DIFFERENT section
  // ("Google-compatible product data feeds" - a separate input-format parser
  // for feeds using Google Shopping's field names, which this tool doesn't
  // implement), not in this table. Re-verified 2026-08-25 directly against
  // the live page; backorder-without-date is a warning, not a hard error -
  // see the raw-issue check in validate-client.ts.
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
  // variant_dict: spec type is "Object" (JSON object with string values), but
  // raw CSV/JSONL rows may deliver it as a pre-serialized string - accept
  // either rather than rejecting valid JSONL that already parsed it.
  variant_dict: stringOrObjectSchema,
  size: z.string().max(20).optional(),
  color: z.string().max(40).optional(),
  size_system: z.string().regex(COUNTRY_CODE_RE, "size_system must be a 2-letter ISO 3166-1 alpha-2 country code").optional(),
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
  // Spec: List, Required, "first entry used", Validation Rules "Use ISO
  // 3166-1 alpha-2 codes" - a comma/array of countries is accepted for
  // compatibility, but OpenAI itself only reads the first entry. Tightened
  // from a bare min(2)-chars check (which wrongly accepted 3-letter and
  // full-name values) to the actual 2-letter format, same fix class as the
  // store_country blocker below.
  target_countries: z.union([
    z.string().regex(COUNTRY_CODE_RE, "target_countries must use ISO 3166-1 alpha-2 codes"),
    z.array(z.string().regex(COUNTRY_CODE_RE, "target_countries must use ISO 3166-1 alpha-2 codes")).min(1),
  ]),
  store_country: z.string().regex(COUNTRY_CODE_RE, "store_country must be a 2-letter ISO 3166-1 alpha-2 code").optional(),
  geo_price: z.string().optional(),
  geo_availability: z.string().optional(),

  // Item Information (Optional)
  condition: z.enum(["new", "refurbished", "used"]).optional(),
  product_category: z.string().optional(),
  material: z.string().max(100).optional(),
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
  // Spec example is "2%" (Validation Rules: "0-100%") - a percent string,
  // despite the Data Type column saying "Number". Accept an optional
  // trailing "%" so the spec's own example doesn't get rejected.
  return_rate: z.union([z.number(), z.string().regex(/^\d+(\.\d+)?%?$/)]).optional(),

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
  // q_and_a / reviews: spec type is "List" (JSON array of objects), but raw
  // CSV/JSONL rows may deliver either a pre-serialized string or already-
  // parsed JSON - see stringOrArraySchema above.
  q_and_a: stringOrArraySchema,
  reviews: stringOrArraySchema,

  // Related Products (Optional)
  related_product_id: z.string().optional(),
  relationship_type: z.enum([
    "part_of_set", "required_part", "often_bought_with",
    "substitute", "different_brand", "accessory",
  ]).optional(),

  // Ads (Optional here; the openai-ads validator overrides this as required).
  // Per developers.openai.com/ads/product-feeds: "Required (Ads); Optional
  // (non-Ads)". Kept on the base schema (not Ads-only) so a merchant running
  // ONE feed file through the plain OpenAI validator doesn't have this column
  // silently stripped from the export by Zod's default unknown-key handling.
  is_ads_eligible: booleanSchema.optional(),
  // ads_metadata: spec type is "Object" (JSON object, string keys/values) -
  // see stringOrObjectSchema above.
  ads_metadata: stringOrObjectSchema,
};

// q_and_a, reviews, variant_dict and ads_metadata accept string OR
// array/object (see stringOrArraySchema/stringOrObjectSchema above) since
// raw JSONL rows may already carry parsed JSON. geo_price and
// geo_availability are region-keyed compound text ("79.99 USD (California)",
// "in_stock (Texas), out_of_stock (New York)") - the spec doesn't pin down a
// stricter shape for either, so they stay free-form strings.

export const commerceBaseSchema = z.object(commerceBaseFields);

// Every canonical field name this schema recognizes - see ValidatorModule.fieldNames.
export const commerceBaseFieldNames: string[] = Object.keys(commerceBaseFields);

// Minimal shape withCommerceRefinements' checks rely on. Any schema built on
// commerceBaseFields (with or without extra fields like is_ads_eligible)
// satisfies this.
type CommerceRefinementFields = {
  is_eligible_search: boolean;
  is_eligible_checkout: boolean;
  seller_privacy_policy?: string;
  seller_tos?: string;
  seller_name?: string;
  availability: string;
  availability_date?: string;
  price: string;
  sale_price?: string;
  length?: string;
  width?: string;
  height?: string;
  dimensions_unit?: string;
  weight?: string;
  item_weight_unit?: string;
  unit_pricing_measure?: string;
  base_measure?: string;
  pickup_method?: string;
  pickup_sla?: string;
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
        // (fetched 2026-08-25): "is_eligible_search must be true for
        // is_eligible_checkout to be enabled for the product."
        if (data.is_eligible_checkout) {
          return data.is_eligible_search === true;
        }
        return true;
      },
      { message: "is_eligible_checkout requires is_eligible_search to also be true" }
    )
    .refine(
      (data: z.infer<T>) => {
        // Main Feed Reference table row: availability_date "Required if
        // availability=pre_order". Backorder-without-date is a warning
        // (raw-issue check in validate-client.ts), not a hard error here -
        // see the field comment above availability_date for why.
        if (data.availability === "pre_order") {
          return !!data.availability_date;
        }
        return true;
      },
      { message: "Pre-order products require availability_date" }
    )
    .refine(
      (data: z.infer<T>) => {
        // Validation Rules on sale_price: "Must be less than or equal to
        // price." Only compares when both sides are already valid price
        // strings - a malformed price/sale_price fails its own field check.
        const price = priceAmount(data.price);
        const sale = priceAmount(data.sale_price);
        if (price === null || sale === null) return true;
        return sale <= price;
      },
      { message: "sale_price must be less than or equal to price" }
    )
    .refine(
      (data: z.infer<T>) => {
        // dimensions_unit "Dependencies: Required if any of length, width,
        // height are provided."
        if (data.length || data.width || data.height) {
          return !!data.dimensions_unit;
        }
        return true;
      },
      { message: "dimensions_unit is required when length, width, or height is provided" }
    )
    .refine(
      (data: z.infer<T>) => {
        // item_weight_unit "Dependencies: Required if weight is provided."
        if (data.weight) {
          return !!data.item_weight_unit;
        }
        return true;
      },
      { message: "item_weight_unit is required when weight is provided" }
    )
    .refine(
      (data: z.infer<T>) => {
        // "unit_pricing_measure / base_measure" - Validation Rules: "Both
        // fields required together."
        return !!data.unit_pricing_measure === !!data.base_measure;
      },
      { message: "unit_pricing_measure and base_measure must be provided together" }
    )
    .refine(
      (data: z.infer<T>) => {
        // pickup_sla "Dependencies: Requires pickup_method."
        if (data.pickup_sla) {
          return !!data.pickup_method;
        }
        return true;
      },
      { message: "pickup_sla requires pickup_method to also be set" }
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
  additional_image_urls: ["additional_image_link", "additional_images", "extra_images", "gallery"],

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

  // Media - video_link/virtual_model_link are the spec's own Google-compatible
  // Field Mapping table names (confirmed verbatim, developers.openai.com/commerce/specs/file-upload/products).
  video_url: ["video_link", "video", "product_video"],
  model_3d_url: ["virtual_model_link"],

  // Basic product data
  gtin: ["upc", "ean"],

  // Item information - product_type/google_product_category are the spec's
  // own Field Mapping table names; product_type wins when both are present
  // per the spec ("Uses the first nonempty comma-separated product_type;
  // otherwise uses google_product_category") - alias resolution here checks
  // product_type first since it's listed first.
  product_category: ["product_type", "google_product_category"],

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
//
// description used to default to "" here too - also dropped. description is
// Required per spec; defaulting a missing one to an empty string let a row
// with no description pass validation silently, which defeats the point of
// it being Required.
export const commerceBaseDefaults: Record<string, unknown> = {};

// Human-readable description for every field in commerceBaseFields, used by
// the field-mapping dialog. Text taken verbatim from each field's
// DESCRIPTION cell on developers.openai.com/commerce/specs/file-upload/products
// (re-verified 2026-08-25). commerceBaseFieldDescriptions.test.ts's drift
// test asserts this has exactly one entry per commerceBaseFieldNames entry,
// so a newly added schema field can't silently ship without one here.
export const commerceBaseFieldDescriptions: Record<string, string> = {
  is_eligible_search: "Controls whether the product can be surfaced in ChatGPT search results",
  is_eligible_checkout: "Allows direct purchase inside ChatGPT (requires is_eligible_search)",
  item_id: "Merchant product ID (unique per variant)",
  gtin: "Universal product identifier",
  mpn: "Manufacturer part number",
  title: "Product title",
  description: "Full product description",
  url: "Product detail page URL",
  brand: "Product brand",
  price: "Regular price, e.g. \"79.99 USD\"",
  sale_price: "Discounted price, e.g. \"59.99 USD\"",
  sale_price_start_date: "Sale start date",
  sale_price_end_date: "Sale end date",
  availability: "Product availability",
  availability_date: "Availability date if pre-order",
  expiration_date: "Remove product after this date",
  image_url: "Main product image URL",
  additional_image_urls: "Extra image URLs",
  video_url: "Product video URL",
  model_3d_url: "3D model URL",
  group_id: "Shared variant group identifier",
  item_group_title: "Group product title",
  listing_has_variations: "Indicates whether the listing has variants",
  variant_dict: "Variant attributes map (e.g. color, size)",
  size: "Variant size",
  color: "Variant color",
  size_system: "Size system (2-letter country code)",
  gender: "Gender target",
  offer_id: "Offer ID (SKU+seller+price)",
  seller_name: "Seller name",
  marketplace_seller: "Marketplace seller of record (3P sellers)",
  seller_url: "Seller storefront page",
  seller_privacy_policy: "Seller-specific privacy policy URL",
  seller_tos: "Seller-specific terms of service URL",
  return_policy: "Return policy URL",
  return_deadline_in_days: "Days allowed for return",
  accepts_returns: "Accepts returns",
  accepts_exchanges: "Accepts exchanges",
  shipping: "country:region:service_class:price:handling/transit days",
  pickup_method: "Pickup options",
  pickup_sla: "Pickup SLA (requires pickup_method)",
  unit_pricing_measure: "Unit price measure, paired with base_measure",
  base_measure: "Base measure, paired with unit_pricing_measure",
  is_digital: "Indicates if the product is digital",
  target_countries: "Target countries of the item (first entry used)",
  store_country: "Store country of the item",
  geo_price: "Price by region",
  geo_availability: "Availability per region",
  condition: "Condition of product",
  product_category: "Category path",
  material: "Primary material(s)",
  dimensions: "Overall dimensions",
  length: "Individual dimension: length (requires dimensions_unit)",
  width: "Individual dimension: width (requires dimensions_unit)",
  height: "Individual dimension: height (requires dimensions_unit)",
  dimensions_unit: "Dimensions unit (required if length/width/height given)",
  weight: "Product weight (requires item_weight_unit)",
  item_weight_unit: "Product weight unit (required if weight given)",
  age_group: "Target demographic",
  pricing_trend: "Lowest price in N months",
  popularity_score: "Popularity indicator",
  return_rate: "Return rate, e.g. \"2%\"",
  warning: "Product disclaimer text",
  warning_url: "Product disclaimer URL",
  age_restriction: "Minimum purchase age",
  review_count: "Number of product reviews",
  star_rating: "Average review score",
  store_review_count: "Number of brand or store reviews",
  store_star_rating: "Average store rating",
  q_and_a: "FAQ content",
  reviews: "Review entries",
  related_product_id: "Associated product IDs",
  relationship_type: "Relationship type",
  is_ads_eligible: "Eligible for ChatGPT Ads (optional here; required in the Ads validator)",
  ads_metadata: "Ad metadata values",
};

// Metadata used by the field-mapping dialog: name, whether it's required,
// and a human-readable description. DERIVED from commerceBaseFields'
// required/optional split (via Zod's own ZodOptional wrapper) rather than
// hand-maintained. This used to be a hand-written array that drifted 45
// fields behind the schema (30 entries vs 75 real fields) - same class of
// bug already fixed once for commerceBaseBooleanFields; same fix here.
export const commerceBaseTargetFields: { name: string; required: boolean; description: string }[] =
  Object.entries(commerceBaseFields).map(([name, fieldSchema]) => ({
    name,
    required: !(fieldSchema instanceof z.ZodOptional),
    description: commerceBaseFieldDescriptions[name] ?? name,
  }));

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
