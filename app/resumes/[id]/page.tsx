import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/database";

export const dynamic = "force-dynamic";

interface ResumeEditorPageProps {
  params: Promise<{ id: string }>;
}

export default async function ResumeEditorPage({ params }: ResumeEditorPageProps) {
  const { id } = await params;
  const row = db.prepare("SELECT job_id FROM resume_versions WHERE id = ?").get(Number(id)) as { job_id: number } | undefined;
  if (!row) notFound();
  redirect(`/jobs/${row.job_id}?tab=resume`);
}
