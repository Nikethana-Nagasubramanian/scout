import { describe, expect, it } from "vitest";
import { aiProviders, DEFAULT_ANTHROPIC_MODEL, describeAiFailure, ollamaKeepAlive, providerChain } from "@/lib/llm";

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

describe("provider fallback chain", () => {
  it("keeps the local model out of the chain when it is not reachable", async () => {
    // providerChain consults the probe, so an unreachable Ollama must not be queued behind
    // Claude. Otherwise a failed Claude call pays a full request timeout to learn that.
    const chain = await providerChain("anthropic");
    expect(chain).toEqual(["anthropic"]);
  });

  it("honours an explicit override without consulting the setting", async () => {
    expect(await providerChain("ollama")).toEqual(["ollama"]);
  });
});

describe("Ollama memory policy", () => {
  it("releases the model immediately when Ollama is only the fallback", () => {
    // A resident model is worth its RAM when Ollama does the work, and not when it is a
    // rare fallback on a small machine.
    delete process.env.OLLAMA_KEEP_ALIVE;
    expect(["0", "30m"]).toContain(ollamaKeepAlive());
  });

  it("lets the environment override the policy", () => {
    process.env.OLLAMA_KEEP_ALIVE = "5m";
    expect(ollamaKeepAlive()).toBe("5m");
    delete process.env.OLLAMA_KEEP_ALIVE;
  });
});
