import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { analyzeNewsletter } from "@/lib/newsletter";
import { readNewsletterUrl } from "@/lib/newsletter-input";
import { newsletterProfileSchema, newsletterResultSchema } from "@/lib/newsletter-models";
import { savedNewsletterProfile } from "@/lib/newsletter-profile";
import { evaluateNewsletter, fixtureNewsletter, newsletterFixtureSchema } from "@/lib/newsletter-evaluation";
import { researchNewsletter } from "@/lib/newsletter-research";
import { researchPolicySchema } from "@/lib/newsletter-research-models";
import { savedResearchPolicy } from "@/lib/newsletter-research-store";
import type { NewsletterSource } from "@/lib/newsletter-input";

const usage = `Usage:
  pnpm newsletter [newsletter.txt|https://newsletter-link] [--top 5] [--profile profile.json]
  pnpm newsletter:eval fixture.json [--profile profile.json] [--top 5]
  pnpm newsletter:eval fixture.json --results results.json

Options: --max-actions 5, --criteria criteria.txt, --initial-only,
         --provider anthropic|ollama, --model MODEL, --help
Uses Scout's saved profile and AI settings by default. --profile replaces the fit context.
With no input, asks for a newsletter link or text-file path in an interactive terminal.
Normal runs investigate every company. --initial-only and evaluation use the original newsletter-only assessment.
Evaluation labels are never included in prompts. --results evaluates saved output without AI calls.`;

async function main(): Promise<void> {
  try { process.loadEnvFile(".env"); } catch { /* Local environment files are optional. */ }
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((argument) => argument !== "--"),
    allowPositionals: true,
    options: {
      evaluate: { type: "boolean", default: false }, help: { type: "boolean", default: false },
      top: { type: "string", default: "5" }, profile: { type: "string" },
      output: { type: "string" }, results: { type: "string" },
      provider: { type: "string" }, model: { type: "string" },
      "max-actions": { type: "string" }, criteria: { type: "string" }, "initial-only": { type: "boolean", default: false },
    },
  });
  if (values.help) { console.log(usage); return; }
  if (!positionals.length && !values.evaluate && stdin.isTTY) {
    const terminal = createInterface({ input: stdin, output: stderr });
    try { positionals.push((await terminal.question("Newsletter link (or text-file path): ")).trim()); }
    finally { terminal.close(); }
  }
  if (positionals.length !== 1 || !positionals[0]) throw new Error(usage);
  const top = Number(values.top);
  if (!Number.isInteger(top) || top < 1 || top > 100) throw new Error("--top must be an integer from 1 to 100.");
  if (values.provider && values.provider !== "anthropic" && values.provider !== "ollama") {
    throw new Error("--provider must be anthropic or ollama.");
  }
  if (values.results && !values.evaluate) throw new Error("--results is available only with newsletter:eval.");
  if (values["max-actions"] && (!Number.isInteger(Number(values["max-actions"])) || Number(values["max-actions"]) < 1 || Number(values["max-actions"]) > 10)) throw new Error("--max-actions must be an integer from 1 to 10.");
  const isUrl = !values.evaluate && /^[a-z][a-z0-9+.-]*:\/\//i.test(positionals[0]);
  if (isUrl && values.results) throw new Error("Saved evaluation results require a fixture file.");
  const inputPath = isUrl ? positionals[0] : resolve(positionals[0]);
  if (isUrl) console.error("Reading newsletter page...");
  const page = isUrl ? await readNewsletterUrl(inputPath) : null;
  const input = page ? page.text : await readFile(inputPath, "utf8");
  const fixture = values.evaluate ? newsletterFixtureSchema.parse(JSON.parse(input)) : null;
  const source = fixture ? fixtureNewsletter(fixture) : input;
  const outputName = page ? new URL(page.url!).hostname.replace(/[^a-z0-9.-]/gi, "-") : basename(inputPath).replace(/\.[^.]+$/, "");
  const outputPath = resolve(values.output || `data/generated/newsletters/${outputName}-${Date.now()}.json`);
  const profile = values.results ? null : values.profile
    ? newsletterProfileSchema.parse(JSON.parse(await readFile(resolve(values.profile), "utf8")))
    : await savedNewsletterProfile();
  if (!values.evaluate && !values["initial-only"]) {
    const savedPolicy = await savedResearchPolicy();
    const policy = researchPolicySchema.parse({ ...savedPolicy,
      ...(values["max-actions"] ? { maxActions: Number(values["max-actions"]) } : {}),
      ...(values.criteria ? { criteria: await readFile(resolve(values.criteria), "utf8") } : {}),
    });
    const researchSource: NewsletterSource = page || { kind: "text", url: null, title: basename(inputPath), text: source };
    await mkdir(dirname(outputPath), { recursive: true });
    const analysis = await researchNewsletter(researchSource, profile!, {
      top, policy, ai: { provider: values.provider as "anthropic" | "ollama" | undefined, model: values.model },
      onProgress: (message) => console.error(message),
      onCheckpoint: async (partial) => { const temporary = `${outputPath}.tmp`; await writeFile(temporary, `${JSON.stringify({ source: researchSource, policy, analysis: partial }, null, 2)}\n`, "utf8"); await (await import("node:fs/promises")).rename(temporary, outputPath); },
    });
    await writeFile(outputPath, `${JSON.stringify({ source: researchSource, policy, analysis }, null, 2)}\n`, "utf8");
    console.log(`${analysis.counts.completed}/${analysis.counts.detected} companies assessed; ${analysis.shortlist.length} shortlisted.`);
    console.log(JSON.stringify(analysis.companies.map((company) => ({ company: company.company, verdict: company.verdict, confidence: company.confidence, current_hypothesis: company.current_hypothesis, unknowns: company.unknowns, stop_reason: company.stop_reason })), null, 2));
    console.log(`Saved all company records, sources and research history to ${outputPath}`);
    return;
  }
  let analysis;
  if (values.results) {
    const saved = JSON.parse(await readFile(resolve(values.results), "utf8"));
    analysis = newsletterResultSchema.parse(saved.analysis ?? saved);
    for (const opportunity of analysis.shortlist) {
      for (const signal of opportunity.observedSignals) {
        if (source.slice(signal.sourceStart, signal.sourceEnd) !== signal.quote) {
          throw new Error("Saved results do not match this fixture's newsletter text.");
        }
      }
    }
  } else {
    analysis = await analyzeNewsletter(source, profile!, {
      top,
      ai: { provider: values.provider as "anthropic" | "ollama" | undefined, model: values.model },
      onProgress: (message) => console.error(message),
    });
  }
  const evaluation = fixture ? evaluateNewsletter(analysis, fixture, top) : null;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evaluation ? { analysis, evaluation } : page ? { source: page, analysis } : analysis, null, 2)}\n`, "utf8");
  console.log(`${analysis.counts.detected} companies detected`);
  console.log(`${analysis.counts.potentiallyRelevant} potentially relevant`);
  console.log(`${analysis.counts.worthInvestigating} worth investigating`);
  console.log(`Returning ${evaluation ? evaluation.returned : analysis.shortlist.length} (top ${top})`);
  console.log(JSON.stringify(evaluation || analysis.shortlist, null, 2));
  console.log(`Saved ${outputPath}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Newsletter analysis failed");
  process.exitCode = 1;
});
