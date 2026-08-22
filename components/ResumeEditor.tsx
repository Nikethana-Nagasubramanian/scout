"use client";

import { useEffect, useRef, useState } from "react";
import { saveAndApproveResumeAction } from "@/app/actions";
import type { ResumeBulletSuggestion, ResumeRewriteTarget } from "@/lib/local-ai";
import {
  appendResumeChange,
  ensureResumeBlockIds,
  newResumeBlockId,
  removeResumeSection,
  replaceResumeBlockText,
  resumeBlockText,
  stripResumeBulletPrefix,
} from "@/lib/resume-blocks";
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

function includesTerm(text: string, term: string): boolean {
  const cleanText = ` ${normalized(text)} `;
  const cleanTerm = normalized(term);
  return Boolean(cleanTerm) && cleanText.includes(` ${cleanTerm} `);
}

export function ResumeEditor({
  resumeId,
  resumeStatus,
  jobId,
  initialContent,
  jobDescription,
  jobTitle,
  company,
  applicationStatus,
  embedded = false,
}: ResumeEditorProps) {
  const [content, setContent] = useState<ResumeContent>(ensureResumeBlockIds({
    ...initialContent,
    skills: normalizeResumeSkills(initialContent.skills),
    skillCategories: resumeSkillCategories(initialContent, jobDescription),
    sections: initialContent.sections || [],
  }));
  const [view, setView] = useState<"guided" | "edit">("guided");
  const [rightRailView, setRightRailView] = useState<"suggestions" | "keywords">("suggestions");
  const [addingKeyword, setAddingKeyword] = useState<string | null>(null);
  const [keywordNotice, setKeywordNotice] = useState("");
  const [keywordSuggestion, setKeywordSuggestion] = useState<ResumeBulletSuggestion | null>(null);
  const [rewriteRequest, setRewriteRequest] = useState<RewriteRequest | null>(null);
  const [guidedSuggestions, setGuidedSuggestions] = useState<ResumeBulletSuggestion[]>([]);
  const [guidedDrafts, setGuidedDrafts] = useState<Record<string, string>>({});
  const [guidedLoading, setGuidedLoading] = useState(true);
  const [guidedNotice, setGuidedNotice] = useState("");
  const [editingPaperSection, setEditingPaperSection] = useState<string | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [refiningSuggestionId, setRefiningSuggestionId] = useState<string | null>(null);
  const requestedGuidance = useRef(false);
  const inspectorDraftRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (requestedGuidance.current) return;
    requestedGuidance.current = true;
    void (async () => {
      try {
        const response = await fetch(`/api/resumes/${resumeId}/proactive-suggestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        const result = await response.json() as {
          content?: ResumeContent;
          suggestions?: ResumeBulletSuggestion[];
          failures?: string[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || "Scout could not find resume improvements");
        const nextContent = result.content ? ensureResumeBlockIds(result.content) : content;
        const suggestions = (result.suggestions || []).slice(0, 3);
        setContent(nextContent);
        setGuidedSuggestions(suggestions);
        setGuidedDrafts(Object.fromEntries(suggestions.map((suggestion) => [suggestion.blockId || "", suggestion.suggestedBullet])));
        if (!suggestions.length) {
          const localAiUnavailable = result.failures?.some((failure) => /fetch failed|ollama/i.test(failure));
          setGuidedNotice(localAiUnavailable
            ? "Local AI is unavailable. Scout checked its safe terminology rules but did not find another defensible improvement. Your resume remains unchanged."
            : result.failures?.[0] || "Scout did not find a defensible improvement for this job. Your resume remains unchanged.");
        }
      } catch (error) {
        setGuidedNotice(error instanceof Error ? error.message : "Scout could not find resume improvements");
      } finally {
        setGuidedLoading(false);
      }
    })();
  }, [content, resumeId]);

  const resumeText = [
    content.summary,
    content.skills.join(" "),
    ...(content.sections || []).flatMap((section) => section.lines.map((line) => line.text)),
  ].join(" ");
  const keywordCandidates = [...atsKeywords, ...content.skills];
  const relevantKeywords = [...new Map(keywordCandidates
    .filter((keyword) => includesTerm(jobDescription, keyword))
    .map((keyword) => [normalized(keyword), keyword])).values()]
    .sort((left, right) => normalized(jobDescription).indexOf(normalized(left)) - normalized(jobDescription).indexOf(normalized(right)));
  const keywordAnalysis = relevantKeywords.map((keyword) => {
    const cleanKeyword = normalized(keyword);
    if (includesTerm(resumeText, cleanKeyword)) return { keyword, status: "present" as const };
    const tokens = cleanKeyword.split(" ").filter((token) => token.length > 2);
    if (tokens.length > 1 && tokens.some((token) => includesTerm(resumeText, token))) return { keyword, status: "partial" as const };
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
            ? [...section.lines, { id: newResumeBlockId("line"), text: "", kind }]
            : [
                ...section.lines.slice(0, afterIndex + 1),
                { id: newResumeBlockId("line"), text: "", kind },
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

  function deleteSection(sectionId: string): void {
    setContent(removeResumeSection(content, sectionId));
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
      setView("guided");
      setRightRailView("suggestions");
    } catch (error) {
      setKeywordNotice(error instanceof Error ? error.message : "The rewrite could not be saved");
    } finally {
      setAddingKeyword(null);
    }
  }

  async function persistGuidedContent(nextContent: ResumeContent): Promise<ResumeContent> {
    const response = await fetch(`/api/resumes/${resumeId}/suggestion`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: nextContent }),
    });
    const result = await response.json() as { content?: ResumeContent; error?: string };
    if (!response.ok || !result.content) throw new Error(result.error || "The resume change could not be saved");
    return ensureResumeBlockIds(result.content);
  }

  async function acceptGuidedSuggestion(suggestion: ResumeBulletSuggestion): Promise<void> {
    const blockId = suggestion.blockId || (suggestion.targetKind === "summary"
      ? content.summaryBlockId
      : content.sections?.[suggestion.sectionIndex]?.lines[suggestion.lineIndex]?.id);
    if (!blockId) {
      setGuidedNotice("Scout could not identify the resume passage. Reload the page and try again.");
      return;
    }
    const currentText = resumeBlockText(content, blockId);
    if (currentText !== suggestion.originalBullet) {
      setGuidedNotice("This passage changed after Scout created the suggestion. Reload to generate a fresh version.");
      return;
    }
    const acceptedText = (guidedDrafts[blockId] || suggestion.suggestedBullet).replace(/\u2014/g, "-").trim();
    if (!acceptedText) {
      setGuidedNotice("The suggested passage cannot be empty.");
      return;
    }
    const normalizedKeyword = normalized(suggestion.keyword);
    let nextContent = replaceResumeBlockText(content, blockId, acceptedText);
    nextContent = appendResumeChange(nextContent, {
      id: newResumeBlockId("change"),
      blockId,
      keyword: suggestion.keyword,
      originalText: suggestion.originalBullet,
      acceptedText,
      createdAt: new Date().toISOString(),
      source: "guided",
    });
    nextContent = {
      ...nextContent,
      highlightedKeywords: [
        ...(nextContent.highlightedKeywords || []).filter((item) => normalized(item) !== normalizedKeyword),
        suggestion.keyword,
      ],
      audit: {
        ...nextContent.audit,
        includedKeywords: [
          ...nextContent.audit.includedKeywords.filter((item) => normalized(item) !== normalizedKeyword),
          suggestion.keyword,
        ],
        unsupportedKeywords: nextContent.audit.unsupportedKeywords.filter((item) => normalized(item) !== normalizedKeyword),
      },
    };
    setAddingKeyword(suggestion.keyword);
    setGuidedNotice("");
    try {
      const saved = await persistGuidedContent(nextContent);
      setContent(saved);
      setGuidedSuggestions((items) => items.filter((item) => item.blockId !== blockId));
      setRefiningSuggestionId(null);
      setGuidedNotice(`${suggestion.keyword} was accepted for this job-specific resume. Your base resume was not changed.`);
    } catch (error) {
      setGuidedNotice(error instanceof Error ? error.message : "The resume change could not be saved");
    } finally {
      setAddingKeyword(null);
    }
  }

  function keepOriginal(suggestion: ResumeBulletSuggestion): void {
    setGuidedSuggestions((items) => items.filter((item) => item.blockId !== suggestion.blockId));
    setRefiningSuggestionId(null);
    setGuidedNotice(`Kept the original passage. ${suggestion.keyword} was not added.`);
  }

  function guidedSuggestionFor(blockId: string | undefined, presentation: "card" | "experience" = "card") {
    if (!blockId) return null;
    const suggestion = guidedSuggestions.find((item) => item.blockId === blockId);
    if (!suggestion) return null;
    if (presentation === "experience") {
      const suggestionNumber = guidedSuggestions.findIndex((item) => item.blockId === blockId) + 1;
      const isActive = guidedSuggestions[activeSuggestionIndex]?.blockId === blockId;
      return (
        <section
          className={`experience-suggestion${isActive ? " active" : ""}`}
          aria-live="polite"
          onClick={() => setActiveSuggestionIndex(Math.max(0, suggestionNumber - 1))}
        >
          <p className="experience-suggestion-label">Suggestion {suggestionNumber}</p>
          <div className="experience-suggestion-copy original">
            <span aria-hidden="true">•</span>
            <p>{stripResumeBulletPrefix(suggestion.originalBullet)}</p>
          </div>
          <div className="experience-suggestion-copy proposed">
            <span aria-hidden="true">•</span>
            <p>{guidedDrafts[blockId] || suggestion.suggestedBullet}</p>
          </div>
        </section>
      );
    }
    return (
      <section className="guided-suggestion" aria-live="polite">
        <div className="guided-suggestion-heading">
          <span><strong>Suggested improvement</strong> <small>Verified resume evidence</small></span>
          <span className="guided-keyword">{suggestion.keyword}</span>
        </div>
        <textarea
          value={guidedDrafts[blockId] || suggestion.suggestedBullet}
          onChange={(event) => setGuidedDrafts({ ...guidedDrafts, [blockId]: event.target.value })}
          aria-label={`Edit the suggested ${suggestion.keyword} passage`}
        />
        <p>{suggestion.reason}</p>
        <div className="guided-suggestion-actions">
          <button className="button small" type="button" onClick={() => void acceptGuidedSuggestion(suggestion)} disabled={addingKeyword !== null}>
            {addingKeyword === suggestion.keyword ? <span className="spinner" aria-hidden="true" /> : null}
            Accept
          </button>
          <button className="button secondary small" type="button" onClick={() => keepOriginal(suggestion)}>Keep original</button>
        </div>
      </section>
    );
  }

  const effectiveSuggestionIndex = guidedSuggestions.length ? Math.min(activeSuggestionIndex, guidedSuggestions.length - 1) : 0;
  const activeSuggestion = guidedSuggestions[effectiveSuggestionIndex] || null;
  const activeSuggestionBlockId = activeSuggestion?.blockId || "";
  const activeEvidenceCount = Math.max(1, activeSuggestion?.evidenceFactIds?.length || 0);

  function moveSuggestion(direction: -1 | 1): void {
    if (!guidedSuggestions.length) return;
    setRefiningSuggestionId(null);
    setActiveSuggestionIndex((index) => (index + direction + guidedSuggestions.length) % guidedSuggestions.length);
  }

  function focusInspectorDraft(): void {
    setRefiningSuggestionId(activeSuggestionBlockId);
    window.requestAnimationFrame(() => {
      inspectorDraftRef.current?.focus();
      inspectorDraftRef.current?.select();
    });
  }

  return (
    <form id={`resume-editor-${resumeId}`} action={saveAndApproveResumeAction} className={`resume-workspace${embedded ? " embedded" : ""}`}>
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
      <div className={`editor-toolbar${embedded ? " embedded-toolbar" : ""}`}>
        <div className="view-switcher" aria-label="Resume view">
          <button className={view === "guided" ? "button small" : "button ghost small"} type="button" onClick={() => setView("guided")}>Guided edit</button>
          <button className={view === "edit" ? "button small" : "button ghost small"} type="button" onClick={() => setView("edit")}>Edit inline</button>
        </div>
        <div className="inline-actions">
          <button className="button" type="submit" formAction={saveAndApproveResumeAction}>Approve resume</button>
        </div>
      </div>

      <div className="resume-editor-grid">
        <div className="resume-document-column">
          {view === "guided" ? (
            <section className="guided-resume-editor">
              <div className="guided-editor-intro">
                <div>
                  <h2>Job-specific resume</h2>
                  <p>Scout suggests up to three defensible improvements. Nothing changes until you accept.</p>
                </div>
                {guidedLoading ? <span className="guided-loading"><span className="spinner" aria-hidden="true" /> Finding improvements</span> : null}
              </div>
              <div className="guided-resume-header">
                <input
                  className="guided-resume-name"
                  value={content.candidateName}
                  onChange={(event) => setContent({ ...content, candidateName: event.target.value })}
                  aria-label="Candidate name"
                />
                <input
                  className="guided-resume-contact"
                  value={content.contactLine}
                  onChange={(event) => setContent({ ...content, contactLine: event.target.value })}
                  aria-label="Contact line"
                />
              </div>
              <div className="guided-resume-section">
                <div className="paper-section-heading">
                  <h2>Summary</h2>
                  <button
                    className={`paper-edit-button${editingPaperSection === "summary" ? " active" : ""}`}
                    type="button"
                    onClick={() => setEditingPaperSection(editingPaperSection === "summary" ? null : "summary")}
                    aria-label={editingPaperSection === "summary" ? "Finish editing summary" : "Edit summary"}
                    aria-pressed={editingPaperSection === "summary"}
                  >
                    {editingPaperSection === "summary" ? "Done" : <span className="paper-edit-icon" aria-hidden="true" />}
                  </button>
                </div>
                {editingPaperSection === "summary" ? (
                  <textarea
                    className="paper-summary-editor"
                    value={content.summary}
                    onChange={(event) => setContent({ ...content, summary: event.target.value })}
                    aria-label="Professional summary"
                  />
                ) : <p className="paper-summary-copy">{content.summary}</p>}
                {guidedSuggestionFor(content.summaryBlockId, "experience")}
              </div>
              <div className="guided-resume-section">
                <div className="paper-section-heading">
                  <h2>Skills</h2>
                  <button
                    className={`paper-edit-button${editingPaperSection === "skills" ? " active" : ""}`}
                    type="button"
                    onClick={() => setEditingPaperSection(editingPaperSection === "skills" ? null : "skills")}
                    aria-label={editingPaperSection === "skills" ? "Finish editing skills" : "Edit skills"}
                    aria-pressed={editingPaperSection === "skills"}
                  >
                    {editingPaperSection === "skills" ? "Done" : <span className="paper-edit-icon" aria-hidden="true" />}
                  </button>
                </div>
                {editingPaperSection === "skills" ? (
                  <div className="paper-skill-editor">
                    {(content.skillCategories || []).map((category, categoryIndex) => (
                      <div className="paper-skill-editor-row" key={`${category.name}-${categoryIndex}`}>
                        <input
                          value={category.name}
                          onChange={(event) => updateSkillCategory(categoryIndex, "name", event.target.value)}
                          aria-label={`Skill category ${categoryIndex + 1}`}
                        />
                        <textarea
                          value={category.skills.join(", ")}
                          onChange={(event) => updateSkillCategory(categoryIndex, "skills", event.target.value)}
                          aria-label={`${category.name} skills`}
                        />
                      </div>
                    ))}
                    <button className="button ghost small" type="button" onClick={addSkillCategory}>Add skill category</button>
                  </div>
                ) : (content.skillCategories || []).map((category, categoryIndex) => (
                  <p className="guided-skill-row" key={`${category.name}-${categoryIndex}`}>
                    <strong>{category.name}:</strong> {category.skills.join(", ")}
                  </p>
                ))}
              </div>
              {(content.sections || []).map((section, sectionIndex) => {
                const isExperience = /experience/i.test(section.title);
                const sectionKey = section.id || `${section.title}-${sectionIndex}`;
                const isEditingSection = editingPaperSection === sectionKey;
                if (isExperience) {
                  return (
                    <section className="guided-resume-section guided-experience-section" key={sectionKey}>
                      <div className="experience-section-heading">
                        <h2>Experience</h2>
                        <button
                          className={`experience-edit-button${isEditingSection ? " active" : ""}`}
                          type="button"
                          onClick={() => setEditingPaperSection(isEditingSection ? null : sectionKey)}
                          aria-pressed={isEditingSection}
                        >
                          {isEditingSection ? "Done" : <span className="paper-edit-icon" aria-hidden="true" />}
                        </button>
                      </div>
                      {isEditingSection ? (
                        <div className="experience-section-editing">
                          <button className="danger-text resume-section-delete" type="button" onClick={() => deleteSection(section.id || "")}>Delete section</button>
                          {section.lines.map((line, lineIndex) => line.kind === "divider" ? (
                            <hr key={line.id || lineIndex} />
                          ) : (
                            <div className={`guided-resume-line ${line.kind}`} key={line.id || lineIndex}>
                              {line.kind === "bullet" ? <span aria-hidden="true">•</span> : null}
                              <textarea
                                value={line.text}
                                onChange={(event) => updateSectionLine(sectionIndex, lineIndex, event.target.value)}
                                aria-label={`${section.title} line ${lineIndex + 1}`}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="experience-entry-list">
                          {section.lines.map((line, lineIndex) => line.kind === "divider" ? (
                            <hr key={line.id || lineIndex} />
                          ) : line.kind === "entry" ? (
                            <h3 className="experience-role-heading" key={line.id || lineIndex}>{line.text}</h3>
                          ) : line.kind === "bullet" ? (
                            <div className="experience-bullet-block" key={line.id || lineIndex}>
                              {guidedSuggestionFor(line.id, "experience") || (
                                <div className="experience-bullet-copy">
                                  <span aria-hidden="true">•</span>
                                  <p>{stripResumeBulletPrefix(line.text)}</p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="experience-supporting-copy" key={line.id || lineIndex}>{line.text}</p>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                }
                return (
                  <section className="guided-resume-section guided-supporting-section" key={sectionKey}>
                    <div className="paper-section-heading">
                      <h2>{section.title}</h2>
                      <button
                        className={`paper-edit-button${isEditingSection ? " active" : ""}`}
                        type="button"
                        onClick={() => setEditingPaperSection(isEditingSection ? null : sectionKey)}
                        aria-label={isEditingSection ? `Finish editing ${section.title}` : `Edit ${section.title}`}
                        aria-pressed={isEditingSection}
                      >
                        {isEditingSection ? "Done" : <span className="paper-edit-icon" aria-hidden="true" />}
                      </button>
                    </div>
                    {isEditingSection ? (
                      <div className="supporting-section-editor">
                        <button className="danger-text resume-section-delete" type="button" onClick={() => deleteSection(section.id || "")}>Delete section</button>
                        {section.lines.map((line, lineIndex) => line.kind === "divider" ? (
                          <hr key={line.id || lineIndex} />
                        ) : (
                          <div className={`guided-resume-line ${line.kind}`} key={line.id || lineIndex}>
                            {line.kind === "bullet" ? <span aria-hidden="true">•</span> : null}
                            <textarea
                              value={line.text}
                              onChange={(event) => updateSectionLine(sectionIndex, lineIndex, event.target.value)}
                              aria-label={`${section.title} line ${lineIndex + 1}`}
                            />
                            {guidedSuggestionFor(line.id)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="supporting-section-content">
                        {section.lines.map((line, lineIndex) => line.kind === "divider" ? (
                          <hr key={line.id || lineIndex} />
                        ) : line.kind === "entry" ? (
                          <p className="supporting-entry" key={line.id || lineIndex}>{line.text}</p>
                        ) : line.kind === "bullet" ? (
                          <div className="experience-bullet-copy" key={line.id || lineIndex}>
                            <span aria-hidden="true">•</span>
                            <p>{stripResumeBulletPrefix(line.text)}</p>
                          </div>
                        ) : (
                          <p key={line.id || lineIndex}>{line.text}</p>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </section>
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
                <div className="resume-edit-section" key={section.id || `${section.title}-${sectionIndex}`}>
                  <div className="resume-section-heading-row">
                    <input
                      className="resume-inline-heading"
                      value={section.title}
                      onChange={(event) => {
                        const sections = (content.sections || []).map((item, index) => index === sectionIndex ? { ...item, title: event.target.value } : item);
                        setContent({ ...content, sections });
                      }}
                      aria-label={`Section ${sectionIndex + 1} heading`}
                    />
                    <button className="danger-text resume-section-delete" type="button" onClick={() => deleteSection(section.id || "")}>Delete section</button>
                  </div>
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
          <div className="resume-rail-switcher" role="group" aria-label="Resume guidance">
            <button className={rightRailView === "suggestions" ? "active" : ""} type="button" onClick={() => setRightRailView("suggestions")}>
              Suggested edits <span>{guidedSuggestions.length}</span>
            </button>
            <button className={rightRailView === "keywords" ? "active" : ""} type="button" onClick={() => setRightRailView("keywords")}>
              ATS keywords <span>{coverage}%</span>
            </button>
          </div>
          {rightRailView === "suggestions" ? (
            <section className="suggestion-inspector" data-stack-count={Math.min(3, guidedSuggestions.length)} aria-live="polite">
              <div className="suggestion-inspector-inner">
                <header className="suggestion-inspector-header">
                  <h2>Scout suggests {guidedSuggestions.length} {guidedSuggestions.length === 1 ? "edit" : "edits"}</h2>
                  <div className="suggestion-nav-actions">
                    <button type="button" onClick={() => moveSuggestion(-1)} disabled={guidedSuggestions.length < 2} aria-label="Previous suggestion">
                      <span className="suggestion-chevron previous" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => moveSuggestion(1)} disabled={guidedSuggestions.length < 2} aria-label="Next suggestion">
                      <span className="suggestion-chevron next" aria-hidden="true" />
                    </button>
                  </div>
                </header>
                {guidedLoading ? (
                  <div className="suggestion-inspector-empty"><span className="spinner" aria-hidden="true" /> Scout is finding defensible edits.</div>
                ) : activeSuggestion ? (
                  <>
                    <section className="inspector-comparison">
                      <p className="inspector-label">Suggestion {effectiveSuggestionIndex + 1}</p>
                      <div className="inspector-copy original"><span aria-hidden="true">•</span><p>{stripResumeBulletPrefix(activeSuggestion.originalBullet)}</p></div>
                      <label className="inspector-copy proposed">
                        <span aria-hidden="true">•</span>
                        {refiningSuggestionId === activeSuggestionBlockId ? (
                          <textarea
                            ref={inspectorDraftRef}
                            value={guidedDrafts[activeSuggestionBlockId] || activeSuggestion.suggestedBullet}
                            onChange={(event) => setGuidedDrafts({ ...guidedDrafts, [activeSuggestionBlockId]: event.target.value })}
                            aria-label={`Refine suggestion ${effectiveSuggestionIndex + 1}`}
                          />
                        ) : (
                          <p>{guidedDrafts[activeSuggestionBlockId] || activeSuggestion.suggestedBullet}</p>
                        )}
                      </label>
                    </section>
                    <section className="inspector-note">
                      <div className="inspector-meta-heading"><span className="inspector-note-icon" aria-hidden="true" /><h3>Scout&apos;s note</h3></div>
                      <p>{activeSuggestion.reason}</p>
                    </section>
                    <section className="inspector-evidence">
                      <div className="inspector-meta-heading"><span className="inspector-evidence-icon" aria-hidden="true" /><h3>Scout&apos;s evidence · {activeEvidenceCount} {activeEvidenceCount === 1 ? "source" : "sources"}</h3></div>
                      <p>Confirmed in the resume evidence used for this job-specific edit.</p>
                      <blockquote>{stripResumeBulletPrefix(activeSuggestion.originalBullet)}</blockquote>
                    </section>
                    <footer className="suggestion-inspector-actions">
                      <button type="button" className="inspector-action keep" onClick={() => keepOriginal(activeSuggestion)}>Keep original</button>
                      <button type="button" className="inspector-action refine" onClick={focusInspectorDraft}>Refine</button>
                      <button type="button" className="inspector-action accept" onClick={() => void acceptGuidedSuggestion(activeSuggestion)} disabled={addingKeyword !== null}>
                        {addingKeyword === activeSuggestion.keyword ? <span className="spinner" aria-hidden="true" /> : null}
                        Accept change
                      </button>
                    </footer>
                  </>
                ) : (
                  <div className="suggestion-inspector-empty">
                    <strong>No pending edits</strong>
                    <span>{guidedNotice || "Scout did not find another defensible change for this resume."}</span>
                  </div>
                )}
              </div>
            </section>
          ) : (
          <section className="card ats-analysis">
            <div className="card-header"><div><h2>ATS keywords</h2><p>Job requirements compared with this resume</p></div><strong className="coverage-score">{coverage}%</strong></div>
            <div className="card-body">
              <div className="coverage-legend"><span className="coverage-key present">Present</span><span className="coverage-key partial">Partial</span><span className="coverage-key missing">Missing</span></div>
              {keywordAnalysis.length ? (["missing", "partial", "present"] as const).map((status) => {
                const items = keywordAnalysis.filter((item) => item.status === status);
                if (!items.length) return null;
                return (
                  <section className="keyword-group" key={status}>
                    <div className="keyword-group-heading"><strong>{status}</strong><span>{items.length}</span></div>
                    <div className="keyword-grid">
                      {items.map((item) => (
                        <span className={`keyword-status ${item.status} ${item.status === "missing" ? "addable" : ""}`} key={item.keyword}>
                          {item.keyword}
                          {item.status === "missing" ? (
                            <button
                              type="button"
                              className="keyword-add"
                              onClick={() => beginKeywordRewrite(item.keyword)}
                              disabled={addingKeyword !== null}
                              aria-label={`Suggest a truthful resume rewrite for ${item.keyword}`}
                              title={`Suggest a truthful resume rewrite for ${item.keyword}`}
                            >
                              {addingKeyword === item.keyword ? <span className="spinner" aria-hidden="true" /> : "+"}
                            </button>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </section>
                );
              }) : <span className="muted">Scout did not detect tracked requirements in this job description.</span>}
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
              <p className="muted coverage-note">Missing keywords are not added automatically. Use plus to choose the summary or a specific experience, then review the evidence-bound rewrite before accepting it.</p>
            </div>
          </section>
          )}
          {(content.changeHistory || []).length ? (
            <section className="card resume-change-log">
              <div className="card-header">
                <div>
                  <h2>Resume changes implemented</h2>
                  <p>Accepted changes in this job-specific resume</p>
                </div>
                <strong>{content.changeHistory?.length}</strong>
              </div>
              <div className="card-body resume-change-list">
                {[...(content.changeHistory || [])].reverse().map((change) => (
                  <article key={change.id}>
                    <div>
                      <strong>{change.keyword}</strong>
                      <small>Accepted</small>
                    </div>
                    <p>{stripResumeBulletPrefix(change.acceptedText)}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          {!embedded ? <section className="card job-description-panel">
            <div className="card-header"><div><h2>Job description</h2><p>{jobTitle} · {company}</p></div></div>
            <div className="card-body job-description">{jobDescription || "No job description was provided."}</div>
          </section> : null}
        </aside>
      </div>
    </form>
  );
}
