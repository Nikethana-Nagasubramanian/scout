export function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .flatMap((item) => String(item).split(/\s*\|\s*/))
        .map((item) => item.trim())
        .filter(Boolean);
    }
  } catch {
    return value.split(/[\n,|]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function toJsonList(value: FormDataEntryValue | null): string {
  return JSON.stringify(
    String(value || "")
      .split(/[\n,|]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const date = new Date(normalizeDateValue(value));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(normalizeDateValue(value));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function relativeAge(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const time = new Date(normalizeDateValue(value)).getTime();
  if (Number.isNaN(time)) return "Unknown";
  const days = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function normalizeDateValue(value: string): string {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return `${value.replace(" ", "T")}Z`;
  }
  return value;
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(value: string, maximum = 160): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum - 3).trim()}...`;
}
