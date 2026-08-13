import type { CandidateProfile, ConfidenceBreakdown, Job, ScoreBreakdown } from "@/lib/types";
import { assessJobEligibility, isUnitedStatesEligible, titleMatchRatio, type JobFitPreferences } from "@/lib/job-fit";
import { normalizeText, parseList } from "@/lib/utils";

const seniorityTerms = ["intern", "junior", "associate", "mid", "senior", "staff", "principal", "lead", "manager", "director"];

const requirementCatalog: Array<{ label: string; aliases: string[] }> = [
  { label: "Figma", aliases: ["figma"] },
  { label: "Prototyping", aliases: ["prototyping", "prototype", "prototypes", "protopie", "framer"] },
  { label: "User research", aliases: ["user research", "ux research", "customer research", "qualitative research"] },
  { label: "Usability testing", aliases: ["usability testing", "usability tests", "user testing"] },
  { label: "Design systems", aliases: ["design system", "design systems", "component library", "component libraries"] },
  { label: "Interaction design", aliases: ["interaction design", "interaction designer"] },
  { label: "Visual design", aliases: ["visual design", "visual designer", "visual craft"] },
  { label: "Product design", aliases: ["product design", "product designer"] },
  { label: "UI/UX design", aliases: ["ui ux", "ui/ux", "user interface design", "user experience design"] },
  { label: "Accessibility", aliases: ["accessibility", "accessible design", "wcag"] },
  { label: "Information architecture", aliases: ["information architecture"] },
  { label: "Product strategy", aliases: ["product strategy", "design strategy", "strategic design"] },
  { label: "Cross-functional collaboration", aliases: ["cross functional", "cross-functional", "collaboration", "collaborate"] },
  { label: "Stakeholder management", aliases: ["stakeholder management", "stakeholder communication", "stakeholders"] },
  { label: "Leadership", aliases: ["leadership", "led", "leading", "mentor", "mentoring"] },
  { label: "Data and analytics", aliases: ["data analysis", "analytics", "data informed", "data driven", "metrics"] },
  { label: "B2B", aliases: ["b2b", "b2b2c", "business to business"] },
  { label: "B2C", aliases: ["b2c", "b2b2c", "consumer product", "consumer products"] },
  { label: "Enterprise", aliases: ["enterprise", "enterprise software", "enterprise product"] },
  { label: "SaaS", aliases: ["saas", "software as a service"] },
  { label: "AI/ML", aliases: ["artificial intelligence", "machine learning", "ai product", "ai powered", "generative ai"] },
  { label: "React", aliases: ["react", "reactjs", "react.js"] },
  { label: "TypeScript", aliases: ["typescript"] },
  { label: "JavaScript", aliases: ["javascript"] },
  { label: "HTML/CSS", aliases: ["html css", "html/css", "html", "css"] },
  { label: "Frontend development", aliases: ["frontend", "front end", "front-end"] },
  { label: "Mobile design", aliases: ["mobile design", "mobile product", "ios", "android"] },
  { label: "Facilitation", aliases: ["facilitation", "facilitate", "workshop", "workshops"] },
  { label: "Agile", aliases: ["agile", "scrum"] },
];

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(" ").filter((token) => token.length > 1));
}

function overlapScore(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let matches = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) matches += 1;
  return matches / Math.max(1, leftTokens.size);
}

function containsPhrase(text: string, phrase: string): boolean {
  return normalizeText(text).includes(normalizeText(phrase));
}

function containsWholePhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  return Boolean(normalizedPhrase) && ` ${normalizeText(text)} `.includes(` ${normalizedPhrase} `);
}

function requirementCoverage(job: Job, profile: CandidateProfile, profileSkills: string[]): {
  score: number;
  matched: string[];
  missing: string[];
} {
  const jobText = job.description;
  const candidateEvidence = [profile.professional_summary, profile.base_resume_text, ...profileSkills].join(" ");
  const requirements = requirementCatalog.filter((requirement) => (
    requirement.aliases.some((alias) => containsWholePhrase(jobText, alias))
  ));
  const catalogLabels = new Set(requirements.map((requirement) => normalizeText(requirement.label)));

  for (const skill of profileSkills) {
    if (!containsWholePhrase(jobText, skill) || catalogLabels.has(normalizeText(skill))) continue;
    requirements.push({ label: skill, aliases: [skill] });
    catalogLabels.add(normalizeText(skill));
  }

  if (!requirements.length) return { score: 18, matched: [], missing: [] };

  const matched = requirements
    .filter((requirement) => requirement.aliases.some((alias) => containsWholePhrase(candidateEvidence, alias)))
    .map((requirement) => requirement.label);
  const matchedKeys = new Set(matched.map(normalizeText));
  const missing = requirements
    .map((requirement) => requirement.label)
    .filter((requirement) => !matchedKeys.has(normalizeText(requirement)));

  return {
    score: Math.round((matched.length / requirements.length) * 35),
    matched,
    missing,
  };
}

