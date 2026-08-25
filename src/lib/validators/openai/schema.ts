import type { z } from "zod";
import type { ValidatorModule } from "../types";
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
} from "../shared/commerce-base";

// OpenAI's "shopping" / Commerce product feed (ChatGPT Search + Checkout).
// This is exactly the shared base commerce schema, no additions - kept as
// its own module because it's the id/name/version users pick in the UI,
// and because a platform-specific validator (like openai-ads) may one day
// need its own extra rules without touching this one.
export const openAIFeedSchema = withCommerceRefinements(commerceBaseSchema);

export type OpenAIFeedRecord = z.infer<typeof openAIFeedSchema>;

const { validateRecord, validateRecordRaw } = createRecordValidators(
  openAIFeedSchema,
  commerceBaseAliases,
  commerceBaseNormalizers,
  commerceBaseDefaults
);

export const openAIValidator: ValidatorModule<typeof openAIFeedSchema> = {
  id: "openai",
  name: "OpenAI Product Feed",
  description: "Validator for OpenAI Commerce product feeds (ChatGPT Shopping)",
  version: "1.1.0",
  supportedFormats: ["jsonl", "csv"],
  schema: openAIFeedSchema,
  fieldAliases: commerceBaseAliases,
  fieldNormalizers: commerceBaseNormalizers,
  defaultValues: commerceBaseDefaults,
  targetFields: commerceBaseTargetFields,
  // is_ads_eligible is optional on the base schema (see commerce-base.ts),
  // so a feed using this validator can still trip the same boolean-as-string
  // and is_ads_enabled-trap warnings as the Ads validator.
  booleanFields: commerceBaseBooleanFields,
  trapAliases: commerceBaseTrapAliases,
  validateRecord,
  validateRecordRaw,
};
