import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, StatusPill } from "@/components/UI";
import { ResumeEditor } from "@/components/ResumeEditor";
import { db } from "@/lib/database";
import type { ResumeContent } from "@/lib/types";
import { safeJson } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ResumeEditorPageProps {
  params: Promise<{ id: string }>;
}

interface ResumeEditorRow {
  id: number;
  job_id: number;
  status: string;
  content_json: string;
  title: string;
  company: string;
  description: string;
  apply_url: string;
  application_status: string | null;
}

export default async function ResumeEditorPage({ params }: ResumeEditorPageProps) {
  const { id } = await params;
  const row = db.prepare(`
    SELECT resume_versions.id, resume_versions.job_id, resume_versions.status, resume_versions.content_json,
      jobs.title, jobs.company, jobs.description, jobs.apply_url,
      applications.status AS application_status
    FROM resume_versions
    JOIN jobs ON jobs.id = resume_versions.job_id
    LEFT JOIN applications ON applications.job_id = jobs.id
    WHERE resume_versions.id = ?
  `).get(Number(id)) as ResumeEditorRow | undefined;
  if (!row) notFound();

  const content = safeJson<ResumeContent>(row.content_json, {
    candidateName: "",
    contactLine: "",
    targetTitle: row.title,
    summary: "",
    skills: [],
    facts: [],
    sections: [],
    audit: { selectedFactIds: [], includedKeywords: [], unsupportedKeywords: [] },
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow={`${row.company} · ${row.title}`}
        title="Prepare application"
        description="Review the tailored resume, approve it, open the company application, and record the result."
      >
        <Link className="button secondary" href={`/jobs/${row.job_id}`}>View job</Link>
        <StatusPill status={row.status} />
      </PageHeader>
      <ResumeEditor
        resumeId={row.id}
        resumeStatus={row.status}
        jobId={row.job_id}
        initialContent={content}
        jobDescription={row.description}
        jobTitle={row.title}
        company={row.company}
        applyUrl={row.apply_url}
        applicationStatus={row.application_status}
      />
    </div>
  );
}
