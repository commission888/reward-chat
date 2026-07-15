// Verifies LINE's X-Line-Signature header. Must be called with the exact raw
// request body text — re-serializing parsed JSON would produce different
// bytes and always fail verification.
export async function verifyLineSignature(
  rawBody: string,
  signatureHeader: string | null,
  channelSecret: string
): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  return timingSafeEqual(computed, signatureHeader);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function verifyLiffIdToken(idToken: string, liffChannelId: string): Promise<{ sub: string; name?: string; picture?: string }> {
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: liffChannelId }),
  });
  if (!res.ok) {
    throw new Error(`LINE id_token verification failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function replyMessage(accessToken: string, replyToken: string, text: string): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    throw new Error(`LINE reply failed: ${res.status} ${await res.text()}`);
  }
}

// Flex variants, kept separate from the text senders above rather than widening
// those: the RAG chat path calls them on every message and has no reason to know
// what a Flex payload is.
//
// `altText` is what shows in the chat list and on clients that can't render
// Flex, so it must carry the actual news on its own — never "[card]".
export async function replyFlexMessage(
  accessToken: string,
  replyToken: string,
  altText: string,
  contents: unknown
): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "flex", altText, contents }] }),
  });
  if (!res.ok) {
    throw new Error(`LINE flex reply failed: ${res.status} ${await res.text()}`);
  }
}

export async function pushFlexMessage(
  accessToken: string,
  to: string,
  altText: string,
  contents: unknown
): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [{ type: "flex", altText, contents }] }),
  });
  if (!res.ok) {
    throw new Error(`LINE flex push failed: ${res.status} ${await res.text()}`);
  }
}

export async function pushMessage(accessToken: string, to: string, text: string): Promise<void> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    throw new Error(`LINE push failed: ${res.status} ${await res.text()}`);
  }
}

// Downloads the binary content of an image/file message a customer sent.
// Note this hits api-data.line.me (LINE's content CDN), not api.line.me.
export async function getMessageContent(accessToken: string, messageId: string): Promise<Uint8Array> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`LINE get message content failed: ${res.status} ${await res.text()}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function getUserProfile(
  accessToken: string,
  userId: string
): Promise<{ displayName?: string; pictureUrl?: string } | null> {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null; // best-effort — a missing profile shouldn't block slip processing
  return res.json();
}
