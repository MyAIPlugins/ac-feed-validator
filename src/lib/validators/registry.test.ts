import { describe, test, expect } from "bun:test";
import { getValidator, getAllValidators, getValidatorIds } from "./registry";

describe("validator registry", () => {
  test("registers both the plain and Ads OpenAI validators", () => {
    expect(getValidatorIds()).toEqual(expect.arrayContaining(["openai", "openai-ads"]));
  });

  test("getValidator resolves each id to a distinct module", () => {
    const openai = getValidator("openai");
    const ads = getValidator("openai-ads");
    expect(openai).toBeDefined();
    expect(ads).toBeDefined();
    expect(openai?.id).not.toBe(ads?.id);
  });

  test("getAllValidators returns every registered validator", () => {
    const ids = getAllValidators().map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(["openai", "openai-ads"]));
  });

  test("unknown id resolves to undefined", () => {
    expect(getValidator("does-not-exist")).toBeUndefined();
  });
});
