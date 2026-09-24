import { describe, expect, it } from "vitest";
import { prettifyIdentifier, resolveBoardName, sharedBoardNames } from "@/lib/board-naming";

const known = [
  { identifier: "openai", name: "Substack" },
  { identifier: "substack", name: "Substack" },
  { identifier: "greptile", name: "Greptile" },
];

describe("resolveBoardName", () => {
  it("rejects a name another board already holds", () => {
    // "Substack" was inherited from the newsletter that linked OpenAI's board.
    expect(resolveBoardName("Substack", "openai", known)).toBe("Openai");
  });

  it("keeps a name that does not match its slug but belongs to no one else", () => {
    // The tell is a shared name, not a mismatched one. These are real company names.
    expect(resolveBoardName("GHX", "globalhealthcareexchangeinc", known)).toBe("GHX");
    expect(resolveBoardName("7AI", "sevenai", known)).toBe("7AI");
    expect(resolveBoardName("Hippo Insurance", "hippo70", known)).toBe("Hippo Insurance");
    expect(resolveBoardName("Atwell, LLC", "atwellgroup", known)).toBe("Atwell, LLC");
  });

  it("lets a board keep its own name on a repeat discovery", () => {
    expect(resolveBoardName("Substack", "substack", known)).toBe("Substack");
  });

  it("falls back to the slug when no name is supplied", () => {
    expect(resolveBoardName("", "applied-intuition", known)).toBe("Applied Intuition");
    expect(resolveBoardName("   ", "greptile", known)).toBe("Greptile");
  });
});

describe("sharedBoardNames", () => {
  it("finds a name claiming boards that cannot all be the same employer", () => {
    const shared = sharedBoardNames([
      { identifier: "openai", name: "Substack" },
      { identifier: "mirage", name: "Substack" },
      { identifier: "greptile", name: "Greptile" },
    ]);
    expect([...shared.keys()]).toEqual(["substack"]);
    expect(shared.get("substack")).toHaveLength(2);
  });

  it("leaves unique names alone", () => {
    expect(sharedBoardNames([
      { identifier: "ghxinc", name: "GHX" },
      { identifier: "sevenai", name: "7AI" },
    ]).size).toBe(0);
  });
});

describe("prettifyIdentifier", () => {
  it("makes a slug readable", () => {
    expect(prettifyIdentifier("applied-intuition")).toBe("Applied Intuition");
    expect(prettifyIdentifier("future_plc")).toBe("Future Plc");
  });
});
