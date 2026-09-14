# Scout

Scout is a private job search app for one candidate. It collects jobs, scores them against your profile, tailors resume drafts using only facts you have confirmed, researches contacts, and tracks applications through to an outcome.

Everything runs on your own machine against a local SQLite file. Nothing leaves it except requests to the AI and search providers you choose to configure.

## Quick start

You need Node.js 22 LTS and pnpm 9 (`corepack enable` installs the right pnpm). Scout runs anywhere Node does; automatic scheduled collection needs macOS.

```bash
git clone https://github.com/Nikethana-Nagasubramanian/scout.git
cd scout
pnpm install
cp .env.example .env
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). No API keys are needed to get this far.

## Where to start

A fresh install opens on the **Search profile** page, and every other page sends you back there until the profile is saved.

1. **Upload your resume.** Import a PDF, DOCX, or text file, or paste the text. Scanned PDFs have no text layer, so paste those instead.
2. **Review the truth bank.** The first import turns your resume bullets into facts. Remove anything inaccurate and add achievements the resume leaves out. Tailored resumes can only use facts in the truth bank, so this is what keeps them honest.
3. **Set your search and save.** Target roles, seniority, years of experience, locations, and sponsorship needs decide which jobs Scout keeps and why others are filtered.
4. **Choose an AI provider** on the Automation page. See [AI setup](#ai-setup) below. Without one, Scout still works and uses templates for drafts.
5. **Add companies you want to watch** (optional). On Job sources, paste a company's careers page or any of its job links. Scout finds its Greenhouse, Ashby, or Lever board and checks it works.
6. **Fetch jobs.** Click Fetch new jobs on the Jobs page. Remotive, Jobicy, and Himalayas work with no keys.
7. **Prepare an application.** Open a job worth your time and prepare it. The tailored resume lands in the Resume queue for review, and approved roles move to Applications.

## API keys

Every key is optional. Put the ones you want in `.env`, which git ignores, and restart `pnpm dev`.

| Key | Where to get it | What it turns on | Cost |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) | Claude for resume suggestions and cover letters. Recommended. | Well under a cent per application on Haiku |
| `EXA_API_KEY` | [dashboard.exa.ai](https://dashboard.exa.ai) | Finding companies hiring for your role before they reach job boards | Under a dollar a month |
| `HUNTER_API_KEY` | [hunter.io/api-keys](https://hunter.io/api-keys) | Finding a contact for a shortlisted role | Free tier available |
| `SCOUT_GMAIL_ADDRESS`, `SCOUT_GMAIL_APP_PASSWORD`, `SCOUT_GMAIL_LABEL` | [Google app passwords](https://myaccount.google.com/apppasswords) (needs 2-step verification) | Reading job alert emails from one Gmail label | Free |

A sensible first setup is just `ANTHROPIC_API_KEY`. Add the others once the basic loop works for you.

## AI setup

Scout uses AI to prioritize resume evidence, suggest truthful rewrites, and draft cover letters. Pick a provider on the Automation page. Scout tries them in this order and never blocks on one that is unavailable:

1. **Claude API**, when `ANTHROPIC_API_KEY` is set. Fastest and best writing. It sends the job posting and your resume evidence to Anthropic. The default model is `claude-haiku-4-5`, changeable on the Automation page.
2. **Ollama**, when it answers a quick reachability check. Free and fully private, but slower and less reliable on small models.
3. **A deterministic template**, which is instant and always available.

The line under each cover letter names which one produced it.

### Local Ollama

Use Ollama if you want nothing to leave your machine or do not want to pay for an API.

1. Install it from [ollama.com/download](https://ollama.com/download), or `brew install ollama` on macOS.
2. Pull the default model. `gemma3:4b` needs about 4 GB of free memory and is the tested default:

   ```bash
   ollama pull gemma3:4b
   ```

   With 16 GB of memory or more, a larger model such as `gemma3:12b` writes better but is slower.
3. Start the server and leave it running:

   ```bash
   ollama serve
   ```

4. On the Automation page, set Provider to **Ollama on this Mac** and pick the model you pulled.

If `ollama serve` is not running, Scout silently falls back to the template, so check the line under a draft. Set `OLLAMA_URL` in `.env` if Ollama is not on `http://127.0.0.1:11434`.

