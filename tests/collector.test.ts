import { describe, expect, it } from "vitest";
import {
  considerRequestHeaders,
  cookieHeaderFromSetCookies,
  normalizeAshbyJobs,
  normalizeGreenhouseJobs,
  normalizeHimalayasJobs,
  normalizeJobicyJobs,
  normalizeLeverJobs,
  normalizeRemotiveJobs,
  parseRetryAfter,
  retryDelay,
} from "@/lib/collector";
import { parseHiringNewsletterSignals, parseJobAlertEmail } from "@/lib/gmail-alerts";
import type { JobSource } from "@/lib/types";

const greenhouseSource: JobSource = {
  id: 1,
  name: "Greenhouse Company",
  source_type: "greenhouse",
  identifier: "greenhouse-company",
  enabled: 1,
  cooldown_until: null,
  last_attempt_at: null,
  last_success_at: null,
  last_error: "",
  consecutive_failures: 0,
  auto_discovered: 0,
  discovered_from_url: "",
  discovered_via_name: "",
  discovered_via_url: "",
  created_at: "2026-01-01",
};

const leverSource: JobSource = {
  ...greenhouseSource,
  id: 2,
  name: "Lever Company",
  source_type: "lever",
  identifier: "lever-company",
};

const ashbySource: JobSource = {
  ...greenhouseSource,
  id: 3,
  name: "Ashby Company",
  source_type: "ashby",
  identifier: "ashby-company",
};

describe("job source normalization", () => {
  it("normalizes Greenhouse content and removes markup", () => {
    const [job] = normalizeGreenhouseJobs(greenhouseSource, [{
      id: 123,
      title: "Product Designer",
      absolute_url: "https://example.com/123",
      updated_at: "2026-01-02",
      location: { name: "Remote" },
      content: "<p>Build useful products &amp; systems.</p>",
    }]);
    expect(job.externalId).toBe("123");
    expect(job.workplaceType).toBe("remote");
    expect(job.description).toBe("Build useful products & systems.");
  });

  it("normalizes Lever salary, locations, and plain text", () => {
    const [job] = normalizeLeverJobs(leverSource, [{
      id: "abc",
      text: "UX Designer",
      hostedUrl: "https://example.com/abc",
      applyUrl: "https://example.com/abc/apply",
      workplaceType: "hybrid",
      categories: { allLocations: ["Chicago", "New York"], commitment: "Full-time" },
      openingPlain: "Opening",
      descriptionPlain: "Description",
      salaryRange: { min: 100000, max: 130000, currency: "USD" },
    }]);
    expect(job.location).toBe("Chicago, New York");
    expect(job.description).toBe("Opening\n\nDescription");
    expect(job.salaryMax).toBe(130000);
  });

  it("normalizes listed Ashby jobs and annual compensation", () => {
    const jobs = normalizeAshbyJobs(ashbySource, [{
      title: "Product Designer",
      location: "New York, NY",
      secondaryLocations: [{ location: "Remote, United States" }],
      isListed: true,
      isRemote: true,
      workplaceType: "Remote",
      descriptionPlain: "Design trusted product workflows.",
      publishedAt: "2026-07-25T12:00:00Z",
      employmentType: "FullTime",
      jobUrl: "https://jobs.ashbyhq.com/ashby-company/job-123",
      applyUrl: "https://jobs.ashbyhq.com/ashby-company/job-123/application",
      compensation: {
        summaryComponents: [{
          compensationType: "Salary",
          interval: "1 YEAR",
          currencyCode: "USD",
          minValue: 120000,
          maxValue: 150000,
        }],
      },
    }, {
      title: "Unlisted Designer",
      isListed: false,
      jobUrl: "https://jobs.ashbyhq.com/ashby-company/hidden",
      applyUrl: "https://jobs.ashbyhq.com/ashby-company/hidden/application",
    }]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].location).toBe("New York, NY, Remote, United States");
    expect(jobs[0].salaryMax).toBe(150000);
    expect(jobs[0].externalId).toBe("job-123");
  });

  it("normalizes Remotive discovery jobs", () => {
    const [job] = normalizeRemotiveJobs([{
      id: 99,
      url: "https://remotive.com/remote-jobs/design/product-designer-99",
      title: "Product Designer",
      company_name: "Product Company",
      candidate_required_location: "USA",
      job_type: "full_time",
      publication_date: "2026-07-22T10:00:00Z",
      description: "<p>Design thoughtful software.</p>",
    }]);
    expect(job.company).toBe("Product Company");
    expect(job.workplaceType).toBe("remote");
    expect(job.description).toBe("Design thoughtful software.");
  });

  it("normalizes Jobicy discovery jobs and seniority", () => {
    const [job] = normalizeJobicyJobs([{
      id: "jobicy-10",
      url: "https://jobicy.com/jobs/10",
      jobTitle: "UX Designer",
      companyName: "Design Company",
      jobGeo: "United States",
      jobLevel: "Mid level",
      annualSalaryMin: "90000",
      annualSalaryMax: 120000,
      salaryCurrency: "USD",
      jobDescription: "<p>Own product discovery.</p>",
    }]);
    expect(job.salaryMin).toBe(90000);
    expect(job.salaryMax).toBe(120000);
    expect(job.description).toContain("Seniority: Mid level");
  });

  it("normalizes Himalayas search jobs", () => {
    const [job] = normalizeHimalayasJobs([{
      guid: "himalayas-1",
      title: "Design Engineer",
      companyName: "Interface Company",
      employmentType: "Full Time",
      locationRestrictions: [{ name: "United States", alpha2: "US" }],
      seniority: ["Mid-level"],
      minSalary: 120000,
      maxSalary: 150000,
      salaryPeriod: "annual",
      currency: "USD",
      description: "<p>Build accessible interfaces.</p>",
      pubDate: 1784764800000,
      applicationLink: "https://example.com/apply",
    }]);
    expect(job.externalId).toBe("himalayas-1");
    expect(job.location).toBe("United States");
    expect(job.salaryMax).toBe(150000);
    expect(job.description).toContain("Seniority: Mid-level");
  });
});

