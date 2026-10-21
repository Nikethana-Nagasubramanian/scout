import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { researchPolicySchema, type NewsletterResearchRun, type ResearchPolicy } from "@/lib/newsletter-research-models";
import type { NewsletterSource } from "@/lib/newsletter-input";
import type { NewsletterProfile } from "@/lib/newsletter-models";

const runDirectory = () => resolve("data/generated/newsletters/runs");
const lockPath = () => resolve(runDirectory(), "active.lock");
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function runPath(id: string): string {
  if (!validId(id)) throw new Error("Invalid newsletter run ID.");
  return resolve(runDirectory(), `${id}.json`);
}

export async function saveResearchRun(run: NewsletterResearchRun): Promise<void> {
  await mkdir(runDirectory(), { recursive: true });
  const path = runPath(run.id);
  const temporary = `${path}.${randomUUID()}.tmp`;
  run.updated_at = new Date().toISOString();
  await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function readResearchRun(id: string): Promise<NewsletterResearchRun> {
  return JSON.parse(await readFile(runPath(id), "utf8")) as NewsletterResearchRun;
}

export async function releaseResearchLock(id: string): Promise<void> {
  try {
    const lock = JSON.parse(await readFile(lockPath(), "utf8")) as { id: string };
    if (lock.id === id) await unlink(lockPath());
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

export async function claimResearchLock(id: string): Promise<void> {
  const lock = JSON.parse(await readFile(lockPath(), "utf8")) as { id: string };
  if (lock.id !== id) throw new Error("Research worker does not own the active run.");
  await writeFile(lockPath(), JSON.stringify({ id, pid: process.pid }), { mode: 0o600 });
}

async function activeResearchRun(): Promise<NewsletterResearchRun | null> {
  let lock: { id: string; pid: number };
  try { lock = JSON.parse(await readFile(lockPath(), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (!validId(lock.id) || !Number.isInteger(lock.pid) || lock.pid < 1) throw new Error("The newsletter worker lock is invalid.");
  let alive = true;
  try { process.kill(lock.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
  const run = await readResearchRun(lock.id);
  if (alive && run.status === "running") return run;
  if (run.status === "running") {
    run.status = "failed";
    run.error = "The research worker stopped before finishing. Saved company records are available; start another run to investigate again.";
    await saveResearchRun(run);
  }
  await releaseResearchLock(lock.id);
  return null;
}

export async function latestResearchRun(): Promise<NewsletterResearchRun | null> {
  const active = await activeResearchRun();
  if (active) return active;
  let files: string[];
  try { files = (await readdir(runDirectory())).filter((file) => file.endsWith(".json") && validId(file.slice(0, -5))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const runs = await Promise.all(files.map((file) => readResearchRun(file.slice(0, -5))));
  return runs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
}

export async function savedResearchPolicy(): Promise<ResearchPolicy> {
  const { getSetting } = await import("@/lib/database");
  try { return researchPolicySchema.parse(JSON.parse(getSetting("newsletter_research_policy", "{}"))); }
  catch { return researchPolicySchema.parse({}); }
}

export async function startResearchRun(source: NewsletterSource, profile: NewsletterProfile, policy: ResearchPolicy, top = 5): Promise<NewsletterResearchRun> {
  const active = await activeResearchRun();
  if (active) throw new Error("A newsletter investigation is already running. Its progress is shown below; wait for it to finish before starting another.");
  await mkdir(runDirectory(), { recursive: true });
  const now = new Date().toISOString();
  const run: NewsletterResearchRun = { id: randomUUID(), status: "running", created_at: now, updated_at: now, progress: "Discovering newsletter companies...", error: null, source, profile, policy, top, analysis: null };
  const lock = await open(lockPath(), "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error("Another newsletter investigation is starting. Reload to see its progress.");
    throw error;
  });
  await lock.writeFile(JSON.stringify({ id: run.id, pid: process.pid }));
  await lock.close();
  try {
    await saveResearchRun(run);
    const { setSetting } = await import("@/lib/database");
    setSetting("newsletter_research_policy", JSON.stringify(policy));
    const child = spawn(process.execPath, ["--import", "tsx", resolve("scripts/newsletter-worker.ts"), run.id], {
      cwd: process.cwd(), env: process.env, detached: true, stdio: "ignore",
    });
    await new Promise<void>((accept, reject) => { child.once("spawn", accept); child.once("error", reject); });
    child.unref();
    return run;
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : "Could not start research worker.";
    await saveResearchRun(run);
    await releaseResearchLock(run.id);
    throw error;
  }
}
