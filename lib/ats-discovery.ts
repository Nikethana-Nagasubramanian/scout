export type AtsBoardType = "greenhouse" | "ashby";

export interface DetectedAtsBoard {
  sourceType: AtsBoardType;
  identifier: string;
  evidenceUrl: string;
}

export interface CompanyLink {
  name: string;
  url: string;
}

export interface NamedAtsBoard {
  company: string;
  board: DetectedAtsBoard;
}

export interface HiringCafeJobListing {
  externalId: string;
  title: string;
  company: string;
  location: string;
  workplaceType: string;
  employmentType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  description: string;
  applyUrl: string;
  postedAt: string | null;
}

interface HiringCafeHit {
  id?: unknown;
  objectID?: unknown;
  apply_url?: unknown;
  is_expired?: unknown;
  job_information?: {
    title?: unknown;
    job_title_raw?: unknown;
  };
  v5_processed_job_data?: {
    company_name?: unknown;
    core_job_title?: unknown;
    requirements_summary?: unknown;
    technical_tools?: unknown;
    role_activities?: unknown;
    commitment?: unknown;
    seniority_level?: unknown;
    workplace_type?: unknown;
    formatted_workplace_location?: unknown;
    min_industry_and_role_yoe?: unknown;
    yearly_min_compensation?: unknown;
    yearly_max_compensation?: unknown;
    listed_compensation_currency?: unknown;
    estimated_publish_date?: unknown;
  };
  enriched_company_data?: { name?: unknown };
}

