import { describe, expect, it } from "vitest";
import { scoreJob, scorePostingConfidence } from "@/lib/scoring";
import { assessJobEligibility, citizenshipRequirement, classifyRoleFamily, digitalDesignSignalCount } from "@/lib/job-fit";
import type { CandidateProfile, Job } from "@/lib/types";

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

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 1,
    source_id: 1,
    source_name: "Example",
    source_type: "greenhouse",
    external_id: "one",
    company: "Example",
    title: "Senior Product Designer",
    location: "Chicago, IL",
    workplace_type: "hybrid",
    employment_type: "Full-time",
    salary_min: 110000,
    salary_max: 140000,
    salary_currency: "USD",
    description: "Use Figma, user research, and design systems to improve our product.",
    canonical_url: "https://example.com/job",
    apply_url: "https://example.com/job",
    posted_at: new Date().toISOString(),
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    status: "discovered",
    score: null,
    hard_filter_pass: null,
    eligibility_status: "needs_verification",
    score_breakdown: null,
    match_summary: null,
    seen_count: 1,
    confidence_score: null,
    confidence_breakdown: null,
    confidence_summary: null,
    duplicate_of_job_id: null,
    duplicate_reason: "",
    ...overrides,
  };
}

describe("scoreJob", () => {
  it("scores a strong aligned role highly", () => {
    const result = scoreJob(job(), profile);
    expect(result.hardFilterPass).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(80);
    expect(result.matchingSkills).toHaveLength(3);
  });

  it("scores coverage against detected job requirements instead of every saved skill", () => {
    const result = scoreJob(job({
      description: "Use Figma and accessibility practices to design an enterprise SaaS product.",
    }), {
      ...profile,
      professional_summary: "Product designer for accessible SaaS products",
      base_resume_text: "Built accessible workflows in Figma for B2B SaaS customers.",
      skills: JSON.stringify(["Figma", "User research", "Design systems", "Accessibility", "SaaS"]),
    });

    expect(result.matchingSkills).toEqual(expect.arrayContaining(["Figma", "Accessibility", "SaaS"]));
    expect(result.missingSkills).toContain("Enterprise");
    expect(result.skills).toBe(26);
  });

  it("uses a neutral requirement score when a posting provides no specific requirements", () => {
    const result = scoreJob(job({ description: "Join our team and make a meaningful impact." }), profile);
    expect(result.skills).toBe(18);
    expect(result.matchingSkills).toEqual([]);
    expect(result.missingSkills).toEqual([]);
  });

  it("explains a sponsorship hard filter", () => {
    const result = scoreJob(job({ description: "Applicants must work without sponsorship." }), { ...profile, sponsorship_required: 1 });
    expect(result.hardFilterPass).toBe(false);
    expect(result.hardFilterReasons[0]).toContain("sponsorship");
  });

  it("keeps an ambiguous location visible for verification", () => {
    const result = scoreJob(job({ location: "Remote", workplace_type: "remote" }), profile, {
      usaOnly: true,
      minimumExperience: 2,
      maximumExperience: 5,
      maximumAgeDays: 60,
    });
    expect(result.hardFilterPass).toBe(true);
    expect(result.eligibilityStatus).toBe("needs_verification");
    expect(result.verificationReasons.join(" ")).toContain("United States");
  });

  it("strictly rejects unrelated, senior, foreign, and overqualified roles", () => {
    const strictProfile = {
      ...profile,
      target_seniority: "mid",
      target_titles: JSON.stringify(["Product Designer"]),
      years_experience: 5,
      preferred_locations: JSON.stringify(["United States", "Boston"]),
    };
    const preferences = { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 };
    expect(scoreJob(job({ title: "Staff Product Designer" }), strictProfile, preferences).hardFilterPass).toBe(false);
    expect(scoreJob(job({ title: "Software Engineer" }), strictProfile, preferences).hardFilterPass).toBe(false);
    expect(scoreJob(job({ title: "Product Designer", location: "Sao Paulo, Brazil" }), strictProfile, preferences).hardFilterPass).toBe(false);
    expect(scoreJob(job({
      title: "Product Designer",
      description: "Required qualifications include 7+ years of relevant experience.",
    }), strictProfile, preferences).hardFilterPass).toBe(false);
  });

  it("accepts a US mid-level product design role requiring two to five years", () => {
    const result = scoreJob(job({
      title: "Product Designer II",
      location: "Remote - United States",
      description: "Required qualifications include 3 to 5 years of relevant experience using Figma.",
    }), {
      ...profile,
      target_seniority: "mid",
      target_titles: JSON.stringify(["Product Designer"]),
      preferred_locations: JSON.stringify(["United States"]),
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 });
    expect(result.hardFilterPass).toBe(true);
  });

  it("recognizes a US restriction near the end of a long description", () => {
    const result = scoreJob(job({
      title: "Product Designer",
      location: "Remote",
      description: `${"Product design collaboration and delivery. ".repeat(100)}
        Required qualifications include 3 years of relevant experience.
        This role is remote within the United States.`,
    }), {
      ...profile,
      target_seniority: "mid",
      target_titles: JSON.stringify(["Product Designer"]),
      preferred_locations: JSON.stringify(["United States"]),
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 });
    expect(result.hardFilterPass).toBe(true);
  });

  it("accepts any US state when the candidate selected United States", () => {
    const result = scoreJob(job({
      title: "Product Designer",
      location: "Portland, Oregon",
      workplace_type: "on-site",
      description: "Required qualifications include 4 years of relevant product design experience.",
    }), {
      ...profile,
      target_seniority: "mid",
      target_titles: JSON.stringify(["Product Designer"]),
      preferred_locations: JSON.stringify(["United States"]),
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 });
    expect(result.hardFilterPass).toBe(true);
  });

  it("treats salary as a ranking preference instead of a hard rejection", () => {
    const result = scoreJob(job({
      title: "Product Designer",
      location: "Remote, United States",
      salary_min: 80000,
      salary_max: 90000,
      description: "Required qualifications include 3 years of relevant product design experience.",
    }), {
      ...profile,
      target_seniority: "mid",
      target_titles: JSON.stringify(["Product Designer"]),
      preferred_locations: JSON.stringify(["United States"]),
      minimum_salary: 120000,
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 });
    expect(result.hardFilterPass).toBe(true);
    expect(result.compensation).toBe(0);
  });

  it("accepts software design titles", () => {
    const strictProfile = {
      ...profile,
      target_seniority: "mid",
      years_experience: 5,
      preferred_locations: JSON.stringify(["United States"]),
    };
    const preferences = { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 };
    for (const title of ["UI/UX Designer", "Design Engineer", "Product Design Engineer"]) {
      const result = scoreJob(job({
        title,
        location: "Remote, United States",
        description: "Build digital product interfaces using Figma and React. Required qualifications include 3 to 5 years of relevant experience.",
      }), strictProfile, preferences);
      expect(result.eligibilityStatus, title).toBe("eligible");
    }
    for (const title of ["UX Designer", "Interaction Designer", "Web Designer"]) {
      const result = scoreJob(job({
        title,
        location: "Remote, United States",
        description: "Design digital product experiences using Figma. Required qualifications include 3 to 5 years of relevant experience.",
      }), strictProfile, preferences);
      expect(result.eligibilityStatus, title).toBe("eligible");
    }
  });

  it("filters hardware Design Engineer roles even when the title matches", () => {
    const result = scoreJob(job({
      title: "Design Engineer",
      location: "Austin, Texas",
      description: "Create SolidWorks CAD drawings and tolerance analysis for manufacturing. Requires 3 years of experience.",
    }), {
      ...profile,
      target_seniority: "mid",
      years_experience: 5,
      preferred_locations: JSON.stringify(["United States"]),
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 });
    expect(result.eligibilityStatus).toBe("filtered");
    expect(result.hardFilterReasons.join(" ")).toContain("digital Design Engineer");
  });

  it("filters Apple hardware Product Design Engineer roles", () => {
    const strictProfile = {
      ...profile,
      target_seniority: "mid",
      years_experience: 5,
      preferred_locations: JSON.stringify(["United States"]),
    };
    const preferences = { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 };
    for (const description of [
      "Own mechanical architecture and end-to-end design for cross-domain prototype systems.",
      "Develop mechanisms, enclosure design, GD&T, tooling, and mass production processes.",
      "Contribute to Apple Vision Pro product development and prototype spatial computing solutions.",
    ]) {
      const result = scoreJob(job({
        title: "Product Design Engineer",
        company: "Apple",
        location: "Cupertino, California",
        description,
      }), strictProfile, preferences);
      expect(result.eligibilityStatus, description).toBe("filtered");
    }
  });

  it("accepts Senior Product Designer when the posting asks for five years or less", () => {
    const result = scoreJob(job({
      title: "Senior Product Designer",
      location: "Remote, United States",
      description: "Required qualifications include 5 years of relevant experience.",
    }), {
      ...profile,
      target_seniority: "mid",
      years_experience: 5,
      preferred_locations: JSON.stringify(["United States"]),
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 });
    expect(result.eligibilityStatus).toBe("eligible");
  });

  it("asks for verification when a Senior title omits the years requirement", () => {
    const result = scoreJob(job({
      title: "Senior Product Designer",
      location: "Remote, United States",
      description: "Create product experiences with a cross-functional team.",
    }), {
      ...profile,
      target_seniority: "mid",
      years_experience: 5,
      preferred_locations: JSON.stringify(["United States"]),
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 });
    expect(result.hardFilterPass).toBe(true);
    expect(result.eligibilityStatus).toBe("needs_verification");
  });

  it("filters roles older than two months", () => {
    const postedAt = new Date(Date.now() - 61 * 86_400_000).toISOString();
    const result = scoreJob(job({
      title: "Product Designer",
      location: "Remote, United States",
      posted_at: postedAt,
      description: "Required qualifications include 3 years of relevant experience.",
    }), {
      ...profile,
      target_seniority: "mid",
      preferred_locations: JSON.stringify(["United States"]),
    }, { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 });
    expect(result.eligibilityStatus).toBe("filtered");
    expect(result.hardFilterReasons.join(" ")).toContain("61 days old");
  });

  it("filters official postings with explicit non-US country locations", () => {
    const preferences = { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 };
    for (const location of ["Malaysia", "Seoul, Korea", "Tokyo, Japan", "Taipei, Taiwan", "London, United Kingdom"]) {
      const result = scoreJob(job({
        title: "Product Designer",
        location,
        description: "Required qualifications include 4 years of relevant experience.",
      }), {
        ...profile,
        target_seniority: "mid",
        preferred_locations: JSON.stringify(["United States"]),
      }, preferences);
      expect(result.eligibilityStatus, location).toBe("filtered");
    }
  });

  it("filters other design disciplines and leadership roles", () => {
    const strictProfile = {
      ...profile,
      target_seniority: "mid",
      preferred_locations: JSON.stringify(["United States"]),
    };
    const preferences = { usaOnly: true, minimumExperience: 2, maximumExperience: 5, maximumAgeDays: 60 };
    for (const title of ["Graphic Designer", "Motion Designer", "Lead Product Designer", "Design Manager"]) {
      const result = scoreJob(job({
        title,
        location: "Remote, United States",
        description: "Required qualifications include 4 years of relevant experience.",
      }), strictProfile, preferences);
      expect(result.eligibilityStatus, title).toBe("filtered");
    }
  });
});

