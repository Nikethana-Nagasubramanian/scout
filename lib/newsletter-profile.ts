import type { CandidateProfile } from "@/lib/types";
import { parseList } from "@/lib/utils";
import { newsletterProfileSchema, type NewsletterProfile } from "@/lib/newsletter-models";

export function newsletterProfileFromCandidate(
  profile: Pick<CandidateProfile, "target_titles" | "skills" | "professional_summary"> & Partial<Pick<CandidateProfile, "work_authorization" | "sponsorship_required">>,
): NewsletterProfile {
  return newsletterProfileSchema.parse({
    targetRoles: parseList(profile.target_titles),
    strengths: parseList(profile.skills),
    summary: profile.professional_summary,
    workAuthorization: profile.work_authorization || "",
    sponsorshipRequired: profile.sponsorship_required === undefined ? null : Boolean(profile.sponsorship_required),
  });
}

export async function savedNewsletterProfile(): Promise<NewsletterProfile> {
  const { db } = await import("@/lib/database");
  const candidate = db.prepare(
    "SELECT target_titles, skills, professional_summary, work_authorization, sponsorship_required FROM candidate_profile WHERE id = 1",
  ).get() as CandidateProfile;
  const profile = newsletterProfileFromCandidate(candidate);
  if (!profile.strengths.length && !profile.summary) {
    throw new Error("Save your Scout search profile or supply --profile examples/newsletter/profile.json.");
  }
  return profile;
}
