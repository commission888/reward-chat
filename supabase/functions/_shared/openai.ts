const EMBEDDING_MODEL = "text-embedding-3-small";
const CHAT_MODEL = "gpt-4o-mini";

// The API key is passed in rather than read from the environment: each shop
// brings its own (shops.openai_api_key), so there is no single key this module
// could sensibly reach for. Callers load the shop first and pass its key.
//
// Note the embedding model is deliberately NOT a per-shop choice. Every vector
// in document_chunks must come from the same model to be comparable, and the
// column and match_document_chunks() are both typed vector(1536) to match this
// one. Swapping the *key* is safe — same model, same vectors — but swapping the
// model would silently make old chunks unfindable.

export async function createEmbeddings(inputs: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.data
    .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((item: { embedding: number[] }) => item.embedding);
}

export async function createEmbedding(input: string, apiKey: string): Promise<number[]> {
  const [embedding] = await createEmbeddings([input], apiKey);
  return embedding;
}

export async function createChatReply(
  systemPrompt: string,
  userMessage: string,
  apiKey: string
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI chat request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.choices[0].message.content as string;
}

// Proves a key can actually do the job, at save time, so a shop finds out while
// they're looking at the field rather than via a chatbot that answers nothing
// for days.
//
// This deliberately embeds a real (tiny) string rather than calling a free
// endpoint like GET /v1/models. Listing models only proves the key is authentic
// — it passes for a brand-new key on an account with no credit attached, which
// is the single most likely way a shop gets this wrong: OpenAI hands out keys
// before you have paid them anything, and only the billed endpoints fail. So the
// check has to exercise the same endpoint the chatbot depends on, or it would
// hand out a green tick for a key that cannot answer a single question.
export async function checkApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: "ok" }),
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Could not reach OpenAI" };
  }

  if (res.ok) return { ok: true };

  // Surface OpenAI's own wording where we can — "you exceeded your current
  // quota" tells a shop far more than any message we could invent.
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message ?? "";
  } catch {
    // non-JSON error body; fall back to the status alone
  }

  if (res.status === 401) {
    return { ok: false, reason: detail || "OpenAI rejected this key" };
  }
  if (res.status === 429) {
    return {
      ok: false,
      reason: detail || "This key has no credit left. Add billing to your OpenAI account and try again.",
    };
  }
  return { ok: false, reason: detail || `OpenAI returned ${res.status}` };
}
