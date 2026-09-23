"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const OPEN_EVENT = "scout:open-job-drawer";

export interface JobDrawerSummary {
  id: number;
  title: string;
  company: string;
  location: string;
}

interface JobDrawerDetail extends JobDrawerSummary {
  score: number | null;
  workplaceType: string | null;
  employmentType: string | null;
  applyUrl: string | null;
  sourceName: string | null;
  description: string;
  enriched: boolean;
  roughRead: boolean;
}

/** The job title on a result row. Opens the single shared drawer rather than navigating. */
export function JobTitleButton({ job }: { job: JobDrawerSummary }) {
  return (
    <button
      className="jobs-result-title"
      onClick={() => window.dispatchEvent(new CustomEvent<JobDrawerSummary>(OPEN_EVENT, { detail: job }))}
      type="button"
    >
      {job.title}
    </button>
  );
}

/** Split the fetched description into paragraphs; feeds arrive as one long run of text. */
function descriptionParagraphs(description: string): string[] {
  return description
    .split(/\n{2,}|(?<=[.!?])\s{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function JobDrawer() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const [summary, setSummary] = useState<JobDrawerSummary | null>(null);
  const [detail, setDetail] = useState<JobDrawerDetail | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const closeDrawer = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || !dialog.open || dialog.classList.contains("is-closing")) return;
    dialog.classList.add("is-closing");
    closeTimerRef.current = window.setTimeout(() => {
      dialog.close();
      dialog.classList.remove("is-closing");
      closeTimerRef.current = null;
    }, 180);
  }, []);

  useEffect(() => {
    function handleOpen(event: Event) {
      const job = (event as CustomEvent<JobDrawerSummary>).detail;
      // Keep the header visible immediately; only the description body waits on the fetch.
      setSummary(job);
      setDetail(null);
      setState("loading");
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      dialogRef.current?.classList.remove("is-closing");
      if (!dialogRef.current?.open) dialogRef.current?.showModal();

      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      fetch(`/api/jobs/${job.id}/description`)
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Request failed"))))
        .then((data: JobDrawerDetail) => {
          if (requestRef.current !== requestId) return;
          setDetail(data);
          setState("idle");
        })
        .catch(() => {
          if (requestRef.current !== requestId) return;
          setState("error");
        });
    }

    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    closeDrawer();
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const clickedOutside = event.clientX < bounds.left
      || event.clientX > bounds.right
      || event.clientY < bounds.top
      || event.clientY > bounds.bottom;
    if (clickedOutside) closeDrawer();
  }

  const paragraphs = detail ? descriptionParagraphs(detail.description) : [];
  const facts = [
    detail?.workplaceType,
    detail?.employmentType,
    detail?.sourceName ? `via ${detail.sourceName}` : null,
  ].filter(Boolean) as string[];

  return (
    <dialog
      aria-labelledby="job-drawer-title"
      className="job-drawer-dialog"
      onCancel={handleCancel}
      onMouseDown={handleBackdropClick}
      ref={dialogRef}
    >
      <div className="job-drawer">
        <header className="job-drawer-header">
          <div>
            <p className="job-drawer-eyebrow">Job description</p>
            <h2 id="job-drawer-title">{summary?.title || "Job"}</h2>
            <p>{summary?.company}{summary?.location ? ` · ${summary.location}` : ""}</p>
            {facts.length ? <p className="job-drawer-facts">{facts.join(" · ")}</p> : null}
          </div>
          <button aria-label="Close job description" className="job-drawer-close" onClick={closeDrawer} type="button">×</button>
        </header>

        <div className="job-drawer-body">
          {state === "loading" ? (
            <p className="muted">Loading the description…</p>
          ) : state === "error" ? (
            <p className="muted">Scout could not load this description. Open the posting to read it in full.</p>
          ) : paragraphs.length ? (
            <>
              {detail?.enriched ? <p className="job-drawer-note">Fetched the full description from the posting and saved it.</p> : null}
              {detail?.roughRead ? <p className="job-drawer-note is-caution">This posting has no structured description, so this is a rough read of the page and was not saved. Open the posting for the real thing.</p> : null}
              {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </>
          ) : (
            <p className="muted">This source did not provide a description, and the posting could not be read.</p>
          )}
        </div>

        <footer className="job-drawer-footer">
          {detail?.applyUrl ? (
            <a className="button secondary small" href={detail.applyUrl} rel="noreferrer" target="_blank">Open posting</a>
          ) : null}
          {summary ? <a className="button small" href={`/jobs/${summary.id}`}>Review this role</a> : null}
        </footer>
      </div>
    </dialog>
  );
}
