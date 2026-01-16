import { z } from "zod";
import type { ValidatorModule, RecordValidationResult, ValidationIssue } from "../types";

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
const httpsUrlSchema = z.string().url().refine(
  (url) => url.startsWith("https://"),
  { message: "URL should use HTTPS" }
);

// Price format: number with optional currency code
const priceSchema = z.union([
  z.number().positive(),
  z.string().regex(/^\d+(\.\d{1,2})?\s?[A-Z]{3}$/, "Price must be a number or 'amount CUR' format"),
]);

// ISO 8601 date format
const dateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/,
  "Date must be in ISO 8601 format"
);

export const openAIFeedSchema = z.object({
  // OpenAI Control Flags (Required)
  is_eligible_search: z.union([z.boolean(), z.enum(["true", "false"])]).transform(v => v === true || v === "true"),
  is_eligible_checkout: z.union([z.boolean(), z.enum(["true", "false"])]).transform(v => v === true || v === "true"),

  // Basic Product Data (Required)
  item_id: z.string().min(1).max(100),
  title: z.string().min(1).max(150).refine(
    (title) => title !== title.toUpperCase() || title.length <= 10,
    { message: "Avoid using all-caps for titles" }
  ),
  description: z.string().min(1).max(5000),
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
  additional_image_urls: z.string().optional(), // comma-separated

  // Variants
  group_id: z.string().max(70).optional(),
  listing_has_variations: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
  size: z.string().max(20).optional(),
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
  return_window: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform(v => Number(v)),
  accepts_returns: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
  accepts_exchanges: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),

  // Geo Targeting (Required)
  target_countries: z.string().min(2), // comma-separated ISO codes
  store_country: z.enum(countryCodes),

  // Item Information (Optional)
  condition: z.enum(["new", "refurbished", "used"]).optional(),
  product_category: z.string().optional(),
  material: z.string().optional(),
  dimensions: z.string().optional(),
  weight: z.string().optional(),
  age_group: z.enum(["newborn", "infant", "toddler", "kids", "adult"]).optional(),

  // Fulfillment (Optional)
  shipping_price: priceSchema.optional(),
  delivery_estimate: z.string().optional(),
  is_digital: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),

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
    z.string().regex(/^[0-5](\.\d+)?$/)
  ]).optional(),
  q_and_a: z.string().optional(),

  // Related Products (Optional)
  related_product_id: z.string().optional(),
  relationship_type: z.string().optional(),
}).refine(
  (data) => {
    // If checkout is enabled, privacy policy and TOS are required
    if (data.is_eligible_checkout) {
      return !!data.seller_privacy_policy && !!data.seller_tos && !!data.store_name;
    }
    return true;
  },
  { message: "Checkout-enabled products require seller_privacy_policy, seller_tos, and store_name" }
).refine(
  (data) => {
    // If pre_order, availability_date is required
    if (data.availability === "pre_order") {
      return !!data.availability_date;
    }
    return true;
  },
  { message: "Pre-order products require availability_date" }
).refine(
  (data) => {
    // sale_price must be less than or equal to price
    if (data.sale_price !== undefined && data.price !== undefined) {
      const price = typeof data.price === "number" ? data.price : parseFloat(data.price);
      const salePrice = typeof data.sale_price === "number" ? data.sale_price : parseFloat(data.sale_price);
      return salePrice <= price;
    }
    return true;
  },
  { message: "sale_price must be less than or equal to price" }
);

export type OpenAIFeedRecord = z.infer<typeof openAIFeedSchema>;

function validateRecord(record: Record<string, unknown>, row: number): RecordValidationResult {
  const result = openAIFeedSchema.safeParse(record);

  if (result.success) {
    return {
      row,
      isValid: true,
      issues: [],
      data: result.data as Record<string, unknown>,
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
    }, record),
  }));

  return {
    row,
    isValid: false,
    issues,
  };
}

export const openAIValidator: ValidatorModule<typeof openAIFeedSchema> = {
  id: "openai",
  name: "OpenAI Product Feed",
  description: "Validator for OpenAI Commerce product feeds (ChatGPT Shopping)",
  version: "1.0.0",
  supportedFormats: ["jsonl", "csv"],
  schema: openAIFeedSchema,
  validateRecord,
};
