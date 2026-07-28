"use client";

import { useFormStatus } from "react-dom";

export function WorkflowSubmitButton({
  children,
  className = "button",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Fetching jobs..." : children}
    </button>
  );
}
