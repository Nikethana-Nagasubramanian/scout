import type { ResumeContent } from "@/lib/types";

export type ResumeSkillCategory = NonNullable<ResumeContent["skillCategories"]>[number];

export function normalizeSkillKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeResumeSkills(values: string[]): string[] {
  const expanded = values.flatMap((value) => {
    const trimmed = value.trim();
    const categoryMatch = trimmed.match(/^[^:]{1,40}:\s*(.+)$/);
    const skillText = categoryMatch?.[1] || trimmed;
    return skillText.split(/\s*,\s*/);
  });
  const seen = new Set<string>();
  return expanded.map((skill) => skill.trim()).filter((skill) => {
    const key = normalizeSkillKey(skill);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function jobIncludesSkill(jobDescription: string, skill: string): boolean {
  const jobWords = ` ${normalizeSkillKey(jobDescription)} `;
  const tokens = normalizeSkillKey(skill).split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => jobWords.includes(` ${token} `));
}

const defaultCategoryOrder = [
  "Product Design",
  "Product and Strategy",
  "Frontend and Engineering",
  "Data and Mapping",
  "AI Tools",
  "Workflow",
  "Additional Skills",
];

export function categoryForResumeSkill(skill: string): string {
  const key = normalizeSkillKey(skill);
  if (/(claude|codex|figma mcp|artificial intelligence|machine learning|(^| )ai( |$))/.test(key)) return "AI Tools";
  if (/(figma|framer|protopie|webflow|design|prototype|research|usability|accessibility|information architecture|audit)/.test(key)) return "Product Design";
  if (/(b2b|saas|strategy|collaboration|stakeholder|roadmap|enterprise|leadership|product management)/.test(key)) return "Product and Strategy";
  if (/(mapbox|deck gl|grafana|analytics|visualization|sql|data)/.test(key)) return "Data and Mapping";
  if (/(typescript|javascript|react|html|css|tailwind|redux|firebase|swift|ios|git|frontend|front end)/.test(key)) return "Frontend and Engineering";
  if (/(linear|notion|jira|confluence|slack|workshop|agile)/.test(key)) return "Workflow";
  return "Additional Skills";
}

export function categorizeResumeSkills(values: string[], jobDescription: string): ResumeSkillCategory[] {
  const skills = normalizeResumeSkills(values);
  const matchedKeys = new Set(
    skills.filter((skill) => jobIncludesSkill(jobDescription, skill)).map(normalizeSkillKey),
  );
  const categories = new Map<string, { matched: string[]; other: string[] }>();

  for (const skill of skills) {
    const category = categoryForResumeSkill(skill);
    const group = categories.get(category) || { matched: [], other: [] };
    if (matchedKeys.has(normalizeSkillKey(skill))) group.matched.push(skill);
    else group.other.push(skill);
    categories.set(category, group);
  }

  return defaultCategoryOrder
    .map((name, index) => {
      const group = categories.get(name) || { matched: [], other: [] };
      return {
        name,
        skills: [...group.matched, ...group.other],
        matchedCount: group.matched.length,
        defaultIndex: index,
      };
    })
    .filter((category) => category.skills.length > 0)
    .sort((left, right) => {
      if (left.matchedCount && !right.matchedCount) return -1;
      if (!left.matchedCount && right.matchedCount) return 1;
      return left.defaultIndex - right.defaultIndex;
    })
    .map(({ name, skills }) => ({ name, skills }));
}

export function resumeSkillCategories(content: ResumeContent, jobDescription = ""): ResumeSkillCategory[] {
  if (content.skillCategories?.length) {
    const hasLegacyCategory = content.skillCategories.some(
      (category) => normalizeSkillKey(category.name) === "job aligned skills",
    );
    if (hasLegacyCategory) {
      return categorizeResumeSkills(
        content.skillCategories.flatMap((category) => category.skills),
        jobDescription,
      );
    }
    const seen = new Set<string>();
    return content.skillCategories
      .map((category) => ({
        name: category.name.trim() || "Skills",
        skills: normalizeResumeSkills(category.skills).filter((skill) => {
          const key = normalizeSkillKey(skill);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      }))
      .filter((category) => category.skills.length > 0);
  }
  return categorizeResumeSkills(content.skills, jobDescription);
}

export function flattenSkillCategories(categories: ResumeSkillCategory[]): string[] {
  return normalizeResumeSkills(categories.flatMap((category) => category.skills));
}
