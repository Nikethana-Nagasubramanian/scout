"use client";

import { useState } from "react";
import { createApplicationAction, saveAndApproveResumeAction, saveResumeContentAction } from "@/app/actions";
import type { ResumeBulletSuggestion, ResumeRewriteTarget } from "@/lib/local-ai";
import { flattenSkillCategories, normalizeResumeSkills, resumeSkillCategories } from "@/lib/resume-skills";
import type { ResumeContent } from "@/lib/types";

interface ResumeEditorProps {
  resumeId: number;
  resumeStatus: string;
  jobId: number;
  initialContent: ResumeContent;
  jobDescription: string;
  jobTitle: string;
  company: string;
  applyUrl: string;
  applicationStatus: string | null;
  embedded?: boolean;
}

type ResumeLine = NonNullable<ResumeContent["sections"]>[number]["lines"][number];
type RewriteRequest = { keyword: string; targetValue: string; userEvidence: string };

const atsKeywords = [
  "A/B testing",
  "accessibility",
  "agile",
  "AI",
  "analytics",
  "audit",
  "B2B",
  "collaboration",
  "data visualization",
  "design systems",
  "enterprise",
  "Figma",
  "information architecture",
  "interaction design",
  "leadership",
  "mobile",
  "product design",
  "product strategy",
  "prototyping",
  "React",
  "research",
  "SaaS",
  "stakeholder management",
  "strategy",
  "TypeScript",
  "usability testing",
  "user experience",
  "user research",
  "visual design",
  "workshops",
];

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