function hiringCafeHits(html: string): HiringCafeHit[] {
  const match = html.match(/<script id=["']__NEXT_DATA__["'] type=["']application\/json["']>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const payload = JSON.parse(match[1]) as {
      props?: { pageProps?: { ssrHits?: unknown } };
    };
    return Array.isArray(payload.props?.pageProps?.ssrHits)
      ? payload.props.pageProps.ssrHits as HiringCafeHit[]
      : [];
  } catch {
    return [];
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function numericValue(value: unknown): number | null {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeHtmlUrl(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replaceAll("&#x2F;", "/")
    .trim();
}

function cleanIdentifier(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

export function detectAtsBoardFromUrl(value: string): DetectedAtsBoard | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(decodeHtmlUrl(value));
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (
    host === "boards.greenhouse.io"
    || host === "job-boards.greenhouse.io"
    || host === "boards-api.greenhouse.io"
    || host === "my.greenhouse.io"
  ) {
    const apiBoardIndex = parts.findIndex((part) => part === "boards");
    const myGreenhouseJobsIndex = host === "my.greenhouse.io" ? parts.findIndex((part) => part === "jobs") : -1;
    const identifier = myGreenhouseJobsIndex >= 0
      ? parts[myGreenhouseJobsIndex + 1]
      : apiBoardIndex >= 0
      ? parts[apiBoardIndex + 1]
      : parts[0] === "embed"
        ? url.searchParams.get("for")
        : parts[0];
    if (identifier && !["embed", "jobs"].includes(identifier)) {
      return {
        sourceType: "greenhouse",
        identifier: cleanIdentifier(identifier),
        evidenceUrl: url.toString(),
      };
    }
  }

  if (host === "jobs.ashbyhq.com" || host === "api.ashbyhq.com") {
    const boardIndex = parts.findIndex((part) => part === "job-board");
    const identifier = boardIndex >= 0 ? parts[boardIndex + 1] : parts[0];
    if (identifier && identifier !== "posting-api") {
      return {
        sourceType: "ashby",
        identifier: cleanIdentifier(identifier),
        evidenceUrl: url.toString(),
      };
    }
  }

  return null;
}

function urlsFromHtml(html: string, baseUrl: string): string[] {
  const values = new Set<string>();
  const attributePattern = /(?:href|src|data-url|data-src)\s*=\s*["']([^"']+)["']/gi;
  const absolutePattern = /https?:\/\/[^\s"'<>\\]+/gi;

  for (const match of html.matchAll(attributePattern)) values.add(decodeHtmlUrl(match[1]));
  for (const match of html.matchAll(absolutePattern)) values.add(decodeHtmlUrl(match[0]));

  return [...values].flatMap((value) => {
    try {
      return [new URL(value, baseUrl).toString()];
    } catch {
      return [];
    }
  });
}

export function detectAtsBoardsFromHtml(html: string, baseUrl: string): DetectedAtsBoard[] {
  const boards = new Map<string, DetectedAtsBoard>();
  for (const url of urlsFromHtml(html, baseUrl)) {
    const detected = detectAtsBoardFromUrl(url);
    if (detected) boards.set(`${detected.sourceType}:${detected.identifier.toLowerCase()}`, detected);
  }
  return [...boards.values()];
}

export function extractHiringCafeAtsBoards(html: string): NamedAtsBoard[] {
  const boards = new Map<string, NamedAtsBoard>();
  for (const hit of hiringCafeHits(html)) {
    const applyUrl = stringValue(hit.apply_url);
    const board = detectAtsBoardFromUrl(applyUrl);
    if (!board) continue;
    const company = stringValue(hit.v5_processed_job_data?.company_name)
      || stringValue(hit.enriched_company_data?.name)
      || board.identifier;
    boards.set(`${board.sourceType}:${board.identifier.toLowerCase()}`, { company, board });
  }
  return [...boards.values()];
}

export function extractHiringCafeJobs(html: string): HiringCafeJobListing[] {
  return hiringCafeHits(html).flatMap((hit) => {
    if (hit.is_expired === true) return [];
    const processed = hit.v5_processed_job_data;
    const applyUrl = stringValue(hit.apply_url);
    const externalId = stringValue(hit.objectID) || stringValue(hit.id) || applyUrl;
    const title = stringValue(hit.job_information?.title)
      || stringValue(hit.job_information?.job_title_raw)
      || stringValue(processed?.core_job_title);
    const company = stringValue(processed?.company_name)
      || stringValue(hit.enriched_company_data?.name);
    if (!externalId || !title || !company || !applyUrl) return [];

    const requirements = stringValue(processed?.requirements_summary);
    const activities = stringList(processed?.role_activities);
    const tools = stringList(processed?.technical_tools);
    const seniority = stringValue(processed?.seniority_level);
    const minimumExperience = numericValue(processed?.min_industry_and_role_yoe);
    const description = [
      requirements,
      activities.length ? `Role activities: ${activities.join(", ")}.` : "",
      tools.length ? `Technical tools: ${tools.join(", ")}.` : "",
      seniority ? `Seniority: ${seniority}.` : "",
      minimumExperience !== null ? `${minimumExperience} years of experience required.` : "",
    ].filter(Boolean).join("\n\n");

    return [{
      externalId,
      title,
      company,
      location: stringValue(processed?.formatted_workplace_location),
      workplaceType: stringValue(processed?.workplace_type).toLowerCase() || "unspecified",
      employmentType: stringList(processed?.commitment).join(", "),
      salaryMin: numericValue(processed?.yearly_min_compensation),
      salaryMax: numericValue(processed?.yearly_max_compensation),
      salaryCurrency: stringValue(processed?.listed_compensation_currency),
      description,
      applyUrl,
      postedAt: stringValue(processed?.estimated_publish_date) || null,
    }];
  });
}

interface GetroJob {
  organization?: { name?: unknown };
  url?: unknown;
}

interface ConsiderJob {
  applyUrl?: unknown;
  companyName?: unknown;
  url?: unknown;
}

function normalizedCompanySet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export function extractGetroAtsBoards(
  html: string,
  includeCompanies: string[] = [],
  excludeCompanies: string[] = [],
): NamedAtsBoard[] {
  const match = html.match(/<script id=["']__NEXT_DATA__["'] type=["']application\/json["']>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const payload = JSON.parse(match[1]) as {
      props?: {
        pageProps?: {
          initialState?: {
            jobs?: { found?: GetroJob[] };
          };
        };
      };
    };
    const included = normalizedCompanySet(includeCompanies);
    const excluded = normalizedCompanySet(excludeCompanies);
    const boards = new Map<string, NamedAtsBoard>();
    for (const job of payload.props?.pageProps?.initialState?.jobs?.found || []) {
      const company = typeof job.organization?.name === "string" ? job.organization.name.trim() : "";
      if (!company) continue;
      const companyKey = company.toLowerCase();
      if (included.size > 0 && !included.has(companyKey)) continue;
      if (excluded.has(companyKey)) continue;
      if (typeof job.url !== "string") continue;
      const board = detectAtsBoardFromUrl(job.url);
      if (!board) continue;
      boards.set(`${board.sourceType}:${board.identifier.toLowerCase()}`, { company, board });
    }
    return [...boards.values()];
  } catch {
    return [];
  }
}

export function extractConsiderAtsBoards(jobs: ConsiderJob[]): NamedAtsBoard[] {
  const boards = new Map<string, NamedAtsBoard>();
  for (const job of jobs) {
    const company = typeof job.companyName === "string" ? job.companyName.trim() : "";
    const url = typeof job.applyUrl === "string"
      ? job.applyUrl
      : typeof job.url === "string"
        ? job.url
        : "";
    if (!company || !url) continue;
    const board = detectAtsBoardFromUrl(url);
    if (!board) continue;
    boards.set(`${board.sourceType}:${board.identifier.toLowerCase()}`, { company, board });
  }
  return [...boards.values()];
}

function cleanAnchorText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

const excludedCompanyHosts = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "crunchbase.com",
  "google.com",
];

export function extractCompanyLinks(html: string, pageUrl: string): CompanyLink[] {
  const page = new URL(pageUrl);
  const companies = new Map<string, CompanyLink>();
  const anchorPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    let url: URL;
    try {
      url = new URL(decodeHtmlUrl(match[1]), pageUrl);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol)) continue;
    if (url.hostname === page.hostname) continue;
    if (excludedCompanyHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) continue;

    const detected = detectAtsBoardFromUrl(url.toString());
    const name = cleanAnchorText(match[2])
      || (detected ? detected.identifier : url.hostname.replace(/^www\./, "").split(".")[0]);
    if (name.length < 2 || name.length > 100) continue;
    const key = detected
      ? `${detected.sourceType}:${detected.identifier.toLowerCase()}`
      : url.hostname.replace(/^www\./, "").toLowerCase();
    companies.set(key, { name, url: url.toString() });
  }

  return [...companies.values()];
}

export function extractCareerPageLinks(html: string, pageUrl: string): string[] {
  const links = new Set<string>();
  const anchorPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const label = cleanAnchorText(match[2]).toLowerCase();
    const href = decodeHtmlUrl(match[1]);
    if (!/(career|careers|jobs|join us|work with us|open roles)/i.test(`${label} ${href}`)) continue;
    try {
      const url = new URL(href, pageUrl);
      if (["http:", "https:"].includes(url.protocol)) links.add(url.toString());
    } catch {
      continue;
    }
  }
  return [...links];
}
