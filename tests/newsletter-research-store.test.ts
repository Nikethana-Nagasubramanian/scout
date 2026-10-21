import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("@/lib/database", () => ({ getSetting: vi.fn(() => "{}"), setSetting: vi.fn() }));
import { latestResearchRun, readResearchRun, releaseResearchLock, saveResearchRun, startResearchRun } from "@/lib/newsletter-research-store";
import { researchPolicySchema } from "@/lib/newsletter-research-models";

let directory: string;
const source = { kind: "text" as const, url: null, title: "Issue", text: "Acme raised funding." };
const profile = { targetRoles: [], strengths: ["Design"], summary: "" };
beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "scout-research-store-"));
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  spawnMock.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { pid: 12345, unref: vi.fn() });
    queueMicrotask(() => child.emit("spawn")); return child;
  });
});
afterEach(async () => { vi.restoreAllMocks(); spawnMock.mockReset(); await rm(directory, { recursive: true, force: true }); });

describe("persisted background investigations", () => {
  it("starts a detached worker, saves a run and prevents duplicate simultaneous app research", async () => {
    const run = await startResearchRun(source, profile, researchPolicySchema.parse({}));
    expect(await readResearchRun(run.id)).toMatchObject({ status: "running", source, policy: { maxActions: 5 } });
    expect(spawnMock).toHaveBeenCalledWith(process.execPath, ["--import", "tsx", resolve(directory, "scripts/newsletter-worker.ts"), run.id], expect.objectContaining({ detached: true, stdio: "ignore" }));
    await expect(startResearchRun(source, profile, researchPolicySchema.parse({}))).rejects.toThrow("already running");
    expect((await latestResearchRun())?.id).toBe(run.id);
  });
  it("retains completed output for a page reload and releases the active lock", async () => {
    const run = await startResearchRun(source, profile, researchPolicySchema.parse({}));
    run.status = "complete"; run.progress = "Complete.";
    await saveResearchRun(run); await releaseResearchLock(run.id);
    expect(await latestResearchRun()).toMatchObject({ id: run.id, status: "complete", progress: "Complete." });
    await expect(readResearchRun("../../private")).rejects.toThrow("Invalid newsletter run ID");
  });
  it("reports a dead worker as failed while preserving its saved records", async () => {
    const run = await startResearchRun(source, profile, researchPolicySchema.parse({}));
    await writeFile(resolve(directory, "data/generated/newsletters/runs/active.lock"), JSON.stringify({ id: run.id, pid: 12345 }));
    vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("No process"), { code: "ESRCH" }); });
    expect(await latestResearchRun()).toMatchObject({ id: run.id, status: "failed", error: expect.stringContaining("worker stopped") });
    expect((await readResearchRun(run.id)).source.text).toBe(source.text);
  });
});
