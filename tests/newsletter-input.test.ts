import { describe, expect, it, vi } from "vitest";
import { newsletterPageText, newsletterUrl, readNewsletterUrl } from "@/lib/newsletter-input";

const publicIp = { address: "93.184.216.34", family: 4 };
const resolve = vi.fn(async () => [publicIp]);
const html = '<html><head><title>Product &amp; Design</title><script>Fake Corp raised $1B.</script></head><body><nav>Navigation Co</nav><article><h1>Launches</h1><p>Acme AI launched an agent with human approval.</p><p>Vector Labs added enterprise customers.</p></article><footer>Sponsor Co</footer></body></html>';
const page = { status: 200, contentType: "text/html; charset=utf-8", body: html };

describe("newsletter URL input", () => {
  it("keeps article text, title, entities, and paragraphs without scripts or navigation", () => {
    const extracted = newsletterPageText(html);
    expect(extracted.title).toBe("Product & Design");
    expect(extracted.text).toContain("Acme AI launched an agent with human approval.");
    expect(extracted.text).toContain("\n");
    expect(extracted.text).not.toMatch(/Fake Corp|Navigation Co|Sponsor Co/);
    expect(newsletterPageText("<main><p>Acme&#32;AI&apos;s &#x41;gent</p></main>").text).toBe("Acme AI's Agent");
  });

  it("accepts public web links and rejects credentials, private literals, and non-web links", () => {
    expect(newsletterUrl(" https://news.example.com/issue#comments ").toString()).toBe("https://news.example.com/issue");
    for (const value of ["not a url", "file:///etc/passwd", "https://user:password@example.com", "http://localhost", "http://127.1", "http://2130706433", "http://[::1]", "https://host.local", "https://host.internal", "https://example.com:8080"]) {
      expect(() => newsletterUrl(value)).toThrow();
    }
  });

  it("passes a checked DNS address to the transport and records the final source", async () => {
    const request = vi.fn(async () => page);
    const source = await readNewsletterUrl("https://news.example.com/issue", { resolve, request });
    expect(request.mock.calls[0]).toEqual([new URL("https://news.example.com/issue"), publicIp]);
    expect(source).toMatchObject({ kind: "url", url: "https://news.example.com/issue", title: "Product & Design" });
    expect(source.text).toContain("Acme AI");
  });

  it("rejects private and mixed DNS results before making a request", async () => {
    const request = vi.fn(async () => page);
    for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "::1", "fc00::1", "::ffff:127.0.0.1", "fe80::1"]) {
      await expect(readNewsletterUrl("https://example.com", { resolve: async () => [publicIp, { address, family: address.includes(":") ? 6 : 4 }], request })).rejects.toThrow("public website");
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("follows public redirects but rejects a redirect to a local host", async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 302, location: "/issue", contentType: "", body: "" }).mockResolvedValueOnce(page);
    expect((await readNewsletterUrl("https://news.example.com", { resolve, request })).url).toBe("https://news.example.com/issue");
    const unsafe = vi.fn(async () => ({ status: 302, location: "http://localhost/private", contentType: "", body: "" }));
    await expect(readNewsletterUrl("https://news.example.com", { resolve, request: unsafe })).rejects.toThrow("public newsletter");
    expect(unsafe).toHaveBeenCalledTimes(1);
  });

  it("rechecks redirected hosts and bounds redirect loops", async () => {
    const request = vi.fn(async () => ({ status: 302, location: "https://next.example.com", contentType: "", body: "" }));
    const resolveHost = vi.fn().mockResolvedValueOnce([publicIp]).mockResolvedValueOnce([{ address: "10.1.1.1", family: 4 }]);
    await expect(readNewsletterUrl("https://news.example.com", { resolve: resolveHost, request })).rejects.toThrow("public website");
    expect(request).toHaveBeenCalledTimes(1);
    request.mockClear();
    await expect(readNewsletterUrl("https://news.example.com", { resolve, request })).rejects.toThrow("too many times");
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("reads plain text and rejects blocked, empty, gated, or oversized pages", async () => {
    const text = "Acme AI launched an agent.\n\nVector Labs added enterprise customers.";
    expect((await readNewsletterUrl("https://news.example.com/issue.txt", { resolve, request: async () => ({ ...page, contentType: "text/plain", body: text }) })).text).toBe(text);
    for (const replacement of [
      { status: 403 }, { contentType: "application/pdf" }, { body: "<article></article>" },
      { body: "<article>Subscribe to read the rest</article>" }, { body: `<article>${"x".repeat(60_001)}</article>` },
    ]) {
      await expect(readNewsletterUrl("https://news.example.com", { resolve, request: async () => ({ ...page, ...replacement }) })).rejects.toThrow();
    }
  });
});
