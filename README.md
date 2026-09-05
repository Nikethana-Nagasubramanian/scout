# Scout

Scout is a private job search app for one candidate. It collects jobs, scores matches, prepares tailored resume drafts, researches contacts, and tracks applications through to an outcome. Everything runs locally on your Mac against a SQLite file.

Job discovery starts from the role, location, seniority, and experience saved during onboarding. Remotive, Jobicy, and Himalayas are built in and do not require an API key. Company Greenhouse, Ashby, and Lever boards are optional watchlist sources, and Scout adds official boards automatically when a matching job exposes one.

A job is kept when its title is one Scout searches for. When the title is unusual but the
description reads like product design work, the job is kept for review rather than dropped,
so an "Interaction Designer" or "Design Technologist" posting still reaches you. Other design
disciplines, hardware roles, and leadership titles are still filtered out.

Boards are checked on a schedule that follows what they produce. A board that yields a
relevant role moves to a frequent watchlist, one that stays quiet falls back to a daily and
then a weekly check, and nothing is ever deleted, so a company that starts hiring again
recovers on its own.

Every fetched result is saved. Open the fetch result in Jobs to see which roles passed, which were filtered, and the reason for each decision.

## Requirements

- macOS
- Node.js 22 LTS
- pnpm 9

## Run Scout

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The first visit opens candidate onboarding.

## What each page does

| Page | Purpose |
| --- | --- |
| Home | Daily starting point with the strongest opportunities and the next step for each. |
| Jobs | Every collected job, its score, and the fetch result explaining why it passed or was filtered. Roles requiring United States citizenship are filtered when your profile says you need sponsorship. |
| Resume queue | Decide which tailored resumes are ready to use. Approve, regenerate, or reject a draft. Applied jobs move to Applications. |
| Applications | Track submitted applications, follow-ups, outcomes, and contact research in one place. |
| Contact research | Find an evidence backed contact for a shortlisted role before you apply. Grouped by application stage. |
| Target companies | Early company hiring momentum worth validating before contact research and outreach. |
| Job sources | Everywhere Scout looks and how often. Exa queries and remaining credit, the public feeds, your Gmail label, and every official board grouped by how often it is checked. Resting boards can be woken in bulk. |
| Candidate profile | The single source of truth for matching and resume generation. |
| Settings | Collection times, AI provider and model, and related preferences. |
| Workflow diagnostics | Per fetch step logs, timings, and counts for debugging a collection run. |

## Resume workflow

Prepare a job from the Jobs page to generate a tailored resume draft. Drafts land in the Resume queue, where each version can be expanded, regenerated, approved, or rejected. Approving a resume moves the role forward into Applications. Scout keeps earlier versions so you can compare what changed, and never lets a model invent resume claims.

## AI provider

Scout can use either the Claude API or a local Ollama model for resume evidence
prioritization and cover letter drafting. Pick one under Provider on the Settings page. The
default is the Claude API, and the order it tries is:

1. Claude, when a key is set.
2. Ollama, but only when it answers a quick reachability check. An Ollama that is not running
   is skipped rather than waited on.
3. A deterministic draft, which is instant and always available.

The line beside a cover letter names whichever one produced it. When the draft came from the
deterministic path, a Retry with Ollama button appears, so a slow local attempt is your
choice rather than something you wait through by default.

Ollama keeps every request on your Mac and costs nothing, but it is slow and the smaller
models are unreliable. The Claude API is faster and writes noticeably better, and it sends the
job posting and your resume evidence to Anthropic.

For the Claude API, put the key in `.env`, which is ignored by git:

```text
ANTHROPIC_API_KEY=your-key-here
```

`CLAUDE_API_KEY` is accepted as an alias.

The model is a setting and defaults to `claude-haiku-4-5`, the cheapest current model. One
application costs roughly 8000 input and 1000 output tokens across its five calls, which at
Haiku pricing is well under a cent, so a normal month of applying costs a few tens of cents.

## Ollama

Ollama is optional. Enable it on the Settings page to prioritize existing resume evidence without sending the resume off the Mac.

