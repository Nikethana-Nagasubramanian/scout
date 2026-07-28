# Scout build goals

Scout is organized as goals so each unit of work has a measurable outcome and can be executed independently in goal mode.

## Goal 1: Establish the local single-candidate foundation

Outcome: One lightweight application runs on an M1 MacBook Air with one SQLite file and no account system.

Acceptance checks:

- Next.js runs the interface and server from one process.
- SQLite stores one candidate profile.
- First launch redirects to onboarding.
- Personal data, generated resumes, logs, and secrets are ignored by Git.
- A repository check fails if an em dash character is introduced.

## Goal 2: Build the candidate onboarding and truth bank

Outcome: The candidate can define the search once, then update verified facts without creating additional users.

Acceptance checks:

- Onboarding captures identity, roles, seniority, skills, locations, workplace preferences, compensation, authorization, sponsorship, resume text, and links.
- Resume bullets are imported into the truth bank on first setup.
- The candidate can add and remove verified facts.
- Resume generation excludes unverified facts.

## Goal 3: Collect and normalize job opportunities

Outcome: The app can retrieve public company jobs and accept manual job descriptions.

Acceptance checks:

- Greenhouse and Lever source adapters work independently.
- Manual job import is available.
- Source errors do not stop healthy sources.
- Repeated collection updates existing records instead of creating duplicates.
- Collection history reports found, added, updated, and failed records.

## Goal 4: Rank jobs and create an approval queue

Outcome: The candidate sees a manageable list of explainable matches.

Acceptance checks:

- Sponsorship, location, and compensation hard filters show their reasons.
- Match scores expose title, skill, seniority, location, recency, and compensation components.
- The queue threshold is configurable.
- The candidate can shortlist, dismiss, search, and filter jobs.

## Goal 5: Generate truth-bound resume versions

Outcome: A shortlisted job can produce an ATS-friendly resume draft without invented claims.

Acceptance checks:

- Every included achievement maps to a verified truth-bank fact.
- Relevant verified skills are prioritized.
- Unsupported keywords are reported instead of inserted.
- Drafts require approval.
- Approved drafts export to PDF and DOCX.

## Goal 5A: Estimate posting confidence as a supporting signal

Outcome: The candidate can consider whether a posting appears current and specific without treating the score as proof.

Acceptance checks:

- Posting confidence is separate from candidate fit.
- The score uses source integrity, freshness, completeness, description specificity, repeated sightings, and recent local company activity.
- Stale, brief, or poorly observed postings show caution signals.
- Every score shows low, medium, or high data sufficiency.
- The interface states that confidence is an aid and not a claim that the job is genuine.
- External company signals remain out of the score until their usefulness can be validated.

## Goal 6: Track applications and funnel outcomes

Outcome: Every approved opportunity has a visible next step and outcome.

Acceptance checks:

- The tracker covers ready, applied, follow-up, screen, interview, rejection, withdrawal, offer, and archive states.
- Contact information, notes, application time, and follow-up time are editable.
- Dashboard metrics summarize the search.
- Application records export to CSV.
- The local database can be downloaded as a backup.

## Goal 7: Run manual and automatic collection windows

Outcome: The candidate can control the whole workflow from settings or let macOS run selected windows.

Acceptance checks:

- Manual and Automatic modes are available.
- Morning, afternoon, evening, and night slots have independent enable switches and times.
- Every slot has a manual Run button.
- Fetch new jobs collects, deduplicates, scores, and refreshes the queue.
- The background tick is idle when Automatic mode is off.

## Goal 8: Transfer and verify the app on the second M1 Mac

Outcome: The app and its private data can move to another M1 Mac without a cloud migration.

Acceptance checks:

- Setup and transfer commands are documented.
- The app supports a current Node 20, 22, or 24 release.
- Type checks, lint, tests, production build, and the character safeguard pass.
- The scheduler can be installed and removed without editing the application.
