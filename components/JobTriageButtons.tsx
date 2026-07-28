"use client";

import { useFormStatus } from "react-dom";
import { approveJobAction, updateJobStatusAction } from "@/app/actions";

function TriageButton({
  icon,
  label,
  className,
}: {
  icon: string;
  label: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} title={label} aria-label={label}>
      {pending ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">{icon}</span>}
    </button>
  );
}

export function JobTriageButtons({ jobId }: { jobId: number }) {
  return (
    <div className="triage-actions" aria-label="Job decision">
      <form action={approveJobAction}>
        <input type="hidden" name="id" value={jobId} />
        <TriageButton icon="👍" label="Relevant, prepare application" className="triage-button approve" />
      </form>
      <form action={updateJobStatusAction}>
        <input type="hidden" name="id" value={jobId} />
        <input type="hidden" name="status" value="irrelevant" />
        <TriageButton icon="👎" label="Irrelevant, remove from active jobs" className="triage-button reject" />
      </form>
    </div>
  );
}
