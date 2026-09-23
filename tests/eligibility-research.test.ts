import { describe, expect, it } from "vitest";
import { boilerplateReason } from "@/lib/eligibility-research";

/**
 * Each quote below was actually produced by the research agent as "evidence" before the
 * guard existed. Verifying a quote exists on a page does not make it mean anything, so
 * these are rejected in code rather than trusted to the prompt.
 */
describe("boilerplateReason", () => {
  it.each([
    ["all persons hired will be required to verify identity and eligibility to work in the United States", "I-9"],
    ["The Company participates in E-Verify.", "E-Verify"],
    ["Labor Condition Applications (LCAs) for specialty occupation petitions are displayed electronically", "LCA"],
    ["Are you currently authorized to work for any employer in the country listed for this role", "form question"],
    ["Will you now or in the future require sponsorship?", "form question"],
  ])("rejects %s", (quote) => {
    expect(boilerplateReason(quote)).not.toBeNull();
  });

  it.each([
    "We are unable to offer visa sponsorship for this role.",
    "This position is NOT eligible for Visa sponsorship.",
    "Visa sponsorship is available.",
  ])("accepts a real policy statement: %s", (quote) => {
    expect(boilerplateReason(quote)).toBeNull();
  });
});
