// Google Gemini (Generative Language API) client — the free-tier alternative to
// OpenAI for a shop's RAG chatbot. Mirrors the shape of _shared/openai.ts so the
// dispatcher in _shared/ai.ts can treat the two interchangeably.
//
// Key contract: embeddings MUST come out at 1536 dimensions to fit
// document_chunks.embedding vector(1536) and match_document_chunks() — the same
// size OpenAI's text-embedding-3-small produces. gemini-embedding-001 supports
// Matryoshka output sizes, so we request outputDimensionality 1536 and L2-
// normalize (Google recommends normalizing any sub-3072 output; cosine ranking
// is scale-invariant, but normalizing keeps distances well-behaved).

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const EMBEDDING_MODEL = "gemini-embedding-001";
const CHAT_MODEL = "gemini-2.0-flash";
const EMBEDDING_DIMENSION = 1536;

function headers(apiKey: string) {
  return { "Content-Type": "application/json", "x-goog-api-key": apiKey };
}

function l2normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

// Batched to one request. The Gemini batch endpoint needs `model` on every
// sub-request even though the model is also in the URL.
export async function createGeminiEmbeddings(inputs: string[], apiKey: string): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const res = await fetch(`${API_BASE}/models/${EMBEDDING_MODEL}:batchEmbedContent`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      requests: inputs.map((text) => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSION,
      })),
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini embeddings request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const embeddings = (json.embeddings ?? []) as { values?: number[] }[];
  if (embeddings.length !== inputs.length) {
    throw new Error(`Gemini returned ${embeddings.length} embeddings for ${inputs.length} inputs`);
  }
  return embeddings.map((e) => l2normalize(e.values ?? []));
}

export async function createGeminiEmbedding(input: string, apiKey: string): Promise<number[]> {
  const [embedding] = await createGeminiEmbeddings([input], apiKey);
  return embedding;
}

export async function createGeminiChatReply(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<string> {
  const res = await fetch(`${API_BASE}/models/${CHAT_MODEL}:generateContent`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini chat request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  // A safety block or empty candidate leaves no text — treat it as a failure so
  // the caller falls back rather than sending the customer an empty message.
  const text = json.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  if (!text.trim()) {
    throw new Error("Gemini returned no text (possibly blocked or empty response)");
  }
  return text;
}

// Same purpose as openai.ts's checkApiKey: prove the key can actually embed
// before we store it, surfacing Google's own error (bad key, quota) at entry
// time rather than as a silently dead chatbot days later.
export async function checkGeminiKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/models/${EMBEDDING_MODEL}:embedContent`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: "ok" }] },
        outputDimensionality: EMBEDDING_DIMENSION,
      }),
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Could not reach Gemini" };
  }

  if (res.ok) return { ok: true };

  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message ?? "";
  } catch {
    // non-JSON error body; fall back to the status alone
  }

  if (res.status === 400) return { ok: false, reason: detail || "Gemini rejected this key" };
  if (res.status === 429) {
    return { ok: false, reason: detail || "This Gemini key has hit its rate/quota limit. Try again shortly." };
  }
  return { ok: false, reason: detail || `Gemini returned ${res.status}` };
}
