"use client";

import { useFormStatus } from "react-dom";

export function ResumeSubmitButton({
  children,
  className = "button",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} aria-busy={pending}>
      {pending ? <><span className="spinner" aria-hidden="true" /> Generating resume...</> : children}
    </button>
  );
}
