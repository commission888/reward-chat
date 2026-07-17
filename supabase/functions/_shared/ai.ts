// Provider-agnostic front door for the shop chatbot's AI calls. Each shop picks
// a provider (shops.ai_provider) and supplies that provider's key; every caller
// (ingest-file, line-webhook) goes through here and never imports a provider
// module directly, so adding a provider is a change in one place.
//
// Both providers are pinned to the same 1536-dim embedding space so
// document_chunks.embedding vector(1536) is untouched — see 0021 and gemini.ts.

import { createEmbeddings as openaiEmbeddings, createChatReply as openaiChat, checkApiKey as openaiCheck } from "./openai.ts";
import {
  createGeminiEmbeddings,
  createGeminiChatReply,
  checkGeminiKey,
} from "./gemini.ts";

export type AiProvider = "openai" | "gemini";

// Normalize whatever is stored/sent into a known provider, defaulting to openai
// (the only provider before 0021, and the column default).
export function asAiProvider(value: unknown): AiProvider {
  return value === "gemini" ? "gemini" : "openai";
}

export async function createEmbeddings(inputs: string[], provider: AiProvider, apiKey: string): Promise<number[][]> {
  return provider === "gemini" ? createGeminiEmbeddings(inputs, apiKey) : openaiEmbeddings(inputs, apiKey);
}

export async function createEmbedding(input: string, provider: AiProvider, apiKey: string): Promise<number[]> {
  const [embedding] = await createEmbeddings([input], provider, apiKey);
  return embedding;
}

export async function createChatReply(
  systemPrompt: string,
  userMessage: string,
  provider: AiProvider,
  apiKey: string
): Promise<string> {
  return provider === "gemini"
    ? createGeminiChatReply(systemPrompt, userMessage, apiKey)
    : openaiChat(systemPrompt, userMessage, apiKey);
}

export async function checkAiKey(
  provider: AiProvider,
  apiKey: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return provider === "gemini" ? checkGeminiKey(apiKey) : openaiCheck(apiKey);
}
