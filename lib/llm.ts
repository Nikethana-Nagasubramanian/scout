import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "@/lib/database";

export type AiProvider = "ollama" | "anthropic";

export const aiProviders: AiProvider[] = ["ollama", "anthropic"];

// Haiku is the cheapest current Claude model and is more than capable of the structured
// work Scout asks for. The model stays a setting so it can be raised without a code change.
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

/**
 * Keeping a model resident saves the reload on the next call, which is worth a lot when
 * Ollama does the work. When it is only the fallback, that same setting would pin gigabytes
 * of RAM for half an hour after one rare use, so it is released immediately instead.
 */
export function ollamaKeepAlive(): string {
  if (process.env.OLLAMA_KEEP_ALIVE) return process.env.OLLAMA_KEEP_ALIVE;
  return aiProvider() === "ollama" ? "30m" : "0";
}

let ollamaProbe: { checkedAt: number; reachable: boolean } | null = null;
const OLLAMA_PROBE_TTL_MS = 30_000;

/**
 * A cheap check before falling back. Without it, a fallback to an Ollama that is not running
 * costs a full request timeout to discover, which on a slow machine is the worst outcome.
 */
export async function ollamaReachable(timeoutMs = 400): Promise<boolean> {
  if (ollamaProbe && Date.now() - ollamaProbe.checkedAt < OLLAMA_PROBE_TTL_MS) return ollamaProbe.reachable;
  let reachable = false;
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    reachable = response.ok;
  } catch {
    reachable = false;
  }
  ollamaProbe = { checkedAt: Date.now(), reachable };
  return reachable;
}

function cleanEnvironmentValue(value: string | undefined): string {
  return (value || "").trim().replace(/^["']|["']$/g, "");
}

export function anthropicApiKey(): string {
  // CLAUDE_API_KEY is accepted because it is the name people reach for first, but
  // ANTHROPIC_API_KEY is canonical and what the Anthropic SDK looks for on its own.
  return cleanEnvironmentValue(process.env.ANTHROPIC_API_KEY) || cleanEnvironmentValue(process.env.CLAUDE_API_KEY);
}

export function anthropicConfigured(): boolean {
  return anthropicApiKey().length > 0;
}

export function aiProvider(): AiProvider {
  const stored = getSetting("ai_provider", "anthropic");
  return aiProviders.includes(stored as AiProvider) ? stored as AiProvider : "anthropic";
}

export function modelFor(provider: AiProvider): string {
  return provider === "anthropic"
    ? getSetting("anthropic_model", DEFAULT_ANTHROPIC_MODEL)
    : getSetting("ollama_model", "gemma3:4b");
}

export function activeModel(): string {
  return modelFor(aiProvider());
}

/**
 * The order to try providers in. The configured provider goes first; the other one follows
 * only when it can actually serve the request, so a dead fallback costs nothing.
 */
export async function providerChain(override?: AiProvider): Promise<AiProvider[]> {
  if (override) return [override];
  const primary = aiProvider();
  if (primary === "ollama") return ["ollama"];
  return await ollamaReachable() ? ["anthropic", "ollama"] : ["anthropic"];
}

/** Describes which engine produced a draft, for the method line shown beside it. */
export function providerLabel(provider: AiProvider = aiProvider()): string {
  return provider === "anthropic" ? `Claude ${modelFor(provider)}` : `local AI using ${modelFor(provider)}`;
}

export interface StructuredPromptOptions {
  /** Overrides the configured provider, for the fallback chain and the manual retry. */
  provider?: AiProvider;
  /** JSON schema handed to Ollama's format option. Claude is steered by the prompt instead. */
  format?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  model?: string;
}

/**
 * Runs one prompt that must come back as JSON, against whichever provider is configured.
 * The caller parses and validates the result, so both providers stay interchangeable.
 */
export async function runStructuredPrompt(prompt: string, options: StructuredPromptOptions = {}): Promise<string> {
  const {
    format,
    temperature = 0,
    maxTokens = 4_096,
    timeoutMs = 120_000,
    provider = aiProvider(),
    model = modelFor(provider),
  } = options;

  if (provider === "anthropic") {
    const apiKey = anthropicApiKey();
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: "Return only JSON matching the shape the prompt describes. No prose, no markdown fences.",
      messages: [{ role: "user", content: prompt }],
    }, { timeout: timeoutMs });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (!text.trim()) throw new Error("Claude returned an empty response");
    return text;
  }

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      ...(format ? { format } : {}),
      keep_alive: ollamaKeepAlive(),
      options: { temperature },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
  const payload = await response.json() as { response?: string };
  return payload.response || "{}";
}

/** Turns a provider failure into something a person can act on. */
export function describeAiFailure(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "the Claude API key was rejected";
  if (error instanceof Anthropic.RateLimitError) return "the Claude API rate limit was reached";
  if (error instanceof Anthropic.APIError) return `the Claude API returned ${error.status}`;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "the model did not finish in time";
  }
  if (error instanceof Error) return error.message;
  return "the model was unavailable";
}
