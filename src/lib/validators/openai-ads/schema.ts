import type { z } from "zod";
import type { ValidatorModule, TargetField } from "../types";
import {
  commerceBaseSchema,
  withCommerceRefinements,
  commerceBaseAliases,
  commerceBaseNormalizers,
  commerceBaseDefaults,
  commerceBaseTargetFields,
  commerceBaseBooleanFields,
  commerceBaseTrapAliases,
  createRecordValidators,
  booleanSchema,
} from "../shared/commerce-base";

// OpenAI Ads product feed - same base commerce fields as the plain
// "OpenAI Product Feed" validator, plus is_ads_eligible required.
//
// Per developers.openai.com/ads/product-feeds and
// developers.openai.com/commerce/specs/file-upload/products (fetched 2026-08-24):
// - is_ads_eligible is Required for an Ads feed (Optional for a non-Ads feed -
//   it's optional on commerceBaseFields; this schema overrides it as required).
// - The legacy alias `is_eligible_ads` and the `is_ads_enabled` trap warning
//   are inherited from the shared base (commerce-base.ts) since the field
//   itself now lives there.
// - Initial catalog upload happens via SFTP through Ads Manager's Feeds UI,
//   not a public API, so this validator's job (like the plain OpenAI one)
//   ends at "produce a correctly formatted export file."
export const openAIAdsFeedSchema = withCommerceRefinements(
  commerceBaseSchema.extend({
    is_ads_eligible: booleanSchema,
  })
);

export type OpenAIAdsFeedRecord = z.infer<typeof openAIAdsFeedSchema>;

// Aliases, trap aliases, and boolean-field list are identical to the base -
// is_ads_eligible's alias/trap entry already lives in commerce-base.ts.
const targetFields: TargetField[] = [
  // Override the base's optional is_ads_eligible entry with a required one.
  ...commerceBaseTargetFields.filter((f) => f.name !== "is_ads_eligible"),
  { name: "is_ads_eligible", required: true, description: "Eligible for ChatGPT Ads (must be true to serve ads)" },
];

const { validateRecord, validateRecordRaw } = createRecordValidators(
  openAIAdsFeedSchema,
  commerceBaseAliases,
  commerceBaseNormalizers,
  commerceBaseDefaults
);

export const openAIAdsValidator: ValidatorModule<typeof openAIAdsFeedSchema> = {
  id: "openai-ads",
  name: "OpenAI Ads Product Feed",
  description: "Validator for OpenAI Ads product feeds (is_ads_eligible required) - upload via Ads Manager",
  version: "1.0.0",
  supportedFormats: ["jsonl", "csv"],
  schema: openAIAdsFeedSchema,
  fieldAliases: commerceBaseAliases,
  fieldNormalizers: commerceBaseNormalizers,
  defaultValues: commerceBaseDefaults,
  targetFields,
  booleanFields: commerceBaseBooleanFields,
  trapAliases: commerceBaseTrapAliases,
  validateRecord,
  validateRecordRaw,
};
