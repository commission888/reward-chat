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

export async function resolveLineIdentity(): Promise<LineIdentity> {
  const params = new URLSearchParams(window.location.search);
  const shopId = params.get("shop_id") ?? import.meta.env.VITE_DEV_SHOP_ID;
  const liffId = params.get("liff_id") ?? import.meta.env.VITE_DEV_LIFF_ID;

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
  if (!liff.isLoggedIn()) {
    liff.login();
    // liff.login() redirects away; execution resumes on the next page load.
    return new Promise(() => {});
  }
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error("Could not get a LINE ID token");
  return { shopId, idToken };
}
