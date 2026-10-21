import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { stripHtml } from "@/lib/utils";

const MAX_PAGE_BYTES = 1_500_000;
export interface NewsletterSource {
  kind: "url" | "text";
  url: string | null;
  title: string;
  text: string;
  links?: PublicPageLink[];
}
export interface PublicPageLink { url: string; label: string }
export interface PublicPage { url: string; title: string; text: string; links: PublicPageLink[] }
interface Address { address: string; family: number }
interface Page { status: number; location?: string; contentType: string; body: string }
interface ReaderOptions {
  resolve?: (hostname: string) => Promise<Address[]>;
  request?: (url: URL, address: Address) => Promise<Page>;
}

export function newsletterUrl(value: string): URL {
  if (value.length > 4096) throw new Error("The newsletter link is too long. Use the public issue URL.");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a complete newsletter link starting with https://."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
    || (url.port && !["80", "443"].includes(url.port))
    || !host.includes(".") || isIP(host.replace(/^\[|\]$/g, ""))
    || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw new Error("Use a public newsletter website link without credentials or a custom port.");
  }
  url.hash = "";
  return url;
}

function publicAddress(address: string): boolean {
  if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && [0, 168].includes(b)) && !(a === 198 && [18, 19].includes(b));
}

// Pin the request to a checked DNS address; keep the original host for HTTP and TLS.
function requestPage(url: URL, address: Address): Promise<Page> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      headers: { "User-Agent": "Scout newsletter reader", Accept: "text/html,application/xhtml+xml,text/plain", "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(15_000),
      family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      const status = response.statusCode || 0;
      const contentType = String(response.headers["content-type"] || "");
      if (status >= 300 && status < 400) {
        response.resume();
        resolve({ status, location: response.headers.location, contentType, body: "" });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        resolve({ status, contentType, body: "" });
        return;
      }
      if (!/^(text\/(html|plain)|application\/xhtml\+xml)\b/i.test(contentType)) {
        response.resume();
        reject(new Error("This link is not an HTML or plain-text newsletter. Paste the issue text instead."));
        return;
      }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
        response.resume();
        reject(new Error("This website returned unsupported encoded content. Paste the issue text instead."));
        return;
      }
      if (Number(response.headers["content-length"] || 0) > MAX_PAGE_BYTES) {
        response.destroy();
        reject(new Error("This page is too large. Paste the newsletter issue text instead."));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_PAGE_BYTES) {
          response.destroy(new Error("This page is too large. Paste the newsletter issue text instead."));
        } else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

export function newsletterPageText(html: string): { title: string; text: string } {
  const title = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "Newsletter");
  const cleaned = html.replace(/<(script|style|noscript|svg|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const body = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || cleaned;
  const text = stripHtml(body
    .replace(/<\/(?:div|section|h[1-6]|article)>/gi, "\n\n")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, code: string) => {
      const value = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    }).replace(/&apos;/gi, "'"));
  return { title, text };
}

export function publicPageLinks(html: string, base: string): PublicPageLink[] {
  const links = new Map<string, PublicPageLink>();
  const cleaned = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  for (const match of cleaned.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = newsletterUrl(new URL(match[1].replace(/&amp;/gi, "&"), base).toString()).toString();
      if (!links.has(url)) links.set(url, { url, label: stripHtml(match[2]).slice(0, 200) });
    } catch { /* Only observed public web URLs become tool targets. */ }
    if (links.size >= 150) break;
  }
  return [...links.values()];
}

export async function readPublicPage(value: string, options: ReaderOptions = {}): Promise<PublicPage> {
  let url = newsletterUrl(value);
  const resolveHost = options.resolve || ((hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  const read = options.request || requestPage;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const addresses = await resolveHost(url.hostname.replace(/\.$/, ""));
    if (!addresses.length || addresses.some((item) => !publicAddress(item.address))) {
      throw new Error("The newsletter link must resolve to a public website.");
    }
    const page = await read(url, addresses[0]);
    if (page.status >= 300 && page.status < 400) {
      if (!page.location) throw new Error("The newsletter website returned an incomplete redirect.");
      url = newsletterUrl(new URL(page.location, url).toString());
      continue;
    }
    if (page.status < 200 || page.status >= 300) {
      throw new Error(`The newsletter website returned HTTP ${page.status}. Paste the issue text if the page requires access.`);
    }
    if (!/^(text\/(html|plain)|application\/xhtml\+xml)\b/i.test(page.contentType)) {
      throw new Error("This link is not an HTML or plain-text newsletter. Paste the issue text instead.");
    }
    const extracted = /^text\/plain\b/i.test(page.contentType)
      ? { title: url.hostname, text: page.body.trim() } : newsletterPageText(page.body);
    if (!extracted.text.trim() || (extracted.text.length < 800
      && /subscribe to (?:read|continue)|sign in to (?:read|continue)|paid subscribers only|enable javascript/i.test(extracted.text))) {
      throw new Error("The newsletter text is unavailable or gated. Paste the full issue text instead.");
    }
    return { url: url.toString(), ...extracted, links: publicPageLinks(page.body, url.toString()) };
  }
  throw new Error("The newsletter website redirected too many times. Paste the issue text instead.");
}

export async function readNewsletterUrl(value: string, options: ReaderOptions = {}): Promise<NewsletterSource> {
  const page = await readPublicPage(value, options);
  if (page.text.length > 60_000) throw new Error("This issue exceeds 60,000 characters. Paste a shorter issue or section.");
  return { kind: "url", ...page };
}
