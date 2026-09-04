import { describe, expect, it } from "vitest";
import { detectAtsBoardFromUrl } from "@/lib/ats-discovery";
import { companyNameFromIdentifier } from "@/lib/collector";
import {
  canonicalJobUrl,
  effectiveIntervalMinutes,
  EXA_ATS_DOMAINS,
  isQueryDue,
  publishedAfterDate,
  type ExaQueryRow,
} from "@/lib/exa-discovery";

function query(overrides: Partial<ExaQueryRow> = {}): ExaQueryRow {
  return {
    id: 1,
    query: "Currently open US Product Designer roles",
    kind: "ats_daily",
    enabled: 1,
    minimum_interval_minutes: 1_440,
    last_run_at: null,
    last_result_count: 0,
    consecutive_zero_runs: 0,
    ...overrides,
  };
}

describe("Exa query cadence", () => {
  it("runs a query that has never run", () => {
    expect(isQueryDue(query())).toBe(true);
  });

  it("caches a daily query for a full day", () => {
    const now = Date.parse("2026-09-04T12:00:00Z");
    const sixHoursAgo = query({ last_run_at: "2026-09-04 06:00:00" });
    const twoDaysAgo = query({ last_run_at: "2026-09-02 12:00:00" });
    expect(isQueryDue(sixHoursAgo, now)).toBe(false);
    expect(isQueryDue(twoDaysAgo, now)).toBe(true);
  });

  it("holds the open web query for a week", () => {
    const now = Date.parse("2026-09-04T12:00:00Z");
    const weekly = query({ kind: "open_weekly", minimum_interval_minutes: 10_080, last_run_at: "2026-09-01 12:00:00" });
    expect(isQueryDue(weekly, now)).toBe(false);
    expect(isQueryDue({ ...weekly, last_run_at: "2026-08-20 12:00:00" }, now)).toBe(true);
  });

  it("rotates a query down after it repeatedly returns nothing", () => {
    expect(effectiveIntervalMinutes(query({ consecutive_zero_runs: 0 }))).toBe(1_440);
    expect(effectiveIntervalMinutes(query({ consecutive_zero_runs: 2 }))).toBe(1_440);
    expect(effectiveIntervalMinutes(query({ consecutive_zero_runs: 3 }))).toBe(2_880);
    expect(effectiveIntervalMinutes(query({ consecutive_zero_runs: 4 }))).toBe(4_320);
  });

  it("never rotates a query out entirely", () => {
    expect(effectiveIntervalMinutes(query({ consecutive_zero_runs: 500 }))).toBe(1_440 * 4);
  });

  it("skips a disabled query", () => {
    expect(isQueryDue(query({ enabled: 0 }))).toBe(false);
  });
});

describe("Exa request shape", () => {
  it("looks back a month rather than further", () => {
    const now = Date.parse("2026-09-04T12:00:00Z");
    const since = Date.parse(publishedAfterDate(now));
    const days = (now - since) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(45);
  });

  it("filters ATS hosts by parameter, keeping operators out of the query text", () => {
    expect(EXA_ATS_DOMAINS).toContain("jobs.ashbyhq.com");
    expect(EXA_ATS_DOMAINS).toContain("job-boards.greenhouse.io");
    for (const domain of EXA_ATS_DOMAINS) expect(domain).not.toContain("site:");
  });
});

describe("canonical job URLs", () => {
  it("treats tracking variants of one posting as the same job", () => {
    const plain = canonicalJobUrl("https://jobs.ashbyhq.com/acme/abc123");
    expect(canonicalJobUrl("https://jobs.ashbyhq.com/acme/abc123?utm_source=exa")).toBe(plain);
    expect(canonicalJobUrl("https://www.jobs.ashbyhq.com/acme/abc123#apply")).toBe(plain);
    expect(canonicalJobUrl("https://jobs.ashbyhq.com/acme/abc123/")).toBe(plain);
  });

  it("keeps different postings distinct", () => {
    expect(canonicalJobUrl("https://jobs.ashbyhq.com/acme/abc123"))
      .not.toBe(canonicalJobUrl("https://jobs.ashbyhq.com/acme/def456"));
  });
});

describe("board detection for the searched ATS hosts", () => {
  it("reads the board out of each host in the include list", () => {
    expect(detectAtsBoardFromUrl("https://jobs.ashbyhq.com/acme/abc123"))
      .toMatchObject({ sourceType: "ashby", identifier: "acme" });
    expect(detectAtsBoardFromUrl("https://jobs.lever.co/acme/abc123"))
      .toMatchObject({ sourceType: "lever", identifier: "acme" });
    expect(detectAtsBoardFromUrl("https://boards.greenhouse.io/acme/jobs/123"))
      .toMatchObject({ sourceType: "greenhouse", identifier: "acme" });
    expect(detectAtsBoardFromUrl("https://job-boards.greenhouse.io/acme/jobs/123"))
      .toMatchObject({ sourceType: "greenhouse", identifier: "acme" });
  });
});

describe("company names from board identifiers", () => {
  it("presents a slug as a readable company name", () => {
    expect(companyNameFromIdentifier("assembledhq")).toBe("Assembledhq");
    expect(companyNameFromIdentifier("norm-ai")).toBe("Norm Ai");
    expect(companyNameFromIdentifier("zero_g_talent")).toBe("Zero G Talent");
  });

  it("survives an empty or malformed identifier", () => {
    expect(companyNameFromIdentifier("")).toBe("");
    expect(companyNameFromIdentifier("--")).toBe("");
  });
});
