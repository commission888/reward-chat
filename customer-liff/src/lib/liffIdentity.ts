// Resolves the LINE identity needed to call register-customer.
//
// Real flow: liff.init -> liff.login (if needed) -> liff.getIDToken(), with
// shop_id/liff_id read from the URL query params LINE appends when opening
// the LIFF app for a given shop (?shop_id=...&liff_id=...).
//
// Dev flow (VITE_LIFF_MOCK=true): skips the LIFF SDK entirely and returns a
// dev bypass token that the register-customer edge function accepts only
// when REGISTER_CUSTOMER_DEV_BYPASS_TOKEN is set server-side to the same
// value (local/dev only — never set that secret on a deployed project).
//
// This value comes from an env var, not a hardcoded literal, precisely so
// it isn't a fixed, publicly-known string baked into every deployment of
// this codebase — whoever runs local dev picks their own value and sets it
// identically in customer-liff/.env and supabase/.env.local.

const DEV_BYPASS_TOKEN = import.meta.env.VITE_DEV_BYPASS_TOKEN as string | undefined;
const DEV_LINE_USER_ID_KEY = "rewardchat_dev_line_user_id";
const SHOP_ID_KEY = "rewardchat_shop_id";
const LIFF_ID_KEY = "rewardchat_liff_id";
const GRANT_KEY = "rewardchat_grant";

// shop_id/liff_id arrive as URL query params (from the LIFF Endpoint URL), but
// liff.login() redirects through LINE's OAuth and returns to the bare endpoint
// URL, dropping our custom params. Persist them the first time we see them and
// fall back to the stored copy after the login round-trip. localStorage (not
// sessionStorage) because the LINE in-app browser can start a fresh session on
// the OAuth return; a later open with real params in the URL overwrites it.
function readParam(params: URLSearchParams, name: string, storageKey: string): string | undefined {
  const fromUrl = params.get(name);
  if (fromUrl) {
    localStorage.setItem(storageKey, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(storageKey) ?? undefined;
}

function getDevLineUserId(): string {
  let id = localStorage.getItem(DEV_LINE_USER_ID_KEY);
  if (!id) {
    id = `dev-${crypto.randomUUID()}`;
    localStorage.setItem(DEV_LINE_USER_ID_KEY, id);
  }
  return id;
}

export type LineIdentity = {
  shopId: string;
  idToken: string;
  devLineUserId?: string;
  devDisplayName?: string;
};

// A points QR opens https://liff.line.me/{liffId}?grant=<token>. LINE does not
// hand that param straight to the endpoint: it wraps it in `liff.state` and the
// SDK re-redirects to the endpoint URL with the param merged in, so `grant` only
// becomes readable in window.location once liff.init() has resolved. Between
// that and liff.login() dropping custom params on the OAuth return, the param
// can be absent on any given page load — hence the same stash-and-recover
// treatment shop_id/liff_id already get.
export function takeGrantToken(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get("grant");
  if (fromUrl) localStorage.setItem(GRANT_KEY, fromUrl);
  return localStorage.getItem(GRANT_KEY);
}

// Clear after *any* claim attempt, win or lose. A stashed token that outlives
// its claim would re-fire on the customer's next ordinary card open and greet
// them with a confusing "expired" error for something they already collected.
export function clearGrantToken(): void {
  localStorage.removeItem(GRANT_KEY);
}

export async function resolveLineIdentity(): Promise<LineIdentity> {
  const params = new URLSearchParams(window.location.search);
  const shopId = readParam(params, "shop_id", SHOP_ID_KEY) ?? import.meta.env.VITE_DEV_SHOP_ID;
  const liffId = readParam(params, "liff_id", LIFF_ID_KEY) ?? import.meta.env.VITE_DEV_LIFF_ID;
  // Stash it now in case this load already carries it (a direct endpoint-URL
  // open); takeGrantToken() runs again after init for the liff.state path.
  takeGrantToken();

  if (!shopId) {
    throw new Error("Missing shop_id. Open this app via your shop's LIFF link.");
  }

  const mock = import.meta.env.VITE_LIFF_MOCK === "true";
  if (mock) {
    if (!DEV_BYPASS_TOKEN) {
      throw new Error("VITE_LIFF_MOCK is true but VITE_DEV_BYPASS_TOKEN is not set");
    }
    return {
      shopId,
      idToken: DEV_BYPASS_TOKEN,
      devLineUserId: getDevLineUserId(),
      devDisplayName: "Dev Customer",
    };
  }

  if (!liffId) {
    throw new Error("Missing liff_id in the URL.");
  }

  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId });
  // init() is what unpacks liff.state, so a grant that arrived via a points QR
  // only shows up in the URL now.
  const grant = takeGrantToken();

  if (!liff.isLoggedIn()) {
    // Ask LINE to return to this app with our params intact (the storage
    // fallback above covers the case where LINE still strips them).
    const returnUrl =
      `${window.location.origin}${window.location.pathname}?shop_id=${encodeURIComponent(shopId)}` +
      `&liff_id=${encodeURIComponent(liffId)}` +
      (grant ? `&grant=${encodeURIComponent(grant)}` : "");
    liff.login({ redirectUri: returnUrl });
    // liff.login() redirects away; execution resumes on the next page load.
    return new Promise(() => {});
  }
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error("Could not get a LINE ID token");
  return { shopId, idToken };
}
