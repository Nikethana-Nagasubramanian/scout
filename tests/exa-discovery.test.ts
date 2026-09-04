import { describe, expect, it } from "vitest";
import { companyDiscoveryQueries } from "@/lib/exa-discovery";
import type { CandidateProfile } from "@/lib/types";

const profile: CandidateProfile = {
  id: 1,
  full_name: "Test Candidate",
  email: "candidate@example.com",
  phone: "",
  home_location: "Chicago, IL",
  professional_summary: "Product designer",
  base_resume_text: "",
  target_titles: JSON.stringify(["Product Designer"]),
  target_seniority: "senior",
  skills: JSON.stringify(["Figma", "User research", "Design systems"]),
  preferred_locations: JSON.stringify(["Chicago"]),
  workplace_preferences: JSON.stringify(["remote", "hybrid"]),
  minimum_salary: 100000,
  work_authorization: "Authorized",
  sponsorship_required: 0,
  years_experience: 7,
  portfolio_url: "",
  linkedin_url: "",
  github_url: "",
  onboarding_complete: 1,
  updated_at: new Date().toISOString(),
};

describe("Exa company discovery queries", () => {
  it("reads the preferred location as a list rather than raw JSON", () => {
    const queries = companyDiscoveryQueries(profile);
    expect(queries.some((query) => query.includes("Chicago"))).toBe(true);
    for (const query of queries) {
      expect(query).not.toContain("[");
      expect(query).not.toContain("\"");
    }
  });

  it("builds queries from the candidate's own design titles", () => {
    const queries = companyDiscoveryQueries(profile);
    expect(queries.length).toBeGreaterThan(0);
    // jobSearchTitles expands the saved title into its synonyms, so every query should be
    // about hiring some flavour of designer rather than a generic job search.
    for (const query of queries) {
      expect(query.toLowerCase()).toContain("designer");
      expect(query.toLowerCase()).toContain("hiring");
    }
  });

  it("bounds how many paid queries a single run can make", () => {
    const manyTitles = { ...profile, target_titles: JSON.stringify(["Product Designer", "UX Designer", "UI Designer", "Brand Designer"]) };
    expect(companyDiscoveryQueries(manyTitles).length).toBeLessThanOrEqual(4);
  });

  it("falls back to the United States when no location is saved", () => {
    const noLocation = { ...profile, preferred_locations: "[]" };
    expect(companyDiscoveryQueries(noLocation).some((query) => query.includes("United States"))).toBe(true);
  });
});
