import { describe, expect, it } from "vitest";
import {
  describeRule,
  isRejectionReason,
  matchingRule,
  roleTypeToken,
  ruleHeadline,
  seniorityToken,
  workplaceToken,
  type LearnedRule,
} from "@/lib/rejection-learning";

function rule(kind: LearnedRule["kind"], value: string, rejectionCount = 2): LearnedRule {
  return { kind, value, label: value, rejectionCount };
}

describe("rejection signal extraction", () => {
  it("pulls the seniority word out of a title", () => {
    expect(seniorityToken("Senior Product Designer")).toBe("senior");
    expect(seniorityToken("Director of Design")).toBe("director");
    expect(seniorityToken("Product Designer")).toBeNull();
  });

  it("does not treat a substring as a seniority word", () => {
    // "Presenter" contains "senior" only as letters, never as a word.
    expect(seniorityToken("Presenter Experience Designer")).toBeNull();
  });

  it("strips seniority and level markers to leave the role itself", () => {
    expect(roleTypeToken("Senior Product Designer")).toBe("product designer");
    expect(roleTypeToken("Staff Product Designer II")).toBe("product designer");
    expect(roleTypeToken("Engineering Manager")).toBe("engineering");
  });

  it("reads workplace type out of a location string", () => {
    expect(workplaceToken("Metairie, LA, USA, Hybrid, In Office")).toBe("hybrid");
    expect(workplaceToken("New York City")).toBeNull();
  });

  it("only accepts the five known reasons", () => {
    expect(isRejectionReason("wrong_seniority")).toBe(true);
    expect(isRejectionReason("vibes")).toBe(false);
  });
});

describe("rule matching", () => {
  const job = { company: "Gumloop", title: "Senior Product Designer", location: "San Francisco Office" };

  it("catches a job by blocked company regardless of title", () => {
    expect(matchingRule(job, [rule("company", "gumloop", 1)])?.kind).toBe("company");
  });

  it("catches a job by seniority", () => {
    expect(matchingRule(job, [rule("seniority", "senior")])?.kind).toBe("seniority");
  });

  it("catches a job by role type once seniority is stripped", () => {
    expect(matchingRule(job, [rule("role_type", "product designer")])?.kind).toBe("role_type");
  });

  it("leaves a job alone when no rule applies", () => {
    expect(matchingRule(job, [rule("company", "packz"), rule("seniority", "director")])).toBeNull();
  });

  it("matches a location rule on workplace type, not just city", () => {
    const hybrid = { company: "RXNT", title: "Product Designer", location: "Metairie, LA, USA, Hybrid" };
    expect(matchingRule(hybrid, [rule("location", "hybrid")])?.kind).toBe("location");
  });

  it("tolerates a missing location", () => {
    const noLocation = { company: "Packz", title: "Product Designer", location: null };
    expect(matchingRule(noLocation, [rule("location", "remote")])).toBeNull();
  });
});

describe("rule copy", () => {
  it("always says how many rejections taught the rule", () => {
    expect(describeRule({ kind: "seniority", value: "senior", label: "senior roles", rejectionCount: 3 }))
      .toBe("Hidden because you rejected senior roles (3 rejections).");
  });

  it("uses the singular for a single rejection", () => {
    expect(describeRule({ kind: "company", value: "acme", label: "Acme", rejectionCount: 1 }))
      .toBe("Hidden because you rejected Acme (1 rejection).");
  });

  it("labels each rule by the kind of signal it came from", () => {
    expect(ruleHeadline({ kind: "location", value: "hybrid", label: "hybrid", rejectionCount: 2 }))
      .toBe("Location: hybrid");
  });
});