describe("collector rate-limit helpers", () => {
  it("preserves the Consider session and CSRF preconditions", () => {
    const cookieHeader = cookieHeaderFromSetCookies([
      "session=abc123; Path=/; HttpOnly",
      "session.sig=signature; Path=/; HttpOnly",
    ]);
    expect(cookieHeader).toBe("session=abc123; session.sig=signature");
    expect(considerRequestHeaders(
      "https://jobs.greylock.com/jobs?jobTypes=UX+Designer",
      "csrf-token",
      cookieHeader,
    )).toMatchObject({
      Origin: "https://jobs.greylock.com",
      Referer: "https://jobs.greylock.com/jobs?jobTypes=UX+Designer",
      "X-CSRF-Token": "csrf-token",
      Cookie: cookieHeader,
    });
  });

  it("parses Retry-After seconds", () => {
    expect(parseRetryAfter("12")).toBe(12_000);
  });

  it("parses a Retry-After date", () => {
    const now = new Date("2026-07-23T12:00:00Z").getTime();
    expect(parseRetryAfter("Thu, 23 Jul 2026 12:00:05 GMT", now)).toBe(5_000);
  });

  it("uses bounded exponential retry delays", () => {
    expect(retryDelay(1)).toBe(1_000);
    expect(retryDelay(2)).toBe(2_000);
    expect(retryDelay(10)).toBe(30_000);
  });
});

