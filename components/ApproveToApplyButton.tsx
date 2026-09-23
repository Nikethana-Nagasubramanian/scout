"use client";

import { useFormStatus } from "react-dom";
import { Spinner } from "@/components/UI";

export function ApproveToApplyButton({
  children,
  className = "button",
  disabled = false,
  pendingLabel = "Approving...",
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? <><Spinner /> {pendingLabel}</> : children}
    </button>
  );
}