## How job discovery works

Scout works for any role, not just design. Everything it searches for comes from the target roles in your Search profile.

**Sources.** A fresh install starts with only the three public feeds. You add the rest:

| Source | How to add it |
| --- | --- |
| Remotive, Jobicy, Himalayas | Built in. Each request searches one of your target roles. |
| Company boards (Greenhouse, Ashby, Lever) | Job sources page: paste a careers page, a job link, or a board name. Scout also adds boards it spots in fetched jobs, Exa results, and discovery pages. |
| Discovery pages | Job sources page: paste a VC portfolio or company directory. Scout reads it daily for company boards. |
| Exa | Set `EXA_API_KEY`. Searches are generated from your target roles. |
| Gmail | Set the `SCOUT_GMAIL_*` keys and send job alerts to that label. |

**Matching.** A job matches when its title contains every word of a target role ("Senior Software Engineer, Payments" matches Software Engineer), and is kept for review when it shares half of them. Lead, staff, manager, and director titles are filtered unless your target roles or seniority include them. Design searches get extra rules: other design disciplines and hardware roles are filtered, and design-adjacent titles are kept for review when the description reads like product design.

**Schedule.** A board that produces an eligible role is checked hourly. After 3 empty checks it drops to daily, and after 8 to weekly. Boards are never deleted, so a company that starts hiring again recovers on its own.

Every fetched result is saved. Open a fetch in Jobs to see which roles passed, which were filtered, and why.

## What each page does

| Page | Purpose |
| --- | --- |
| Job sources | Everywhere Scout looks and how often: Exa queries and remaining credit, public feeds, your Gmail label, and every official board grouped by check frequency. |
| Jobs | Every collected job, its score, and the fetch result explaining why it passed or was filtered. |
| Resume queue | Review tailored resumes. Approve, regenerate, or reject a draft. |
| Applications | Track submitted applications, follow-ups, and outcomes. Download a backup here. |
| Contacts | Find an evidence backed contact for a shortlisted role before you apply. |
| Search profile | Your resume, truth bank, and search preferences. The source of truth for matching and resume generation. |
| Automation | Collection times, AI provider, and model. |
| Developer logs | Per fetch step logs, timings, and counts for debugging a collection run. |

## Resume workflow

Prepare a job from the Jobs page to generate a tailored resume draft. Drafts land in the Resume queue, where each version can be expanded, regenerated, approved, or rejected. Approving a resume moves the role forward into Applications. Scout keeps earlier versions so you can compare what changed, and never lets a model invent resume claims.

## Ollama performance notes

Roughly a third of a cold local request is the model loading from disk. When Ollama is the chosen provider, Scout keeps the model loaded for 30 minutes. When it is only the fallback, the model is released after each request so it does not hold memory. Override either with `OLLAMA_KEEP_ALIVE`.

To let resume suggestions run in parallel, start the server with `OLLAMA_NUM_PARALLEL=4 ollama serve`, which was about 17 percent faster in testing. Using one model for every task avoids reloads.

Ollama has no internet access, so everything it knows comes from the job posting Scout fetched and your truth bank.

## Gmail hiring signals

Scout can read job alert email to pull out specific roles and find new company job boards to check. Configure it with these environment variables:

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

The Contacts page uses Hunter to find an evidence backed contact for a role. Set `HUNTER_API_KEY` to enable it. Scout tracks credit usage against a budget and shows the remaining allowance on the page. Without the key the page still lists opportunities, but cannot run a lookup.

## Company discovery with Exa

Scout uses [Exa](https://exa.ai) to find companies that are hiring for your role but are not
yet on any board it tracks.

Daily queries run at most once a day against the known ATS hosts
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

The queries are generated from your target roles: one daily query per role (up to four) plus one weekly open-web query. They are rebuilt whenever you save the Search profile or Automation settings.

Set the key in `.env`:

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

Set your preferred times on the Automation page, then install the macOS scheduler once:

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
