# Scout

Scout is a private job search app for one candidate. It collects jobs, scores matches, prepares resume drafts, and tracks applications.

Job discovery starts from the role, location, seniority, and experience saved during onboarding. Remotive, Jobicy, and Himalayas are built in and do not require an API key. Company Greenhouse and Lever boards are optional watchlist sources.

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

## Ollama

Ollama is optional. Enable it on the Settings page to prioritize existing resume evidence without sending the resume off the Mac.

```bash
ollama pull llama3.2:3b
ollama serve
```

Scout works without Ollama and never lets the model invent resume claims.

## Automatic job collection

Set your preferred times on the Settings page, then install the macOS scheduler once:

```bash
pnpm scheduler:install
```

Remove it with:

```bash
pnpm scheduler:remove
```

## Data

Your profile, jobs, and applications are stored locally in:

```text
data/job-copilot.sqlite
```

Use the Applications page to download a backup.

## Check the app

```bash
pnpm verify
```
