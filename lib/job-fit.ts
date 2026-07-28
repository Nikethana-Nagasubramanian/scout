import type { CandidateProfile } from "@/lib/types";
import { normalizeText, parseList } from "@/lib/utils";

export interface JobFitPreferences {
  usaOnly: boolean;
  minimumExperience: number;
  maximumExperience: number;
}

export interface JobEligibilityInput {
  title: string;
  location: string;
  description: string;
  workplaceType: string;
}

const usStateNames = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
  "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
  "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
  "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire",
  "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
  "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota",
  "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia",
  "wisconsin", "wyoming", "district of columbia",
];

const foreignLocationTerms = [
  "argentina", "australia", "brazil", "canada", "chile", "colombia", "europe", "germany",
  "india", "ireland", "latam", "latin america", "mexico", "philippines", "portugal",
  "spain", "united kingdom", "uk", "worldwide",
];

function titleTokens(value: string): Set<string> {
  return new Set(normalizeText(value)
    .split(" ")
    .map((token) => token === "designer" || token === "designing" ? "design" : token)
    .map((token) => token === "engineering" ? "engineer" : token)
    .filter((token) => token.length > 1 && !["and", "the"].includes(token)));
}

export function titleMatchRatio(jobTitle: string, targetTitle: string): number {
  const jobTokens = titleTokens(jobTitle);
  const targetTokens = titleTokens(targetTitle);
  if (!targetTokens.size) return 0;
  let matches = 0;
  for (const token of targetTokens) if (jobTokens.has(token)) matches += 1;
  return matches / targetTokens.size;
}

export function inferRequiredExperience(description: string): { minimum: number | null; maximum: number | null } {
  const relevantText = description
    .split(/[\n.!?]+/)
    .filter((line) => /years?/i.test(line) && /(experience|required|qualification|background)/i.test(line))
    .join(" ");
  const minimums: number[] = [];
  const maximums: number[] = [];
  const rangePattern = /\b(\d{1,2})\s*(?:-|to|\u2013|\u2014)\s*(\d{1,2})\s+years?\b/gi;
  const minimumPattern = /\b(?:at least|min(?:imum)?(?: of)?|requires?)?\s*(\d{1,2})\s*\+?\s+years?(?:\s+of)?\s+(?:relevant\s+)?experience\b/gi;

  for (const match of relevantText.matchAll(rangePattern)) {
    minimums.push(Number(match[1]));
    maximums.push(Number(match[2]));
  }
  for (const match of relevantText.matchAll(minimumPattern)) {
    minimums.push(Number(match[1]));
  }

  return {
    minimum: minimums.length ? Math.max(...minimums) : null,
    maximum: maximums.length ? Math.max(...maximums) : null,
  };
}

export function isUnitedStatesEligible(job: JobEligibilityInput, profile: CandidateProfile): boolean {
  const location = job.location.trim();
  const normalizedLocation = normalizeText(location);
  const explicitlyForeign = foreignLocationTerms.some((term) => normalizedLocation.includes(term));
  const explicitUsLocation = /\b(?:united states|usa)\b/i.test(location)
    || /\bU\.?S\.?\b/.test(location)
    || /(?:,|\s)\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/.test(location)
    || usStateNames.some((state) => normalizedLocation.includes(state));
  if (explicitlyForeign && !explicitUsLocation) return false;
  if (explicitUsLocation) return true;

  const preferredUsLocations = [...parseList(profile.preferred_locations), profile.home_location]
    .map(normalizeText)
    .filter((value) => value && !["remote", "united states", "usa"].includes(value));
  if (preferredUsLocations.some((value) => normalizedLocation.includes(value))) return true;

  const descriptionLocation = job.description;
  return /\b(?:remote within (?:the )?united states|united states only|us-based|u\.s\.-based|based in (?:the )?u\.s\.|remote us|remote u\.s\.)\b/i.test(descriptionLocation);
}

export function jobEligibilityReasons(
  job: JobEligibilityInput,
  profile: CandidateProfile,
  preferences: JobFitPreferences,
): string[] {
  const reasons: string[] = [];
  const targetTitles = parseList(profile.target_titles);
  const bestTitleMatch = targetTitles.length
    ? Math.max(...targetTitles.map((title) => titleMatchRatio(job.title, title)))
    : 1;
  if (bestTitleMatch < 0.75) {
    reasons.push("The role title does not match the target role family.");
  }

  const requestedSeniority = normalizeText(profile.target_seniority);
  const rejectsSeniorRoles = !requestedSeniority || /\b(?:intern|junior|entry|associate|mid)\b/.test(requestedSeniority);
  const seniorTitle = /\b(?:senior|sr\.?|staff|principal|lead|manager|director|head|vice president|vp)\b/i.test(job.title);
  const earlyCareerTitle = /\b(?:intern|internship|new grad)\b/i.test(job.title);
  if ((rejectsSeniorRoles && seniorTitle) || (preferences.minimumExperience >= 2 && earlyCareerTitle)) {
    reasons.push("The role seniority is outside the selected individual-contributor range.");
  }

  const requiredExperience = inferRequiredExperience(job.description);
  if (requiredExperience.minimum !== null && requiredExperience.minimum > preferences.maximumExperience) {
    reasons.push(`The role asks for at least ${requiredExperience.minimum} years of experience.`);
  }
  if (requiredExperience.maximum !== null && requiredExperience.maximum < preferences.minimumExperience) {
    reasons.push(`The role targets no more than ${requiredExperience.maximum} years of experience.`);
  }

  if (preferences.usaOnly && !isUnitedStatesEligible(job, profile)) {
    reasons.push("The role is not explicitly located in or restricted to the United States.");
  }
  return reasons;
}
