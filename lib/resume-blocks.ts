import type { ResumeContent, ResumeChange } from "@/lib/types";

function blockHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function newResumeBlockId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

export function stripResumeBulletPrefix(value: string): string {
  return value.replace(/^\s*(?:[-*]|[•●▪◦])\s+/, "").trim();
}

export function isScoutGeneratedResumeSection(title: string): boolean {
  return title.trim().toUpperCase() === "ADDITIONAL VERIFIED HIGHLIGHTS";
}

export function ensureResumeBlockIds(content: ResumeContent): ResumeContent {
  const summaryBlockId = content.summaryBlockId || `summary-${blockHash(content.summary || "summary")}`;
  const sections = (content.sections || [])
    .filter((section) => !isScoutGeneratedResumeSection(section.title))
    .map((section, sectionIndex) => {
    const sectionId = section.id || `section-${blockHash(`${section.title}:${sectionIndex}`)}`;
    return {
      ...section,
      id: sectionId,
      lines: section.lines.map((line, lineIndex) => ({
        ...line,
        text: line.kind === "bullet" ? stripResumeBulletPrefix(line.text) : line.text,
        id: line.id || `line-${blockHash(`${sectionId}:${line.kind}:${line.text}:${lineIndex}`)}`,
      })),
    };
    });
  return {
    ...content,
    summaryBlockId,
    sections,
    changeHistory: (content.changeHistory || []).map((change) => ({
      ...change,
      originalText: stripResumeBulletPrefix(change.originalText),
      acceptedText: stripResumeBulletPrefix(change.acceptedText),
    })),
  };
}

export function removeResumeSection(content: ResumeContent, sectionId: string): ResumeContent {
  return {
    ...content,
    sections: (content.sections || []).filter((section) => section.id !== sectionId),
  };
}

export function resumeBlockText(content: ResumeContent, blockId: string): string | null {
  if (content.summaryBlockId === blockId) return content.summary;
  for (const section of content.sections || []) {
    const line = section.lines.find((item) => item.id === blockId);
    if (line) return line.text;
  }
  return null;
}

export function replaceResumeBlockText(content: ResumeContent, blockId: string, text: string): ResumeContent {
  if (content.summaryBlockId === blockId) return { ...content, summary: text };
  return {
    ...content,
    sections: (content.sections || []).map((section) => ({
      ...section,
      lines: section.lines.map((line) => line.id === blockId ? { ...line, text } : line),
    })),
  };
}

export function appendResumeChange(content: ResumeContent, change: ResumeChange): ResumeContent {
  return {
    ...content,
    changeHistory: [...(content.changeHistory || []), change].slice(-50),
  };
}

export function undoLastResumeChange(content: ResumeContent): { content: ResumeContent; undone: ResumeChange | null } {
  const history = content.changeHistory || [];
  const last = history.at(-1) || null;
  if (!last) return { content, undone: null };
  const current = resumeBlockText(content, last.blockId);
  if (current !== last.acceptedText) return { content, undone: null };
  const reverted = replaceResumeBlockText(content, last.blockId, last.originalText);
  return {
    content: { ...reverted, changeHistory: history.slice(0, -1) },
    undone: last,
  };
}
