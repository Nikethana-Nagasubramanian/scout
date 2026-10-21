import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/newsletter", async (original) => ({ ...(await original<typeof import("@/lib/newsletter")>()), analyzeNewsletter: vi.fn() }));
vi.mock("@/lib/newsletter-input", () => ({ readNewsletterUrl: vi.fn() }));
vi.mock("@/lib/newsletter-profile", () => ({ savedNewsletterProfile: vi.fn() }));
vi.mock("@/lib/newsletter-research-store", () => ({ startResearchRun: vi.fn(), latestResearchRun: vi.fn(async () => null), readResearchRun: vi.fn() }));

import { analyzeNewsletterAction, startNewsletterResearchAction } from "@/app/newsletters/actions";
import { analyzeNewsletter } from "@/lib/newsletter";
import { readNewsletterUrl } from "@/lib/newsletter-input";
import { savedNewsletterProfile } from "@/lib/newsletter-profile";
import { startResearchRun } from "@/lib/newsletter-research-store";

const profile = { targetRoles: ["Design Engineer"], strengths: ["AI workflows"], summary: "" };
const analysis = { schemaVersion: 1 as const, counts: { detected: 0, potentiallyRelevant: 0, worthInvestigating: 0 }, shortlist: [] };
const previous = { error: null, run: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(savedNewsletterProfile).mockResolvedValue(profile);
  vi.mocked(analyzeNewsletter).mockResolvedValue(analysis);
});

describe("newsletter agent app input", () => {
  it("starts a worker with user criteria and the balanced action limit", async () => {
    const form = new FormData(); form.set("mode", "text"); form.set("text", " Acme raised funding. "); form.set("criteria", "Growing B2B companies with an explicit design gap."); form.set("maxActions", "5");
    await startNewsletterResearchAction(form);
    expect(startResearchRun).toHaveBeenCalledWith({ kind: "text", url: null, title: "Pasted newsletter", text: "Acme raised funding." }, profile,
      expect.objectContaining({ maxActions: 5, stance: "conservative", criteria: "Growing B2B companies with an explicit design gap." }));
    expect(analyzeNewsletter).not.toHaveBeenCalled();
  });
  it("rejects blank input and invalid budgets before starting research", async () => {
    const form = new FormData(); form.set("mode", "text"); form.set("text", " ");
    expect((await startNewsletterResearchAction(form)).error).toContain("empty");
    form.set("text", "Acme raised funding."); form.set("maxActions", "50");
    expect((await startNewsletterResearchAction(form)).error).toBeTruthy();
    expect(startResearchRun).not.toHaveBeenCalled();
  });
});

describe("newsletter app input", () => {
  it("reads the supplied URL and analyzes the resulting text with the saved profile", async () => {
    const source = { kind: "url" as const, url: "https://news.example.com/issue", title: "Issue", text: "Acme AI launched an agent." };
    vi.mocked(readNewsletterUrl).mockResolvedValue(source);
    const form = new FormData(); form.set("mode", "url"); form.set("url", source.url);
    expect(await analyzeNewsletterAction(previous, form)).toEqual({ error: null, run: { source, analysis } });
    expect(readNewsletterUrl).toHaveBeenCalledWith(source.url);
    expect(analyzeNewsletter).toHaveBeenCalledWith(source.text, profile);
  });

  it("analyzes pasted text directly without requesting a page", async () => {
    const form = new FormData(); form.set("mode", "text"); form.set("text", " Acme AI launched an agent. ");
    const state = await analyzeNewsletterAction(previous, form);
    expect(state.run?.source).toMatchObject({ kind: "text", url: null, text: "Acme AI launched an agent." });
    expect(readNewsletterUrl).not.toHaveBeenCalled();
  });

  it("surfaces profile and reader failures without spending inference calls", async () => {
    const form = new FormData(); form.set("mode", "url"); form.set("url", "https://news.example.com/issue");
    vi.mocked(savedNewsletterProfile).mockRejectedValueOnce(new Error("Save your Scout search profile."));
    expect((await analyzeNewsletterAction(previous, form)).error).toBe("Save your Scout search profile.");
    expect(readNewsletterUrl).not.toHaveBeenCalled();
    vi.mocked(readNewsletterUrl).mockRejectedValueOnce(new Error("The page is gated. Paste the issue text."));
    expect((await analyzeNewsletterAction(previous, form)).error).toBe("The page is gated. Paste the issue text.");
    expect(analyzeNewsletter).not.toHaveBeenCalled();
  });
});
