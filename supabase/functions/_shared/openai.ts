const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const EMBEDDING_MODEL = "text-embedding-3-small";
const CHAT_MODEL = "gpt-4o-mini";

function requireApiKey(): string {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  return OPENAI_API_KEY;
}

export async function createEmbeddings(inputs: string[]): Promise<number[][]> {
  const apiKey = requireApiKey();
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

export async function createEmbedding(input: string): Promise<number[]> {
  const [embedding] = await createEmbeddings([input]);
  return embedding;
}

export async function createChatReply(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = requireApiKey();
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