describe("Gmail alert parsing", () => {
  it("separates explicit newsletter roles from broad company hiring signals", () => {
    const input = {
      html: `
        <p><strong>Gamma</strong> builds an AI presentation platform. We are hiring a Forward Deployed Designer in San Francisco. <a href="https://careers.gamma.app/jobs/forward-deployed-designer">Apply here</a></p>
        <p><strong>Ineffable Intelligence</strong> raised a seed round and is hiring technical staff members. <a href="https://jobs.ashbyhq.com/ineffable">View open roles</a></p>
        <p><a href="https://a16zbuild.substack.com/account">Manage preferences</a></p>
      `,
      text: "",
      subject: "Open roles with founders",
      from: "a16z Build <newsletter@substack.com>",
      date: new Date("2026-05-05T12:00:00Z"),
    };

    const signals = parseHiringNewsletterSignals(input);
    const jobs = parseJobAlertEmail(input);

    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({
      company: "Gamma",
      roleHint: "Forward Deployed Designer",
      signalType: "explicit_role",
    });
    expect(signals[1]).toMatchObject({
      company: "Ineffable Intelligence",
      roleHint: "",
      signalType: "company_hiring",
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      company: "Gamma",
      title: "Forward Deployed Designer",
      sourceType: "gmail_newsletter",
      sourceName: "a16z Build newsletter",
    });
  });

  it("extracts an Indeed job card without preserving tracking parameters", () => {
    const jobs = parseJobAlertEmail({
      html: `
        <table>
          <tr><td><a href="https://www.indeed.com/rc/clk?jk=abc123&amp;from=jobalert">Product Designer</a></td></tr>
          <tr><td>Acme Financial</td></tr>
          <tr><td>Boston, MA</td></tr>
          <tr><td>3 years of product design experience. Full-time hybrid role.</td></tr>
        </table>
      `,
      text: "",
      subject: "Product Designer jobs",
      from: "Indeed Job Alert",
      date: new Date("2026-07-23T12:00:00Z"),
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceType).toBe("gmail_indeed");
    expect(jobs[0].title).toBe("Product Designer");
    expect(jobs[0].company).toBe("Acme Financial");
    expect(jobs[0].location).toBe("Boston, MA");
    expect(jobs[0].canonicalUrl).toBe("https://www.indeed.com/viewjob?jk=abc123");
  });

  it("extracts a BuiltIn card when the link text is a generic action", () => {
    const jobs = parseJobAlertEmail({
      html: `
        <section>
          <h2>UX Designer</h2>
          <div>Interface Labs</div>
          <div>Remote, United States</div>
          <div>Build accessible SaaS workflows with product and engineering.</div>
          <a href="https://builtin.com/job/ux-designer/12345?utm_source=alert">View job</a>
        </section>
      `,
      text: "",
      subject: "New design jobs",
      from: "BuiltIn",
      date: new Date("2026-07-23T12:00:00Z"),
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceType).toBe("gmail_builtin");
    expect(jobs[0].title).toBe("UX Designer");
    expect(jobs[0].company).toBe("Interface Labs");
    expect(jobs[0].location).toBe("Remote, United States");
    expect(jobs[0].canonicalUrl).toBe("https://builtin.com/job/ux-designer/12345");
  });

  it("decodes a BuiltIn AWS tracking destination without opening it", () => {
    const jobs = parseJobAlertEmail({
      html: `
        <table>
          <tr><td><a href="https://cb4sdw3d.r.us-west-2.awstrack.me/L0/https:%2F%2Fbuiltin.com%2Fjob%2Fproduct-designer%2F98765%3Futm_source%3Dalert/1/token">Product Designer</a></td></tr>
          <tr><td>Product Studio</td></tr>
          <tr><td>New York, NY</td></tr>
        </table>
      `,
      text: "",
      subject: "Your BuiltIn matches",
      from: "BuiltIn",
      date: new Date("2026-07-23T12:00:00Z"),
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].canonicalUrl).toBe("https://builtin.com/job/product-designer/98765");
  });

  it("removes company, location, work mode, and salary from a wrapped BuiltIn title", () => {
    const jobs = parseJobAlertEmail({
      html: `
        <table>
          <tr><td><a href="https://builtin.com/job/innovation-product-designer/9986582?i=tracking&amp;preference_id=private">Brown Brothers Harriman Innovation Product Designer In Office Boston, MA $100,000-$155,000</a></td></tr>
          <tr><td>Brown Brothers Harriman</td></tr>
          <tr><td>Boston, MA</td></tr>
        </table>
      `,
      text: "",
      subject: "Your BuiltIn matches",
      from: "BuiltIn",
      date: new Date("2026-07-23T12:00:00Z"),
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("Innovation Product Designer");
    expect(jobs[0].canonicalUrl).toBe("https://builtin.com/job/innovation-product-designer/9986582");
  });

  it("keeps a titled Indeed alert tracking link without following it", () => {
    const jobs = parseJobAlertEmail({
      html: `
        <table>
          <tr><td><a href="https://cts.indeed.com/v1/abc123/def456">Product Designer</a></td></tr>
          <tr><td>Design Systems Co</td></tr>
          <tr><td>Remote, United States</td></tr>
          <tr><td>Work with research and engineering to ship accessible products.</td></tr>
        </table>
      `,
      text: "",
      subject: "New Product Designer roles",
      from: "Indeed",
      date: new Date("2026-07-23T12:00:00Z"),
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].sourceType).toBe("gmail_indeed");
    expect(jobs[0].canonicalUrl).toBe("https://cts.indeed.com/v1/abc123/def456");
  });

  it("ignores Indeed footer and profile action links", () => {
    const jobs = parseJobAlertEmail({
      html: `
        <table>
          <tr><td><a href="https://cts.indeed.com/v1/job123/token">Product Designer</a></td></tr>
          <tr><td>Design Systems Co</td></tr>
          <tr><td>Remote, United States</td></tr>
          <tr><td><a href="https://cts.indeed.com/v1/badmatch/token">This is a bad match</a></td></tr>
          <tr><td><a href="https://cts.indeed.com/v1/profile/token">Edit profile</a></td></tr>
          <tr><td><a href="https://cts.indeed.com/v1/pause/token">Pause these emails</a></td></tr>
          <tr><td><a href="https://cts.indeed.com/v1/help/token">Help Center</a></td></tr>
        </table>
      `,
      text: "",
      subject: "New Product Designer roles",
      from: "Indeed",
      date: new Date("2026-07-23T12:00:00Z"),
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("Product Designer");
  });

  it("repairs a BuiltIn company name that is embedded in the title", () => {
    const jobs = parseJobAlertEmail({
      html: `
        <table>
          <tr><td><a href="https://builtin.com/job/staff-product-designer/2222">Vetcove Staff Product Designer</a></td></tr>
          <tr><td>Product Designer,</td></tr>
          <tr><td>Boston, MA, USA, Hybrid, Mid Level</td></tr>
        </table>
      `,
      text: "",
      subject: "Your BuiltIn matches",
      from: "BuiltIn",
      date: new Date("2026-07-23T12:00:00Z"),
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].company).toBe("Vetcove");
    expect(jobs[0].title).toBe("Staff Product Designer");
  });
});
