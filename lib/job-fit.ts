import type { CandidateProfile, EligibilityStatus } from "@/lib/types";
import { normalizeText, parseList } from "@/lib/utils";

export interface JobFitPreferences {
  usaOnly: boolean;
  minimumExperience: number;
  maximumExperience: number;
  maximumAgeDays: number;
}

export interface JobEligibilityInput {
  title: string;
  location: string;
  description: string;
  workplaceType: string;
  postedAt?: string | null;
  firstSeenAt?: string | null;
}

export interface JobEligibilityAssessment {
  status: EligibilityStatus;
  filterReasons: string[];
  verificationReasons: string[];
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
  "argentina", "australia", "austria", "belgium", "brazil", "bulgaria", "canada",
  "chile", "china", "colombia", "croatia", "cyprus", "czech republic", "denmark",
  "egypt", "estonia", "europe", "finland", "france", "germany", "greece", "hong kong",
  "hungary", "india", "indonesia", "ireland", "israel", "italy", "japan", "kenya",
  "latam", "latin america", "lithuania", "luxembourg", "malaysia", "mexico",
  "netherlands", "new zealand", "nigeria", "norway", "pakistan", "peru", "philippines",
  "poland", "portugal", "romania", "russia", "saudi arabia", "serbia", "singapore",
  "slovakia", "slovenia", "south africa", "south korea", "korea", "spain", "sweden",
  "switzerland", "taiwan", "thailand", "turkey", "ukraine", "united arab emirates",
  "united kingdom", "uk", "vietnam",
];

const productDesignerPattern = /\bproduct designer\b/i;
const uiUxDesignerPattern = /\b(?:ui\s*\/?\s*ux|ux\s*\/?\s*ui) designer\b/i;
const designEngineerPattern = /\bdesign engineer\b/i;
const hardwareDesignTitlePattern = /\b(?:mechanical|electrical|electronics|hardware|civil|structural|manufacturing|aerospace|automotive|semiconductor|silicon|pcb|hvac)\b/i;
const hardwareDesignDescriptionPattern = /\b(?:mechanical (?:architecture|design|engineering)|electrical engineering|circuit design|printed circuit|pcb|solidworks|autocad|catia|creo|pro\/?e|siemens nx|3d cad|cad drawings?|gd&t|geometric dimensioning|finite element|fea|manufacturing process|design for manufacturability|dfm|design for assembly|dfa|injection mold(?:ing)?|cnc|tooling|tolerance analysis|thermodynamics|mechanisms?|enclosure design|industrial design|consumer electronics|mass production|semiconductor|silicon validation|hvac)\b/i;
const digitalDesignDescriptionPattern = /\b(?:user experience|user interface|ux|ui|figma|frontend|front-end|react|typescript|javascript|design systems?|web applications?|mobile applications?|interaction design|accessible interfaces?)\b/i;

export const adjacentJobTitles = [
  "Product Designer",
  "UI/UX Designer",
  "Design Engineer",
];

export function jobSearchTitles(profile: CandidateProfile): string[] {
  void profile;
  return adjacentJobTitles;
}

export function broadDiscoverySearchTitles(profile: CandidateProfile): string[] {
  const ambiguousEngineeringTitles = new Set(["design engineer", "product design engineer"]);
  return jobSearchTitles(profile).filter((title) => !ambiguousEngineeringTitles.has(normalizeText(title)));
}

export function isProductDesignRoleFamily(title: string, description = ""): boolean {
  if (productDesignerPattern.test(title) || uiUxDesignerPattern.test(title)) return true;
  if (!designEngineerPattern.test(title) || hardwareDesignTitlePattern.test(title)) return false;
  if (!description.trim()) return false;
  return digitalDesignDescriptionPattern.test(description) && !hardwareDesignDescriptionPattern.test(description);
}

