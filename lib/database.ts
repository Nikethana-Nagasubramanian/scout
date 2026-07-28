import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const databasePath = join(process.cwd(), "data", "job-copilot.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

const globalDatabase = globalThis as typeof globalThis & { jobCopilotDb?: Database.Database };

export const db = globalDatabase.jobCopilotDb || new Database(databasePath);

if (process.env.NODE_ENV !== "production") globalDatabase.jobCopilotDb = db;

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS candidate_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    full_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    home_location TEXT NOT NULL DEFAULT '',
    professional_summary TEXT NOT NULL DEFAULT '',
    base_resume_text TEXT NOT NULL DEFAULT '',
    target_titles TEXT NOT NULL DEFAULT '[]',
    target_seniority TEXT NOT NULL DEFAULT '',
    skills TEXT NOT NULL DEFAULT '[]',
    preferred_locations TEXT NOT NULL DEFAULT '[]',
    workplace_preferences TEXT NOT NULL DEFAULT '[]',
    minimum_salary INTEGER,
    work_authorization TEXT NOT NULL DEFAULT '',
    sponsorship_required INTEGER NOT NULL DEFAULT 0,
    years_experience INTEGER,
    portfolio_url TEXT NOT NULL DEFAULT '',
    linkedin_url TEXT NOT NULL DEFAULT '',
    github_url TEXT NOT NULL DEFAULT '',
    onboarding_complete INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO candidate_profile (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS candidate_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    claim TEXT NOT NULL,
    skills TEXT NOT NULL DEFAULT '[]',
    verified INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS job_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('greenhouse', 'lever')),
    identifier TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    cooldown_until TEXT,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_type, identifier)
  );

  CREATE TABLE IF NOT EXISTS discovery_sources (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    minimum_interval_minutes INTEGER NOT NULL,
    cooldown_until TEXT,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_error TEXT NOT NULL DEFAULT '',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    query_cursor INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS collection_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot TEXT NOT NULL DEFAULT 'manual',
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    jobs_found INTEGER NOT NULL DEFAULT 0,
    jobs_added INTEGER NOT NULL DEFAULT 0,
    jobs_updated INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS workflow_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER REFERENCES collection_runs(id) ON DELETE CASCADE,
    source_id INTEGER REFERENCES job_sources(id) ON DELETE SET NULL,
    step TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error', 'success')),
    message TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS workflow_logs_run_index ON workflow_logs(run_id, id);

  CREATE TABLE IF NOT EXISTS collection_job_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    outcome TEXT NOT NULL CHECK (outcome IN ('new', 'refreshed')),
    eligible INTEGER NOT NULL,
    reasons_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id, job_id)
  );

  CREATE INDEX IF NOT EXISTS collection_job_results_run_index
    ON collection_job_results(run_id, eligible, outcome);
  CREATE INDEX IF NOT EXISTS collection_job_results_job_index
    ON collection_job_results(job_id, run_id);

  CREATE TABLE IF NOT EXISTS gmail_alert_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    label TEXT NOT NULL DEFAULT '',
    last_attempt_at TEXT,
    last_success_at TEXT,
    cooldown_until TEXT,
    last_error TEXT NOT NULL DEFAULT ''
  );

  INSERT OR IGNORE INTO gmail_alert_state (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS gmail_processed_messages (
    mailbox TEXT NOT NULL,
    uid INTEGER NOT NULL,
    parser_version INTEGER NOT NULL,
    message_id_hash TEXT NOT NULL,
    jobs_found INTEGER NOT NULL DEFAULT 0,
    processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (mailbox, uid, parser_version)
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER REFERENCES job_sources(id) ON DELETE SET NULL,
    source_name TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    workplace_type TEXT NOT NULL DEFAULT 'unspecified',
    employment_type TEXT NOT NULL DEFAULT '',
    salary_min INTEGER,
    salary_max INTEGER,
    salary_currency TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    apply_url TEXT NOT NULL,
    posted_at TEXT,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL DEFAULT 'discovered',
    score INTEGER,
    hard_filter_pass INTEGER,
    score_breakdown TEXT,
    match_summary TEXT,
    seen_count INTEGER NOT NULL DEFAULT 1,
    confidence_score INTEGER,
    confidence_breakdown TEXT,
    confidence_summary TEXT,
    UNIQUE(source_id, external_id)
  );

  CREATE INDEX IF NOT EXISTS jobs_score_index ON jobs(score DESC);
  CREATE INDEX IF NOT EXISTS jobs_status_index ON jobs(status);
  CREATE INDEX IF NOT EXISTS jobs_seen_index ON jobs(first_seen_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS jobs_discovery_external_unique
    ON jobs(source_type, external_id)
    WHERE source_id IS NULL AND source_type IN ('remotive', 'jobicy');
  CREATE UNIQUE INDEX IF NOT EXISTS jobs_himalayas_external_unique
    ON jobs(source_type, external_id)
    WHERE source_id IS NULL AND source_type = 'himalayas';
  CREATE UNIQUE INDEX IF NOT EXISTS jobs_gmail_external_unique
    ON jobs(source_type, external_id)
    WHERE source_id IS NULL AND source_type IN ('gmail_indeed', 'gmail_builtin', 'gmail_alert');

  CREATE TABLE IF NOT EXISTS resume_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft',
    content_json TEXT NOT NULL,
    change_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    resume_version_id INTEGER REFERENCES resume_versions(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ready_to_apply',
    applied_at TEXT,
    follow_up_at TEXT,
    contact_name TEXT NOT NULL DEFAULT '',
    contact_details TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS application_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn("jobs", "seen_count", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("jobs", "confidence_score", "INTEGER");
ensureColumn("jobs", "confidence_breakdown", "TEXT");
ensureColumn("jobs", "confidence_summary", "TEXT");
ensureColumn("job_sources", "cooldown_until", "TEXT");
ensureColumn("job_sources", "last_attempt_at", "TEXT");
ensureColumn("job_sources", "last_success_at", "TEXT");
ensureColumn("job_sources", "last_error", "TEXT NOT NULL DEFAULT ''");
ensureColumn("job_sources", "consecutive_failures", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("discovery_sources", "query_cursor", "INTEGER NOT NULL DEFAULT 0");

const insertDiscoverySource = db.prepare(`
  INSERT OR IGNORE INTO discovery_sources (key, name, minimum_interval_minutes)
  VALUES (?, ?, ?)
`);
insertDiscoverySource.run("remotive", "Remotive", 360);
insertDiscoverySource.run("jobicy", "Jobicy", 60);
insertDiscoverySource.run("himalayas", "Himalayas", 1440);
db.prepare("UPDATE discovery_sources SET query_cursor = 1 WHERE key = 'jobicy' AND last_attempt_at IS NULL AND query_cursor = 0").run();
db.prepare("UPDATE discovery_sources SET query_cursor = 2 WHERE key = 'himalayas' AND last_attempt_at IS NULL AND query_cursor = 0").run();

const defaultSettings: Record<string, string> = {
  collection_mode: "manual",
  morning_enabled: "1",
  morning_time: "06:30",
  afternoon_enabled: "0",
  afternoon_time: "12:30",
  evening_enabled: "0",
  evening_time: "17:30",
  night_enabled: "0",
  night_time: "21:30",
  minimum_queue_score: "65",
  search_usa_only: "1",
  search_experience_min: "2",
  search_experience_max: "5",
  local_ai_enabled: "0",
  ollama_model: "llama3.2:3b",
};

const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
const seedSettings = db.transaction(() => {
  for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value);
});
seedSettings();

export function getSetting(key: string, fallback = ""): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function getDatabasePath(): string {
  return databasePath;
}
