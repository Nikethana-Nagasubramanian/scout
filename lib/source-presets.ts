export const focusedHiringCafeUrl = "https://hiringcafe.com/?searchState=%7B%22dateFetchedPastNDays%22%3A4%2C%22departments%22%3A%5B%22Engineering%22%2C%22Design%22%2C%22Software+Development%22%2C%22Information+Technology%22%2C%22Product+Management%22%5D%2C%22roleYoeRange%22%3A%5B2%2C5%5D%2C%22roleTypes%22%3A%5B%22Individual+Contributor%22%5D%2C%22seniorityLevel%22%3A%5B%22Mid+Level%22%2C%22Entry+Level%22%5D%2C%22jobTitleQuery%22%3A%22Product+Designer%22%7D";

export const vcDiscoverySources = [
  {
    name: "Greylock UX Designer jobs",
    url: "https://jobs.greylock.com/jobs?jobTypes=UX+Designer",
    includeCompanies: "",
    excludeCompanies: "",
  },
  {
    name: "Designer Fund filtered design jobs",
    url: "https://jobs.designerfund.com/jobs?filter=eyJzZW5pb3JpdHkiOlsiYXNzb2NpYXRlIiwibWlkX3NlbmlvciJdLCJzZWFyY2hhYmxlX2xvY2F0aW9ucyI6WyJVbml0ZWQgU3RhdGVzIl0sImpvYl9mdW5jdGlvbnMiOlsiRGVzaWduIl19&q=Designer",
    includeCompanies: "",
    excludeCompanies: "",
  },
  {
    name: "645 Ventures selected design companies",
    url: "https://jobs.645ventures.com/jobs?filter=eyJqb2JfZnVuY3Rpb25zIjpbIkRlc2lnbiJdLCJzZW5pb3JpdHkiOlsibWlkX3NlbmlvciIsImFzc29jaWF0ZSJdLCJzZWFyY2hhYmxlX2xvY2F0aW9ucyI6WyJVbml0ZWQgU3RhdGVzIl19",
    includeCompanies: "Hanover, Variance",
    excludeCompanies: "Arbor",
  },
  {
    name: "a16z Build open roles newsletter",
    url: "https://a16zbuild.substack.com/p/open-roles-with-founders-hailing-de7",
    includeCompanies: "",
    excludeCompanies: "",
  },
] as const;

// Exa discovery runs a small fixed set of natural-language queries. Exa is a semantic search
// engine, so these are written as plain descriptions of the wanted role rather than with
// keyword operators. Domain filtering is a separate request parameter, not query syntax.
export const exaQueryPresets = [
  {
    query: "Currently open US Product Designer or Design Engineer roles at startups where designers build working prototypes using React, TypeScript, Claude Code, Cursor, or other AI coding tools.",
    kind: "ats_daily",
    minimumIntervalMinutes: 1_440,
  },
  {
    query: "Currently open US Product Designer roles involving complex B2B workflows, data visualization, decision-support products, maps, geospatial interfaces, or location intelligence.",
    kind: "ats_daily",
    minimumIntervalMinutes: 1_440,
  },
  {
    query: "Currently open US Product Designer or Product Engineer roles with 0-to-1 ownership and close collaboration with founders and engineers.",
    kind: "ats_daily",
    minimumIntervalMinutes: 1_440,
  },
  {
    query: "Currently open US Product Designer roles for AI products involving user research, rapid experimentation, functional prototypes, design systems, and production implementation.",
    kind: "ats_daily",
    minimumIntervalMinutes: 1_440,
  },
  {
    query: "Product Designer, Design Engineer, or Product Engineer openings at fast-growing US startups for someone experienced in data-heavy products, AI-assisted coded prototypes, design systems, and ambiguous 0-to-1 work. Return direct company career or application pages.",
    kind: "open_weekly",
    minimumIntervalMinutes: 10_080,
  },
] as const;
