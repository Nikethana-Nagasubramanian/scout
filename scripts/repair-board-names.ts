import { prettifyIdentifier, sharedBoardNames, type BoardIdentity } from "@/lib/board-naming";
import { db } from "@/lib/database";

/**
 * Usage: pnpm repair:boards [--dry-run]
 *
 * Auto-discovered ATS boards used to be named after whatever referred them, so one
 * company's name ended up on several unrelated boards. Those are renamed from their own
 * identifier. A name that merely differs from its slug is left alone - "GHX" and "7AI" are
 * correct names for globalhealthcareexchangeinc and sevenai.
 */
const dryRun = process.argv.includes("--dry-run");

const boards = db.prepare(`
  SELECT id, name, identifier, source_type
  FROM job_sources
  WHERE source_type IN ('greenhouse', 'lever', 'ashby') AND identifier != ''
`).all() as Array<BoardIdentity & { id: number; source_type: string }>;

const shared = sharedBoardNames(boards);
if (!shared.size) {
  console.log("No board name is claimed by more than one board.");
  process.exit(0);
}

const renameSource = db.prepare("UPDATE job_sources SET name = ? WHERE id = ?");
// Only jobs still carrying the old name: anything edited by hand stays as it is.
const renameJobs = db.prepare("UPDATE jobs SET company = ?, source_name = ? WHERE source_id = ? AND company = ?");
const countJobs = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE source_id = ? AND company = ?");

const planned: Array<{ id: number; from: string; to: string; jobs: number; type: string; identifier: string }> = [];
/** A board whose name echoes its own slug is named for itself, however many boards share it. */
function namesItself(board: BoardIdentity): boolean {
  const slug = board.identifier.toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = board.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(slug) && Boolean(name) && (slug.includes(name) || name.includes(slug));
}

for (const [, group] of shared) {
  for (const board of group) {
    if (namesItself(board)) continue;
    const full = boards.find((candidate) => candidate.identifier === board.identifier && candidate.name === board.name);
    if (!full) continue;
    const to = prettifyIdentifier(board.identifier);
    if (to === board.name) continue;
    planned.push({
      id: full.id,
      from: board.name,
      to,
      jobs: (countJobs.get(full.id, board.name) as { count: number }).count,
      type: full.source_type,
      identifier: board.identifier,
    });
  }
}

if (!planned.length) {
  console.log("Shared names found, but each already belongs to the board whose slug matches.");
  process.exit(0);
}

for (const entry of planned) {
  console.log(`[${entry.type}/${entry.identifier}] "${entry.from}" -> "${entry.to}"  (${entry.jobs} ${entry.jobs === 1 ? "job" : "jobs"})`);
}

if (!dryRun) {
  db.transaction(() => {
    for (const entry of planned) {
      renameSource.run(entry.to, entry.id);
      renameJobs.run(entry.to, entry.to, entry.id, entry.from);
    }
  })();
}

const jobsTouched = planned.reduce((total, entry) => total + entry.jobs, 0);
console.log(`\n${planned.length} ${planned.length === 1 ? "board" : "boards"} and ${jobsTouched} ${jobsTouched === 1 ? "job" : "jobs"} renamed${dryRun ? " (dry run, nothing written)" : ""}.`);
