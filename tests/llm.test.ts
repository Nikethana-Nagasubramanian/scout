import { describe, expect, it } from "vitest";
import { aiProviders, DEFAULT_ANTHROPIC_MODEL, describeAiFailure } from "@/lib/llm";

describe("AI provider selection", () => {
  it("offers exactly the two supported providers", () => {
    expect(aiProviders).toEqual(["ollama", "anthropic"]);
  });

  it("defaults Claude to the cheapest current model", () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-haiku-4-5");
  });
});

describe("AI failure messages", () => {
  it("explains a timeout in plain words", () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(describeAiFailure(timeout)).toBe("the model did not finish in time");
  });

  it("passes through an unrecognised error message", () => {
    expect(describeAiFailure(new Error("fetch failed"))).toBe("fetch failed");
  });

  it("never returns an empty reason", () => {
    expect(describeAiFailure(undefined).length).toBeGreaterThan(0);
    expect(describeAiFailure("something odd").length).toBeGreaterThan(0);
  });
});