export function ResumeEditor({
  resumeId,
  resumeStatus,
  jobId,
  initialContent,
  jobDescription,
  jobTitle,
  company,
  applyUrl,
  applicationStatus,
  embedded = false,
}: ResumeEditorProps) {
  const [content, setContent] = useState<ResumeContent>({
    ...initialContent,
    skills: normalizeResumeSkills(initialContent.skills),
    skillCategories: resumeSkillCategories(initialContent, jobDescription),
    sections: initialContent.sections || [],
  });
  const [view, setView] = useState<"pdf" | "edit">("pdf");
  const [addingKeyword, setAddingKeyword] = useState<string | null>(null);
  const [keywordNotice, setKeywordNotice] = useState("");
  const [keywordSuggestion, setKeywordSuggestion] = useState<ResumeBulletSuggestion | null>(null);
  const [rewriteRequest, setRewriteRequest] = useState<RewriteRequest | null>(null);
  const [pdfVersion, setPdfVersion] = useState(0);
  const resumeText = normalized([
    content.summary,
    content.skills.join(" "),
    ...(content.sections || []).flatMap((section) => section.lines.map((line) => line.text)),
  ].join(" "));
  const jobText = normalized(jobDescription);
  const relevantKeywords = [...new Set([...atsKeywords, ...content.skills])]
    .filter((keyword) => jobText.includes(normalized(keyword)));
  const keywordAnalysis = relevantKeywords.map((keyword) => {
    const cleanKeyword = normalized(keyword);
    if (resumeText.includes(cleanKeyword)) return { keyword, status: "present" as const };
    const tokens = cleanKeyword.split(" ").filter((token) => token.length > 2);
    if (tokens.length > 1 && tokens.some((token) => resumeText.includes(token))) return { keyword, status: "partial" as const };
    return { keyword, status: "missing" as const };
  });
  const presentCount = keywordAnalysis.filter((item) => item.status === "present").length;
  const partialCount = keywordAnalysis.filter((item) => item.status === "partial").length;
  const coverage = keywordAnalysis.length
    ? Math.round(((presentCount + partialCount * 0.5) / keywordAnalysis.length) * 100)
    : 100;
  const applicationRecorded = Boolean(applicationStatus && applicationStatus !== "ready_to_apply");
  const resumeApproved = resumeStatus === "approved" || applicationRecorded;
  const workflowSteps = [
    { label: "Job", state: "complete" },
    { label: "Prepare", state: "complete" },
    { label: "Resume", state: resumeApproved ? "complete" : "current" },
    { label: "Approve", state: resumeApproved ? "complete" : "upcoming" },
    { label: "Apply", state: applicationRecorded ? "complete" : resumeApproved ? "current" : "upcoming" },
    { label: "Track", state: applicationRecorded ? "complete" : "upcoming" },
  ];
  const rewriteTargetOptions = [
    { value: "summary", label: "Summary" },
    ...(content.sections || []).flatMap((section, sectionIndex) => /experience/i.test(section.title)
      ? section.lines.flatMap((line, lineIndex) => line.kind === "entry" && line.text.trim()
        ? [{ value: `experience:${sectionIndex}:${lineIndex}`, label: line.text.trim() }]
        : [])
      : []),
  ];

  function updateSectionLine(sectionIndex: number, lineIndex: number, text: string): void {
    const sections = (content.sections || []).map((section, currentSectionIndex) => currentSectionIndex === sectionIndex
      ? {
          ...section,
          lines: section.lines.map((line, currentLineIndex) => currentLineIndex === lineIndex ? { ...line, text } : line),
        }
      : section);
    setContent({ ...content, sections });
  }

  function addBullet(sectionIndex: number): void {
    addLine(sectionIndex, "bullet");
  }

  function addLine(sectionIndex: number, kind: ResumeLine["kind"], afterIndex?: number): void {
    const sections = (content.sections || []).map((section, currentSectionIndex) => currentSectionIndex === sectionIndex
      ? {
          ...section,
          lines: afterIndex === undefined
            ? [...section.lines, { text: "", kind }]
            : [
                ...section.lines.slice(0, afterIndex + 1),
                { text: "", kind },
                ...section.lines.slice(afterIndex + 1),
              ],
        }
      : section);
    setContent({ ...content, sections });
  }

  function removeLine(sectionIndex: number, lineIndex: number): void {
    const sections = (content.sections || []).map((section, currentSectionIndex) => currentSectionIndex === sectionIndex
      ? { ...section, lines: section.lines.filter((_, currentLineIndex) => currentLineIndex !== lineIndex) }
      : section);
    setContent({ ...content, sections });
  }

  function updateSkillCategory(index: number, field: "name" | "skills", value: string): void {
    const skillCategories = (content.skillCategories || []).map((category, categoryIndex) => categoryIndex === index
      ? {
          ...category,
          [field]: field === "skills" ? normalizeResumeSkills(value.split(",")) : value,
        }
      : category);
    setContent({
      ...content,
      skillCategories,
      skills: flattenSkillCategories(skillCategories),
    });
  }

  function addSkillCategory(): void {
    const skillCategories = [
      ...(content.skillCategories || []),
      { name: "New category", skills: [] },
    ];
    setContent({ ...content, skillCategories, skills: flattenSkillCategories(skillCategories) });
  }

  function removeSkillCategory(index: number): void {
    const skillCategories = (content.skillCategories || []).filter((_, categoryIndex) => categoryIndex !== index);
    setContent({ ...content, skillCategories, skills: flattenSkillCategories(skillCategories) });
  }

  function moveSkillCategory(index: number, direction: "up" | "down"): void {
    const skillCategories = [...(content.skillCategories || [])];
    const targetIndex = direction === "up"
      ? Math.max(0, index - 1)
      : Math.min(skillCategories.length - 1, index + 1);
    if (targetIndex === index) return;
    const [category] = skillCategories.splice(index, 1);
    skillCategories.splice(targetIndex, 0, category);
    setContent({ ...content, skillCategories, skills: flattenSkillCategories(skillCategories) });
  }

  function updateLineKind(sectionIndex: number, lineIndex: number, kind: ResumeLine["kind"]): void {
    const sections = (content.sections || []).map((section, currentSectionIndex) => currentSectionIndex === sectionIndex
      ? {
          ...section,
          lines: section.lines.map((line, currentLineIndex) => currentLineIndex === lineIndex ? { ...line, kind } : line),
        }
      : section);
    setContent({ ...content, sections });
  }

  function moveLine(sectionIndex: number, lineIndex: number, destination: "up" | "down" | "top"): void {
    const sections = (content.sections || []).map((section, currentSectionIndex) => {
      if (currentSectionIndex !== sectionIndex) return section;
      const lines = [...section.lines];
      const targetIndex = destination === "top"
        ? 0
        : destination === "up"
          ? Math.max(0, lineIndex - 1)
          : Math.min(lines.length - 1, lineIndex + 1);
      if (targetIndex === lineIndex) return section;
      const [line] = lines.splice(lineIndex, 1);
      lines.splice(targetIndex, 0, line);
      return { ...section, lines };
    });
    setContent({ ...content, sections });
  }

  function beginKeywordRewrite(keyword: string): void {
    setRewriteRequest({ keyword, targetValue: "summary", userEvidence: "" });
    setKeywordSuggestion(null);
    setKeywordNotice("");
  }

  async function suggestKeywordRewrite(): Promise<void> {
    if (!rewriteRequest) return;
    const [kind, sectionIndex, entryLineIndex] = rewriteRequest.targetValue.split(":");
    const target: ResumeRewriteTarget = kind === "summary"
      ? { kind: "summary" }
      : {
          kind: "experience",
          sectionIndex: Number(sectionIndex),
          entryLineIndex: Number(entryLineIndex),
        };
    setAddingKeyword(rewriteRequest.keyword);
    setKeywordNotice("");
    setKeywordSuggestion(null);
    try {
      const response = await fetch(`/api/resumes/${resumeId}/suggestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: rewriteRequest.keyword,
          content,
          target,
          userEvidence: rewriteRequest.userEvidence,
        }),
      });
      const result = await response.json() as { suggestion?: ResumeBulletSuggestion; error?: string };
      if (!response.ok || !result.suggestion) {
        throw new Error(result.error || "The rewrite could not be suggested");
      }
      if (!result.suggestion.supported) {
        setKeywordNotice(`Scout did not find a defensible rewrite for ${rewriteRequest.keyword} in that target. ${result.suggestion.reason}`);
        return;
      }
      setKeywordSuggestion(result.suggestion);
      setRewriteRequest(null);
    } catch (error) {
      setKeywordNotice(error instanceof Error ? error.message : "The rewrite could not be suggested");
    } finally {
      setAddingKeyword(null);
    }
  }

  async function acceptKeywordRewrite(): Promise<void> {
    if (!keywordSuggestion?.supported) return;
    const sourceText = keywordSuggestion.targetKind === "summary"
      ? content.summary
      : content.sections?.[keywordSuggestion.sectionIndex]?.lines[keywordSuggestion.lineIndex]?.text;
    if (sourceText !== keywordSuggestion.originalBullet) {
      setKeywordNotice("The source passage changed after this suggestion was generated. Request a fresh suggestion.");
      setKeywordSuggestion(null);
      return;
    }
    const sections = keywordSuggestion.targetKind === "line"
      ? (content.sections || []).map((section, sectionIndex) => sectionIndex === keywordSuggestion.sectionIndex
          ? {
              ...section,
              lines: section.lines.map((line, lineIndex) => lineIndex === keywordSuggestion.lineIndex
                ? { ...line, text: keywordSuggestion.suggestedBullet }
                : line),
            }
          : section)
      : content.sections;
    const normalizedKeyword = normalized(keywordSuggestion.keyword);
    const nextContent: ResumeContent = {
      ...content,
      summary: keywordSuggestion.targetKind === "summary" ? keywordSuggestion.suggestedBullet : content.summary,
      sections,
      highlightedKeywords: [
        ...(content.highlightedKeywords || []).filter((item) => normalized(item) !== normalizedKeyword),
        keywordSuggestion.keyword,
      ],
      audit: {
        ...content.audit,
        includedKeywords: [
          ...content.audit.includedKeywords.filter((item) => normalized(item) !== normalizedKeyword),
          keywordSuggestion.keyword,
        ],
        unsupportedKeywords: content.audit.unsupportedKeywords.filter((item) => normalized(item) !== normalizedKeyword),
      },
    };
    setAddingKeyword(keywordSuggestion.keyword);
    setKeywordNotice("");
    try {
      const response = await fetch(`/api/resumes/${resumeId}/suggestion`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: nextContent }),
      });
      const result = await response.json() as { content?: ResumeContent; error?: string };
      if (!response.ok || !result.content) throw new Error(result.error || "The rewrite could not be saved");
      setContent(result.content);
      setKeywordNotice(`${keywordSuggestion.keyword} was added to an existing achievement after your approval.`);
      setKeywordSuggestion(null);
      setPdfVersion((version) => version + 1);
      setView("pdf");
    } catch (error) {
      setKeywordNotice(error instanceof Error ? error.message : "The rewrite could not be saved");
    } finally {
      setAddingKeyword(null);
    }
  }

  return (
    <form action={saveResumeContentAction} className={`resume-workspace${embedded ? " embedded" : ""}`}>
      <input type="hidden" name="id" value={resumeId} />
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="resume_id" value={resumeId} />
      <input type="hidden" name="content_json" value={JSON.stringify(content)} readOnly />
      {!embedded ? <ol className="application-progress" aria-label="Application preparation progress">
        {workflowSteps.map((step, index) => (
          <li className={step.state} key={step.label}>
            <span>{step.state === "complete" ? "✓" : index + 1}</span>
            <small>{step.label}</small>
          </li>
        ))}
      </ol> : null}
      <div className="editor-toolbar">
        <div className="view-switcher" aria-label="Resume view">
          <button className={view === "pdf" ? "button small" : "button ghost small"} type="button" onClick={() => setView("pdf")}>PDF preview</button>
          <button className={view === "edit" ? "button small" : "button ghost small"} type="button" onClick={() => setView("edit")}>Edit inline</button>
        </div>
        <div className="inline-actions">
          <button className="button secondary" type="submit">{resumeApproved ? "Save changes for review" : "Save and preview"}</button>
          {!resumeApproved ? <button className="button" type="submit" formAction={saveAndApproveResumeAction}>Save and approve</button> : null}
          <a className="button secondary" href={`/api/resumes/${resumeId}/pdf`}>Download PDF</a>
          {resumeApproved && applyUrl && !applicationRecorded ? <a className="button" href={applyUrl} target="_blank" rel="noreferrer">Open application</a> : null}
          {resumeApproved && !applicationRecorded ? <button className="button secondary" type="submit" formAction={createApplicationAction}>Mark applied</button> : null}
          {applicationRecorded ? <a className="button" href="/applications">View tracked application</a> : null}
        </div>
      </div>

      <div className="resume-editor-grid">
        <div className="resume-document-column">
          {view === "pdf" ? (
            <iframe
              className="resume-pdf-frame"
              src={`/api/resumes/${resumeId}/pdf?preview=1&v=${pdfVersion}`}
              title={`${content.candidateName} resume PDF preview`}
            />
          ) : (
            <section className="resume-preview resume-editor-sheet">
              <input
                className="resume-inline-name"
                value={content.candidateName}
                onChange={(event) => setContent({ ...content, candidateName: event.target.value })}
                aria-label="Candidate name"
              />
              <input
                className="resume-inline-contact"
                value={content.contactLine}
                onChange={(event) => setContent({ ...content, contactLine: event.target.value })}
                aria-label="Contact line"
              />

              <h3>SUMMARY</h3>
              <textarea
                className="resume-inline-text"
                value={content.summary}
                onChange={(event) => setContent({ ...content, summary: event.target.value })}
                aria-label="Professional summary"
              />

              <h3>SKILLS</h3>
              <div className="skill-category-editor">
                {(content.skillCategories || []).map((category, categoryIndex) => (
                  <div className="skill-category-row" key={categoryIndex}>
                    <div className="skill-category-header">
                      <input
                        className="skill-category-name"
                        value={category.name}
                        onChange={(event) => updateSkillCategory(categoryIndex, "name", event.target.value)}
                        aria-label={`Skill category ${categoryIndex + 1}`}
                      />
                      <div className="skill-category-actions">
                        <button type="button" onClick={() => moveSkillCategory(categoryIndex, "up")} disabled={categoryIndex === 0} aria-label={`Move ${category.name} up`} title="Move category up">↑</button>
                        <button type="button" onClick={() => moveSkillCategory(categoryIndex, "down")} disabled={categoryIndex === (content.skillCategories || []).length - 1} aria-label={`Move ${category.name} down`} title="Move category down">↓</button>
                        <button className="danger-text" type="button" onClick={() => removeSkillCategory(categoryIndex)} aria-label={`Remove ${category.name}`} title="Remove category and its skills">×</button>
                      </div>
                    </div>
                    <textarea
                      className="resume-inline-text compact"
                      value={category.skills.join(", ")}
                      onChange={(event) => updateSkillCategory(categoryIndex, "skills", event.target.value)}
                      aria-label={`${category.name} skills`}
                    />
                  </div>
                ))}
                <button className="button ghost small add-skill-category" type="button" onClick={addSkillCategory}>Add skill category</button>
              </div>

              {(content.sections || []).map((section, sectionIndex) => (
                <div className="resume-edit-section" key={`${section.title}-${sectionIndex}`}>
                  <input
                    className="resume-inline-heading"
                    value={section.title}
                    onChange={(event) => {
                      const sections = (content.sections || []).map((item, index) => index === sectionIndex ? { ...item, title: event.target.value } : item);
                      setContent({ ...content, sections });
                    }}
                    aria-label={`Section ${sectionIndex + 1} heading`}
                  />
                  {section.lines.map((line, lineIndex) => (
                    <div className={`resume-line-editor ${line.kind}`} key={`${sectionIndex}-${lineIndex}`}>
                      <div className="line-format-toolbar">
                        <label>
                          <span className="sr-only">Line format</span>
                          <select
                            value={line.kind}
                            onChange={(event) => updateLineKind(sectionIndex, lineIndex, event.target.value as ResumeLine["kind"])}
                            aria-label={`${section.title} line ${lineIndex + 1} format`}
                          >
                            <option value="entry">Role heading</option>
                            <option value="bullet">Achievement bullet</option>
                            <option value="text">Plain text</option>
                            <option value="divider">Horizontal line</option>
                          </select>
                        </label>
                        <button type="button" onClick={() => moveLine(sectionIndex, lineIndex, "top")} disabled={lineIndex === 0} aria-label="Move line to top" title="Move to top">Top</button>
                        <button type="button" onClick={() => moveLine(sectionIndex, lineIndex, "up")} disabled={lineIndex === 0} aria-label="Move line up" title="Move up">↑</button>
                        <button type="button" onClick={() => moveLine(sectionIndex, lineIndex, "down")} disabled={lineIndex === section.lines.length - 1} aria-label="Move line down" title="Move down">↓</button>
                        <button type="button" onClick={() => addLine(sectionIndex, "bullet", lineIndex)} aria-label="Add achievement below" title="Add bullet below">+ Bullet</button>
                        <button type="button" onClick={() => addLine(sectionIndex, "divider", lineIndex)} aria-label="Add horizontal line below" title="Add horizontal line below">+ Line</button>
                        <button className="line-remove" type="button" onClick={() => removeLine(sectionIndex, lineIndex)} aria-label="Remove line" title="Remove">×</button>
                      </div>
                      {line.kind === "divider" ? (
                        <div className="resume-inline-divider" role="separator" />
                      ) : (
                        <div className="resume-inline-line">
                          <span aria-hidden="true">{line.kind === "bullet" ? "•" : ""}</span>
                          <textarea
                            value={line.text}
                            onChange={(event) => updateSectionLine(sectionIndex, lineIndex, event.target.value)}
                            aria-label={`${section.title} line ${lineIndex + 1}`}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="section-add-controls">
                    <button className="button ghost small" type="button" onClick={() => addLine(sectionIndex, "entry")}>Add role heading</button>
                    <button className="button ghost small" type="button" onClick={() => addBullet(sectionIndex)}>Add bullet</button>
                    <button className="button ghost small" type="button" onClick={() => addLine(sectionIndex, "text")}>Add text</button>
                    <button className="button ghost small" type="button" onClick={() => addLine(sectionIndex, "divider")}>Add horizontal line</button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>

        <aside className="resume-reference-column">
          <section className="card ats-analysis">
            <div className="card-header"><div><h2>Resume coverage</h2><p>Compared with this job description</p></div><strong className="coverage-score">{coverage}%</strong></div>
            <div className="card-body">
              <div className="coverage-legend"><span className="coverage-key present">Present</span><span className="coverage-key partial">Partial</span><span className="coverage-key missing">Missing</span></div>
              <div className="keyword-grid">
                {keywordAnalysis.length ? keywordAnalysis.map((item) => (
                  <span className={`keyword-status ${item.status} ${item.status === "missing" ? "addable" : ""}`} key={item.keyword}>
                    {item.keyword}
                    {item.status === "missing" ? (
                      <button
                        type="button"
                        className="keyword-add"
                        onClick={() => beginKeywordRewrite(item.keyword)}
                        disabled={addingKeyword !== null}
                        aria-label={`Suggest an experience rewrite for ${item.keyword}`}
                        title={`Suggest a truthful bullet rewrite for ${item.keyword}`}
                      >
                        {addingKeyword === item.keyword ? <span className="spinner" aria-hidden="true" /> : "+"}
                      </button>
                    ) : null}
                  </span>
                )) : <span className="muted">No tracked ATS keywords were detected.</span>}
              </div>
              {rewriteRequest ? (
                <section className="keyword-suggestion rewrite-target-picker">
                  <div className="keyword-suggestion-heading">
                    <span>
                      <strong>Where should Scout use {rewriteRequest.keyword}?</strong>
                      <small>Choose one passage and add context when the resume does not state the fact directly.</small>
                    </span>
                    <button className="button ghost small" type="button" onClick={() => setRewriteRequest(null)}>Cancel</button>
                  </div>
                  <label className="rewrite-target-field">
                    <span>Rewrite target</span>
                    <select
                      value={rewriteRequest.targetValue}
                      onChange={(event) => setRewriteRequest({ ...rewriteRequest, targetValue: event.target.value })}
                    >
                      {rewriteTargetOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="rewrite-target-field">
                    <span>Optional truth note</span>
                    <textarea
                      value={rewriteRequest.userEvidence}
                      onChange={(event) => setRewriteRequest({ ...rewriteRequest, userEvidence: event.target.value })}
                      placeholder="Example: My last two products served B2B2C customers."
                      maxLength={600}
                    />
                  </label>
                  <button className="button small" type="button" onClick={() => void suggestKeywordRewrite()} disabled={addingKeyword !== null}>
                    {addingKeyword ? <span className="spinner" aria-hidden="true" /> : null}
                    Generate suggestion
                  </button>
                </section>
              ) : null}
              {keywordSuggestion ? (
                <section className="keyword-suggestion" aria-live="polite">
                  <div className="keyword-suggestion-heading">
                    <span>
                      <strong>Suggested experience rewrite</strong>
                      <small>{keywordSuggestion.sectionTitle} · {keywordSuggestion.keyword}</small>
                    </span>
                    <button className="button ghost small" type="button" onClick={() => setKeywordSuggestion(null)}>Discard</button>
                  </div>
                  <div className="keyword-suggestion-copy original">
                    <span>Original</span>
                    <p>{keywordSuggestion.originalBullet}</p>
                  </div>
                  <div className="keyword-suggestion-copy proposed">
                    <span>Proposed</span>
                    <p>{keywordSuggestion.suggestedBullet}</p>
                  </div>
                  <p className="keyword-suggestion-reason">{keywordSuggestion.reason}</p>
                  <button className="button small" type="button" onClick={() => void acceptKeywordRewrite()} disabled={addingKeyword !== null}>
                    {addingKeyword ? <span className="spinner" aria-hidden="true" /> : null}
                    Accept rewrite
                  </button>
                </section>
              ) : null}
              {keywordNotice ? <p className="keyword-notice" role="status">{keywordNotice}</p> : null}
              <p className="muted coverage-note">Use plus to choose the summary or a specific experience. Add a short truth note when the resume does not make the context explicit. Nothing changes until you accept the proposal.</p>
            </div>
          </section>
          {!embedded ? <section className="card job-description-panel">
            <div className="card-header"><div><h2>Job description</h2><p>{jobTitle} · {company}</p></div></div>
            <div className="card-body job-description">{jobDescription || "No job description was provided."}</div>
          </section> : null}
        </aside>
      </div>
    </form>
  );
}
