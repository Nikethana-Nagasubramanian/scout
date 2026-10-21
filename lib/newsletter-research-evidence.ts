import type { ResearchSource } from "@/lib/newsletter-research-models";

export function sourcePassages(source: ResearchSource): { id: string; text: string }[] {
  const passages: { id: string; text: string }[] = [];
  // Stable, literal passages let the model select evidence without retyping or stitching it.
  for (const paragraph of source.text.split(/(?<=[.!?])\s+|\n\s*\n/)) {
    let offset = 0;
    while (offset < paragraph.length) {
      let end = Math.min(offset + 600, paragraph.length);
      if (end < paragraph.length) {
        const space = paragraph.lastIndexOf(" ", end);
        if (space > offset + 300) end = space;
      }
      const text = paragraph.slice(offset, end).trim();
      if (text) passages.push({ id: `${source.id}:p${passages.length + 1}`, text });
      offset = end;
    }
  }
  return passages;
}
