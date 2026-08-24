import { z } from "zod";
import type { FieldAliases, FieldNormalizers, RecordValidationResult, ValidationIssue } from "../types";
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

// Price format: accepts multiple formats after normalization
export const priceSchema = z.union([
  z.number().positive(),
  z.string().min(1),
]).refine((val) => {
  if (typeof val === "number") return val > 0;
  // Accept "123.45 EUR" or "123.45" format (after normalization)
  return /^\d+(\.\d{1,2})?\s?[A-Z]{0,3}$/.test(val);
}, { message: "Invalid price format" });

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
export const commerceBaseFields = {
  // OpenAI Control Flags (Required)
  is_eligible_search: booleanSchema,
  is_eligible_checkout: booleanSchema,

  // Basic Product Data (Required)
  item_id: z.string().min(1).max(100),
  title: z.string().min(1).max(150).refine(
    (title) => title !== title.toUpperCase() || title.length <= 10,
    { message: "Avoid using all-caps for titles" }
  ),
  description: z.string().max(5000),
  url: urlSchema,
  brand: z.string().min(1).max(70),

  // Pricing (Required)
  price: priceSchema,
  currency: z.enum(currencyCodes).optional(),
  sale_price: priceSchema.optional(),
  sale_price_effective_date_begin: dateSchema.optional(),
  sale_price_effective_date_end: dateSchema.optional(),

  // Availability (Required)
  availability: z.enum(availabilityValues),
  availability_date: dateSchema.optional(),

  // Media (Required)
  image_url: urlSchema,
  additional_image_urls: z.string().optional(),

  // Variants
  group_id: z.string().max(70).optional(),
  item_group_title: z.string().max(150).refine(
    (title) => title !== title.toUpperCase() || title.length <= 10,
    { message: "Avoid using all-caps for group titles" }
  ).optional(),
  listing_has_variations: booleanSchema.optional(),
  size: z.string().max(100).optional(),
  color: z.string().max(40).optional(),
  size_system: z.string().optional(),
  gender: z.enum(["male", "female", "unisex"]).optional(),

  // Merchant Information (Required for checkout)
  store_name: z.string().max(70).optional(),
  seller_url: urlSchema.optional(),
  seller_privacy_policy: urlSchema.optional(),
  seller_tos: urlSchema.optional(),

  // Returns Policy (Required)
  return_policy: urlSchema,
  return_window: z.union([
    z.number().int().positive(),
    z.string().regex(/^\d+$/),
  ]).transform((v) => Number(v)),
  accepts_returns: booleanSchema.optional(),
  accepts_exchanges: booleanSchema.optional(),

  // Geo Targeting (Required)
  target_countries: z.union([
    z.string().min(2),
    z.array(z.string().min(2)).min(1),
  ]),
  store_country: z.enum(countryCodes),

  // Item Information (Optional)
  condition: z.enum(["new", "refurbished", "used"]).optional(),
  product_category: z.string().optional(),
  material: z.string().optional(),
  dimensions: z.string().optional(),
  weight: z.string().optional(),
  age_group: z.enum(["newborn", "infant", "toddler", "kids", "adult"]).optional(),
  inventory_quantity: z.union([z.number(), z.string()]).optional(),

  // Fulfillment (Optional)
  shipping_price: priceSchema.optional(),
  delivery_estimate: z.string().optional(),
  is_digital: booleanSchema.optional(),

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
  q_and_a: z.string().optional(),

  // Related Products (Optional)
  related_product_id: z.string().optional(),
  relationship_type: z.string().optional(),
};

export const commerceBaseSchema = z.object(commerceBaseFields);

// Minimal shape withCommerceRefinements' checks rely on. Any schema built on
// commerceBaseFields (with or without extra fields like is_ads_eligible)
// satisfies this.
type CommerceRefinementFields = {
  is_eligible_checkout: boolean;
  seller_privacy_policy?: string;
  seller_tos?: string;
  store_name?: string;
  availability: string;
  availability_date?: string;
};

// The two cross-field rules from OpenAI's spec that apply to every commerce
// feed regardless of platform (checkout eligibility, pre-order availability).
// Kept as a standalone function (not baked into commerceBaseSchema) because
// z.object().refine() returns a ZodEffects, which can't be .extend()'d — and
// the Ads schema needs to extend the base with `is_ads_eligible` before the
// refinements are applied.
export function withCommerceRefinements<T extends z.ZodType<CommerceRefinementFields>>(schema: T) {
  return schema
    .refine(
      (data: z.infer<T>) => {
        if (data.is_eligible_checkout) {
          return !!data.seller_privacy_policy && !!data.seller_tos && !!data.store_name;
        }
        return true;
      },
      { message: "Checkout-enabled products require seller_privacy_policy, seller_tos, and store_name" }
    )
    .refine(
      (data: z.infer<T>) => {
        if (data.availability === "pre_order") {
          return !!data.availability_date;
        }
        return true;
      },
      { message: "Pre-order products require availability_date" }
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
  store_name: ["seller_name", "merchant_name", "shop_name"],

  // Geo
  target_countries: ["countries", "ship_to_countries", "available_countries"],
  store_country: ["country", "merchant_country", "seller_country"],
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

  shipping_price: (value) => {
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

  // Normalize return_window: "14 days" -> "14"
  return_window: (value) => {
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
export const commerceBaseDefaults: Record<string, unknown> = {
  target_countries: "IT",
  store_country: "IT",
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
  { name: "title", required: true, description: "Product name" },
  { name: "description", required: false, description: "Product description" },
  { name: "url", required: true, description: "Product page URL" },
  { name: "brand", required: true, description: "Brand name" },
  { name: "price", required: true, description: "Regular price" },
  { name: "currency", required: false, description: "Currency code (ISO 4217)" },
  { name: "sale_price", required: false, description: "Sale price" },
  { name: "availability", required: true, description: "Stock status" },
  { name: "image_url", required: true, description: "Main product image" },
  { name: "additional_image_urls", required: false, description: "Extra images" },
  { name: "group_id", required: false, description: "Variant group ID" },
  { name: "item_group_title", required: false, description: "Group product title" },
  { name: "listing_has_variations", required: false, description: "Has variants" },
  { name: "size", required: false, description: "Product size" },
  { name: "color", required: false, description: "Product color" },
  { name: "condition", required: false, description: "new/refurbished/used" },
  { name: "product_category", required: false, description: "Product category" },
  { name: "store_name", required: false, description: "Merchant name" },
  { name: "seller_url", required: false, description: "Merchant URL" },
  { name: "return_policy", required: true, description: "Return policy URL" },
  { name: "return_window", required: true, description: "Return window in days" },
  { name: "target_countries", required: true, description: "Target countries (ISO)" },
  { name: "store_country", required: true, description: "Store country (ISO)" },
  { name: "material", required: false, description: "Product material" },
  { name: "inventory_quantity", required: false, description: "Stock quantity" },
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
