const CANDIDATE_FILENAME_PREFIX = "Nikethana";

function filenameSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

export function resumePdfFilename(company: string): string {
  return `${CANDIDATE_FILENAME_PREFIX}_Resume_${filenameSegment(company, "Company")}.pdf`;
}

export function coverLetterPdfFilename(company: string): string {
  return `${CANDIDATE_FILENAME_PREFIX}_CoverLetter_${filenameSegment(company, "Company")}.pdf`;
}
