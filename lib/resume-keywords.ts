import type { ResumeContent } from "@/lib/types";
import { categoryForResumeSkill, resumeSkillCategories } from "@/lib/resume-skills";

function normalizedKeyword(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function addResumeKeyword(content: ResumeContent, value: string): ResumeContent {
  const keyword = value.replace(/\s+/g, " ").trim();
  if (!keyword) return content;

  const normalized = normalizedKeyword(keyword);
  const existingSkill = content.skills.find((skill) => normalizedKeyword(skill) === normalized);
  const savedKeyword = existingSkill || keyword;
  const skills = existingSkill ? content.skills : [...content.skills, keyword];
  const currentCategories = resumeSkillCategories(content);
  const targetCategory = categoryForResumeSkill(keyword);
  const skillCategories = existingSkill
    ? currentCategories
    : currentCategories.some((category) => category.name === targetCategory)
      ? currentCategories.map((category) => category.name === targetCategory
        ? { ...category, skills: [keyword, ...category.skills] }
        : category)
      : [{ name: targetCategory, skills: [keyword] }, ...currentCategories];
  const highlightedKeywords = [
    ...(content.highlightedKeywords || []).filter((item) => normalizedKeyword(item) !== normalized),
    savedKeyword,
  ];
  const includedKeywords = [
    ...content.audit.includedKeywords.filter((item) => normalizedKeyword(item) !== normalized),
    savedKeyword,
  ];

  return {
    ...content,
    skills,
    skillCategories,
    highlightedKeywords,
    audit: {
      ...content.audit,
      includedKeywords,
      unsupportedKeywords: content.audit.unsupportedKeywords.filter(
        (item) => normalizedKeyword(item) !== normalized,
      ),
    },
  };
}

export function isHighlightedKeyword(content: ResumeContent, value: string): boolean {
  const normalized = normalizedKeyword(value);
  return (content.highlightedKeywords || []).some((item) => normalizedKeyword(item) === normalized);
}
