import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runWorkflowAction, saveSettingsAction } from "@/app/actions";
import { PageHeader, StatusPill } from "@/components/UI";
import { WorkflowSubmitButton } from "@/components/WorkflowSubmitButton";
import { getSetting } from "@/lib/database";

export const dynamic = "force-dynamic";

const slots = [
  { key: "morning", label: "Morning", description: "Start the day with fresh roles" },
  { key: "afternoon", label: "Afternoon", description: "Catch new midday postings" },
  { key: "evening", label: "Evening", description: "Review late business hours" },
  { key: "night", label: "Night", description: "Prepare tomorrow's queue" },
];

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

async function installedOllamaModels(): Promise<string[]> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return [];
    const payload = await response.json() as OllamaTagsResponse;
    return [...new Set((payload.models || []).map((model) => model.name || "").filter(Boolean))].sort();
  } catch {
    return [];
  }
}

export default async function SettingsPage() {
  const mode = getSetting("collection_mode", "manual");
  const schedulerInstalled = existsSync(join(homedir(), "Library", "LaunchAgents", "local.scout.job-collector.plist"));
  const selectedModel = getSetting("ollama_model", "gemma3:4b");
  const installedModels = await installedOllamaModels();
  const modelOptions = installedModels.includes(selectedModel) ? installedModels : [selectedModel, ...installedModels];

  return (
    <div className="page narrow">
      <PageHeader title="Automation" description="Choose when Scout fetches jobs and which eligibility rules every result must pass.">
        <StatusPill status={mode} />
      </PageHeader>

      {mode === "automatic" && !schedulerInstalled ? (
        <div className="callout warning">
          <strong>Automatic schedule is configured but not installed on this Mac.</strong>
          <p>From the Scout folder, run <code>pnpm scheduler:install</code> once. The browser and Scout server can then be closed while launchd checks the schedule.</p>
        </div>
      ) : null}

      <form action={saveSettingsAction} className="card form-card">
        <section className="form-section">
          <h2>Collection mode</h2>
          <p>Manual mode never collects unless you press a run button. Automatic mode uses enabled schedule slots.</p>
          <div className="field">
            <label htmlFor="collection_mode">Mode</label>
            <select id="collection_mode" name="collection_mode" defaultValue={mode}>
              <option value="manual">Manual only</option>
              <option value="automatic">Automatic schedule</option>
            </select>
          </div>
        </section>

        <section className="form-section">
          <h2>Daily schedule</h2>
          <p>Times use the current Mac timezone. Missed slots run once when the Mac wakes later that day. Any slot can still be run manually.</p>
          <div className="schedule-grid">
            {slots.map((slot) => (
              <div className="schedule-card" key={slot.key}>
                <h3>{slot.label}</h3>
                <p>{slot.description}</p>
                <label className="check-label">
                  <input
                    type="checkbox"
                    name={`${slot.key}_enabled`}
                    defaultChecked={getSetting(`${slot.key}_enabled`, "0") === "1"}
                  />
                  Enabled
                </label>
                <div className="field schedule-time">
                  <label htmlFor={`${slot.key}_time`}>Run time</label>
                  <input
                    id={`${slot.key}_time`}
                    type="time"
                    name={`${slot.key}_time`}
                    defaultValue={getSetting(`${slot.key}_time`, "06:30")}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="form-section">
          <h2>Job eligibility</h2>
          <p>Scout filters explicit contradictions. Missing or ambiguous details stay visible as Needs verification instead of disappearing.</p>
          <label className="check-label">
            <input type="checkbox" name="search_usa_only" defaultChecked={getSetting("search_usa_only", "1") === "1"} />
            Only include jobs explicitly located in or restricted to the United States
          </label>
          <div className="two-column compact-form">
            <div className="field">
              <label htmlFor="search_experience_min">Minimum experience level</label>
              <input id="search_experience_min" name="search_experience_min" type="number" min="0" max="20" defaultValue={getSetting("search_experience_min", "2")} />
            </div>
            <div className="field">
              <label htmlFor="search_experience_max">Maximum experience level</label>
              <input id="search_experience_max" name="search_experience_max" type="number" min="0" max="20" defaultValue={getSetting("search_experience_max", "5")} />
            </div>
            <div className="field">
              <label htmlFor="search_max_age_days">Maximum posting age in days</label>
              <input id="search_max_age_days" name="search_max_age_days" type="number" min="1" max="365" defaultValue={getSetting("search_max_age_days", "60")} />
            </div>
          </div>
          <p className="muted">Included titles: Product Designer, UI/UX Designer, and Design Engineer. Design Engineer requires digital product evidence in the job description. Senior Product Designer is included when the posting asks for five years or less.</p>
        </section>

        <section className="form-section">
          <h2>Approval queue</h2>
          <p>Only jobs at or above this score enter the priority queue. Failed hard filters stay out.</p>
          <div className="field">
            <label htmlFor="minimum_queue_score">Minimum match score</label>
            <input id="minimum_queue_score" name="minimum_queue_score" type="number" min="0" max="100" defaultValue={getSetting("minimum_queue_score", "65")} />
          </div>
        </section>

        <section className="form-section">
          <h2>Optional local AI</h2>
          <p>When enabled, Scout asks Ollama to rank your existing skills and resume lines for each job. It cannot add or rewrite claims. Resume generation falls back safely when Ollama is not running.</p>
          <label className="check-label">
            <input type="checkbox" name="local_ai_enabled" defaultChecked={getSetting("local_ai_enabled", "0") === "1"} />
            Use local Ollama for resume evidence prioritization
          </label>
          <div className="field">
            <label htmlFor="ollama_model">Ollama model</label>
            <select id="ollama_model" name="ollama_model" defaultValue={selectedModel}>
              {modelOptions.map((model) => <option value={model} key={model}>{model}</option>)}
            </select>
            <small>{installedModels.length ? `${installedModels.length} installed model${installedModels.length === 1 ? "" : "s"} detected on this Mac.` : "Ollama is not reachable. The saved model name is preserved."}</small>
          </div>
        </section>

        <div className="form-actions"><button className="button" type="submit">Save workflow settings</button></div>
      </form>

      <div className="spacer" />
      <section className="card">
        <div className="card-header"><div><h2>Fetch jobs now</h2><p>These buttons run immediately. Sources in cooldown are skipped safely.</p></div></div>
        <div className="card-body inline-actions">
          {slots.map((slot) => (
            <form action={runWorkflowAction} key={slot.key}>
              <input type="hidden" name="slot" value={slot.key} />
              <WorkflowSubmitButton className="button secondary">Fetch {slot.label.toLowerCase()} jobs</WorkflowSubmitButton>
            </form>
          ))}
          <form action={runWorkflowAction}>
            <input type="hidden" name="slot" value="manual_full" />
            <WorkflowSubmitButton>Fetch all ready sources</WorkflowSubmitButton>
          </form>
        </div>
      </section>
    </div>
  );
}
