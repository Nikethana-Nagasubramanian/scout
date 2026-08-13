"use client";

import { useFormStatus } from "react-dom";

export function ContactSearchButton({
  children,
  disabled = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="button secondary small"
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
    >
      {pending ? "Researching public evidence..." : children}
    </button>
  );
}
