import { z } from "zod";
import type {
  ValidatorModule,
  RecordValidationResult,
  ValidationIssue,
  FieldAliases,
  FieldNormalizers,
} from "../types";
import { normalizeRecord } from "../types";

// ISO 4217 currency codes (common ones)
const currencyCodes = [
  "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "HKD", "NZD",
  "SEK", "KRW", "SGD", "NOK", "MXN", "INR", "RUB", "ZAR", "BRL", "TWD",
] as const;

// ISO 3166-1 alpha-2 country codes (common ones)
const countryCodes = [
  "US", "GB", "CA", "AU", "DE", "FR", "IT", "ES", "JP", "CN",
  "KR", "IN", "BR", "MX", "NL", "SE", "NO", "DK", "FI", "PL",
  "AT", "BE", "CH", "IE", "PT", "NZ", "SG", "HK", "TW", "ZA",
] as const;

const availabilityValues = ["in_stock", "out_of_stock", "pre_order", "backorder", "unknown"] as const;

const urlSchema = z.string().url().max(2048);

// Price format: accepts multiple formats after normalization
const priceSchema = z.union([
  z.number().positive(),
  z.string().min(1),
]).refine((val) => {
  if (typeof val === "number") return val > 0;
  // Accept "123.45 EUR" or "123.45" format (after normalization)
  return /^\d+(\.\d{1,2})?\s?[A-Z]{0,3}$/.test(val);
}, { message: "Invalid price format" });

// ISO 8601 date format
const dateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/,
  "Date must be in ISO 8601 format"
);

// Boolean that accepts various string formats
const booleanSchema = z.union([
  z.boolean(),
  z.enum(["true", "false", "TRUE", "FALSE", "True", "False", "1", "0"]),
]).transform((v) => {
  if (typeof v === "boolean") return v;
  return ["true", "TRUE", "True", "1"].includes(v);
});

export const openAIFeedSchema = z.object({
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
  target_countries: z.string().min(2),
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
}).refine(
  (data) => {
    if (data.is_eligible_checkout) {
      return !!data.seller_privacy_policy && !!data.seller_tos && !!data.store_name;
    }
    return true;
  },
  { message: "Checkout-enabled products require seller_privacy_policy, seller_tos, and store_name" }
).refine(
  (data) => {
    if (data.availability === "pre_order") {
      return !!data.availability_date;
    }
    return true;
  },
  { message: "Pre-order products require availability_date" }
);

export type OpenAIFeedRecord = z.infer<typeof openAIFeedSchema>;

// Field aliases: map common CSV column names to canonical OpenAI field names
const fieldAliases: FieldAliases = {
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
  listing_has_variations: ["has_variants", "has_variations", "is_variant"],

  // Merchant info
  store_name: ["seller_name", "merchant_name", "shop_name"],

  // Geo
  target_countries: ["countries", "ship_to_countries", "available_countries"],
  store_country: ["country", "merchant_country", "seller_country"],
};

// Normalizers: transform values to canonical format before validation
const fieldNormalizers: FieldNormalizers = {
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

// Default values for fields that can have sensible defaults
const defaultValues: Record<string, unknown> = {
  target_countries: "IT",
  store_country: "IT",
  description: "",
};

function validateRecord(record: Record<string, unknown>, row: number): RecordValidationResult {
  // Apply normalization before validation
  const normalized = normalizeRecord(record, fieldAliases, fieldNormalizers, defaultValues);

  const result = openAIFeedSchema.safeParse(normalized);

  if (result.success) {
    return {
      row,
      isValid: true,
      issues: [],
      data: result.data as Record<string, unknown>,
      normalized,
    };
  }

  const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
    row,
    field: issue.path.join("."),
    message: issue.message,
    severity: "error" as const,
    value: issue.path.reduce((obj: unknown, key) => {
      if (obj && typeof obj === "object" && key in obj) {
        return (obj as Record<string, unknown>)[key as string];
      }
      return undefined;
    }, normalized),
  }));

  return {
    row,
    isValid: false,
    issues,
    normalized,
  };
}

export const openAIValidator: ValidatorModule<typeof openAIFeedSchema> = {
  id: "openai",
  name: "OpenAI Product Feed",
  description: "Validator for OpenAI Commerce product feeds (ChatGPT Shopping)",
  version: "1.1.0",
  supportedFormats: ["jsonl", "csv"],
  schema: openAIFeedSchema,
  fieldAliases,
  fieldNormalizers,
  defaultValues,
  validateRecord,
};
