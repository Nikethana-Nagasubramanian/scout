"use client";

import { useState } from "react";

interface CoverLetterResponse {
  coverLetter?: {
    content?: string;
    generation_method?: string;
    status?: string;
    updated_at?: string;
  };
  error?: string;
}

interface CoverLetterEditorProps {
  applicationId: number;
  company: string;
  initialContent: string;
  initialMethod: string;
  initialStatus: string;
  initialCandidateNote: string;
}

export function CoverLetterEditor({
  applicationId,
  company,
  initialContent,
  initialMethod,
  initialStatus,
  initialCandidateNote,
}: CoverLetterEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [method, setMethod] = useState(initialMethod);
  const [status, setStatus] = useState(initialStatus || "not_started");
  const [candidateNote, setCandidateNote] = useState(initialCandidateNote);
  const [notice, setNotice] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = content !== savedContent;
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  async function generate(): Promise<void> {
    setGenerating(true);
    setNotice("Drafting from the company mission, role, and approved resume evidence...");
    try {
      const response = await fetch(`/api/applications/${applicationId}/cover-letter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateNote }),
      });
      const payload = await response.json() as CoverLetterResponse;
      if (!response.ok || !payload.coverLetter?.content) throw new Error(payload.error || "Cover letter generation failed");
      setContent(payload.coverLetter.content);
      setSavedContent(payload.coverLetter.content);
      setMethod(payload.coverLetter.generation_method || "Generated draft");
      setStatus(payload.coverLetter.status || "draft");
      setNotice("Draft generated. Read it aloud, edit anything that does not sound like you, then save.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Cover letter generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function save(): Promise<void> {
    setSaving(true);
    setNotice("Saving...");
    try {
      const response = await fetch(`/api/applications/${applicationId}/cover-letter`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = await response.json() as CoverLetterResponse;
      if (!response.ok || !payload.coverLetter?.content) throw new Error(payload.error || "Cover letter could not be saved");
      setSavedContent(payload.coverLetter.content);
      setContent(payload.coverLetter.content);
      setMethod(payload.coverLetter.generation_method || method);
      setStatus(payload.coverLetter.status || "edited");
      setNotice("Saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Cover letter could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function copy(): Promise<void> {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setNotice("Copied to clipboard.");
    } catch {
      setNotice("Clipboard access was unavailable. Select and copy the text manually.");
    }
  }

  return (
    <details className="cover-letter-workspace">
      <summary>
        <span>
          <strong>Cover letter</strong>
          <small>{content ? `${wordCount} words · ${dirty ? "Unsaved edits" : status.replaceAll("_", " ")}` : "Generate a role-specific draft"}</small>
        </span>
        <span className="cover-letter-company">{company}</span>
      </summary>
      <div className="cover-letter-body">
        <div className="cover-letter-intro">
          <p>Scout uses the company mission, role requirements, and the approved resume linked to this application. It does not invent personal connections or experience.</p>
          {method ? <small>{method}</small> : null}
        </div>
        <label className="cover-letter-interest-note">
          <span>Why this company? <small>Optional, but this is what makes the letter sound like you.</small></span>
          <textarea
            aria-label={`Why ${company} interests you`}
            onChange={(event) => setCandidateNote(event.target.value)}
            placeholder="Example: Their focus on transparent financial products feels close to my trust-focused work at Inrupt."
            rows={3}
            value={candidateNote}
          />
        </label>
        {content ? (
          <textarea
            aria-label={`Cover letter for ${company}`}
            className="cover-letter-content"
            onChange={(event) => setContent(event.target.value)}
            rows={16}
            value={content}
          />
        ) : null}
        <div className="cover-letter-actions">
          <button className="button secondary small" disabled={generating || saving} onClick={generate} type="button">
            {generating ? <><span className="spinner" aria-hidden="true" /> Drafting...</> : content ? "Regenerate" : "Generate cover letter"}
          </button>
          {content ? <button className="button small" disabled={!dirty || generating || saving} onClick={save} type="button">{saving ? "Saving..." : "Save"}</button> : null}
          {content ? <button className="button ghost small" onClick={copy} type="button">Copy</button> : null}
          {savedContent ? <a className="button ghost small" href={`/api/applications/${applicationId}/cover-letter/pdf`}>Download PDF</a> : null}
          {content ? <span className="job-meta">{wordCount} words</span> : null}
        </div>
        {notice ? <p className="cover-letter-notice" aria-live="polite">{notice}</p> : null}
      </div>
    </details>
  );
}
