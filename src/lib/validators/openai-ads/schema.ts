import type { z } from "zod";
import type { ValidatorModule, FieldAliases, TrapAliases, TargetField } from "../types";
import {
  commerceBaseSchema,
  withCommerceRefinements,
  commerceBaseAliases,
  commerceBaseNormalizers,
  commerceBaseDefaults,
  commerceBaseTargetFields,
  createRecordValidators,
  booleanSchema,
} from "../shared/commerce-base";

// OpenAI Ads product feed - same base commerce fields as the plain
// "OpenAI Product Feed" validator, plus is_ads_eligible.
//
// Per developers.openai.com/ads/product-feeds and
// developers.openai.com/commerce/specs/file-upload/products (fetched 2026-08-24):
// - is_ads_eligible is Required for an Ads feed (Optional for a non-Ads feed).
// - A legacy alias `is_eligible_ads` is accepted; `is_ads_enabled` is NOT a
//   real field and is silently ignored by OpenAI if a merchant uses it by
//   mistake - see trapAliases below.
// - Initial catalog upload happens via SFTP through Ads Manager's Feeds UI,
//   not a public API, so this validator's job (like the plain OpenAI one)
//   ends at "produce a correctly formatted export file."
export const openAIAdsFeedSchema = withCommerceRefinements(
  commerceBaseSchema.extend({
    is_ads_eligible: booleanSchema,
  })
);

export type OpenAIAdsFeedRecord = z.infer<typeof openAIAdsFeedSchema>;

const fieldAliases: FieldAliases = {
  ...commerceBaseAliases,
  is_ads_eligible: ["is_eligible_ads"],
};

// is_ads_enabled looks like a plausible column name but OpenAI's docs
// explicitly warn it's ignored - flag it instead of letting it silently
// disappear (Zod strips unknown keys, so today this failed 100% silently).
const trapAliases: TrapAliases = {
  is_ads_enabled: 'OpenAI does not read "is_ads_enabled" - it is silently ignored. Rename this column to "is_ads_eligible".',
};

const targetFields: TargetField[] = [
  ...commerceBaseTargetFields,
  { name: "is_ads_eligible", required: true, description: "Eligible for ChatGPT Ads (must be true to serve ads)" },
];

const { validateRecord, validateRecordRaw } = createRecordValidators(
  openAIAdsFeedSchema,
  fieldAliases,
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
  fieldAliases,
  fieldNormalizers: commerceBaseNormalizers,
  defaultValues: commerceBaseDefaults,
  targetFields,
  trapAliases,
  validateRecord,
  validateRecordRaw,
};