describe("scorePostingConfidence", () => {
  it("keeps confidence separate and explains limited history", () => {
    const result = scorePostingConfidence(job(), 1);
    expect(result.total).toBeGreaterThan(0);
    expect(result.dataSufficiency).not.toBe("high");
    expect(result.cautionSignals.join(" ")).toContain("history");
  });

  it("increases evidence after repeated healthy sightings", () => {
    const first = scorePostingConfidence(job(), 1);
    const repeated = scorePostingConfidence(job({ seen_count: 4 }), 5);
    expect(repeated.total).toBeGreaterThan(first.total);
    expect(repeated.positiveSignals.join(" ")).toContain("collection runs");
  });
});

describe("role family classification", () => {
  const digitalDescription = "Own end to end product design in Figma, run user research, and ship design systems with React engineers.";

  it("still matches the titles Scout searches for", () => {
    expect(classifyRoleFamily("Senior Product Designer")).toBe("match");
    expect(classifyRoleFamily("UX/UI Designer")).toBe("match");
    expect(classifyRoleFamily("Product Design Engineer", "Build React interfaces using Figma and TypeScript.")).toBe("match");
  });

  it("passes any software design title outright", () => {
    for (const title of [
      "UX Designer",
      "UI Designer",
      "Interaction Designer",
      "Experience Designer",
      "Web Designer",
      "Visual Designer",
      "Mobile UI Designer",
      "Design Technologist",
      "Figma Design Specialist",
    ]) expect(classifyRoleFamily(title, digitalDescription), title).toBe("match");
  });

  it("keeps a title with no design word for review when the posting reads like design work", () => {
    expect(classifyRoleFamily("Product Technologist", digitalDescription)).toBe("possible");
    expect(classifyRoleFamily("Creative Technologist", digitalDescription)).toBe("possible");
  });

  it("still rejects other design disciplines whatever the description says", () => {
    expect(classifyRoleFamily("Graphic Designer", digitalDescription)).toBe("no");
    expect(classifyRoleFamily("Motion Designer", digitalDescription)).toBe("no");
    expect(classifyRoleFamily("Industrial Designer", digitalDescription)).toBe("no");
  });

  it("still rejects hardware roles", () => {
    expect(classifyRoleFamily("Mechanical Design Engineer", digitalDescription)).toBe("no");
    expect(classifyRoleFamily("Design Engineer", "Own mechanical architecture and SolidWorks CAD drawings.")).toBe("no");
  });

  it("does not rescue a non-design title on one stray keyword", () => {
    expect(classifyRoleFamily("Product Technologist", "We use React.")).toBe("no");
    expect(digitalDesignSignalCount("We use React.")).toBe(1);
  });

  it("ignores a title with no design signal at all", () => {
    expect(classifyRoleFamily("Backend Engineer", digitalDescription)).toBe("no");
    expect(classifyRoleFamily("Account Executive", digitalDescription)).toBe("no");
  });

  it("keeps filtering leadership titles even when the description fits", () => {
    for (const title of ["Director, Product Design", "Lead UX Designer", "Staff Interaction Designer"]) {
      const assessment = assessJobEligibility(
        { title, location: "New York, NY", description: digitalDescription, workplaceType: "hybrid", postedAt: new Date().toISOString() },
        profile,
        { usaOnly: true, minimumExperience: 2, maximumExperience: 8, maximumAgeDays: 45 },
      );
      expect(assessment.status).toBe("filtered");
    }
  });

  it("does not rescue an engineering role on an incidental title word", () => {
    expect(classifyRoleFamily("Senior Frontend Software Engineer, Home Experience", digitalDescription)).toBe("no");
  });

  it("routes a possible match to verification rather than eligible", () => {
    const assessment = assessJobEligibility(
      {
        title: "Product Technologist",
        location: "New York, NY",
        description: digitalDescription,
        workplaceType: "hybrid",
        postedAt: new Date().toISOString(),
      },
      profile,
      { usaOnly: true, minimumExperience: 2, maximumExperience: 8, maximumAgeDays: 45 },
    );
    expect(assessment.status).toBe("needs_verification");
    expect(assessment.verificationReasons.join(" ")).toContain("reads like product design work");
  });
});

