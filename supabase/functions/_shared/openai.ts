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

// Cheapest possible round-trip that proves a key is real and has quota. Used at
// save time so a shop finds out their key is wrong while they're looking at the
// field, rather than via a chatbot that answers nothing days later.
export async function checkApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Could not reach OpenAI" };
  }
  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, reason: "OpenAI rejected this key" };
  return { ok: false, reason: `OpenAI returned ${res.status}` };
}
