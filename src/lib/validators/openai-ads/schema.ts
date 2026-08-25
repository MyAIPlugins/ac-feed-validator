import { z } from "zod";
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
  commerceBaseFieldNames,
  createRecordValidators,
  booleanSchema,
} from "../shared/commerce-base";

// Google-compatible custom_label_0..custom_label_4 - not part of the base
// commerce schema (they're Ads-specific), but per developers.openai.com/commerce/specs/file-upload/products:
// "For Ads feeds, OpenAI retains selected Google-compatible fields for
// product filtering in Ads campaigns. This dynamically configured set
// currently includes custom_label_0 through custom_label_4 and a few other
// key columns." Ads-only, so they live on this schema, not commerce-base.ts.
const CUSTOM_LABEL_FIELDS = ["custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4"] as const;

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
    custom_label_0: z.string().optional(),
    custom_label_1: z.string().optional(),
    custom_label_2: z.string().optional(),
    custom_label_3: z.string().optional(),
    custom_label_4: z.string().optional(),
  })
);

export type OpenAIAdsFeedRecord = z.infer<typeof openAIAdsFeedSchema>;

// Aliases, trap aliases, and boolean-field list are identical to the base -
// is_ads_eligible's alias/trap entry already lives in commerce-base.ts.
const targetFields: TargetField[] = [
  // Override the base's optional is_ads_eligible entry with a required one.
  ...commerceBaseTargetFields.filter((f) => f.name !== "is_ads_eligible"),
  { name: "is_ads_eligible", required: true, description: "Eligible for ChatGPT Ads (must be true to serve ads)" },
  ...CUSTOM_LABEL_FIELDS.map((name) => ({ name, required: false, description: "Ads product-set filtering label" })),
];

// custom_label_0..4 are additional Ads-only field names on top of the shared
// base's fieldNames - without this, they'd be flagged as "not part of the
// spec" by the ignored-column check even though this validator accepts them.
const fieldNames = [...commerceBaseFieldNames, ...CUSTOM_LABEL_FIELDS];

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
  fieldNames,
  validateRecord,
  validateRecordRaw,
};
