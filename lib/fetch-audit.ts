import type { WorkflowLog } from "@/lib/types";
import { safeJson } from "@/lib/utils";

export type FetchResourceKey = "gmail" | "public" | "portfolio" | "hiring_cafe" | "official";
export type FetchResourceStatus = "complete" | "partial" | "cooldown" | "failed" | "not_checked";

export interface FetchResourceEvent {
  label: string;
  level: WorkflowLog["level"];
  message: string;
}

export interface FetchResourceAudit {
  key: FetchResourceKey;
  label: string;
  description: string;
  status: FetchResourceStatus;
  expected: number;
  checked: number;
  skipped: number;
  failed: number;
  inspected: number;
  extracted: number;
  added: number;
  refreshed: number;
  hiringSignals: number;
  boardsAdded: number;
  events: FetchResourceEvent[];
}

interface LogDetails {
  automaticFeeds?: number;
  companyWatchlistSources?: number;
  companyDiscoverySources?: number;
  gmailAlertsConfigured?: boolean;
  source?: string;
  jobsFound?: number;
  roleFamilyJobs?: number;
  relevantJobsFound?: number;
  jobsAdded?: number;
  jobsUpdated?: number;
  hiringSignalsFound?: number;
  boardsAdded?: number;
  directJobsFound?: number;
}

const definitions: Array<Pick<FetchResourceAudit, "key" | "label" | "description">> = [
  { key: "gmail", label: "Gmail job alerts", description: "BuiltIn, Indeed, and direct job-alert messages" },
  { key: "public", label: "Public discovery feeds", description: "Jobicy, Remotive, and Himalayas" },
  { key: "portfolio", label: "VC and curated pages", description: "Portfolio directories and curated company lists" },
  { key: "hiring_cafe", label: "HiringCafe", description: "Focused United States product-design search" },
  { key: "official", label: "Official company boards", description: "Greenhouse, Ashby, and Lever boards" },
];

function resourceKey(log: WorkflowLog): FetchResourceKey | null {
  if (log.step.startsWith("gmail.")) return "gmail";
  if (log.step.startsWith("discovery.")) return "public";
  if (log.step.startsWith("source.")) return "official";
  if (log.step.startsWith("portfolio.")) {
    return /hiringcafe/i.test(log.message) ? "hiring_cafe" : "portfolio";
  }
  return null;
}

function terminalLog(log: WorkflowLog): boolean {
  return /\.(complete|cooldown|failed)$/.test(log.step);
}

function eventLabel(log: WorkflowLog, details: LogDetails): string {
  if (log.source_name) return log.source_name;
  if (details.source) return details.source;
  if (log.step.startsWith("gmail.")) return "Scout Job Alert";
  const cooling = log.message.match(/^(.+?) is cooling down/i)?.[1];
  if (cooling) return cooling;
  const inspecting = log.message.match(/^Inspecting (.+?) for company career boards/i)?.[1];
  if (inspecting) return inspecting;
  const exposed = log.message.match(/^(.+?) exposed /i)?.[1];
  if (exposed) return exposed;
  return "Source check";
}

function expectedCounts(logs: WorkflowLog[]): Record<FetchResourceKey, number> {
  const start = logs.find((log) => log.step === "workflow.start");
  const details = safeJson<LogDetails>(start?.details_json, {});
  const portfolioTerminals = logs.filter((log) => log.step.startsWith("portfolio.") && terminalLog(log));
  const hiringCafeCount = portfolioTerminals.some((log) => /hiringcafe/i.test(log.message)) ? 1 : 0;
  return {
    gmail: details.gmailAlertsConfigured ? 1 : 0,
    public: details.automaticFeeds || 0,
    portfolio: Math.max(0, (details.companyDiscoverySources || portfolioTerminals.length) - hiringCafeCount),
    hiring_cafe: hiringCafeCount,
    official: details.companyWatchlistSources || 0,
  };
}

function auditStatus(events: WorkflowLog[]): FetchResourceStatus {
  if (!events.length) return "not_checked";
  const completed = events.filter((log) => log.step.endsWith(".complete")).length;
  const cooldowns = events.filter((log) => log.step.endsWith(".cooldown")).length;
  const failures = events.filter((log) => log.step.endsWith(".failed") || log.level === "error").length;
  if (completed && (cooldowns || failures)) return "partial";
  if (failures) return "failed";
  if (cooldowns && !completed) return "cooldown";
  return completed ? "complete" : "not_checked";
}

export function buildFetchResourceAudit(logs: WorkflowLog[]): FetchResourceAudit[] {
  const expected = expectedCounts(logs);
  return definitions.map((definition) => {
    const events = logs.filter((log) => resourceKey(log) === definition.key && terminalLog(log));
    const details = events.map((log) => safeJson<LogDetails>(log.details_json, {}));
    return {
      ...definition,
      status: auditStatus(events),
      expected: expected[definition.key],
      checked: events.filter((log) => !log.step.endsWith(".cooldown")).length,
      skipped: events.filter((log) => log.step.endsWith(".cooldown")).length,
      failed: events.filter((log) => log.step.endsWith(".failed") || log.level === "error").length,
      inspected: details.reduce((total, item) => total + (item.jobsFound || 0), 0),
      extracted: details.reduce((total, item) => total + (item.roleFamilyJobs ?? item.relevantJobsFound ?? item.directJobsFound ?? 0), 0),
      added: details.reduce((total, item) => total + (item.jobsAdded || 0), 0),
      refreshed: details.reduce((total, item) => total + (item.jobsUpdated || 0), 0),
      hiringSignals: details.reduce((total, item) => total + (item.hiringSignalsFound || 0), 0),
      boardsAdded: details.reduce((total, item) => total + (item.boardsAdded || 0), 0),
      events: events.map((log, index) => ({
        label: eventLabel(log, details[index]),
        level: log.level,
        message: log.message,
      })),
    };
  });
}
