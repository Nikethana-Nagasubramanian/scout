export type SourceType = "greenhouse" | "lever" | "ashby";
export type CollectionMode = "manual" | "automatic";
export type JobStatus = "discovered" | "reviewing" | "shortlisted" | "irrelevant" | "dismissed" | "archived";
export type ResumeStatus = "draft" | "approved" | "rejected";
export type ApplicationStatus =
  | "preparing"
  | "ready_to_apply"
  | "applied"
  | "follow_up_due"
  | "recruiter_screen"
  | "interview"
  | "rejected"
  | "withdrawn"
  | "offer"
  | "archived";
export type EligibilityStatus = "eligible" | "needs_verification" | "filtered";

export interface CandidateProfile {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  home_location: string;
  professional_summary: string;
  base_resume_text: string;
  target_titles: string;
  target_seniority: string;
  skills: string;
  preferred_locations: string;
  workplace_preferences: string;
  minimum_salary: number | null;
  work_authorization: string;
  sponsorship_required: number;
  years_experience: number | null;
  portfolio_url: string;
  linkedin_url: string;
  github_url: string;
  onboarding_complete: number;
  updated_at: string;
}

export interface CandidateFact {
  id: number;
  category: string;
  context: string;
  claim: string;
  skills: string;
  verified: number;
  scope_type?: "career" | "employer";
  scope_key?: string;
  created_at: string;
}

export interface ResumeChange {
  id: string;
  blockId: string;
  keyword: string;
  originalText: string;
  acceptedText: string;
  createdAt: string;
  source: "guided" | "manual";
}

export interface JobSource {
  id: number;
  name: string;
  source_type: SourceType;
  identifier: string;
  enabled: number;
  cooldown_until: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string;
  consecutive_failures: number;
  auto_discovered: number;
  discovered_from_url: string;
  discovered_via_name: string;
  discovered_via_url: string;
  tier: string;
  consecutive_zero_runs: number;
  last_relevant_job_at: string | null;
  tier_changed_at: string | null;
  created_at: string;
}

export interface CompanyDiscoverySource {
  id: number;
  name: string;
  url: string;
  include_companies: string;
  exclude_companies: string;
  enabled: number;
  cooldown_until: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string;
  consecutive_failures: number;
  query_cursor: number;
  created_at: string;
}

export interface DiscoverySource {
  key: "remotive" | "jobicy" | "himalayas";
  name: string;
  enabled: number;
  minimum_interval_minutes: number;
  cooldown_until: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string;
  consecutive_failures: number;
  query_cursor: number;
}

export type WorkflowLogLevel = "info" | "warning" | "error" | "success";

export interface WorkflowLog {
  id: number;
  run_id: number | null;
  source_id: number | null;
  step: string;
  level: WorkflowLogLevel;
  message: string;
  details_json: string;
  duration_ms: number | null;
  created_at: string;
  source_name?: string | null;
}

export interface Job {
  id: number;
  source_id: number | null;
  source_name: string;
  source_type: string;
  external_id: string;
  company: string;
  title: string;
  location: string;
  workplace_type: string;
  employment_type: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  description: string;
  canonical_url: string;
  apply_url: string;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  status: JobStatus;
  score: number | null;
  hard_filter_pass: number | null;
  eligibility_status: EligibilityStatus;
  score_breakdown: string | null;
  match_summary: string | null;
  seen_count: number;
  confidence_score: number | null;
  confidence_breakdown: string | null;
  confidence_summary: string | null;
  duplicate_of_job_id: number | null;
  duplicate_reason: string;
}

export interface ContactResearch {
  id: number;
  job_id: number;
  status: string;
  company_domain: string;
  company_size: number | null;
  company_size_label: string;
  person_name: string;
  person_title: string;
  email: string;
  email_confidence: number | null;
  evidence_url: string;
  evidence_summary: string;
  candidates_json: string;
  provider: string;
  credits_used: number;
  last_error: string;
  searched_at: string | null;
  updated_at: string;
}

export interface CoverLetter {
  id: number;
  application_id: number;
  content: string;
  generation_method: string;
  evidence_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ConfidenceBreakdown {
  sourceIntegrity: number;
  freshness: number;
  completeness: number;
  specificity: number;
  repeatedSightings: number;
  companyActivity: number;
  riskAdjustment: number;
  total: number;
  dataSufficiency: "low" | "medium" | "high";
  positiveSignals: string[];
  cautionSignals: string[];
}

export interface ScoreBreakdown {
  title: number;
  skills: number;
  seniority: number;
  location: number;
  recency: number;
  compensation: number;
  total: number;
  eligibilityStatus: EligibilityStatus;
  hardFilterPass: boolean;
  hardFilterReasons: string[];
  verificationReasons: string[];
  matchingSkills: string[];
  missingSkills: string[];
}

export interface ResumeContent {
  candidateName: string;
  contactLine: string;
  targetTitle: string;
  summaryBlockId?: string;
  summary: string;
  skills: string[];
  skillCategories?: Array<{
    name: string;
    skills: string[];
  }>;
  highlightedKeywords?: string[];
  facts: Array<{
    category: string;
    context: string;
    claim: string;
  }>;
  sections?: Array<{
    id?: string;
    title: string;
    lines: Array<{
      id?: string;
      text: string;
      kind: "entry" | "bullet" | "text" | "divider";
    }>;
  }>;
  changeHistory?: ResumeChange[];
  audit: {
    selectedFactIds: number[];
    includedKeywords: string[];
    unsupportedKeywords: string[];
  };
}
