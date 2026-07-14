// Minimal HS256 JWT sign/verify for loyalty-card QR tokens. Implemented
// directly on Web Crypto (available in the Deno edge runtime) rather than a
// third-party JWT library, since we only need this one narrow shape:
// { cid: customer_id, sid: shop_id, iat }.

function base64UrlEncode(bytes: Uint8Array): string {
  let str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export type QrTokenPayload = { cid: string; sid: string; iat: number };

export async function signQrToken(payload: Omit<QrTokenPayload, "iat">, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const fullPayload: QrTokenPayload = { ...payload, iat: Math.floor(Date.now() / 1000) };
  const encoder = new TextEncoder();
  const headerPart = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadPart = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));
  const signingInput = `${headerPart}.${payloadPart}`;
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  const signaturePart = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${signaturePart}`;
}

export async function verifyQrToken(token: string, secret: string): Promise<QrTokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed QR token");
  const [headerPart, payloadPart, signaturePart] = parts;
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  );
  if (!valid) throw new Error("Invalid QR token signature");
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
  return payload as QrTokenPayload;
}
