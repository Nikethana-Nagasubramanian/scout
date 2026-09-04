import { describe, expect, it } from "vitest";
import {
  detectAtsBoardFromUrl,
  detectAtsBoardsFromHtml,
  extractCareerPageLinks,
  extractCompanyLinks,
  extractConsiderAtsBoards,
  extractGetroAtsBoards,
  extractHiringCafeAtsBoards,
  extractHiringCafeJobs,
} from "@/lib/ats-discovery";
import {
  broadDiscoverySearchTitles,
  isProductDesignRoleFamily,
  jobSearchTitles,
} from "@/lib/job-fit";
import type { CandidateProfile } from "@/lib/types";

const profile = {
  target_titles: JSON.stringify(["Product Designer", "Design Engineer"]),
} as CandidateProfile;

describe("ATS board detection", () => {
  it("detects Greenhouse board tokens from hosted jobs and embeds", () => {
    expect(detectAtsBoardFromUrl("https://job-boards.greenhouse.io/acme/jobs/123")?.identifier).toBe("acme");
    expect(detectAtsBoardFromUrl("https://boards.greenhouse.io/embed/job_app?for=studio&token=123")?.identifier).toBe("studio");
    expect(detectAtsBoardFromUrl("https://my.greenhouse.io/jobs/tatari/8652422002")?.identifier).toBe("tatari");
  });

  it("detects Ashby board names from job and public API URLs", () => {
    expect(detectAtsBoardFromUrl("https://jobs.ashbyhq.com/InterfaceLabs/role-id")?.identifier).toBe("InterfaceLabs");
    expect(detectAtsBoardFromUrl("https://api.ashbyhq.com/posting-api/job-board/InterfaceLabs")?.identifier).toBe("InterfaceLabs");
  });

  it("finds official boards embedded in a company career page", () => {
    const boards = detectAtsBoardsFromHtml(`
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>
      <a href="https://jobs.ashbyhq.com/Studio">Open roles</a>
    `, "https://acme.example/careers");
    expect(boards.map((board) => `${board.sourceType}:${board.identifier}`).sort()).toEqual([
      "ashby:Studio",
      "greenhouse:acme",
    ]);
  });

  it("maps HiringCafe server-rendered jobs to named official ATS boards", () => {
    const payload = {
      props: {
        pageProps: {
          ssrHits: [{
            apply_url: "https://jobs.ashbyhq.com/joinpogo/job-id",
            v5_processed_job_data: { company_name: "Pogo" },
          }, {
            apply_url: "https://job-boards.greenhouse.io/acme/jobs/123",
            enriched_company_data: { name: "Acme Labs" },
          }],
        },
      },
    };
    const boards = extractHiringCafeAtsBoards(
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`,
    );
    expect(boards.map((item) => `${item.company}:${item.board.sourceType}:${item.board.identifier}`)).toEqual([
      "Pogo:ashby:joinpogo",
      "Acme Labs:greenhouse:acme",
    ]);
  });

  it("extracts direct HiringCafe jobs with enough structured evidence to classify them", () => {
    const payload = {
      props: {
        pageProps: {
          ssrHits: [{
            id: "ashby___studio___role-id",
            objectID: "ashby___studio___role-id",
            apply_url: "https://jobs.ashbyhq.com/studio/role-id",
            is_expired: false,
            job_information: { title: "Product Designer" },
            v5_processed_job_data: {
              company_name: "Studio",
              requirements_summary: "Build clear workflows for complex products.",
              role_activities: ["prototyping", "user research"],
              technical_tools: ["Figma", "React"],
              seniority_level: "Mid Level",
              min_industry_and_role_yoe: 3,
              commitment: ["Full Time"],
              workplace_type: "Hybrid",
              formatted_workplace_location: "New York, New York, United States",
              yearly_min_compensation: 120000,
              yearly_max_compensation: 150000,
              listed_compensation_currency: "USD",
              estimated_publish_date: "2026-07-31T12:00:00.000Z",
            },
          }, {
            id: "expired-role",
            apply_url: "https://example.com/expired",
            is_expired: true,
            job_information: { title: "Product Designer" },
            v5_processed_job_data: { company_name: "Expired Company" },
          }],
        },
      },
    };

    expect(extractHiringCafeJobs(
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`,
    )).toEqual([expect.objectContaining({
      externalId: "ashby___studio___role-id",
      title: "Product Designer",
      company: "Studio",
      location: "New York, New York, United States",
      workplaceType: "hybrid",
      employmentType: "Full Time",
      salaryMin: 120000,
      salaryMax: 150000,
      salaryCurrency: "USD",
      applyUrl: "https://jobs.ashbyhq.com/studio/role-id",
      postedAt: "2026-07-31T12:00:00.000Z",
      description: expect.stringContaining("3 years of experience required."),
    })]);
  });

  it("maps filtered Getro jobs and respects company rules", () => {
    const payload = {
      props: {
        pageProps: {
          initialState: {
            jobs: {
              found: [{
                organization: { name: "Hanover" },
                url: "https://jobs.ashbyhq.com/hanover-park/job-one",
              }, {
                organization: { name: "Variance" },
                url: "https://jobs.ashbyhq.com/intrinsic-safety/job-two",
              }, {
                organization: { name: "Arbor" },
                url: "https://jobs.ashbyhq.com/findarbor/job-three",
              }, {
                organization: { name: "Hanover" },
                url: "https://example.com/jobs/job-four",
              }],
            },
          },
        },
      },
    };
    const boards = extractGetroAtsBoards(
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`,
      ["Hanover", "Variance"],
      ["Arbor"],
    );
    expect(boards).toEqual([
      {
        company: "Hanover",
        board: {
          sourceType: "ashby",
          identifier: "hanover-park",
          evidenceUrl: "https://jobs.ashbyhq.com/hanover-park/job-one",
        },
      },
      {
        company: "Variance",
        board: {
          sourceType: "ashby",
          identifier: "intrinsic-safety",
          evidenceUrl: "https://jobs.ashbyhq.com/intrinsic-safety/job-two",
        },
      },
    ]);
  });

  it("maps Consider jobs to named official ATS boards", () => {
    expect(extractConsiderAtsBoards([{
      companyName: "Orb",
      applyUrl: "https://jobs.ashbyhq.com/orb/job-one?utm_source=greylock",
    }, {
      companyName: "Discord",
      url: "https://job-boards.greenhouse.io/discord/jobs/123",
    }, {
      companyName: "Shortcut",
      applyUrl: "https://shortcut.bamboohr.com/careers/40",
    }])).toEqual([
      {
        company: "Orb",
        board: {
          sourceType: "ashby",
          identifier: "orb",
          evidenceUrl: "https://jobs.ashbyhq.com/orb/job-one?utm_source=greylock",
        },
      },
      {
        company: "Discord",
        board: {
          sourceType: "greenhouse",
          identifier: "discord",
          evidenceUrl: "https://job-boards.greenhouse.io/discord/jobs/123",
        },
      },
    ]);
  });
});

describe("company directory discovery", () => {
  it("extracts external companies while excluding social and same-site links", () => {
    const companies = extractCompanyLinks(`
      <a href="/about">About us</a>
      <a href="https://acme.example">Acme</a>
      <a href="https://jobs.ashbyhq.com/Studio">Studio</a>
      <a href="https://linkedin.com/company/acme">LinkedIn</a>
    `, "https://fund.example/portfolio");
    expect(companies.map((company) => company.name)).toEqual(["Acme", "Studio"]);
  });

  it("finds likely career links on a company site", () => {
    const careers = extractCareerPageLinks(`
      <a href="/about">About</a>
      <a href="/careers">Join our team</a>
      <a href="https://jobs.ashbyhq.com/acme">Open roles</a>
    `, "https://acme.example");
    expect(careers).toEqual([
      "https://acme.example/careers",
      "https://jobs.ashbyhq.com/acme",
    ]);
  });
});

describe("source-specific role queries", () => {
  it("keeps engineering titles for exact ATS matching but removes them from broad feed queries", () => {
    expect(jobSearchTitles(profile)).toContain("Design Engineer");
    expect(broadDiscoverySearchTitles(profile)).not.toContain("Design Engineer");
  });

  it("accepts any software design title and requires digital evidence for Design Engineer", () => {
    expect(isProductDesignRoleFamily("Senior Product Designer")).toBe(true);
    expect(isProductDesignRoleFamily("UX/UI Designer")).toBe(true);
    expect(isProductDesignRoleFamily("Product Design Engineer", "Build React interfaces using Figma and TypeScript.")).toBe(true);
    expect(isProductDesignRoleFamily("Product Design Engineer", "Create SolidWorks CAD drawings for manufacturing.")).toBe(false);
    expect(isProductDesignRoleFamily("Product Design Engineer", "Own mechanical architecture for prototype systems.")).toBe(false);
    expect(isProductDesignRoleFamily("Product Design Engineer", "Prototype spatial computing products with cross-functional teams.")).toBe(false);
    expect(isProductDesignRoleFamily("Design Engineer")).toBe(false);
    expect(isProductDesignRoleFamily("UX Designer")).toBe(true);
    expect(isProductDesignRoleFamily("Interaction Designer")).toBe(true);
    expect(isProductDesignRoleFamily("Web Designer")).toBe(true);
    expect(isProductDesignRoleFamily("Design Technologist")).toBe(true);
    expect(isProductDesignRoleFamily("Software Engineer")).toBe(false);
    expect(isProductDesignRoleFamily("Graphic Designer")).toBe(false);
  });
});