export function scoreJob(job: Job, profile: CandidateProfile, fitPreferences?: JobFitPreferences): ScoreBreakdown {
  const titles = parseList(profile.target_titles);
  const skills = parseList(profile.skills);
  const locations = parseList(profile.preferred_locations);
  const workplaces = parseList(profile.workplace_preferences);
  const hardFilterReasons: string[] = [];
  const preferences = fitPreferences || {
    usaOnly: false,
    minimumExperience: 0,
    maximumExperience: 50,
    maximumAgeDays: 60,
  };
  const eligibility = assessJobEligibility({
    title: job.title,
    location: job.location,
    description: job.description,
    workplaceType: job.workplace_type,
    postedAt: job.posted_at,
    firstSeenAt: job.first_seen_at,
  }, profile, preferences);
  hardFilterReasons.push(...eligibility.filterReasons);

  const preferredRemote = workplaces.some((item) => item.toLowerCase() === "remote");
  const nationwidePreference = locations.some((location) => ["united states", "usa", "us"].includes(normalizeText(location)));
  const nationwideLocationMatch = nationwidePreference && isUnitedStatesEligible({
    title: job.title,
    location: job.location,
    description: job.description,
    workplaceType: job.workplace_type,
  }, profile);
  const locationMatches = nationwideLocationMatch || locations.some((location) => containsPhrase(job.location, location));
  const jobIsRemote = containsPhrase(`${job.location} ${job.workplace_type}`, "remote");
  const titleSimilarity = titles.length
    ? Math.max(...titles.map((title) => Math.max(overlapScore(title, job.title), titleMatchRatio(job.title, title))))
    : 0;
  const title = Math.round(titleSimilarity * 25);

  const requirements = requirementCoverage(job, profile, skills);
  const matchingSkills = requirements.matched;
  const missingSkills = requirements.missing;
  const skillsScore = requirements.score;

  const experienceSeniority = profile.years_experience === null
    ? ""
    : profile.years_experience <= 2
      ? "junior"
      : profile.years_experience <= 5
        ? "mid"
        : profile.years_experience <= 9
          ? "senior"
          : "lead";
  const requestedSeniority = normalizeText(profile.target_seniority || experienceSeniority);
  const jobSeniority = seniorityTerms.find((term) => containsPhrase(`${job.title} ${job.description.slice(0, 300)}`, term)) || "";
  const seniority = !requestedSeniority || !jobSeniority
    ? 8
    : requestedSeniority.includes(jobSeniority) || jobSeniority.includes(requestedSeniority)
      ? 15
      : 4;

  const location = !locations.length
    ? 10
    : locationMatches || (preferredRemote && jobIsRemote)
      ? 10
      : 0;

  const postingDate = job.posted_at || job.first_seen_at;
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(postingDate).getTime()) / 86_400_000));
  const recency = ageDays <= 2 ? 10 : ageDays <= 7 ? 7 : ageDays <= 14 ? 4 : 1;

  const compensation = !profile.minimum_salary || !job.salary_max
    ? 3
    : job.salary_max >= profile.minimum_salary
      ? 5
      : 0;

  const rawTotal = title + skillsScore + seniority + location + recency + compensation;
  const total = Math.max(0, Math.min(100, rawTotal));

  return {
    title,
    skills: skillsScore,
    seniority,
    location,
    recency,
    compensation,
    total,
    eligibilityStatus: eligibility.status,
    hardFilterPass: hardFilterReasons.length === 0,
    hardFilterReasons,
    verificationReasons: eligibility.verificationReasons,
    matchingSkills,
    missingSkills,
  };
}

export function buildMatchSummary(score: ScoreBreakdown): string {
  if (!score.hardFilterPass) return score.hardFilterReasons.join(" ");
  if (score.eligibilityStatus === "needs_verification") {
    return `Needs verification. ${score.verificationReasons.join(" ")}`;
  }
  if (!score.matchingSkills.length && !score.missingSkills.length) {
    return "The posting has too little specific requirement data for a strong coverage assessment.";
  }
  if (score.total >= 80) return `Strong profile match with evidence for ${score.matchingSkills.length} detected job requirements.`;
  if (score.total >= 65) return `Promising profile match. Review ${score.missingSkills.length} detected requirements without clear resume evidence.`;
  return "Possible profile match, but title or requirement coverage is limited.";
}

function ageInDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

