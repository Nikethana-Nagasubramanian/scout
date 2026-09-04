import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "@/lib/database";

export type AiProvider = "ollama" | "anthropic";

export const aiProviders: AiProvider[] = ["ollama", "anthropic"];

// Haiku is the cheapest current Claude model and is more than capable of the structured
// work Scout asks for. The model stays a setting so it can be raised without a code change.
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
// Loading a model from disk costs about as much as a whole request, so it is kept resident
// long enough to cover a full resume and cover letter session.
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "30m";

function cleanEnvironmentValue(value: string | undefined): string {
  return (value || "").trim().replace(/^["']|["']$/g, "");
}

export function anthropicApiKey(): string {
  return cleanEnvironmentValue(process.env.ANTHROPIC_API_KEY);
}

export function anthropicConfigured(): boolean {
  return anthropicApiKey().length > 0;
}

export function aiProvider(): AiProvider {
  const stored = getSetting("ai_provider", "ollama");
  return aiProviders.includes(stored as AiProvider) ? stored as AiProvider : "ollama";
}

export function activeModel(): string {
  return aiProvider() === "anthropic"
    ? getSetting("anthropic_model", DEFAULT_ANTHROPIC_MODEL)
    : getSetting("ollama_model", "gemma3:4b");
}

/** Describes which engine produced a draft, for the method line shown beside it. */
export function providerLabel(): string {
  return aiProvider() === "anthropic" ? `Claude ${activeModel()}` : `local AI using ${activeModel()}`;
}

export interface StructuredPromptOptions {
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
    model = activeModel(),
  } = options;

  if (aiProvider() === "anthropic") {
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
      keep_alive: OLLAMA_KEEP_ALIVE,
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
