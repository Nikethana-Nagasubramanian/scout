import type { CandidateProfile, ConfidenceBreakdown, Job, ScoreBreakdown } from "@/lib/types";
import { isUnitedStatesEligible, jobEligibilityReasons, titleMatchRatio, type JobFitPreferences } from "@/lib/job-fit";
import { normalizeText, parseList } from "@/lib/utils";

const seniorityTerms = ["intern", "junior", "associate", "mid", "senior", "staff", "principal", "lead", "manager", "director"];

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

export function scoreJob(job: Job, profile: CandidateProfile, fitPreferences?: JobFitPreferences): ScoreBreakdown {
  const description = normalizeText(`${job.title} ${job.description}`);
  const titles = parseList(profile.target_titles);
  const skills = parseList(profile.skills);
  const locations = parseList(profile.preferred_locations);
  const workplaces = parseList(profile.workplace_preferences);
  const hardFilterReasons: string[] = [];
  const preferences = fitPreferences || {
    usaOnly: false,
    minimumExperience: 0,
    maximumExperience: 50,
  };
  hardFilterReasons.push(...jobEligibilityReasons({
    title: job.title,
    location: job.location,
    description: job.description,
    workplaceType: job.workplace_type,
  }, profile, preferences));

  if (
    profile.sponsorship_required &&
    /(no sponsorship|unable to sponsor|cannot sponsor|without sponsorship|not sponsor)/i.test(job.description)
  ) {
    hardFilterReasons.push("The posting says sponsorship is unavailable.");
  }

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
  if (locations.length && !locationMatches && !(preferredRemote && jobIsRemote)) {
    hardFilterReasons.push("The location does not match the current preferences.");
  }

  const titleSimilarity = titles.length
    ? Math.max(...titles.map((title) => Math.max(overlapScore(title, job.title), titleMatchRatio(job.title, title))))
    : 0;
  const title = Math.round(titleSimilarity * 25);

  const matchingSkills = skills.filter((skill) => containsPhrase(description, skill));
  const missingSkills = skills.filter((skill) => !matchingSkills.includes(skill));
  const skillsScore = skills.length ? Math.round((matchingSkills.length / skills.length) * 35) : 0;

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
    hardFilterPass: hardFilterReasons.length === 0,
    hardFilterReasons,
    matchingSkills,
    missingSkills,
  };
}

export function buildMatchSummary(score: ScoreBreakdown): string {
  if (!score.hardFilterPass) return score.hardFilterReasons.join(" ");
  if (score.total >= 80) return `Strong match with ${score.matchingSkills.length} profile skills found in the posting.`;
  if (score.total >= 65) return `Promising match. Review ${score.missingSkills.length} profile skills that were not found in the posting.`;
  return "Possible match, but title or skill alignment is limited.";
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
  const officialSource = job.source_type === "greenhouse" || job.source_type === "lever";
  const discoveryFeed = job.source_type === "remotive" || job.source_type === "jobicy" || job.source_type === "himalayas";
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
  const label = confidence.total >= 75 ? "Higher confidence" : confidence.total >= 55 ? "Mixed confidence" : "Lower confidence";
  return `${label} based on ${confidence.dataSufficiency} local data sufficiency. This is a supporting signal, not proof that a role is active.`;
}