```bash
ollama pull gemma3:4b
ollama serve
```

Ollama must actually be running for any of this to happen. If `ollama serve` is not up, Scout
silently falls back to a structured template, so check the line under a cover letter draft: it
names the model when local AI wrote it, and says so plainly when it did not.

Local AI work is slow because it runs on your Mac, and roughly a third of a cold request is
the model loading from disk. When Ollama is the chosen provider, Scout keeps the model
resident for 30 minutes to avoid re-paying that. When it is only the fallback, the model is
released as soon as the request finishes, so a rare fallback does not hold gigabytes of RAM
on a small machine. Override either with `OLLAMA_KEEP_ALIVE`. If you want the resume suggestions to overlap rather than queue, start
the server with `OLLAMA_NUM_PARALLEL=4 ollama serve`, which was worth about 17 percent in
testing. Switching models between tasks forces a reload, so one model everywhere is faster
than picking a different one per task.

Ollama runs entirely on your Mac and has no internet access, so it never researches a company
on its own. Everything it knows comes from the job posting Scout fetched and your saved
resume evidence.

Scout works without Ollama.

Set `OLLAMA_URL` if Ollama does not run on its default address.

## Gmail hiring signals

Scout can read job alert email to surface companies showing hiring momentum, which appear on the Target companies page. Configure it with these environment variables:

```text
SCOUT_GMAIL_ADDRESS
SCOUT_GMAIL_APP_PASSWORD
SCOUT_GMAIL_LABEL
```

Use a Google app password, not your account password. Run a manual pass with:

```bash
pnpm collect:gmail
```

## Contact research

The Contact research page uses Hunter to find an evidence backed contact for a role. Set `HUNTER_API_KEY` to enable it. Scout tracks credit usage against a budget and shows the remaining allowance on the page. Without the key the page still lists opportunities, but cannot run a lookup.

## Company discovery with Exa

Scout uses [Exa](https://exa.ai) to find companies that are hiring for your role but are not
yet on any board it tracks.

Four natural-language queries run at most once a day against the known ATS hosts
(`jobs.ashbyhq.com`, `jobs.lever.co`, and both Greenhouse board domains), looking back 30
days. Those results are job postings whose board is already named in the URL, so Scout reads
the board straight from the link without crawling anything.

One broader query runs weekly with no domain filter, to catch companies whose careers page
sits outside those hosts. Only that query leads to page inspection.

Exa is a semantic search engine, so the queries are written as plain descriptions of the
wanted role. Domain filtering is a request parameter rather than query syntax, and Scout
never asks Exa to judge fit: scoring happens afterwards against the full job text. Results
are deduplicated by canonical URL before anything is fetched, and a query that keeps
returning nothing is run less often rather than deleted.

Edit the queries in `lib/source-presets.ts`, or the `exa_queries` table to change cadence.

Set the key in `.env.local`, which is ignored by git:

```text
EXA_API_KEY=your-key-here
```

At Exa's current search price this costs well under a dollar a month. Exa reports the exact
price of every request, so Scout keeps a running total rather than an
estimate. The default budget is 10 dollars and can be changed with the `exa_budget_dollars`
setting. Once spending passes 80 percent of it, the Job sources page shows a warning banner
with the amount used, and Scout keeps searching. If Exa reports that the credits are gone,
discovery pauses and the banner says so.

Scout works without Exa. Company discovery is simply skipped when the key is missing.

## Automatic job collection

Set your preferred times on the Settings page, then install the macOS scheduler once:

```bash
pnpm scheduler:install
```

Remove it with:

```bash
pnpm scheduler:remove
```

Run a collection by hand at any time with `pnpm collect`.

## Data

Your profile, jobs, resumes, and applications are stored locally in:

```text
data/job-copilot.sqlite
```

Use the Applications page to download a backup.

## Check the app

```bash
pnpm verify
```

This runs the em dash check, TypeScript, ESLint, the Vitest suite, and a production build. Note that the em dash check rejects the `U+2014` character anywhere in the tracked source, README included.
