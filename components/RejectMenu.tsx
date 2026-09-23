"use client";

import { useEffect, useRef, useState } from "react";
import { rejectJobAction } from "@/app/actions";
import { REJECTION_REASONS } from "@/lib/rejection-reasons";

/**
 * Reject always asks why. The reason is the only thing that lets Scout stop showing
 * roles like this one, so there is no reason-less path.
 */
export function RejectMenu({ jobId }: { jobId: number }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="reject-menu" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="button ghost small danger-text reject-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        Reject
        <span aria-hidden="true" className="reject-menu-caret" />
      </button>
      {open ? (
        <div className="reject-menu-panel" role="menu">
          <p className="reject-menu-label">Why is this not a fit?</p>
          {REJECTION_REASONS.map((reason) => (
            <form action={rejectJobAction} key={reason.value}>
              <input type="hidden" name="id" value={jobId} />
              <input type="hidden" name="reason" value={reason.value} />
              <button className="reject-menu-item" role="menuitem" type="submit">{reason.label}</button>
            </form>
          ))}
        </div>
      ) : null}
    </div>
  );
}
