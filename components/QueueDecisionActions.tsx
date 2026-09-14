"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createApplicationAction, updateResumeStatusAction } from "@/app/actions";

export function QueueMarkAppliedButton({ jobId, resumeId }: { jobId: number; resumeId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function markApplied() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("job_id", String(jobId));
      formData.set("resume_id", String(resumeId));
      await createApplicationAction(formData);
      toast.success("Marked applied", { description: "The application is now tracked in Applications." });
      router.refresh();
    });
  }

  return <button className="button queue-primary" type="button" onClick={markApplied} disabled={isPending}>Mark applied</button>;
}

export function QueueRejectButton({ resumeId }: { resumeId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function reject() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", String(resumeId));
      formData.set("status", "rejected");
      await updateResumeStatusAction(formData);
      toast("Removed from queue", { description: "The tailored resume was moved to Rejected." });
      router.refresh();
    });
  }

  return <button className="queue-utility queue-utility-button queue-reject" type="button" onClick={reject} disabled={isPending}>Reject</button>;
}