describe("citizenship and clearance requirements", () => {
  const sponsoredProfile = { ...profile, sponsorship_required: 1 };
  const citizenProfile = { ...profile, sponsorship_required: 0 };
  const preferences = { usaOnly: true, minimumExperience: 2, maximumExperience: 8, maximumAgeDays: 60 };
  const base = {
    title: "Product Designer",
    location: "Mountain View, CA",
    workplaceType: "onsite",
    postedAt: new Date().toISOString(),
  };

  it("detects the requirement however the posting words it", () => {
    expect(citizenshipRequirement("SECURITY REQUIREMENTS:\n - Must be a U.S. Citizen")).toBe("citizen_required");
    expect(citizenshipRequirement("U.S. citizenship required.")).toBe("citizen_required");
    expect(citizenshipRequirement("This role requires US citizenship.")).toBe("citizen_required");
  });

  it("does not read equal opportunity boilerplate as a requirement", () => {
    expect(citizenshipRequirement(
      "We consider all applicants without regard to race, religion, national origin, or citizenship status.",
    )).toBe("none");
    expect(citizenshipRequirement(
      "We are an equal opportunity employer and do not discriminate on the basis of citizenship.",
    )).toBe("none");
  });

  it("filters a citizen-only role when sponsorship is needed", () => {
    const result = assessJobEligibility(
      { ...base, description: "Design defense interfaces. SECURITY REQUIREMENTS: Must be a U.S. Citizen. Requires 3 to 5 years of experience." },
      sponsoredProfile,
      preferences,
    );
    expect(result.status).toBe("filtered");
    expect(result.filterReasons.join(" ")).toContain("United States citizenship");
  });

  it("only asks for confirmation when sponsorship is not needed", () => {
    const result = assessJobEligibility(
      { ...base, description: "Design defense interfaces. U.S. citizenship required. Requires 3 to 5 years of experience." },
      citizenProfile,
      preferences,
    );
    expect(result.status).toBe("needs_verification");
  });

  it("raises a clearance mention for review rather than dropping the role", () => {
    const result = assessJobEligibility(
      { ...base, description: "Design tools for analysts. An active TS/SCI security clearance is nice to have. Requires 3 to 5 years of experience." },
      sponsoredProfile,
      preferences,
    );
    expect(result.status).toBe("needs_verification");
  });
});
