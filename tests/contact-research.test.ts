import { describe, expect, it } from "vitest";
import {
  findPublicPeopleFromHtml,
  rankPublicCandidates,
  type PublicContactCandidate,
  validateHunterEmailCandidate,
} from "@/lib/contact-research";

describe("public contact evidence", () => {
  it("extracts a product leader from JSON-LD person data", () => {
    const candidates = findPublicPeopleFromHtml(`
      <script type="application/ld+json">
        {
          "@type": "Person",
          "name": "Maya Chen",
          "jobTitle": "Head of Product",
          "url": "/team/maya"
        }
      </script>
    `, "https://example.com/about");

    expect(candidates).toEqual([{
      name: "Maya Chen",
      title: "Head of Product",
      evidenceUrl: "https://example.com/team/maya",
      evidenceSummary: "Maya Chen, Head of Product",
      source: "json_ld",
    }]);
  });

  it("extracts a named founder from adjacent public page text", () => {
    const candidates = findPublicPeopleFromHtml(`
      <section>
        <h2>Jordan Patel</h2>
        <p>Co-founder and CEO</p>
      </section>
    `, "https://example.com/team");

    expect(candidates.some((candidate) => candidate.name === "Jordan Patel" && /founder/i.test(candidate.title))).toBe(true);
  });

  it("does not treat an author tag as role evidence", () => {
    const candidates = findPublicPeopleFromHtml(`
      <meta name="author" content="Taylor Morgan">
      <article><h1>How we build products</h1></article>
    `, "https://example.com/blog/product");

    expect(candidates).toEqual([]);
  });

  it("selects the appointed person instead of the company name", () => {
    const candidates = findPublicPeopleFromHtml(`
      <p>Housecall Pro launches trade-specific software packages.</p>
      <p>Housecall Pro appoints Stan Chia as Chief Executive Officer.</p>
      <p>Housecall Pro announces scholarship winners.</p>
    `, "https://www.housecallpro.com/about/newsroom/", "Housecall Pro");

    expect(candidates.map((candidate) => candidate.name)).toEqual(["Stan Chia"]);
  });

  it("extracts leadership names from a compact company about page", () => {
    const candidates = findPublicPeopleFromHtml(`
      <section>
        <div>Philip Inghelbrecht CEO and Co-Founder</div>
        <div>Mike Swinson Co-Founder and Chief Data Scientist</div>
        <div>Lara McGowan Senior Vice President, Product</div>
      </section>
    `, "https://www.tatari.tv/about-tv-ad-technology-company", "Tatari");

    expect(candidates.some((candidate) => candidate.name === "Philip Inghelbrecht")).toBe(true);
    expect(rankPublicCandidates(candidates, 1_000)[0].name).toBe("Lara McGowan");
  });
});

describe("contact ranking", () => {
  const candidates: PublicContactCandidate[] = [{
    name: "Ari Lewis",
    title: "Founder and CEO",
    evidenceUrl: "https://example.com/team",
    evidenceSummary: "Ari Lewis, Founder and CEO",
    source: "page_text",
  }, {
    name: "Maya Chen",
    title: "Head of Product",
    evidenceUrl: "https://example.com/team",
    evidenceSummary: "Maya Chen, Head of Product",
    source: "page_text",
  }];

  it("prioritizes a founder at a very small startup", () => {
    expect(rankPublicCandidates(candidates, 12)[0].name).toBe("Ari Lewis");
  });

  it("prioritizes a product leader at a larger startup", () => {
    expect(rankPublicCandidates(candidates, 40)[0].name).toBe("Maya Chen");
  });
});

describe("Hunter email validation", () => {
  it("rejects an email pattern made from the company name", () => {
    expect(validateHunterEmailCandidate({
      email: "housecall.pro@housecallpro.com",
      confidence: 63,
      verificationStatus: "unknown",
      personName: "Housecall Pro",
      companyName: "Housecall Pro",
    })).toEqual({
      accepted: false,
      reason: "Hunter returned a generic or company-name email pattern, so Scout rejected it.",
    });
  });

  it("accepts a high-confidence person-specific email", () => {
    expect(validateHunterEmailCandidate({
      email: "stan.chia@housecallpro.com",
      confidence: 92,
      verificationStatus: "valid",
      personName: "Stan Chia",
      companyName: "Housecall Pro",
    }).accepted).toBe(true);
  });

  it("rejects a low-confidence inferred email", () => {
    expect(validateHunterEmailCandidate({
      email: "s.chia@housecallpro.com",
      confidence: 63,
      verificationStatus: "unknown",
      personName: "Stan Chia",
      companyName: "Housecall Pro",
    }).accepted).toBe(false);
  });
});
