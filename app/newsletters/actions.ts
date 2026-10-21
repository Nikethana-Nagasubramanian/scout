"use server";

import { analyzeNewsletter } from "@/lib/newsletter";
import { readNewsletterUrl, type NewsletterSource } from "@/lib/newsletter-input";
import type { NewsletterResult } from "@/lib/newsletter-models";
import { savedNewsletterProfile } from "@/lib/newsletter-profile";
import { newsletterChunks } from "@/lib/newsletter";
import { researchPolicySchema, type NewsletterResearchRun } from "@/lib/newsletter-research-models";
import { latestResearchRun, readResearchRun, startResearchRun } from "@/lib/newsletter-research-store";

export interface NewsletterFormState {
  error: string | null;
  run: { source: NewsletterSource; analysis: NewsletterResult } | null;
}

export async function startNewsletterResearchAction(form: FormData): Promise<{ error: string | null; run: NewsletterResearchRun | null }> {
  try {
    const profile = await savedNewsletterProfile();
    const policy = researchPolicySchema.parse({ maxActions: Number(form.get("maxActions") || "5"), ...(form.get("criteria") ? { criteria: String(form.get("criteria")) } : {}) });
    const mode = String(form.get("mode") || "url");
    if (!["url", "text"].includes(mode)) throw new Error("Choose a newsletter link or pasted text.");
    const source: NewsletterSource = mode === "url"
      ? await readNewsletterUrl(String(form.get("url") || ""))
      : { kind: "text", url: null, title: "Pasted newsletter", text: String(form.get("text") || "").trim() };
    newsletterChunks(source.text);
    return { error: null, run: await startResearchRun(source, profile, policy) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not start investigation.", run: await latestResearchRun().catch(() => null) };
  }
}

export async function newsletterResearchStatusAction(id: string): Promise<NewsletterResearchRun> {
  // Detect a terminated worker and retain its completed records on reload/poll.
  const latest = await latestResearchRun();
  return latest?.id === id ? latest : readResearchRun(id);
}

export async function analyzeNewsletterAction(_previous: NewsletterFormState, form: FormData): Promise<NewsletterFormState> {
  try {
    const profile = await savedNewsletterProfile();
    const mode = String(form.get("mode") || "url");
    if (!["url", "text"].includes(mode)) throw new Error("Choose a newsletter link or pasted text.");
    const source: NewsletterSource = mode === "url"
      ? await readNewsletterUrl(String(form.get("url") || ""))
      : { kind: "text", url: null, title: "Pasted newsletter", text: String(form.get("text") || "").trim() };
    const analysis = await analyzeNewsletter(source.text, profile);
    return { error: null, run: { source, analysis } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Newsletter analysis failed. Try pasting the issue text.", run: null };
  }
}