const excludedLeadershipPattern = /\b(?:staff|principal|lead|manager|director|head|vice president|vp)\b/i;
const seniorPattern = /\b(?:senior|sr\.?)\b/i;

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

function isExplicitlyForeign(job: JobEligibilityInput): boolean {
  const location = normalizeText(job.location);
  const description = normalizeText(job.description.slice(0, 2_000));
  const explicitDescriptionLocation = description.match(
    /\b(?:based in|located in|remote from|candidates in|applicants in)\s+([a-z ]{2,40})/,
  )?.[1] || "";
  const locationEvidence = `${location} ${explicitDescriptionLocation}`;
  const hasForeignTerm = foreignLocationTerms.some((term) => (
    new RegExp(`(?:^|\\s|,)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s|,)`, "i").test(locationEvidence)
  ));
  const hasUsTerm = /\b(?:united states|usa|u s|us based|remote us)\b/i.test(locationEvidence)
    || usStateNames.some((state) => locationEvidence.includes(state));
  return hasForeignTerm && !hasUsTerm;
}

function ageInDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

export function assessJobEligibility(
  job: JobEligibilityInput,
  profile: CandidateProfile,
  preferences: JobFitPreferences,
): JobEligibilityAssessment {
  const filterReasons: string[] = [];
  const verificationReasons: string[] = [];
  const allowedTargetRole = isProductDesignRoleFamily(job.title, job.description);
  if (excludedLeadershipPattern.test(job.title)) {
    filterReasons.push("The title is a Lead, Staff, Principal, Manager, Director, or executive role.");
  } else if (!allowedTargetRole) {
    filterReasons.push("The title is not Product Designer, UI/UX Designer, or a digital Design Engineer role.");
  }

  const earlyCareerTitle = /\b(?:intern|internship|new grad)\b/i.test(job.title);
  if (preferences.minimumExperience >= 2 && earlyCareerTitle) {
    filterReasons.push("The role is an internship or new graduate position.");
  }

  const requiredExperience = inferRequiredExperience(job.description);
  if (requiredExperience.minimum !== null && requiredExperience.minimum > preferences.maximumExperience) {
    filterReasons.push(`The role asks for at least ${requiredExperience.minimum} years of experience.`);
  }
  if (requiredExperience.maximum !== null && requiredExperience.maximum < preferences.minimumExperience) {
    filterReasons.push(`The role targets no more than ${requiredExperience.maximum} years of experience.`);
  }
  if (
    seniorPattern.test(job.title)
    && requiredExperience.minimum === null
    && requiredExperience.maximum === null
    && !excludedLeadershipPattern.test(job.title)
  ) {
    verificationReasons.push("Senior title needs an experience check because the posting does not state a clear years requirement.");
  }

  if (preferences.usaOnly) {
    if (isExplicitlyForeign(job)) {
      filterReasons.push("The posting explicitly places the role outside the United States.");
    } else if (!isUnitedStatesEligible(job, profile)) {
      verificationReasons.push("The posting does not clearly confirm United States eligibility.");
    }
  }

  const postingAge = ageInDays(job.postedAt || job.firstSeenAt);
  if (postingAge !== null && postingAge > preferences.maximumAgeDays) {
    filterReasons.push(`The posting is ${postingAge} days old, beyond the ${preferences.maximumAgeDays}-day limit.`);
  }

  if (
    profile.sponsorship_required
    && /(no sponsorship|unable to sponsor|cannot sponsor|without sponsorship|not sponsor)/i.test(job.description)
  ) {
    filterReasons.push("The posting says sponsorship is unavailable.");
  }

  return {
    status: filterReasons.length ? "filtered" : verificationReasons.length ? "needs_verification" : "eligible",
    filterReasons,
    verificationReasons,
  };
}

export function jobEligibilityReasons(
  job: JobEligibilityInput,
  profile: CandidateProfile,
  preferences: JobFitPreferences,
): string[] {
  return assessJobEligibility(job, profile, preferences).filterReasons;
}
