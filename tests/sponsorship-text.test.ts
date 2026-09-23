import { describe, expect, it } from "vitest";
import { sponsorshipFromPosting } from "@/lib/sponsorship-text";

describe("sponsorshipFromPosting", () => {
  // Every phrasing below is taken verbatim from a real posting in the database.
  const refusals = [
    "Please note that, at this time, we're unable to offer visa sponsorship for this role.",
    "Additional Information This position is NOT eligible for Visa sponsorship.",
    "Salary not disclosed. Visa sponsorship not available.",
    "We are unable to provide visa sponsorship or support visa transfers.",
    "Visa sponsorship is not offered.",
    "Note: Visa sponsorship is not available for this role.",
    "Candidates must be authorized to work in the US without visa sponsorship.",
    "Applicants must work without sponsorship.",
  ];

  it.each(refusals)("reads a refusal: %s", (text) => {
    expect(sponsorshipFromPosting(text)?.verdict).toBe("us_work_authorization_required");
  });

  it.each([
    "Visa sponsorship available.",
    "We offer relocation and visa sponsorship for the right candidate.",
  ])("reads an offer: %s", (text) => {
    expect(sponsorshipFromPosting(text)?.verdict).toBe("sponsors");
  });

  it("ignores sponsorship that is a benefit, not a visa policy", () => {
    // A real false positive: "Sponsored life insurance" sat in a benefits list.
    expect(sponsorshipFromPosting("401k matching - Medical, Dental, Vision - Sponsored life insurance")).toBeNull();
  });

  it("ignores I-9 boilerplate, which says nothing about sponsorship", () => {
    expect(sponsorshipFromPosting(
      "All persons hired will be required to verify identity and eligibility to work in the United States.",
    )).toBeNull();
  });

  it("returns null when the posting is silent", () => {
    expect(sponsorshipFromPosting("We are looking for a product designer to join our team in New York.")).toBeNull();
  });

  it("quotes the sentence it decided from", () => {
    const statement = sponsorshipFromPosting("About us. Visa sponsorship is not available for this role. Apply now.");
    expect(statement?.quote).toBe("Visa sponsorship is not available for this role.");
  });
});