export function scorePostingConfidence(job: Job, recentCompanyJobCount: number, similarRoleCount = 1): ConfidenceBreakdown {
  const positiveSignals: string[] = [];
  const cautionSignals: string[] = [];
  const officialSource = job.source_type === "greenhouse" || job.source_type === "lever" || job.source_type === "ashby";
  const discoveryFeed = job.source_type === "remotive"
    || job.source_type === "jobicy"
    || job.source_type === "himalayas"
    || job.source_type === "hiring_cafe";
  const sourceIntegrity = officialSource ? 15 : discoveryFeed ? 11 : 7;
  if (officialSource) positiveSignals.push("Collected from the company's public ATS feed.");
  else if (discoveryFeed) positiveSignals.push("Collected from a public job discovery feed with a direct application link.");
  else cautionSignals.push("This job was imported manually and source health cannot be checked automatically.");

  const postedAge = ageInDays(job.posted_at);
  const observedAge = ageInDays(job.first_seen_at) ?? 0;
  const effectiveAge = postedAge ?? observedAge;
  const freshness = effectiveAge <= 3 ? 25 : effectiveAge <= 14 ? 20 : effectiveAge <= 30 ? 12 : effectiveAge <= 60 ? 5 : 0;
  if (effectiveAge <= 14) positiveSignals.push("The posting is recent.");
  if (postedAge === null) cautionSignals.push("The source does not provide a reliable original posting date.");
  if (effectiveAge > 45) cautionSignals.push("The posting has been open or observed for more than 45 days.");

  let completeness = 0;
  if (job.location) completeness += 4;
  if (job.employment_type) completeness += 4;
  if (job.workplace_type && job.workplace_type !== "unspecified") completeness += 3;
  if (job.description.length >= 700) completeness += 5;
  if (job.apply_url) completeness += 4;
  if (completeness >= 15) positiveSignals.push("The posting includes useful role and application details.");
  if (completeness < 9) cautionSignals.push("The posting is missing several basic job details.");

  const description = normalizeText(job.description);
  const wordCount = description.split(" ").filter(Boolean).length;
  let specificity = 0;
  if (wordCount >= 250) specificity += 5;
  if (/(responsibilities|what you will do|in this role|your impact)/i.test(job.description)) specificity += 3;
  if (/(requirements|qualifications|what you bring|you have)/i.test(job.description)) specificity += 3;
  if (/(team|manager|report to|department)/i.test(job.description)) specificity += 2;
  if (job.salary_min || job.salary_max) specificity += 2;
  if (specificity >= 10) positiveSignals.push("The description has concrete responsibilities and qualifications.");
  if (wordCount < 100) cautionSignals.push("The job description is unusually brief.");

  const seenCount = job.seen_count || 1;
  const repeatedSightings = seenCount >= 3 ? 10 : seenCount === 2 ? 7 : 3;
  if (seenCount >= 2) positiveSignals.push(`The job remained active across ${seenCount} collection runs.`);
  else cautionSignals.push("The job has only one local observation so far.");

  const companyActivity = recentCompanyJobCount >= 2 && recentCompanyJobCount <= 30
    ? 15
    : recentCompanyJobCount > 30
      ? 10
      : 6;
  if (recentCompanyJobCount >= 2) positiveSignals.push(`The company has ${recentCompanyJobCount} recently observed postings.`);
  else cautionSignals.push("There is not enough local company hiring history yet.");

  let riskAdjustment = 0;
  if (effectiveAge > 90) riskAdjustment -= 20;
  else if (effectiveAge > 60) riskAdjustment -= 12;
  else if (effectiveAge > 45) riskAdjustment -= 6;
  if (wordCount < 100) riskAdjustment -= 7;
  if (!job.apply_url) riskAdjustment -= 8;
  if (similarRoleCount >= 3) {
    riskAdjustment -= 5;
    cautionSignals.push("The same company and title appears in several local records, which may indicate reposting or location variants.");
  }

  const total = Math.max(0, Math.min(100, sourceIntegrity + freshness + completeness + specificity + repeatedSightings + companyActivity + riskAdjustment));
  const evidencePoints = [officialSource || discoveryFeed, postedAge !== null, seenCount >= 2, recentCompanyJobCount >= 2, completeness >= 15].filter(Boolean).length;
  const dataSufficiency = evidencePoints >= 4 ? "high" : evidencePoints >= 2 ? "medium" : "low";

  return {
    sourceIntegrity,
    freshness,
    completeness,
    specificity,
    repeatedSightings,
    companyActivity,
    riskAdjustment,
    total,
    dataSufficiency,
    positiveSignals,
    cautionSignals,
  };
}

export function buildConfidenceSummary(confidence: ConfidenceBreakdown): string {
  const label = confidence.total >= 75 ? "Higher posting signal" : confidence.total >= 55 ? "Mixed posting signal" : "Lower posting signal";
  return `${label} based on ${confidence.dataSufficiency} local data sufficiency. This is a supporting signal, not proof that a role is active.`;
}
