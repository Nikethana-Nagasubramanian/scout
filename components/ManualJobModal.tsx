"use client";

import { useRef } from "react";
import { addManualJobAction } from "@/app/actions";

export function ManualJobModal() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  function openDialog() {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    dialogRef.current?.classList.remove("is-closing");
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    const dialog = dialogRef.current;
    if (!dialog || !dialog.open || dialog.classList.contains("is-closing")) return;
    dialog.classList.add("is-closing");
    closeTimerRef.current = window.setTimeout(() => {
      dialog.close();
      dialog.classList.remove("is-closing");
      closeTimerRef.current = null;
    }, 180);
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const clickedOutside = event.clientX < bounds.left
      || event.clientX > bounds.right
      || event.clientY < bounds.top
      || event.clientY > bounds.bottom;
    if (clickedOutside) closeDialog();
  }

  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    closeDialog();
  }

  return (
    <>
      <button className="button secondary manual-job-trigger" onClick={openDialog} type="button">
        Import job manually
      </button>
      <dialog
        aria-labelledby="manual-job-title"
        className="manual-job-dialog"
        onCancel={handleCancel}
        onMouseDown={handleBackdropClick}
        ref={dialogRef}
      >
        <div className="manual-job-modal">
          <header className="manual-job-modal-header">
            <div>
              <p className="manual-job-eyebrow">Manual import</p>
              <h2 id="manual-job-title">Import a job</h2>
              <p>Paste the posting details and Scout will score it against your search profile.</p>
            </div>
            <button aria-label="Close manual job import" className="manual-job-close" onClick={closeDialog} type="button">×</button>
          </header>
          <form action={addManualJobAction} className="manual-job-form">
            <div className="manual-job-grid">
              <div className="manual-job-field">
                <label htmlFor="manual-company">Company <span aria-hidden="true">*</span></label>
                <input autoComplete="organization" id="manual-company" name="company" required />
              </div>
              <div className="manual-job-field">
                <label htmlFor="manual-title">Job title <span aria-hidden="true">*</span></label>
                <input id="manual-title" name="title" required />
              </div>
              <div className="manual-job-field">
                <label htmlFor="manual-location">Location</label>
                <input id="manual-location" name="location" placeholder="New York, NY" />
              </div>
              <div className="manual-job-field">
                <label htmlFor="manual-url">Job URL <span aria-hidden="true">*</span></label>
                <input id="manual-url" name="url" placeholder="https://company.com/careers/role" required type="url" />
              </div>
              <div className="manual-job-field">
                <label htmlFor="manual-workplace-type">Workplace</label>
                <select defaultValue="unspecified" id="manual-workplace-type" name="workplace_type">
                  <option value="unspecified">Not specified</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="on-site">On-site</option>
                </select>
              </div>
              <div className="manual-job-field">
                <label htmlFor="manual-employment-type">Employment type</label>
                <input id="manual-employment-type" name="employment_type" placeholder="Full-time" />
              </div>
              <div className="manual-job-field full">
                <label htmlFor="manual-description">Job description</label>
                <textarea id="manual-description" name="description" placeholder="Paste the complete job description" rows={9} />
              </div>
            </div>
            <div className="manual-job-actions">
              <button className="button secondary" onClick={closeDialog} type="button">Cancel</button>
              <button className="button" type="submit">Import and score</button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
