import { describe, expect, it } from "vitest";
import { jobPostingDescription } from "@/lib/job-description";

function ldScript(type: string, payload: unknown): string {
  return `<html><head><script type="${type}">${JSON.stringify(payload)}</script></head><body><nav>Jobs Articles Log In For Employers</nav></body></html>`;
}

const posting = { "@type": "JobPosting", title: "Product Designer", description: "<p><strong>About Us:</strong></p><p>We build learning tools.</p>" };

describe("jobPostingDescription", () => {
  it("reads a plain JobPosting block", () => {
    const result = jobPostingDescription(ldScript("application/ld+json", posting));
    expect(result.structured).toBe(true);
    expect(result.text).toBe("About Us: We build learning tools.");
  });

  it("reads a posting wrapped in @graph", () => {
    // Schema.org lets sites nest nodes under @graph; BuiltIn does exactly this.
    const result = jobPostingDescription(ldScript("application/ld+json", {
      "@context": "https://schema.org",
      "@graph": [{ "@type": "BreadcrumbList" }, posting],
    }));
    expect(result.structured).toBe(true);
    expect(result.text).toContain("We build learning tools.");
  });

  it("reads a script tag whose type has an HTML-encoded plus", () => {
    // BuiltIn serves type="application/ld&#x2B;json"; a literal-plus regex misses it entirely.
    for (const type of ["application/ld&#x2B;json", "application/ld&#43;json"]) {
      const result = jobPostingDescription(ldScript(type, posting));
      expect(result.structured, type).toBe(true);
      expect(result.text, type).toContain("We build learning tools.");
    }
  });

  it("marks a page with no JobPosting as an unstructured read", () => {
    const result = jobPostingDescription("<html><body><nav>Jobs Articles</nav><p>Sorry, this job is closed.</p></body></html>");
    expect(result.structured).toBe(false);
    expect(result.text).toContain("Sorry, this job is closed.");
  });

  it("skips malformed JSON without giving up on later blocks", () => {
    const html = `<script type="application/ld+json">{not json</script>${ldScript("application/ld+json", posting)}`;
    expect(jobPostingDescription(html).structured).toBe(true);
  });
});
