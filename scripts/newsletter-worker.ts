import { researchNewsletter } from "@/lib/newsletter-research";
import { claimResearchLock, readResearchRun, releaseResearchLock, saveResearchRun } from "@/lib/newsletter-research-store";

async function main() {
  try { process.loadEnvFile(".env"); } catch { /* Inherits the app environment as well. */ }
  const run = await readResearchRun(process.argv[2] || "");
  await claimResearchLock(run.id);
  let saves = Promise.resolve();
  let dirty = true;
  const save = () => {
    dirty = false;
    const snapshot = structuredClone(run);
    saves = saves.then(() => saveResearchRun(snapshot));
    return saves;
  };
  const ticker = setInterval(() => { if (dirty) void save().catch(() => { /* Final save surfaces disk errors. */ }); }, 2500);
  try {
    run.analysis = await researchNewsletter(run.source, run.profile, {
      top: run.top, policy: run.policy,
      onProgress: (message) => { run.progress = message; dirty = true; },
      onCheckpoint: async (analysis) => { run.analysis = analysis; await save(); },
    });
    run.status = "complete";
    run.progress = `Complete: ${run.analysis.counts.completed} companies assessed; ${run.analysis.shortlist.length} shortlisted.`;
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : "Newsletter investigation failed.";
    run.progress = "Investigation stopped. Any completed company records are saved.";
  } finally {
    clearInterval(ticker);
    await save();
    await releaseResearchLock(run.id);
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
