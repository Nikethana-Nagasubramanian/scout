function filenameSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

/** Files are named after the candidate's first name, so a recruiter can tell them apart. */
function candidatePrefix(fullName: string): string {
  return filenameSegment(fullName.trim().split(/\s+/)[0] || "", "Candidate");
}

export function resumePdfFilename(company: string, fullName = ""): string {
  return `${candidatePrefix(fullName)}_Resume_${filenameSegment(company, "Company")}.pdf`;
}

export function coverLetterPdfFilename(company: string, fullName = ""): string {
  return `${candidatePrefix(fullName)}_CoverLetter_${filenameSegment(company, "Company")}.pdf`;
}
