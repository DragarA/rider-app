import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

// Provider-agnostic by design (see PROJECT_SPEC.md §4.4): the model choice
// is a config value, not an architectural one. AI_PROVIDER + the matching
// API key select it at runtime; nothing downstream needs to know which
// provider is in use.
//
// OpenRouter model slugs differ from the providers' own IDs (e.g. Anthropic
// direct is "claude-haiku-4-5-20251001", OpenRouter's equivalent is
// "anthropic/claude-haiku-4.5") — confirmed against openrouter.ai/api/v1/models
// rather than guessed, since OpenRouter uses its own naming convention.
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4.1-mini";

export function getModel(): LanguageModel {
  const provider = process.env.AI_PROVIDER;

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
    }
    return anthropic(process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL);
  }

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("AI_PROVIDER=openai but OPENAI_API_KEY is not set.");
    }
    return openai(process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL);
  }

  if (provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("AI_PROVIDER=openrouter but OPENROUTER_API_KEY is not set.");
    }
    const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
    return openrouter(process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL);
  }

  throw new Error(
    `AI_PROVIDER must be set to "anthropic", "openai", or "openrouter" (got: ${provider ? `"${provider}"` : "unset"}). See .env.example.`,
  );
}
