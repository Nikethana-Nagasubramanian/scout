export type SourceType = "greenhouse" | "lever";
export type CollectionMode = "manual" | "automatic";
export type JobStatus = "discovered" | "reviewing" | "shortlisted" | "irrelevant" | "dismissed" | "archived";
export type ResumeStatus = "draft" | "approved" | "rejected";
export type ApplicationStatus =
  | "ready_to_apply"
  | "applied"
  | "follow_up_due"
  | "recruiter_screen"
  | "interview"
  | "rejected"
  | "withdrawn"
  | "offer"
  | "archived";

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
  created_at: string;
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
  score_breakdown: string | null;
  match_summary: string | null;
  seen_count: number;
  confidence_score: number | null;
  confidence_breakdown: string | null;
  confidence_summary: string | null;
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
  hardFilterPass: boolean;
  hardFilterReasons: string[];
  matchingSkills: string[];
  missingSkills: string[];
}

export interface ResumeContent {
  candidateName: string;
  contactLine: string;
  targetTitle: string;
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
    title: string;
    lines: Array<{
      text: string;
      kind: "entry" | "bullet" | "text" | "divider";
    }>;
  }>;
  audit: {
    selectedFactIds: number[];
    includedKeywords: string[];
    unsupportedKeywords: string[];
  };
}
