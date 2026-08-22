"use client";

import { useRouter } from "next/navigation";
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
  defaultOpen?: boolean;
  approvalFormId?: string;
  workspaceMode?: boolean;
}

export function CoverLetterEditor({
  applicationId,
  company,
  initialContent,
  initialMethod,
  initialStatus,
  initialCandidateNote,
  defaultOpen = false,
  approvalFormId,
  workspaceMode = false,
}: CoverLetterEditorProps) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [method, setMethod] = useState(initialMethod);
  const [status, setStatus] = useState(initialStatus || "not_started");
  const [candidateNote, setCandidateNote] = useState(initialCandidateNote);
  const [notice, setNotice] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(defaultOpen);
  const dirty = content !== savedContent;
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const editorFormId = `cover-letter-editor-${applicationId}`;

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
      router.refresh();
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
      router.refresh();
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

  const body = (
    <form
      className="cover-letter-body"
      id={editorFormId}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="cover-letter-interest-heading">
        <h2>Why are you interested in {company}? <span>(optional)</span></h2>
        <p>A line or two in your own words makes the letter sound like you. Or leave it blank and Scout reads {company}&apos;s site for its mission and values, then writes the angle from those and your approved resume.</p>
      </div>

      {!content ? (
        <label className="cover-letter-interest-note">
          <span className="sr-only">Why {company} interests you</span>
          <textarea
            aria-label={`Why ${company} interests you`}
            onChange={(event) => setCandidateNote(event.target.value)}
            placeholder={`Their focus on improving customer experience feels similar to my work at GrowthFactor`}
            rows={4}
            value={candidateNote}
          />
        </label>
      ) : candidateNote.trim() ? null : (
        <p className="cover-letter-origin-note">You did not add a note, so Scout wrote the opening from {company}&apos;s mission and values plus your approved resume. Edit anything before saving.</p>
      )}

      {content ? (
        <textarea
          aria-label={`Cover letter for ${company}`}
          className="cover-letter-content"
          form={approvalFormId}
          name="cover_letter_content"
          onChange={(event) => setContent(event.target.value)}
          rows={16}
          value={content}
        />
      ) : null}

      <div className="cover-letter-actions">
        {content ? (
          <button className="button cover-letter-primary" disabled={!dirty || generating || saving} type="submit">
            {saving ? "Saving..." : "Save Cover Letter"}
          </button>
        ) : (
          <button className="button cover-letter-primary" disabled={generating || saving} onClick={generate} type="button">
            {generating ? <><span className="spinner" aria-hidden="true" /> Drafting...</> : "Generate Cover Letter"}
          </button>
        )}
        {content ? <button className="button secondary" disabled={generating || saving} onClick={generate} type="button">Regenerate</button> : null}
        <span className="cover-letter-trust-note">Scout never invents personal connections or experience.</span>
        {content ? <button className="button ghost cover-letter-utility" onClick={copy} type="button">Copy</button> : null}
        {savedContent ? <a className="button ghost cover-letter-utility" href={`/api/applications/${applicationId}/cover-letter/pdf`}>PDF</a> : null}
      </div>
      {method && content ? <small className="cover-letter-method">{method} · {wordCount} words · {dirty ? "Unsaved edits" : status.replaceAll("_", " ")}</small> : null}
      {notice ? <p className="cover-letter-notice" aria-live="polite">{notice}</p> : null}
    </form>
  );

  if (workspaceMode) return <section className="cover-letter-workspace cover-letter-workspace-page">{body}</section>;

  return (
    <details className="cover-letter-workspace" onToggle={(event) => setExpanded(event.currentTarget.open)} open={expanded}>
      <summary>
        <span>
          <strong>Cover letter</strong>
          <small>{content ? `${wordCount} words · ${dirty ? "Unsaved edits" : status.replaceAll("_", " ")}` : "Generate a role-specific draft"}</small>
        </span>
        <span className="cover-letter-company">{company}</span>
      </summary>
      {body}
    </details>
  );
}
